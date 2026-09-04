# Nimbus — Remediating the Remaining Blockers (Step-by-Step)

> **Audience:** repo owner / hacker running Nimbus for the Common S3nse General
> Hackathon. Everything below is the *remaining* work after the in-sandbox fixes
> already applied (see `docs/COMMON_S3NSE_HACKATHON_ADAPTATION.md`, Appendix C).
>
> **Why these are blocked *here*:** this sandbox cannot reach `sh.rustup.rs`,
> `static.rust-lang.org`, `index.crates.io` (SSL reset), so the Rust/Solana/Anchor
> toolchain can't be installed, and the GitHub App token lacks `workflows`
> permission. Every remaining blocker is therefore something **you** run on your own
> machine with your own GitHub account.

---

## 0. Blocker overview

| # | Blocker | Where | Est. time | Result |
|---|---|---|---|---|
| 1 | No Rust/Anchor toolchain → program never built/tested/deployed | Your machine | 1–2 h | `anchor build` green, program on a cluster |
| 2 | Disabled GitHub workflows (CodeQL, Security Gate) | GitHub (your account) | 5 min | Both workflows re-enabled |
| 3 | `merged-app/` duplicate frontend (Pages static export) | Your machine + GitHub | 30 min | Real app on Vercel; duplicate archived |
| 4 | `@solana/wallet-adapter-wallets` mega-package pulls `protobufjs` (critical) | Your machine | 30 min | Single-wallet adapter, critical vuln gone |
| 5 | `next` 14.2.35 has remaining advisories (fixed in 15.x) | Your machine | 1–2 h | Next 15 migration (or documented fallback) |
| 6 | Wallet endpoint hardcoded to Devnet (breaks a *localnet* UI demo) | Your machine | 10 min | UI can point at any RPC |
| 7 | Pricing is a flat placeholder (not wired to on-chain risk model) | Your machine | optional | Honest labels, or wire real model |

**Devnet costs nothing.** Devnet SOL is free from faucets (rate-limited); `anchor localnet`
is free *and* unlimited. Only a **mainnet** deployment would cost real money — you do not
need mainnet for this hackathon. Use localnet for the demo recording and devnet for the
public contract address / transaction links.

---

## 1. Blocker 1 — Build, test, and deploy the on-chain program (Rust/Anchor)

### 1.1 What is wrong

The program (`programs/nimbus/`, Anchor 0.29) is complete and type-checks conceptually,
but in this sandbox we could not install Rust/Anchor, so:

- `anchor build` has never produced `target/idl/nimbus.json` (the IDL that `offchain/`
  and `scripts/deploy.ts` load at runtime);
- `anchor test` (the 600-line `tests/nimbus.ts`) has never executed;
- the program has never been deployed, so the placeholder program ID
  (`CLiMaFi1111111111111111111111111111111111111`) has no real keypair behind it.

### 1.2 Install the toolchain

Run these on **your** machine (macOS, Linux, or Windows WSL2). Versions are pinned to
match the repo (`anchor-lang 0.29.0`, `solana-program 1.18.0`).

```bash
# 1) Rust (latest stable is fine for Solana 1.18)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
#   → choose "1) Proceed with installation (default)"
#   → then reload your shell:  source "$HOME/.cargo/env"

# 2) Solana CLI 1.18.x (match the on-chain solana-program 1.18.0)
sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)"
#   → add to PATH per the installer's prompt, or:
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# 3) Anchor CLI 0.29.0 via avm (version manager)
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.29.0
avm use 0.29.0
```

> **Windows note:** use WSL2. Everything below assumes a bash-like shell.

### 1.3 Verify versions

Run each command and confirm the expected output. Everything after this section
assumes these pass:

```bash
rustc --version            # e.g.  rustc 1.79.0 (…)
cargo --version            # e.g.  cargo 1.79.0 (…)
solana --version           # e.g.  solana-cli 1.18.26 (src:…; feat:…)
anchor --version           # e.g.  anchor-cli 0.29.0
avm list                   # 0.29.0 (installed, selected)
node --version             # v18.17.0 or newer (Next 14 requirement)
npm --version              # 9.x or 10.x
```

