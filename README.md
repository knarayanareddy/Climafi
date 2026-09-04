# Nimbus — Parametric Climate Risk Protocol (MVP)

Solana-native parametric climate coverage. Buy USDC-denominated rainfall policies with
deterministic, oracle-driven settlement — no claims, no adjusters, pure data.

| Layer | Location |
|---|---|
| On-chain program (Anchor/Rust) | `programs/nimbus/` |
| Frontend (Next.js 14) | `app/` |
| Off-chain services (oracle, settlement, monitoring) | `offchain/` |
| Client SDK + transaction builders | `lib/` |
| Deploy / demo scripts | `scripts/` |
| Database schema | `db/` |
| Full specification | `master designdoc.md` |

---

## 1. Prerequisites

- **Node.js 18+** and npm
- **Rust** + **Solana CLI** + **Anchor 0.29** (`cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.29.0 && avm use 0.29.0`)
- A Solana wallet (Phantom) for the *buyer* role (the protocol admin is a CLI keypair)

---

## 2. Install

```bash
npm install
```

---

## 3. Deploy runbook (devnet or localnet)

### 3.1 Generate your program keypair and update the program ID (one-time)

The repo ships with a placeholder program ID (`CLiMaFi111…`). You must deploy with a
keypair **you** own. Generate one and replace the placeholder in every layer:

```bash
solana-keygen new -o target/deploy/nimbus-keypair.json --no-bip39-passphrase --force
NEW_ID=$(solana address -k target/deploy/nimbus-keypair.json)
sed -i "s/CLiMaFi1111111111111111111111111111111111111/${NEW_ID}/g" \
  programs/nimbus/src/lib.rs \
  Anchor.toml \
  lib/nimbus.ts \
  offchain/monitoring.ts \
  offchain/oracle-aggregator.ts \
  offchain/policy-monitor.ts \
  .env.example
```

Verify nothing references the placeholder anymore:

```bash
grep -rn "CLiMaFi" --include="*.ts" --include="*.rs" --include="*.toml" . | grep -v node_modules
# (must print nothing)
```

### 3.2 Build

```bash
anchor build
```

This compiles the program and generates `target/idl/nimbus.json` — the IDL the offchain
services and deploy/demo scripts load at runtime.

### 3.3 Deploy the program

**Option A — local validator** (fastest, unlimited SOL, great for the demo video):

```bash
# terminal 1
anchor localnet          # starts a validator AND deploys the program
```

**Option B — devnet** (public links + contract address for the submission):

```bash
solana config set --url devnet
solana airdrop 2         # funds ~/.config/solana/id.json (the anchor provider wallet)
anchor deploy
```

> Devnet faucets are rate-limited (~2 SOL/request, a few per day). For the demo video,
> Option A is zero-friction and looks identical (real transaction signatures, local chain).

### 3.4 Bootstrap on-chain state (USDC mint + config + pool + capital)

```bash
SOLANA_RPC_URL=http://localhost:8899 npm run deploy   # localnet
npm run deploy                                        # devnet (default)
```

`scripts/deploy.ts` does, in order:

1. Generates keypairs under `keys/` (gitignored): `admin`, `oracle`, `quote_signer`,
   `treasury`, `usdc_mint`.
2. Funds `admin` + `oracle` (airdrop, devnet only).
3. Creates the **devnet USDC mint** (6 decimals) and mints 1,000,000 USDC to the admin.
4. `initialize_config` — sets protocol fee (1%), oracle staleness (1 day), policy duration
   bounds, the **quote signer** and **oracle authority**.
5. `create_pool` — Pool #1 (Rainfall, 80% LTV limit).
6. `deposit_liquidity` — seeds 10,000 USDC of capital (required, or `buy_policy` fails the
   LTV check).
7. (optional) funds a buyer wallet — see §3.7.

It prints a copy-paste environment block at the end.

> Prefer a dry run first: `npm run deploy:dryrun` prints every address without touching a
> cluster.

### 3.5 Configure the app

Create `.env.local` and paste the block printed by `npm run deploy`:

```bash
SOLANA_RPC_URL=<cluster url>
NEXT_PUBLIC_USDC_MINT=<mint printed by deploy>
NEXT_PUBLIC_RPC_URL=<cluster url>
QUOTE_SIGNER_SECRET_KEY=<base58 secret printed by deploy>
```

`QUOTE_SIGNER_SECRET_KEY` is the **secret** key of `keys/quote_signer.json`; its **public**
key was stored on-chain as `quote_signer` in `initialize_config`. The `/api/quotes/sign`
route signs quotes with it, and `buy_policy` verifies them on-chain.

### 3.6 Run the frontend

```bash
npm run dev
```

Open http://localhost:3000. The buy flow now runs end-to-end: quote → sign → (init nonce →
Ed25519 verify → `buy_policy`) → on-chain policy account.

### 3.7 Fund a buyer wallet

The wallet you connect in the UI needs **devnet SOL** (fees/rent) and **USDC** (premium).

```bash
# airdrop SOL to your wallet (devnet)
solana airdrop 2 <your-wallet-address>     # or Phantom settings → "Request Devnet SOL"

# send it 100 USDC (and 1 SOL on devnet) from the admin
FUND_WALLET=<your-wallet-address> npm run deploy
```

