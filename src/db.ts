import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRole,
  { auth: { persistSession: false } }
);

export type EpochStatus = "running" | "completed" | "failed" | "skipped";

function assertNoError<T>(result: { data: T; error: unknown }, label: string): T {
  if (result.error) throw new Error(`${label}: ${JSON.stringify(result.error)}`);
  return result.data;
}

export async function getEpoch(epochId: string) {
  const result = await supabase
    .from("epochs")
    .select("*")
    .eq("epoch_id", epochId)
    .maybeSingle();
  return assertNoError(result, "get epoch");
}

export async function startEpoch(epochId: string) {
  const result = await supabase
    .from("epochs")
    .upsert({ epoch_id: epochId, status: "running", started_at: new Date().toISOString() })
    .select()
    .single();
  return assertNoError(result, "start epoch");
}

export async function completeEpoch(
  epochId: string,
  fields: { eligible_count: number; mcdx_bought: string; mcdx_distributed: string; status?: EpochStatus }
) {
  const result = await supabase
    .from("epochs")
    .update({
      ...fields,
      status: fields.status ?? "completed",
      completed_at: new Date().toISOString()
    })
    .eq("epoch_id", epochId);
  assertNoError(result, "complete epoch");
}

export async function failEpoch(epochId: string, error: unknown) {
  const result = await supabase
    .from("epochs")
    .update({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      completed_at: new Date().toISOString()
    })
    .eq("epoch_id", epochId);
  assertNoError(result, "fail epoch");
}

export async function persistSnapshot(epochId: string, rows: { wallet: string; mcjob_balance: string }[]) {
  if (!rows.length) return;
  const result = await supabase.from("snapshots").upsert(
    rows.map((row) => ({ epoch_id: epochId, ...row }))
  );
  assertNoError(result, "persist snapshot");
}

export async function recordBuy(epochId: string, baseSpent: string, mcdxReceived: string, txSig: string | null) {
  const result = await supabase
    .from("buys")
    .upsert({ epoch_id: epochId, base_spent: baseSpent, mcdx_received: mcdxReceived, tx_sig: txSig });
  assertNoError(result, "record buy");
}

export async function getClaim(epochId: string) {
  const result = await supabase
    .from("claims")
    .select("*")
    .eq("epoch_id", epochId)
    .maybeSingle();
  return assertNoError(result, "get claim");
}

export async function recordClaim(epochId: string, amountClaimed: string, txSig: string | null) {
  const result = await supabase
    .from("claims")
    .upsert({ epoch_id: epochId, amount_claimed: amountClaimed, tx_sig: txSig });
  assertNoError(result, "record claim");
}

export async function planPayout(epochId: string, wallet: string, amount: string) {
  const idempotencyKey = `${epochId}:${wallet}`;
  const result = await supabase
    .from("payouts")
    .upsert(
      {
        epoch_id: epochId,
        wallet,
        mcdx_amount: amount,
        idempotency_key: idempotencyKey,
        status: "planned",
        updated_at: new Date().toISOString()
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    )
    .select()
    .maybeSingle();
  return assertNoError(result, "plan payout");
}

export async function settlePayout(epochId: string, wallet: string, txSig: string) {
  const result = await supabase
    .from("payouts")
    .update({ status: "settled", tx_sig: txSig, updated_at: new Date().toISOString() })
    .eq("epoch_id", epochId)
    .eq("wallet", wallet);
  assertNoError(result, "settle payout");
}

export async function dryRunPayout(epochId: string, wallet: string, amount: string) {
  const result = await supabase
    .from("payouts")
    .upsert({
      epoch_id: epochId,
      wallet,
      mcdx_amount: amount,
      idempotency_key: `${epochId}:${wallet}`,
      status: "dry_run",
      updated_at: new Date().toISOString()
    });
  assertNoError(result, "dry-run payout");
}

export async function failPayout(epochId: string, wallet: string, error: unknown) {
  const result = await supabase
    .from("payouts")
    .update({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      updated_at: new Date().toISOString()
    })
    .eq("epoch_id", epochId)
    .eq("wallet", wallet);
  assertNoError(result, "fail payout");
}
