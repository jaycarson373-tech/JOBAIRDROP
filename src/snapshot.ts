import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import { config } from "./config.js";
import { connection } from "./solana.js";

export type Holder = {
  wallet: string;
  rawBalance: bigint;
  uiBalance: number;
};

async function tokenProgramForMint(mint: PublicKey) {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint not found: ${mint.toBase58()}`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unsupported token program: ${info.owner.toBase58()}`);
}

export async function snapshotEligibleHolders(): Promise<Holder[]> {
  const tokenProgram = await tokenProgramForMint(config.mcjobMint);
  const mintInfo = await getMint(connection, config.mcjobMint, "confirmed", tokenProgram);
  const accounts = await connection.getParsedProgramAccounts(tokenProgram, {
    filters: [{ memcmp: { offset: 0, bytes: config.mcjobMint.toBase58() } }]
  });

  const balances = new Map<string, bigint>();
  for (const account of accounts) {
    const parsed = (account.account.data as any).parsed?.info;
    if (!parsed?.owner || !parsed?.tokenAmount?.amount) continue;
    if (!PublicKey.isOnCurve(new PublicKey(parsed.owner).toBytes())) continue;
    const amount = BigInt(parsed.tokenAmount.amount);
    balances.set(parsed.owner, (balances.get(parsed.owner) ?? 0n) + amount);
  }

  const minRaw = BigInt(Math.floor(config.eligibilityMin * 10 ** mintInfo.decimals));
  const holders = [...balances.entries()]
    .filter(([, amount]) => amount >= minRaw)
    .sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1))
    .map(([wallet, rawBalance]) => ({
      wallet,
      rawBalance,
      uiBalance: Number(rawBalance) / 10 ** mintInfo.decimals
    }));

  if (holders.length > config.maxWalletsPerEpoch) {
    console.warn(
      `[WARN] ${holders.length} eligible holders exceeds MAX_WALLETS_PER_EPOCH=${config.maxWalletsPerEpoch}; processing all in batches.`
    );
  }

  return holders;
}
