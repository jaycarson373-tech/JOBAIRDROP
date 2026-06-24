import { config } from "./config.js";
import { airdropMcdx, computeAllocations } from "./airdrop.js";
import { buyMcdx } from "./buy.js";
import {
  completeEpoch,
  failEpoch,
  getEpoch,
  persistSnapshot,
  recordBuy,
  startEpoch
} from "./db.js";
import { snapshotEligibleHolders } from "./snapshot.js";
import { currentEpochId } from "./time.js";

let inProgress = false;

export async function runEpoch(date = new Date()) {
  if (inProgress) {
    console.log("[SKIP] previous epoch still running");
    return;
  }
  inProgress = true;
  const epochId = currentEpochId(date);

  try {
    const existing = await getEpoch(epochId);
    if (existing?.status === "completed") {
      console.log(`[${epochId}] already completed, skipping`);
      return;
    }

    await startEpoch(epochId);
    const holders = await snapshotEligibleHolders();
    await persistSnapshot(
      epochId,
      holders.map((holder) => ({
        wallet: holder.wallet,
        mcjob_balance: holder.uiBalance.toString()
      }))
    );
    console.log(`[${epochId}] snapshot eligible holders: ${holders.length}`);

    const buy = await buyMcdx(epochId);
    await recordBuy(epochId, buy.baseSpent.toString(), buy.mcdxReceived.toString(), buy.txSig);

    if (buy.mcdxReceived <= 0n) {
      await completeEpoch(epochId, {
        eligible_count: holders.length,
        mcdx_bought: "0",
        mcdx_distributed: "0",
        status: "skipped"
      });
      return;
    }

    const allocations = computeAllocations(holders, buy.mcdxReceived);
    await airdropMcdx(epochId, allocations);
    const distributed = allocations.reduce((sum, row) => sum + row.amount, 0n);
    await completeEpoch(epochId, {
      eligible_count: holders.length,
      mcdx_bought: buy.mcdxReceived.toString(),
      mcdx_distributed: distributed.toString()
    });
    console.log(
      `[${epochId}] summary: eligible=${holders.length}, mode=${config.distributionMode}, bought=${buy.mcdxReceived}, distributed=${distributed}`
    );
  } catch (error) {
    await failEpoch(epochId, error).catch((dbError) => {
      console.error(`[${epochId}] failed to mark epoch failed`, dbError);
    });
    console.error(`[${epochId}] epoch failed`, error);
  } finally {
    inProgress = false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEpoch();
}
