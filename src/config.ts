import "dotenv/config";
import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";

export type DistributionMode = "proportional" | "equal";
export type TreasuryBase = "SOL" | "USDC";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredAny(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required`);
}

function bool(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value.toLowerCase() === "true";
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function publicKeyList(name: string): PublicKey[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new PublicKey(value));
}

export function treasuryKeypair(): Keypair {
  const raw = required("TREASURY_WALLET_SECRET");
  const bytes = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw))
    : bs58.decode(raw);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error("TREASURY_WALLET_SECRET must decode to 32 or 64 bytes");
}

const sourceTokenMint = new PublicKey(requiredAny(["SOURCE_TOKEN_MINT", "MCJOB_MINT"]));
const rewardTokenMint = new PublicKey(requiredAny(["REWARD_TOKEN_MINT", "PUMP_MINT", "MCDX_MINT"]));

export const config = {
  heliusRpcUrl: required("HELIUS_RPC_URL"),
  sourceTokenMint,
  rewardTokenMint,
  mcjobMint: sourceTokenMint,
  mcdxMint: rewardTokenMint,
  usdcMint: new PublicKey(process.env.USDC_MINT?.trim() || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  treasuryBase: (process.env.TREASURY_BASE?.trim() || "SOL") as TreasuryBase,
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRole: required("SUPABASE_SERVICE_ROLE"),
  claimEnabled: bool("CLAIM_ENABLED", false),
  buyEnabled: bool("BUY_ENABLED", false),
  airdropEnabled: bool("AIRDROP_ENABLED", false),
  minTreasuryToRun: numberEnv("MIN_TREASURY_TO_RUN", 0.01),
  maxWalletsPerEpoch: numberEnv("MAX_WALLETS_PER_EPOCH", 500),
  eligibilityMin: numberEnv("ELIGIBILITY_MIN", 1_000_000),
  distributionMode: (process.env.DISTRIBUTION_MODE?.trim() || "proportional") as DistributionMode,
  swapSlippageBps: numberEnv("SWAP_SLIPPAGE_BPS", 300),
  gasBufferSol: numberEnv("GAS_BUFFER_SOL", numberEnv("SOL_RESERVE", 0.05)),
  airdropBatchSize: Math.max(1, Math.floor(numberEnv("AIRDROP_BATCH_SIZE", 4))),
  airdropSolReserve: numberEnv("AIRDROP_SOL_RESERVE", numberEnv("GAS_BUFFER_SOL", numberEnv("SOL_RESERVE", 0.05))),
  maxHolderPct: numberEnv("MAX_HOLDER_PCT", 5),
  excludeWallets: publicKeyList("EXCLUDE_WALLETS")
};

if (!["SOL", "USDC"].includes(config.treasuryBase)) {
  throw new Error("TREASURY_BASE must be SOL or USDC");
}

if (!["proportional", "equal"].includes(config.distributionMode)) {
  throw new Error("DISTRIBUTION_MODE must be proportional or equal");
}