If `anchor` isn't found, add Cargo's bin dir to PATH:
`export PATH="$HOME/.cargo/bin:$PATH"`.

### 1.4 Install Node dependencies

```bash
cd /path/to/Nimbus
npm install
```

The test stack (`chai`, `mocha`, `ts-mocha`, `@types/chai`, `@types/mocha`) is already in
`package.json` devDependencies — the "repo currently lists only @types/mocha" comment in
`Anchor.toml` is **outdated**; you do not need to add anything.

### 1.5 (One-time) Generate a real program keypair and replace the placeholder ID

The placeholder `CLiMaFi111…` is a vanity string with **no private key**. You cannot deploy
to it. Generate your own keypair and replace the ID in **every** layer:

```bash
# Generate the keypair Anchor will deploy from (named after the program in Anchor.toml)
solana-keygen new -o target/deploy/nimbus-keypair.json --no-bip39-passphrase --force

# The address derived from that keypair becomes your program ID
NEW_ID=$(solana address -k target/deploy/nimbus-keypair.json)
echo "$NEW_ID"            # copy this; it goes in the submission as your contract address

# Replace the placeholder in every functional layer
sed -i "s/CLiMaFi1111111111111111111111111111111111111/${NEW_ID}/g" \
  programs/nimbus/src/lib.rs \
  Anchor.toml \
  lib/nimbus.ts \
  offchain/monitoring.ts \
  offchain/oracle-aggregator.ts \
  offchain/policy-monitor.ts \
  scripts/deploy.ts \
  .env.example
```

> ⚠️ `scripts/deploy.ts` carries a `DEFAULT_PROGRAM_ID` fallback — it must be in the
> replace list (the earlier README list omitted it). Note the script actually prefers the
> ID from `target/idl/nimbus.json`'s `metadata.address` once you've built, so both layers
> end up consistent after `anchor build`.

**Verify nothing still references the placeholder in code/config:**

```bash
grep -rn "CLiMaFi" \
  --include="*.ts" --include="*.rs" --include="*.toml" --include="*.example" . \
  | grep -v node_modules | grep -v merged-app
# → must print nothing (docs/*.md mentions are narrative only and safe to ignore)
```

Docs (`README.md`, `designdocfull.md`, `docs/*.md`) mention the old ID in prose — harmless,
but you may `sed` them too if you want the submission docs to show your real ID.

### 1.6 Build

```bash
anchor build
```

Expected output / artifacts:

- `target/deploy/nimbus.so` — the compiled BPF program.
- `target/idl/nimbus.json` — **the IDL**. This is what `offchain/load-idl.ts`,
  `scripts/deploy.ts`, and `scripts/demo-settle.ts` load. If it's missing, those scripts
  print `! target/idl/nimbus.json not found — run 'anchor build' first`.

If the build fails, see **Troubleshooting** in the appendix.

### 1.7 Test (local validator)

```bash
anchor test
```

This starts a throwaway local validator, deploys the program, and runs
`tests/**/*.ts` (including `tests/nimbus.ts` with its chai assertions). Expected: the
suite ends with a passing count and no `Error: instruction failed`.

> If `anchor test` complains about `ts-mocha`, it means the devDependencies from §1.4
> aren't installed — rerun `npm install`.

### 1.8 Choose your deployment target

| | **localnet** (`anchor localnet`) | **devnet** (`anchor deploy`) |
|---|---|---|
| Cost | Free, unlimited SOL | Free (faucet, rate-limited) |
| Friction | None (no wallet needed) | Faucet + deploy rent (~few SOL) |
| Public links | No (localhost) | Yes — explorer links for the submission |
| Best for | **Demo video**, tests | **Public proof** / contract address |

Recommended: do **both** — devnet first for the public contract address, localnet for the
2-minute demo recording (zero faucet friction, real transaction signatures).

### 1.9 Deploy

**Option A — devnet (public contract address):**

```bash
solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json --no-bip39-passphrase --force   # one-time deployer wallet
solana airdrop 2           # repeat a few times if rate-limited (faucet ~2 SOL/request)
solana balance             # confirm you have SOL
anchor deploy
```

