import { LAMPORTS_PER_SOL, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { config, treasuryKeypair } from "./config.js";
import { connection } from "./solana.js";

export type BuyResult = {
  baseSpent: bigint;
  mcdxReceived: bigint;
  txSig: string | null;
};

export async function availableTreasuryBase(): Promise<bigint> {
  if (config.treasuryBase !== "SOL") {
    throw new Error("USDC treasury base is not implemented yet; set TREASURY_BASE=SOL");
  }
  const treasury = treasuryKeypair();
  const balance = await connection.getBalance(treasury.publicKey, "confirmed");
  const reserve = BigInt(Math.floor(config.solReserve * LAMPORTS_PER_SOL));
  return BigInt(Math.max(0, balance - Number(reserve)));
}

async function jupiterSwap(baseLamports: bigint, treasuryPublicKey: string) {
  const query = new URLSearchParams({
    inputMint: NATIVE_MINT.toBase58(),
    outputMint: config.mcdxMint.toBase58(),
    amount: baseLamports.toString(),
    slippageBps: String(config.swapSlippageBps),
    restrictIntermediateTokens: "true"
  });
  const quoteResponse = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${query}`);
  if (!quoteResponse.ok) throw new Error(`Jupiter quote failed: ${await quoteResponse.text()}`);
  const quote = await quoteResponse.json() as any;

  const swapResponse = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: treasuryPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: false
    })
  });
  if (!swapResponse.ok) throw new Error(`Jupiter swap build failed: ${await swapResponse.text()}`);
  return { quote, swap: await swapResponse.json() as any };
}

export async function buyMcdx(epochId: string): Promise<BuyResult> {
  const treasury = treasuryKeypair();
  const available = await availableTreasuryBase();
  const min = BigInt(Math.floor(config.minTreasuryToRun * LAMPORTS_PER_SOL));
  if (available < min) {
    console.log(`[${epochId}] insufficient treasury, skipping buy+airdrop`);
    return { baseSpent: 0n, mcdxReceived: 0n, txSig: null };
  }

  const { quote, swap } = await jupiterSwap(available, treasury.publicKey.toBase58());
  const outAmount = BigInt(quote.outAmount);
  console.log(`[${epochId}] ${config.buyEnabled ? "" : "[DRY-RUN] "}would buy ${outAmount.toString()} raw MCDx for ${available.toString()} lamports`);

  if (!config.buyEnabled) {
    return { baseSpent: available, mcdxReceived: outAmount, txSig: null };
  }

  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
  tx.sign([treasury]);
  const simulation = await connection.simulateTransaction(tx, { replaceRecentBlockhash: true, sigVerify: false });
  if (simulation.value.err) {
    console.error(simulation.value.logs?.join("\n"));
    throw new Error(`Swap simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  const txSig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
  await connection.confirmTransaction(txSig, "confirmed");
  return { baseSpent: available, mcdxReceived: outAmount, txSig };
}
