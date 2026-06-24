import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { config, treasuryKeypair } from "./config.js";
import { getClaim, recordClaim } from "./db.js";
import { connection } from "./solana.js";

export type ClaimResult = {
  amountClaimed: bigint;
  txSig: string | null;
};

const sdk = new OnlinePumpSdk(connection);

export async function claimFees(epochId: string): Promise<ClaimResult> {
  const existing = await getClaim(epochId);
  if (existing) {
    console.log(`[${epochId}] claim already recorded, skipping`);
    return {
      amountClaimed: BigInt(existing.amount_claimed ?? "0"),
      txSig: existing.tx_sig ?? null
    };
  }

  const treasury = treasuryKeypair();
  const claimable = BigInt(
    (await sdk.getCreatorVaultBalanceBothPrograms(treasury.publicKey)).toString()
  );
  console.log(`[${epochId}] claimable creator fees: ${claimable.toString()} lamports`);

  if (!config.claimEnabled) {
    console.log(`[${epochId}] [DRY-RUN] would claim fees`);
    return { amountClaimed: 0n, txSig: null };
  }

  if (claimable <= 0n) {
    console.log(`[${epochId}] no creator fees to claim`);
    await recordClaim(epochId, "0", null);
    return { amountClaimed: 0n, txSig: null };
  }

  const instructions = await sdk.collectCoinCreatorFeeV2Instructions(
    treasury.publicKey,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
    treasury.publicKey
  );

  const tx = new Transaction().add(...instructions);
  tx.feePayer = treasury.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(treasury);

  const simulation = await connection.simulateTransaction(tx);
  if (simulation.value.err) {
    console.error(simulation.value.logs?.join("\n"));
    throw new Error(`Claim simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  const txSig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
  await connection.confirmTransaction(txSig, "confirmed");
  await recordClaim(epochId, claimable.toString(), txSig);
  console.log(`[${epochId}] claimed creator fees: ${txSig}`);
  return { amountClaimed: claimable, txSig };
}