Anchor will print the **Program Id** and a deploy transaction link. Save both for the
submission. Devnet program rent for a program this size is a few SOL — if `anchor deploy`
reports insufficient funds, airdrop more:

```bash
solana airdrop 2 && solana airdrop 2 && solana balance
```

**Option B — localnet (demo recording):**

```bash
# terminal 1 (leave running)
anchor localnet            # starts a validator AND deploys the program
```

Keep this terminal open; it prints `Program Id` and the validator listens on
`localhost:8899`.

### 1.10 Bootstrap on-chain state (USDC mint + config + pool + capital)

```bash
# Dry-run first (prints every address/PDA without touching a cluster):
npm run deploy:dryrun

# Localnet:
SOLANA_RPC_URL=http://localhost:8899 npm run deploy

# Devnet (default):
npm run deploy
```

`scripts/deploy.ts` (idempotent — safe to rerun) does, in order:

1. Generates keypairs under `keys/` (gitignored): `admin`, `oracle`, `quote_signer`,
   `treasury`, `usdc_mint`.
2. Airdrops `admin` + `oracle` (devnet only; skipped on localhost, or with
   `SKIP_AIRDROP=1`).
3. Creates the **devnet USDC mint** (6 decimals) and mints 1,000,000 USDC to `admin`.
4. `initialize_config` — protocol fee (1%), oracle staleness (1 day), duration bounds,
   the **quote signer** and **oracle authority**.
5. `create_pool` — Pool #1 (Rainfall, 80% LTV limit).
6. `deposit_liquidity` — seeds 10,000 USDC of capital (required: `buy_policy` fails the
   LTV check without it).
7. Prints a **copy-paste environment block** at the end.

The printed block looks like:

```
SOLANA_RPC_URL=…
NEXT_PUBLIC_USDC_MINT=…
NEXT_PUBLIC_RPC_URL=…
QUOTE_SIGNER_SECRET_KEY=…
```

### 1.11 Configure the app

Create `.env.local` in the repo root and paste the block from §1.10:

```bash
# .env.local
SOLANA_RPC_URL=http://localhost:8899        # or https://api.devnet.solana.com
NEXT_PUBLIC_RPC_URL=http://localhost:8899   # or https://api.devnet.solana.com
NEXT_PUBLIC_USDC_MINT=<mint printed by deploy>
QUOTE_SIGNER_SECRET_KEY=<base58 secret printed by deploy>
```

- `QUOTE_SIGNER_SECRET_KEY` is the **secret** key of `keys/quote_signer.json`. Its
  **public** key was stored on-chain as `quote_signer` in `initialize_config`.
  `/api/quotes/sign` signs quotes with it; `buy_policy` verifies them on-chain.
- Add `QUOTE_SIGNER_ALLOW_PAST=true` **only** if you drive the UI buy flow with backdated
  windows (the `scripts/demo-settle.ts` script posts observations itself and doesn't
  need it).

### 1.12 Run the frontend and verify the buy loop

```bash
npm run dev
```

Open http://localhost:3000 and verify the full loop:

1. **Buy** page → pick region/direction/days/threshold/payout → premium computes from the
   API → **Confirm & Purchase** → the flow runs: sign quote → `initQuoteNonce` (its own
   tx) → Ed25519 verify + `buy_policy` (second tx) → confirmed policy account.
2. **Pools** page shows the seeded pool and capital.
3. **Portfolio** page shows the policy you just bought.
4. (After the window ends, or using the backdated demo) **Settle** page settles it.

> See §6 for the wallet-endpoint fix if you want to exercise the **browser wallet** on
> localnet. For devnet, Phantom's "Devnet" network is already what the provider uses.

### 1.13 One-shot end-to-end demo (no waiting)

```bash
npm run demo
```

`scripts/demo-settle.ts` buys a policy with a **backdated window** (yesterday 00:00 UTC →
today 00:00 UTC), posts yesterday's *real* Open-Meteo rainfall for Nairobi, then settles it
immediately — printing the buy/observe/settle transaction links and the final policy
state. Perfect for the demo recording.

