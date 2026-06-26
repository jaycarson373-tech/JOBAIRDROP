# Pump 5-Minute Airdrop Worker

Standalone Railway worker for token-holder rewards. Every 5 minutes it:

1. claims creator fees when enabled,
2. buys the reward token with treasury base funds while leaving a SOL gas buffer,
3. snapshots source-token holders with at least `ELIGIBILITY_MIN` whole tokens,
4. computes rewards,
5. airdrops the reward token,
6. writes proof and idempotency records to Supabase.

Both live money-moving switches default to `false`.

## Safety Model

- `BUY_ENABLED=false`: the worker logs the Jupiter quote but does not swap.
- `AIRDROP_ENABLED=false`: the worker logs computed payouts but does not send.
- `CLAIM_ENABLED=false`: the worker logs the creator-fee claim step but does not claim.
- Idempotency key: `${epoch_id}:${wallet}`.
- Each epoch is floored to a 5-minute UTC timestamp.
- The in-process lock prevents overlapping epochs in one Railway process.
- Missing `HELIUS_RPC_URL` fails loudly. There is no public RPC fallback.

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env` locally or in Railway:

```env
HELIUS_RPC_URL=
SOURCE_TOKEN_MINT=
REWARD_TOKEN_MINT=
TREASURY_WALLET_SECRET=
TREASURY_BASE=SOL
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
SUPABASE_URL=
SUPABASE_SERVICE_ROLE=
CLAIM_ENABLED=false
AIRDROP_ENABLED=false
BUY_ENABLED=false
MIN_TREASURY_TO_RUN=0.01
MAX_WALLETS_PER_EPOCH=500
ELIGIBILITY_MIN=1000000
DISTRIBUTION_MODE=proportional
SWAP_SLIPPAGE_BPS=300
GAS_BUFFER_SOL=0.05
AIRDROP_BATCH_SIZE=4
AIRDROP_SOL_RESERVE=0.05
MAX_HOLDER_PCT=5
EXCLUDE_WALLETS=
```

Legacy env aliases still work: `MCJOB_MINT` maps to `SOURCE_TOKEN_MINT`, and `MCDX_MINT` / `PUMP_MINT` map to `REWARD_TOKEN_MINT`.

Apply the Supabase migration:

```sql
-- supabase/migrations/001_airdrop_worker.sql
```

## Local Dry Run

```bash
npm run dev
```

Dry-run logs include:

- eligible holder count,
- `[DRY-RUN] would buy ...`,
- `[DRY-RUN] would send ...`.

## Railway Deploy

Create a Railway service from this folder and set the start command:

```bash
npm start
```

This is a worker/background process, not a web service.

## Going Live

1. Deploy with both flags false.
2. Watch dry-run snapshots and computed payouts.
3. Set `BUY_ENABLED=true`.
4. Verify one real buy is recorded in `buys`.
5. Set `AIRDROP_ENABLED=true`.
6. Verify the first real airdrop tx signatures in `payouts`.

Distribution defaults to proportional by source-token balance. Keep this for supply-weighted rewards:

```env
DISTRIBUTION_MODE=proportional
```

Set `MAX_HOLDER_PCT=5` to exclude any wallet holding at least 5% of total source-token supply.
