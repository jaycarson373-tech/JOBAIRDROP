import { PublicKey, Transaction } from "@solana/web3.js";
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

export async function airdropMcdx(epochId: string, allocations: Allocation[]) {
  const treasury = treasuryKeypair();
  const tokenProgram = await tokenProgramForMint(config.mcdxMint);
  const mintInfo = await getMint(connection, config.mcdxMint, "confirmed", tokenProgram);
  const sourceAta = getAssociatedTokenAddressSync(config.mcdxMint, treasury.publicKey, false, tokenProgram);

  console.log(`[${epochId}] proof before send: ${allocations.length} payouts`);
  for (const allocation of allocations) {
    console.log(`[${epochId}] ${config.airdropEnabled ? "" : "[DRY-RUN] "}would send ${allocation.amount.toString()} raw MCDx to ${allocation.wallet}`);
  }

  if (!config.airdropEnabled) {
    for (const allocation of allocations) {
      await dryRunPayout(epochId, allocation.wallet, allocation.amount.toString());
    }
    return [];
  }

  const signatures: string[] = [];
  for (const allocation of allocations) {
    await planPayout(epochId, allocation.wallet, allocation.amount.toString());
    try {
      const owner = new PublicKey(allocation.wallet);
      const destinationAta = getAssociatedTokenAddressSync(config.mcdxMint, owner, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
      const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          treasury.publicKey,
          destinationAta,
          owner,
          config.mcdxMint,
          tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        createTransferCheckedInstruction(
          sourceAta,
          config.mcdxMint,
          destinationAta,
          treasury.publicKey,
          allocation.amount,
          mintInfo.decimals,
          [],
          tokenProgram
        )
      );
      tx.feePayer = treasury.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      tx.sign(treasury);
      const simulation = await connection.simulateTransaction(tx);
      if (simulation.value.err) {
        throw new Error(`Transfer simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }
      const txSig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
      await connection.confirmTransaction(txSig, "confirmed");
      await settlePayout(epochId, allocation.wallet, txSig);
      console.log(`[${epochId}] settled ${allocation.wallet}: ${txSig}`);
      signatures.push(txSig);
    } catch (error) {
      await failPayout(epochId, allocation.wallet, error);
      console.error(`[${epochId}] payout failed for ${allocation.wallet}:`, error);
    }
  }
  return signatures;
}