### 1.14 Fund a browser-wallet buyer (devnet UI demo)

```bash
# airdrop SOL to the wallet you'll connect in the UI
solana airdrop 2 <your-wallet-address>
# or Phantom → Settings → "Request Devnet SOL"

# send it USDC (and 1 SOL on devnet) from the admin
FUND_WALLET=<your-wallet-address> npm run deploy
```

### 1.15 Record the demo

Suggested order for the 2-minute video (matches
`docs/COMMON_S3NSE_SUBMISSION.md`):

1. Landing page + the "Illustrative" threshold chart → explain the product.
2. Buy page → live quote → sign → confirm → show the transaction on the explorer.
3. `npm run demo` output (buy → observe → settle) → show the settled policy + payout.

---

## 2. Blocker 2 — Re-enable the disabled GitHub Actions workflows (CodeQL, Security Gate)

### 2.1 What is wrong

`codeql-analysis.yml` and `security-gate.yml` are GitHub-disabled
(`disabled_inactivity`). The sandbox's GitHub App token gets
`HTTP 403: Resource not accessible by integration` when trying to re-enable them, so
**only you** (an owner/admin of `knarayanareddy/Nimbus`) can re-enable them.

### 2.2 Option A — GitHub UI

1. Open **https://github.com/knarayanareddy/Nimbus/actions**.
2. Click **CodeQL Analysis** in the left sidebar.
3. Click the **Enable workflow** button (GitHub shows it in a yellow banner when a
   workflow was disabled for inactivity).
4. Repeat for **Security Gate** (and any others with an "Enable workflow" banner).
5. Trigger a run: either push any commit, or open the workflow and click
   **Run workflow ▸ Run workflow** (on `main`).

### 2.3 Option B — CLI (from your machine, with your account)

```bash
gh auth login                       # authenticate as YOU (not the sandbox app)
gh repo view knarayanareddy/Nimbus  # confirm you have admin (or are owner)
gh workflow list --repo knarayanareddy/Nimbus
# copy the workflow file names that show "disabled_inactivity"

gh workflow enable codeql-analysis.yml --repo knarayanareddy/Nimbus
gh workflow enable security-gate.yml   --repo knarayanareddy/Nimbus
```

Then trigger a run:

```bash
gh workflow run codeql-analysis.yml --repo knarayanareddy/Nimbus
gh workflow run security-gate.yml   --repo knarayanareddy/Nimbus
gh run watch --repo knarayanareddy/Nimbus   # optional: tail the newest run
```

### 2.4 Verify

```bash
gh workflow list --repo knarayanareddy/Nimbus
# the two workflows should show "active" instead of "disabled_inactivity"
```

### 2.5 Do you even need them?

They are **redundant** with the checks that already run in PRs: `ci.yml` runs cargo
audit/clippy/build, and the PR also runs `docker-build`, `solana-security`, `sbom`, and
`security-audit` (all currently **passing**). Re-enabling CodeQL + Security Gate is nice
for the "unusually strong security posture" story, but **not required** for the
submission. If you're time-constrained, skip this blocker.

---

## 3. Blocker 3 — `merged-app/` duplicate frontend (deploy the real app to Vercel)

### 3.1 What is wrong

The repo has two near-identical frontends:

- `app/` — the real app (App Router, `/api/*` routes, live on-chain reads). **This is
  what you want to show judges.**
- `merged-app/` — a divergent static-export duplicate used **only** by the GitHub Pages
  workflow (`deploy-pages.yml` swaps it in on push to `main`).

The Pages static export cannot serve the `/api/*` routes the buy flow needs, and keeping
two frontends invites "the demo and the source don't match" confusion. **Archive
`merged-app/` and deploy `app/` to Vercel.**

### 3.2 Archive (or delete) the duplicate

```bash
git mv merged-app docs/_archived-merged-app   # archive (keeps history, out of the way)
# …or delete outright:
# git rm -r merged-app

git commit -m "chore: archive the merged-app static-export duplicate"
git push
```

