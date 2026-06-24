import { VersionedTransaction } from "@solana/web3.js";
import { config, treasuryKeypair } from "./config.js";
import { getClaim, recordClaim } from "./db.js";
import { connection } from "./solana.js";

export type ClaimResult = {
  amountClaimed: bigint;
  txSig: string | null;
};

async function safeRecordClaim(epochId: string, amountClaimed: string, txSig: string | null) {
  try {
    await recordClaim(epochId, amountClaimed, txSig);
  } catch (error) {
    console.warn(`[${epochId}] failed to record claim:`, error);
  }
}

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

  if (!config.claimEnabled) {
    console.log(`[${epochId}] [DRY-RUN] would claim creator fees`);
    return { amountClaimed: 0n, txSig: null };
  }

  try {
    const response = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        publicKey: treasury.publicKey.toBase58(),
        action: "collectCreatorFee",
        priorityFee: 0.000001
      })
    });

    if (!response.ok) {
      console.warn(`[${epochId}] creator-fee claim returned ${response.status}: ${await response.text()}`);
      await safeRecordClaim(epochId, "0", null);
      return { amountClaimed: 0n, txSig: null };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) {
      console.log(`[${epochId}] no creator fees to claim`);
      await safeRecordClaim(epochId, "0", null);
      return { amountClaimed: 0n, txSig: null };
    }

    const tx = VersionedTransaction.deserialize(bytes);
    tx.sign([treasury]);

    const txSig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
    await connection.confirmTransaction(txSig, "confirmed");
    await safeRecordClaim(epochId, "0", txSig);
    console.log(`[${epochId}] claimed creator fees: ${txSig}`);
    return { amountClaimed: 0n, txSig };
  } catch (error) {
    console.warn(`[${epochId}] creator-fee claim skipped:`, error);
    await safeRecordClaim(epochId, "0", null);
    return { amountClaimed: 0n, txSig: null };
  }
}
