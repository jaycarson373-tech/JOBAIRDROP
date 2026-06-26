import { LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint
} from "@solana/spl-token";
import { config, treasuryKeypair } from "./config.js";
import { connection } from "./solana.js";
import { dryRunPayout, failPayout, planPayout, settlePayout } from "./db.js";
import type { Holder } from "./snapshot.js";

export type Allocation = {
  wallet: string;
  amount: bigint;
};

type PreparedAllocation = Allocation & {
  owner: PublicKey;
  destinationAta: PublicKey;
};

async function tokenProgramForMint(mint: PublicKey) {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint not found: ${mint.toBase58()}`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unsupported token program: ${info.owner.toBase58()}`);
}

export function computeAllocations(holders: Holder[], mcdxRaw: bigint): Allocation[] {
  if (!holders.length || mcdxRaw <= 0n) return [];
  if (config.distributionMode === "equal") {
    const each = mcdxRaw / BigInt(holders.length);
    return holders.map((holder) => ({ wallet: holder.wallet, amount: each })).filter((row) => row.amount > 0n);
  }

  const totalWeight = holders.reduce((sum, holder) => sum + holder.rawBalance, 0n);
  return holders
    .map((holder) => ({
      wallet: holder.wallet,
      amount: (mcdxRaw * holder.rawBalance) / totalWeight
    }))
    .filter((row) => row.amount > 0n);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function missingAtaRentLamports(atas: PublicKey[]) {
  const accounts = await connection.getMultipleAccountsInfo(atas, "confirmed");
  const missingCount = accounts.filter((account) => account === null).length;
  const rent = await connection.getMinimumBalanceForRentExemption(165);
  return BigInt(missingCount * rent);
}

export async function airdropMcdx(epochId: string, allocations: Allocation[]) {
  const treasury = treasuryKeypair();
  const tokenProgram = await tokenProgramForMint(config.rewardTokenMint);
  const mintInfo = await getMint(connection, config.rewardTokenMint, "confirmed", tokenProgram);
  const sourceAta = getAssociatedTokenAddressSync(config.rewardTokenMint, treasury.publicKey, false, tokenProgram);

  console.log(`[${epochId}] proof before send: ${allocations.length} payouts`);
  for (const allocation of allocations) {
    console.log(`[${epochId}] ${config.airdropEnabled ? "" : "[DRY-RUN] "}would send ${allocation.amount.toString()} raw reward tokens to ${allocation.wallet}`);
  }

  if (!config.airdropEnabled) {
    for (const allocation of allocations) {
      await dryRunPayout(epochId, allocation.wallet, allocation.amount.toString());
    }
    return [];
  }

  const prepared: PreparedAllocation[] = allocations.map((allocation) => {
    const owner = new PublicKey(allocation.wallet);
    return {
      ...allocation,
      owner,
      destinationAta: getAssociatedTokenAddressSync(config.rewardTokenMint, owner, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID)
    };
  });

  const signatures: string[] = [];
  const batches = chunk(prepared, config.airdropBatchSize);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const reserveLamports = BigInt(Math.floor(config.airdropSolReserve * LAMPORTS_PER_SOL));
    const estimatedRentLamports = await missingAtaRentLamports(batch.map((allocation) => allocation.destinationAta));
    const estimatedFeeLamports = 10_000n;
    const requiredLamports = reserveLamports + estimatedRentLamports + estimatedFeeLamports;
    const balanceLamports = BigInt(await connection.getBalance(treasury.publicKey, "confirmed"));

    if (balanceLamports < requiredLamports) {
      const error = new Error(
        `Treasury SOL below airdrop reserve: balance=${balanceLamports}, required=${requiredLamports}, reserve=${reserveLamports}, estimatedAtaRent=${estimatedRentLamports}`
      );
      console.error(`[${epochId}] stopping airdrop batch: ${error.message}`);
      const remaining = batches.slice(batchIndex).flat();
      for (const allocation of remaining) {
        await failPayout(epochId, allocation.wallet, error);
      }
      break;
    }

    for (const allocation of batch) {
      await planPayout(epochId, allocation.wallet, allocation.amount.toString());
    }

    try {
      const tx = new Transaction();
      for (const allocation of batch) {
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            treasury.publicKey,
            allocation.destinationAta,
            allocation.owner,
            config.rewardTokenMint,
            tokenProgram,
            ASSOCIATED_TOKEN_PROGRAM_ID
          ),
          createTransferCheckedInstruction(
            sourceAta,
            config.rewardTokenMint,
            allocation.destinationAta,
            treasury.publicKey,
            allocation.amount,
            mintInfo.decimals,
            [],
            tokenProgram
          )
        );
      }
      tx.feePayer = treasury.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      tx.sign(treasury);
      const simulation = await connection.simulateTransaction(tx);
      if (simulation.value.err) {
        throw new Error(`Transfer simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }
      const txSig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
      await connection.confirmTransaction(txSig, "confirmed");
      for (const allocation of batch) {
        await settlePayout(epochId, allocation.wallet, txSig);
        console.log(`[${epochId}] settled ${allocation.wallet}: ${txSig}`);
      }
      signatures.push(txSig);
    } catch (error) {
      for (const allocation of batch) {
        await failPayout(epochId, allocation.wallet, error);
        console.error(`[${epochId}] payout failed for ${allocation.wallet}:`, error);
      }
    }
  }
  return signatures;
}