### 3.3 Stop the Pages workflow from swapping it in

Either delete the workflow (if you're done with Pages):

```bash
git rm .github/workflows/deploy-pages.yml
```

…or keep Pages but stop swapping directories (Pages can't run the API routes anyway, so
the static site is a shell). Recommended: delete the workflow and rely on Vercel. Commit
and push.

> ⚠️ The sandbox App token cannot push under `.github/workflows/` (no `workflows`
> permission). Run the `git rm` on **your machine** with your own credentials.

### 3.4 Deploy the real app to Vercel

1. Push the repo to GitHub (already there: `knarayanareddy/Nimbus`).
2. Go to **https://vercel.com/new** → import `knarayanareddy/Nimbus`.
3. **Framework preset:** Next.js (auto-detected). Leave root directory as the repo root
   (`app/` is the Next.js root).
4. **Build command:** `npm run build` · **Output:** default.
5. **Environment variables** (Settings → Environment Variables), mirroring `.env.local`:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_RPC_URL` | `https://api.devnet.solana.com` |
   | `NEXT_PUBLIC_USDC_MINT` | your devnet mint from §1.10 |
   | `SOLANA_RPC_URL` | `https://api.devnet.solana.com` |
   | `QUOTE_SIGNER_SECRET_KEY` | base58 secret from §1.10 |
   | `REDIS_URL` | *(optional; rate limiter falls back to in-memory)* |

6. Deploy. The live URL becomes the submission link.

### 3.5 CSP note for a custom RPC (if you use Helius/QuickNode/Triton)

`next.config.js` production `connect-src` only allows `*.solana.com` endpoints. If you
point the app at a hosted RPC, add its origin, e.g.:

```js
`connect-src 'self' https://*.solana.com https://api.mainnet-beta.solana.com https://api.devnet.solana.com wss://*.solana.com https://your-rpc.helius-rpc.com wss://your-rpc.helius-rpc.com`
```

Otherwise the browser blocks wallet/RPC connections in production.

---

## 4. Blocker 4 — Swap the wallet-adapter mega-package for the single Phantom adapter

### 4.1 What is wrong

`package.json` depends on `@solana/wallet-adapter-wallets` (the "all wallets" package),
whose dependency tree pulls **`protobufjs` (critical)** plus `@trezor/*`, `@stellar/*`,
`@particle/*`, `metro`, `socket.io-parser`, etc. The app only ever registers **Phantom**
(`components/WalletProvider.tsx` → `new PhantomWalletAdapter()`), so 90% of that surface
is dead weight with real CVEs.

### 4.2 The fix

```bash
npm uninstall @solana/wallet-adapter-wallets
npm install @solana/wallet-adapter-phantom@latest
```

Change `components/WalletProvider.tsx`:

```tsx
// before
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets'
// after
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
```

That's the only import to change; the rest of the component is unchanged.

### 4.3 Version-compatibility caveat (important)

`@solana/wallet-adapter-phantom` 0.9.x requires `@solana/web3.js ^1.98` and newer
wallet-adapter base packages. The repo currently pins `@solana/web3.js ^1.87.6` (Anchor
0.29's client wants `^1.x`). If `npm install` reports peer-dep conflicts:

```bash
npm install @solana/web3.js@^1.98 @solana/wallet-adapter-base@latest \
            @solana/wallet-adapter-react@latest @solana/wallet-adapter-react-ui@latest \
            @solana/wallet-adapter-phantom@latest
```

Then re-run the full typecheck/lint (§4.5). If the newer `web3.js` breaks the hand-written
client (`lib/nimbus.ts`) or the wallet connect flow, **roll back**:

```bash
git checkout components/WalletProvider.tsx package.json package-lock.json
npm install
```

…and rely on the existing allowlist in `scripts/security-gate.sh` (which already
documents why the Trezor/Stellar/Particle chains are never loaded). This swap is a
"nice-to-have" hardening, not a demo blocker.

### 4.4 Regenerate the lockfile and verify

```bash
npm install                  # regenerates package-lock.json
npx tsc --noEmit             # expect exit 0
npm run lint                 # expect "No ESLint warnings or errors"
```

### 4.5 Confirm the vulnerability is gone

```bash
npm audit --audit-level=high
# protobufjs / @trezor / @stellar / @particle should disappear from the report
```

Then update the allowlist in `scripts/security-gate.sh` (remove the entries that are no
longer needed: `protobufjs`, `@trezor`, `@stellar`, `@particle`, `socket.io-parser`,
`@toruslabs`) so the gate stays honest.

---

## 5. Blocker 5 — Upgrade Next.js 14.2.35 → 15.x (remaining `next` advisories)

### 5.1 What is wrong

All current Next.js advisories are fixed in **15.5.21+**. This app is client-heavy and uses
almost none of the affected surfaces (image optimizer, server actions, middleware,
rewrites), so staying on 14.2.35 is *defensible* for the demo (it's allowlisted in the
security gate). But if you want a clean audit, upgrade.

### 5.2 Migration steps

```bash
npm install next@latest eslint-config-next@latest react@latest react-dom@latest
```

Next 15's breaking changes that affect this repo:

1. **Async route-handler params.** `app/api/*/route.ts` handlers with dynamic segments
   must read `params` as a `Promise`. Change e.g.:

   ```ts
   // before (Next 14)
   export async function GET(req: NextRequest, { params }: { params: { regionId: string } }) {
     const { regionId } = params
   }
   // after (Next 15)
   export async function GET(req: NextRequest, ctx: { params: Promise<{ regionId: string }> }) {
     const { regionId } = await ctx.params
   }
   ```

   Find every dynamic route handler:

   ```bash
   grep -rln "params" app/api --include="*.ts"
   ```

2. **`next lint`** was removed in Next 15 — move to ESLint directly (see §5.3).
3. **Caching defaults** changed (`fetch` no longer cached by default). This repo doesn't
   rely on route caching, so no action beyond a smoke test.

### 5.3 Verify

```bash
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.offchain.json
npx next build        # full production build (now that you're not in the sandbox)
npm run lint          # or, on 15:  npx eslint .
```

### 5.4 Fallback

If the migration fights you and the deadline is close: stay on 14.2.35. It's already
allowlisted in `scripts/security-gate.sh` with a written rationale, and CI passes. Revisit
after the hackathon.

---

## 6. Blocker 6 — Let the wallet adapter respect a custom RPC (localnet UI demo)

### 6.1 What is wrong

`components/WalletProvider.tsx` hardcodes `WalletAdapterNetwork.Devnet` and
`clusterApiUrl(network)`, so the browser wallet always talks to **devnet** — even when the
rest of the app reads `localhost:8899`. A localnet *UI* demo would therefore fail (wallet
on devnet, app on localnet).

The scripted demo (`npm run demo`) is unaffected (it uses CLI keypairs, no wallet). You
only need this fix if you want the **browser buy flow** on localnet.

### 6.2 The fix

```tsx
const isLocal =
  (process.env.NEXT_PUBLIC_RPC_URL || '').includes('localhost') ||
  (process.env.NEXT_PUBLIC_RPC_URL || '').includes('127.0.0.1')
const network = isLocal ? WalletAdapterNetwork.Devnet : WalletAdapterNetwork.Devnet // same, but
const endpoint = useMemo(
  () => process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl(network),
  [network]
)
```

Simplest version — just honor the env var:

```tsx
const endpoint = useMemo(
  () => process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl(WalletAdapterNetwork.Devnet),
  []
)
```

Set `NEXT_PUBLIC_RPC_URL=http://localhost:8899` in `.env.local`, then `npm run dev`.

> **Caveat:** Phantom's localnet UX is unreliable (it strongly prefers public clusters).
> For a smooth demo, prefer **devnet** for the UI flow and **localnet** only for
> `anchor test` + `npm run demo`. The endpoint fix is still worth applying so the code is
> honest about where it points.

---

## 7. Known limitation (optional) — Pricing is a flat placeholder

`app/api/quotes/calculate` computes `purePremium = payout × 3.5%`, `surcharge = payout × 1%`,
`fee = 5%` — it does **not** call the on-chain risk machinery (`risk.rs` dynamic LTV,
`economic_safety.rs` utilization surcharge). For the hackathon this is acceptable **if
labeled honestly** (the submission copy already frames pricing as "MVP pricing model").
If you have time, wire the quote to read the pool's current utilization from-chain and
apply the same formula `risk.rs` uses; otherwise, just don't overclaim pricing
sophistication in the demo.

---

## 8. Final verification checklist

Run through this before submitting:

- [ ] `rustc`, `solana --version` (1.18.x), `anchor --version` (0.29.0) all report.
- [ ] `grep -rn "CLiMaFi"` (code/config) prints nothing (§1.5).
- [ ] `anchor build` green; `target/idl/nimbus.json` exists.
- [ ] `anchor test` green (local validator).
- [ ] Program deployed: devnet (public address + explorer link saved) and/or `anchor localnet`.
- [ ] `npm run deploy:dryrun` prints all addresses; `npm run deploy` succeeds (mint + config + pool + capital).
- [ ] `.env.local` created from the deploy output.
- [ ] `npm run demo` prints buy/observe/settle tx links + final policy state.
- [ ] `npm run dev` → UI buy loop completes end-to-end (quote → sign → nonce → buy).
- [ ] `npx tsc --noEmit` and `npx tsc --noEmit -p tsconfig.offchain.json` exit 0.
- [ ] `npm run lint` → no warnings/errors.
- [ ] CodeQL + Security Gate re-enabled (or consciously skipped, §2.5).
- [ ] `merged-app/` archived; Pages workflow removed (or consciously kept).
- [ ] Vercel deploy live with env vars set (§3.4).
- [ ] (Optional) Phantom-adapter swap done (§4) — `protobufjs` gone from `npm audit`.
- [ ] (Optional) Next 15 upgrade done (§5) — or documented fallback.

---

## Appendix A — Version compatibility matrix

| Component | Repo requires | Known-good |
|---|---|---|
| Rust | stable (1.75+) | 1.79.x |
| Solana CLI | 1.18.x (match `solana-program 1.18.0`) | 1.18.26 |
| Anchor CLI | 0.29.0 | 0.29.0 via `avm` |
| anchor-lang / anchor-spl | 0.29.0 | 0.29.0 |
| solana-program | 1.18.0 | 1.18.0 |
| Node.js | 18.17+ (Next 14) | 18/20 |
| Next.js | 14.2.35 (→ 15.5.21+ optional) | 14.2.35 |
| @solana/web3.js | ^1.87.6 (^1.98 for Phantom 0.9.x) | ^1.87.6 |

## Appendix B — Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `anchor build` fails with `package is not in the manifest` | Run `anchor build` from the **repo root** (Anchor.toml lives there). |
| `! target/idl/nimbus.json not found` | You haven't run `anchor build`. Build first. |
| `Error: Deploying program failed` / `Account ... insufficient funds` on devnet | `solana airdrop 2` a few times; devnet faucet is rate-limited. |
| `anchor deploy` uses the wrong ID | `Anchor.toml [programs.devnet]` must match `declare_id!` in `programs/nimbus/src/lib.rs`. |
| `anchor test` fails with `Cannot find module 'ts-mocha'` | `npm install` (devDeps must be installed). |
| `npm run deploy` fails at airdrop | Local cluster needs no airdrop; on devnet use `SKIP_AIRDROP=1` after manually funding `keys/admin.json`. |
| Buy flow reverts at `buy_policy` | Capital not seeded (`deposit_liquidity`) — rerun `npm run deploy`; or quote nonce not initialized (should be auto-handled by `ensureQuoteNonceInitialized`). |
| Wallet connect fails on localnet | See §6 — the adapter defaults to devnet. Use devnet for UI demos. |
| Browser blocks RPC in production | Add your RPC origin to `connect-src` in `next.config.js` (§3.5). |
| `gh workflow enable` → 403 | You're authenticated as the sandbox app, not yourself. `gh auth login` as your account (§2.3). |
| Rust install SSL reset | That's the sandbox — run on your own machine. |