### 3.8 Oracle + settlement

```bash
# post today's rainfall observation for region 1 (runs once and exits)
npm run oracle
# specific region/date
REGION_ID=2 DATE=2026-09-03 npm run oracle

# continuously settle matured policies owned by the oracle wallet
npm run monitor
```

- `oracle` posts a daily `ObservationSnapshot` (fetches real rainfall from Open-Meteo and
  calls `record_observation`).
- `monitor` polls for matured policies and settles them.

**One-shot demo — no waiting for a window to elapse:**

```bash
npm run demo
```

`scripts/demo-settle.ts` buys a policy with a backdated window (yesterday → today), posts
yesterday's real rainfall, and settles it immediately — printing the buy/observe/settle
transaction links and the final policy state. Perfect for a 2-minute demo recording.

For normal (non-backdated) policies, settle via the **/settle** page once the window ends
(settlement is owner-signed by design).

---

## 4. Environment reference

| Variable | Used by | Notes |
|---|---|---|
| `SOLANA_RPC_URL` | deploy/demo scripts | default `https://api.devnet.solana.com` |
| `RPC_URL` | oracle, monitor | default `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_RPC_URL` | frontend | wallet + on-chain reads |
| `NEXT_PUBLIC_USDC_MINT` | frontend (`lib/nimbus.ts`, Nav) | devnet mint you created |
| `QUOTE_SIGNER_SECRET_KEY` | `/api/quotes/sign` | base58 secret of `keys/quote_signer.json` |
| `QUOTE_SIGNER_ALLOW_PAST` | `/api/quotes/sign` | `true` to allow backdated windows (demo) |
| `ORACLE_KEYPAIR_PATH` | oracle, monitor | default `./keys/oracle.json` |
| `REGION_ID`, `DATE` | oracle | region id + `YYYY-MM-DD` override |
| `FUND_WALLET` | deploy | buyer address to fund with USDC |
| `SKIP_AIRDROP` | deploy/demo | `1` to skip faucet requests |
| `REDIS_URL` | `/api/quotes/sign` rate limiter | falls back to in-memory if absent |
| `SLACK_WEBHOOK_URL`, `PAGERDUTY_ROUTING_KEY` | monitor/alerting | optional |

---

## 5. Testing

```bash
anchor test          # on-chain integration suite (requires the harness in §3)
npx tsc --noEmit     # typecheck the app
npm run lint         # ESLint (security gate requires --max-warnings=0)
```

---

## 6. Security & Developer Onboarding

**This project maintains a high security standard.** All contributions must pass our
automated security gate.

### Security Gate (Mandatory)

Every commit and PR is automatically checked for:

- **A06** — High/critical dependency vulnerabilities (`npm audit --audit-level=high`)
- **A05** — Static export security headers
- **A09** — Linting and code quality
- **A02** — Secret detection

### Quick Setup (New Developers)

```bash
npm install
pip install pre-commit
pre-commit install
./scripts/security-gate.sh
```

### Available Security Commands

| Command | Description |
|---|---|
| `npm run security:audit` | Run npm audit (moderate level) |
| `npm run security:fix` | Attempt automatic vulnerability fixes |
| `./scripts/security-gate.sh` | Full local security gate |
| `npm run build:static` | Build for GitHub Pages + generate headers |

### CI / Automated Checks

Security Gate · CodeQL (JS/TS + Rust) · Semgrep (OWASP Top 10 + secrets) · Gitleaks ·
Weekly full audit (Mondays 09:00 UTC).

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `anchor build` errors on program ID | Keypair not generated / `declare_id!` not updated — redo §3.1 |
| `npm run deploy` can't find the IDL | Run `anchor build` first (generates `target/idl/nimbus.json`) |
| "Airdrop request failed" / rate limited | Wait ~60s and retry, use `solfaucet.com`, or use `anchor localnet` |
| "Locked exposure would exceed LTV limit" / `LtvExceeded` on buy | Pool has no capital — seed it (`npm run deploy` deposits 10k USDC) |
| Buy fails on a missing token account | The buy flow initializes the nonce account (separate tx) then auto-creates the USDC ATA in the purchase — ensure the wallet has SOL for both |
| `QuoteSigMissing` / `QuoteSigInvalid` | `QUOTE_SIGNER_SECRET_KEY` doesn't match the on-chain `quote_signer` — check `.env.local` |
| `Account not found` / wrong balances | Program ID mismatch between layers — redo §3.1 and redeploy |
| `/settle` says no matured policies | Policy window hasn't ended, or daily observations aren't posted yet (`npm run oracle`) |
| `npm run monitor` settles nothing | Settlement is **owner-signed**; the monitor only settles policies owned by its own wallet. Other policies are settled by their owner via /settle |
| `next build` fails fetching Google Fonts | Sandboxed/offline environments only — builds fine on Vercel/local |

---

## 8. Reporting Security Issues

Please report vulnerabilities privately to the maintainers before public disclosure.

**Security is everyone's responsibility.** The gate is designed to be helpful, not
blocking. If it fails, fix the issue and re-run.
