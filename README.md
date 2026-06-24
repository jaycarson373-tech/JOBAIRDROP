# McJob 5-Minute Airdrop Worker

Standalone Railway worker for `$MCJOB` holder rewards. Every 5 minutes it:

1. claims creator fees when enabled,
2. buys MCDx with treasury base funds while leaving a SOL gas buffer,
3. snapshots eligible `$MCJOB` holders with whale and pool exclusion,
4. computes rewards,
5. airdrops MCDx,
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
MCJOB_MINT=
MCDX_MINT=XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2
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
MAX_HOLDER_PCT=4
EXCLUDE_WALLETS=
```

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

Distribution defaults to proportional by `$MCJOB` balance. To switch to equal split:

```env
DISTRIBUTION_MODE=equal
```
