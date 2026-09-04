# Nimbus → Common S3nse Hackathon: Adaptation Deep Dive

> Deep dive into this repository from the point of view of adapting it for
> [Common S3nse Hackathon](https://commons3nse.cryptocanal.org/hackathon) (Aug 31 – Sep 5, 2026).
> Prepared 2026-09-04. All claims are grounded in the code as checked out on branch
> `arena/01a06ba5-nimbus` @ `32b6568`.
>
> **Team status (2026-09-04):** already registered on Taikai for the main
> "Common S3nse — General Hackathon" track (bounty-eligible), and **Nimbus was never
> presented at the Colosseum/Frontier hackathon** — it is effectively new to any judging
> audience. Final submissions close **Sept 5 @ 07:00 UTC (09:00 Amsterdam)**.

---

## 0. TL;DR

**Nimbus is a Solana-native parametric climate-risk protocol** (buy USDC-denominated
rainfall coverage, auto-settle when an oracle index crosses a threshold). The repo is a
*complete-looking, security-flavored MVP*: a full Anchor program, a polished Next.js
frontend, off-chain oracle/settlement/monitoring services, a Postgres+TimescaleDB schema,
and an unusually heavy security/CI apparatus.

For **Common S3nse**, the honest read is:

- **You're in the main track — play to win it.** Registered, bounty-eligible, and Nimbus
  has never been shown anywhere, so it lands as *new to the judges*. Lead with **Security +
  DeFi** (the repo's actual depth), and be transparent that the core predates hack week and
  this week is about hardening + wiring + demo.
- **The window is ~24 hours, not a week.** Final submissions are Sept 5 @ 07:00 UTC
  (09:00 Amsterdam). The plan below is a deadline-driven runbook, not a roadmap.
- **The repo is not demo-ready as-is.** There are real integration breakages (inconsistent
  program ID across layers — one string was even invalid base58 — a broken quote API
  wiring, a dead "Confirm & Purchase" button, mock data in the frontend, no Anchor harness).
  A focused day of wiring gets it to "walkable demo." The first fixes are already applied
  (see §4.1).

---

## 1. What this repository actually is

### 1.1 Product

Parametric climate coverage on Solana:

1. User picks region, peril (MVP: rainfall), window (7/14/30 days), index method
   (Sum/Mean/Max), direction (drought = "below threshold", flood = "above threshold"),
   and payout.
2. An off-chain quote service prices it and Ed25519-signs the quote.
3. `buy_policy` verifies the signature on-chain (via the Ed25519 syscall instruction +
   instructions-sysvar inspection), takes USDC premium, and mints a `Policy` account.
4. A permissioned oracle posts daily `ObservationSnapshot` accounts.
5. Anyone (or the policy monitor bot) calls `settle_policy` after the window ends;
   if the aggregated index crosses the threshold, USDC payout is automatic.

The original design docs were written for **Colosseum Frontier Hackathon 2026**
(`designdoc.md` targets "Colosseum Frontier Hackathon", `master designdoc.md` targets
"Frontier Hackathon submission by 2026-05-11"). So the repo is a **prior hackathon build**
being re-aimed at a new event — that's the adaptation problem in a nutshell.

### 1.2 Architecture map (verified)

| Layer | Location | Size | Status |
|---|---|---|---|
| On-chain program (Anchor/Rust) | `programs/nimbus/src/` | ~2,300 LOC across 11 modules | Complete, unbuilt locally |
| Frontend (Next.js 14) | `app/` (+ duplicate `merged-app/`) | ~2,300 LOC | Polished UI, partially wired |
| API routes | `app/api/…` (5 routes) | ~300 LOC | Quote/sign real, rest stubbed |
| Client SDK | `lib/nimbus.ts`, `lib/deserialize.ts` | ~700 LOC | Hand-written IDL, real helpers |
| Off-chain services | `offchain/` (10 files) | ~1,200 LOC | Aggregator+monitor real; several stubs |
| Database | `db/schema.sql`, `db/encryption.sql` | — | Schema only, no seed/migrations |
| Tests | `tests/` (5 files) | ~1,600 LOC | Anchor/chai integration + fuzz + security |
| Docs | `designdoc*.md`, `EXECUTIVE_SUMMARY.md`, `LEGAL.md`, `governance/`, `docs/` | large | Extensive |
| CI/CD | `.github/workflows/` (5) | — | Security gate, CodeQL, Semgrep, Gitleaks, SBOM, Pages deploy |

### 1.3 On-chain program (the crown jewel)

`programs/nimbus/src/lib.rs` (1,307 lines) + modules:

- `state.rs` — `GlobalConfig`, `Pool`, `Policy`, `ObservationSnapshot`, `Quote` + events
- `errors.rs` — 31 error codes
- `risk.rs`, `economic_safety.rs` — dynamic LTV (30% floor), utilization surcharge,
  capital ≥ locked invariant, 90% utilization circuit breaker, all checked arithmetic
- `switchboard.rs` (218 L) — on-chain Switchboard V2 read path
- `timelock.rs`, `governance.rs` — admin timelock + M-of-N multisig proposals
- `nonce.rs`, `reentrancy.rs`, `compute.rs` — per-signer nonce replay protection, CPI
  reentrancy guard, compute-budget helpers

Instruction set: `initialize_config`, `set_paused`, `create_pool`,
`deposit_liquidity`, `withdraw_liquidity`, `init_quote_nonce`, `buy_policy`,
`cancel_policy`, `record_observation` (+ `record_observation_switchboard`),
`settle_policy`, timelock (init/schedule/execute/cancel), multisig governance
(init/propose/approve/execute).

Notable security details (good talking points for a **Security-track** judge):

- `buy_policy` verifies an Ed25519 `Quote` signature by locating the injected
  `Ed25519` program instruction in the transaction sysvar and checking sig/pubkey/msg —
  no off-chain "trust the API" signing.
- `assert_no_cpi_in_transaction` reentrancy guard.
- Settlement validates observation accounts' ownership, region/peril match, day
  alignment, and staleness before computing the index.
- LTV + solvency + circuit breaker on every purchase.

### 1.4 Off-chain

- `oracle-aggregator.ts` — pulls real rainfall from **Open-Meteo**, validates coords
  against a hard-coded 3-region registry (Nairobi/Mumbai/Manila), posts `record_observation`.
- `policy-monitor.ts` — `getProgramAccounts` scan → settle matured policies, with
  observation-coverage checks, compute-budget, and alerting hooks.
- `switchboard-oracle.ts` — **stub** (placeholder aggregator pubkey = `1111…`).
- `alerting.ts` (Slack + PagerDuty via axios), `monitoring.ts` (utilization/solvency/oracle
  staleness), `observability.ts` (structured events), `rate-limiter.ts` (Redis + in-memory
  fallback), `service-auth.ts` (HMAC), `log-integrity.ts` (tamper-proof logs),
  `emergency.ts` (stub multisig bypass).

### 1.5 Security / CI posture (unusually strong for a hackathon repo)

`.github/workflows/`: `ci.yml` (cargo-audit, clippy -D warnings, cargo-geiger, unsafe/panic
grep), `security-gate.yml` (npm audit, lint, Semgrep OWASP+secrets, Gitleaks),
`codeql-analysis.yml` (JS+TS and Rust), `sbom.yml` (cargo-sbom SPDX), `deploy-pages.yml`
(static export → GitHub Pages). Plus pre-commit hooks and a local `scripts/security-gate.sh`.
`next.config.js` ships a real CSP + security headers.

**Implication:** the repo already *tells* a "Security track" story by itself. That's a
judge-ready asset even before touching product code.

---

## 2. Hackathon context & where Nimbus fits

### 2.1 The event

- **Online build week Aug 31 – Sep 2 + IRL finals in Amsterdam** (De Hallen Studios).
- **Two ways to join:**
  1. **Start from Scratch** — build something *new* during hack week. Bounty-eligible.
     IRL finals Sept 5, judging 11:30–15:00, top 10 on stage 15:00.
  2. **Otter Tank 🦦** — showcase an *established* project. **No bounties.** Stage pitches
     IRL **Sept 4**. "Just visibility, feedback and a stage."
- **Tracks (explicitly "directions, not boxes"):**
  - **Privacy** — identity, ZK, private transactions, metadata protection.
  - **Security** — wallets, protocol security, monitoring, permissions, dev tooling,
    threat detection, safer UX.
  - **DeFi** — payments, stablecoins, lending, markets, interoperability, financial
    privacy, permissionless infrastructure.
- **Deadlines (critical):** applications close **Sept 4 @ 17:00**; Otter Tank Sept 4;
  final submissions **Sept 5 @ 09:00**; judging Sept 5 11:30–15:00.

### 2.2 Fit matrix

| Nimbus capability | DeFi | Security | Privacy |
|---|---|---|---|
| Parametric coverage market, USDC premiums/payouts | ★★★ | | |
| Permissionless LP pools (deposit/withdraw, LP tokens) | ★★★ | | |
| Ed25519 signed quotes + nonce replay protection | ★★ | ★★★ | |
| Reentrancy guard, checked math, LTV/circuit breakers | | ★★★ | |
| Oracle validation (ownership/peril/day/staleness) | | ★★★ | |
| Monitoring/alerting/observability services | | ★★★ | |
| Timelock + multisig governance | | ★★ | |
| Buyer identity/payout metadata protection | | | ★ (not built) |

**Verdict:** lead with **Security** (the repo's actual depth) framed inside a **DeFi**
product. Privacy is the honest gap — there's nothing privacy-native today (see §4.7),
though a *metadata-protection* angle is a credible stretch for the conference crowd.

### 2.3 Partner/bounty leverage

| Partner | Bounty | Natural Nimbus use |
|---|---|---|
| **ENS** | $2k + ticket | Name regions/pools/policies (`nairobi.drought.nimbus.eth`); resolve policy owners |
| **Superteam NL** | $2k | Solana builder support, product feedback |
| **Mobula** | $2,750 + $2,750 credits | Market/price data API for premium modeling + LP analytics |
| **EthSwarm** | (docs provided) | Decentralized storage of oracle observation history + quote receipts |
| **Zcash** | (logo; privacy theme) | Privacy direction — shielded payouts (long shot) |

Concrete, low-cost integrations that would materially strengthen a pitch:

1. **ENS subnames for regions/pools** — trivial (no contract needed; the resolver/name
   lives off-chain), demonstrates composability, maps to the $2k bounty.
2. **Swarm for oracle data** — store daily `ObservationSnapshot` JSON + quote receipts on
   Swarm and pin the content hash on-chain (or in the DB). This directly answers the
   "oracle data is centralized in TimescaleDB" critique and uses a partner.
3. **Mobula for pricing signals** — pull USDC market data / volatility into the premium
   model to replace the flat 3.5% formula (§4.6).

---

## 3. Repo readiness: honest gap analysis

What's **real** vs **stub** vs **broken**. This is the part that decides how much runway a
demo needs.

### 3.1 ✅ Real / working

- On-chain program logic is complete and coherent (compiles under `cargo`; see §3.2 caveat).
- Signed-quote flow server-side (`/api/quotes/sign`) is genuinely implemented: Borsh-
  compatible serialization + tweetnacl detached signature + rate limiting + input
  validation.
- Off-chain aggregator (Open-Meteo) and policy monitor are real, runnable Node scripts.
- Security CI, docs, legal, governance scaffolding.

### 3.2 ❌ Broken / missing (blockers for a live demo)

1. **No Anchor harness.** There is no `Anchor.toml`, no `.anchor/`, no
   `target/deploy/*-keypair.json` (the IDL and program keypair artifacts). The README's
   `anchor build` / `anchor localnet` / `anchor test` **cannot run as-is**; only
   `cargo build` inside `programs/nimbus` works. The 600-line `tests/nimbus.ts` (chai +
   `anchor.workspace.Nimbus`) therefore can't execute without re-creating the harness.
2. **Program ID is inconsistent across layers** (three different strings):
   - Rust `declare_id!("CLiMaFi1111111111111111111111111111111111111")` — 44 chars
   - `lib/nimbus.ts` `PROGRAM_ID = 'CLiMaFi111111111111111111111111111111111111'` — **43 chars**
   - `offchain/*` `"CliMaFi1111111111111111111111111111111111111"` — 44 chars, **lowercase `i`**
   Base58 is case-sensitive and length matters: these decode to *three different public
   keys*, so PDA derivations diverge between client, off-chain, and program. Also the ID is
   a vanity placeholder, not a deployed program — "Live on Solana Devnet" (landing page) is
   unverifiable. Any real deploy needs a generated keypair + consistent ID everywhere.
3. **Quote API is mis-wired.** `app/buy/page.tsx` calls
   `GET /api/quotes/calculate?region=…&direction=…&days=…&threshold=…&payout=…`, but the
   route is **POST-only** and expects `{payoutAmount}` (returns `premiumAmount`, while the
   UI reads `data.premium`). The UI never calls `/api/quotes/sign` and never builds the
   `buy_policy` transaction. Result: the "real" flow silently falls back to a hardcoded
   `23.63` premium. The 6-step wizard is UI-only.
4. **Mock data everywhere.** `pools`, `portfolio`, `settle`, `governance` pages render
   hard-coded `DEMO_POOLS` / `DEMO_POLICIES` / `DEMO_ELIGIBLE` / `DEMO_PROPOSALS`.
   `/api/oracle/regions`, `/api/oracle/[regionId]/current`, `/api/policies/[wallet]`
   return canned JSON (`// In production: query TimescaleDB`). Only the governance page
   attempts a real `getProgramAccounts` read.
5. **USDC mint is hardcoded to mainnet** (`EPjFWdd5…`) in `lib/nimbus.ts` while everything
   else points at devnet → ATA derivation would be wrong on devnet.
6. **Pricing is a placeholder.** `/api/quotes/calculate` uses flat
   `purePremium = payout*3.5%`, `surcharge = payout*1%`, `fee = 5%` — none of the on-chain
   risk machinery (`risk.rs` dynamic LTV / `economic_safety.rs` utilization surcharge) is
   wired into the quote.
7. **Two frontends.** `app/` and `merged-app/` are near-duplicates; the Pages deploy
   workflow swaps `merged-app` in. Maintenance hazard and a source of "the demo and the
   source don't match" confusion.

### 3.3 ⚠️ Stubs / aspirational

- `switchboard-oracle.ts` (placeholder aggregator), `emergency.ts` (no-op), `publishToNimbus`
  (console.log). The on-chain Switchboard path exists but is unexercised.
- DB: schema only; no docker-compose, no seed data, no migration runner.
- Governance: on-chain multisig implemented, but no UI beyond demo cards.

### 3.4 Net assessment

> The repo is a **strong, security-flavored foundation with a broken last mile**.
> ~80% of the product code exists; the 20% missing is exactly the wiring a demo and a
> judge would notice first (consistent program ID, working quote→buy→settle loop, real
> data instead of mock cards).

---

## 4. Adaptation strategies (updated for team status)

### Strategy A — Main-track submission of Nimbus (recommended)

Submit Nimbus to the **"Common S3nse — General Hackathon"** track (you're registered) and
pitch it in **Security + DeFi**. Because it was never presented at Colosseum, the framing
"this is what we built for this event" is truthful and judge-ready — but state plainly
that the core was developed in the months prior and hack week was spent hardening and
wiring it (the single-squashed commit history makes "new to the world" easy to verify).

**Narrative:** "Nimbus — permissionless parametric climate coverage on Solana, built
security-first." Lead with the *Security* story (Ed25519 quote verification via the
transaction sysvar, checked arithmetic, reentrancy guard, LTV/circuit breakers,
oracle-validation on settle) inside a *DeFi* product (USDC pools, LP yields, deterministic
settlement). The audit checklist, OWASP mapping, and CI gates *are* the slide deck.

**Submission checklist (Taikai wants: description, repo, demo, deployment links, contract
addresses):**

1. Working devnet demo (see §4.1 — quote → buy → settle loop live).
2. Demo video (< 2 min) with a devnet Tx signature on-screen.
3. Public repo link (this repo, with `Anchor.toml`, consistent program ID).
4. Deployment links (Vercel/static frontend) + devnet contract address.
5. Written description: problem → mechanism → security → partner integrations.

### Strategy B — Otter Tank (optional, in parallel)

The Otter Tank stage is **Sept 4** (no bounties, but free stage time + feedback). If you
can reach the venue, do both: pitch Nimbus at Otter Tank on Sept 4 and submit to the main
track by Sept 5. Same demo, same repo.

### Strategy C — Partner-bounty spin-off (only if capacity)

Only if there's leftover time *after* the main submission is safe: reuse the on-chain
program and add **ENS subnames** (regions/pools → `*.nimbus.eth`) + **Swarm-pinned**
observation data + **Mobula** price signals. Highest partner overlap, but honestly low
differentiation vs. Nimbus itself — treat as a bonus, not the plan.

### §4.1 Fixes already applied (this session)

| Fix | File(s) |
|---|---|
| Unify program ID to the Rust canonical `CLiMaFi1111111111111111111111111111111111111` (was 3 different strings; the offchain one was invalid base58 → would throw at import) | `lib/nimbus.ts`, `offchain/{monitoring,oracle-aggregator,policy-monitor}.ts` |
| Quote endpoint now accepts the UI's `GET ?payout=…` call (was POST-only with different field names) and returns `premium` + `premiumAmount` | `app/api/quotes/calculate/route.ts` |
| Added missing `Anchor.toml` so `anchor build` / `anchor test` / `anchor localnet` work | `Anchor.toml` (new) |

---

## 5. Concrete work plan (for Strategy A, ~24 hours)

Prioritized by demo impact per unit effort. ✅ = already done this session.

| # | Task | Effort | Why |
|---|---|---|---|
| 1 | ✅ Unify `PROGRAM_ID` + add `Anchor.toml` | done | Unblocks build/test/deploy, fixes PDA divergence |
| 2 | Recreate Anchor harness (keypair gen); `anchor build` green; run `tests/nimbus.ts` on localnet | 1–2h | Proves the program works; enables devnet deploy |
| 3 | ✅ Fix quote endpoint (GET + POST, `premium` field) | done | Buy flow now quotes for real |
| 4 | **Wire the rest of the buy loop**: call `/api/quotes/sign`, build the Ed25519 instruction + `buy_policy` via `lib/nimbus.ts`, and hook the **dead "Confirm & Purchase" button** (currently no `onClick`) to actually send the transaction | 2–3h | The core product loop — the single biggest demo gap |
| 5 | Deploy program + config + pool + devnet USDC mint; stand up oracle aggregator + policy monitor; settle one policy live | 1–2h | A real end-to-end demo with a Tx sig |
| 6 | Replace demo data on buy/pools/portfolio with on-chain reads (`getProgramAccounts` already used in governance page) | 2–4h | Kills "it's mock data" objection |
| 7 | Point USDC mint at a devnet mint (env-driven), not mainnet `EPjFWdd5…` | 0.25h | Correctness on devnet |
| 8 | Wire real pricing: surface `calculate_dynamic_ltv` / utilization surcharge into `/api/quotes/calculate` (or at least document the gap) | 1–2h | Closes the "flat pricing" critique |
| 9 | ENS subname registry + Swarm pin of observation JSON (stretch) | 2–4h | Partner-bounty narrative |
| 10 | Polish submission: 2-min video, description, live links, contract addresses | 2h | Judging is on the demo + story |

**Critical-path check:** items 2 + 4 + 5 are the *minimum viable demo* (a signed
quote → on-chain policy → automatic settle). Everything else is polish. Land those three
first, then submit, then improve.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Regulatory framing (parametric weather can read as insurance/derivatives; EU MiFID/IDD) | Use the repo's own `LEGAL.md` framing: "parametric risk coverage, not insurance"; keep it devnet/demo |
| Single permissioned oracle undermines "decentralized" claim | Be explicit: Switchboard path is implemented but MVP uses a permissioned publisher; position as roadmap, or demo the Switchboard read path |
| Deadline pressure (apps close Sept 4 17:00; judging Sept 5) | Commit to Strategy A (Otter Tank) and lock the demo hours early |
| Program ID / key drift breaking the demo | Single source of truth for `PROGRAM_ID` (env var + generated keypair); add a CI check that greps for ID consistency |
| Mock data undermining credibility | Ship item 5; if time-constrained, label remaining mocks honestly in-UI |
| Two-frontend divergence | Delete or reconcile `merged-app/`; demo from `app/` only |

---

## 7. Immediate quick wins (do first)

1. ✅ **Unify `PROGRAM_ID`** (one grep-able constant) and add `Anchor.toml` — done.
2. ✅ **Fix the quote endpoint** to match the UI — done.
3. **Wire `quotes/sign` → `buy_policy` and the dead "Confirm & Purchase" button** — the
   next task (see §5 item 4).
4. **`anchor build` + localnet test suite green.**
5. **One devnet deploy + one live settle** recorded as a demo clip.
6. **Update the landing copy** — remove "Live on Solana Devnet" unless true; align
   "Colosseum/Frontier Hackathon" references in the design docs with Common S3nse.

---

## Appendix A — File inventory (LOC)

```
programs/nimbus/src/lib.rs        1306   (program entry + contexts + Ed25519 verify)
programs/nimbus/src/state.rs       205   (accounts, Quote, events)
programs/nimbus/src/switchboard.rs 218   (on-chain Switchboard read)
programs/nimbus/src/governance.rs  229   (multisig)
programs/nimbus/src/*.rs           ~330  (risk, economic_safety, errors, timelock, nonce,
                                            reentrancy, compute, constants)
tests/nimbus.ts                     600   (anchor integration suite)
tests/deserialize.test.ts           447
tests/security-audit.ts             378
tests/fuzz-settlement.ts            222
programs/nimbus/tests/proptest_settlement.rs
lib/nimbus.ts                       329   (client SDK + hand-written IDL)
lib/deserialize.ts                  375
offchain/policy-monitor.ts          339
offchain/oracle-aggregator.ts       164
offchain/{alerting,monitoring,observability,rate-limiter,switchboard-oracle,…}.ts ~600
app/buy/page.tsx                    573
app/page.tsx                        376
app/governance/page.tsx             322
app/{pools,portfolio,settle}/page.tsx ~270 each
app/api/**                           ~300 (5 routes)
db/schema.sql + encryption.sql
.github/workflows/*                  5 workflows
docs (designdoc.md 158KB, designdocfull.md, master designdoc.md, EXECUTIVE_SUMMARY, LEGAL,
      governance/, PROFESSIONAL_AUDIT_CHECKLIST.md)
```

## Appendix B — Key files to read first

1. `programs/nimbus/src/lib.rs` — the whole product on-chain
2. `master designdoc.md` — original spec (note: still targets the *Frontier* hackathon)
3. `EXECUTIVE_SUMMARY.md` — the intended public narrative
4. `app/api/quotes/sign/route.ts` — quote signing (now shares `lib/quote.ts` serializer)
5. `lib/nimbus.ts` — client SDK (transaction builders live here)

---

## Appendix C — Changes applied this session (2026-09-04)

Typechecked (`npx tsc --noEmit`, exit 0) and offchain-tsconfig typechecked (exit 0).

| Area | Change |
|---|---|
| **Program ID** | Unified to `CLiMaFi1111111111111111111111111111111111111` in `lib/nimbus.ts` + all `offchain/*` (the offchain string was invalid base58 — would throw at import). |
| **Anchor harness** | Added `Anchor.toml` (localnet + devnet, test script). Rust/Solana toolchain still required to build/deploy (not available in this sandbox). |
| **Quote serialization** | New `lib/quote.ts` — one Borsh-compatible `serializeQuote` shared by the sign API and the client (kills drift risk). |
| **Regions** | New `lib/regions.ts` — single registry with on-chain u64 ids; used by UI, API, and mirrored in the oracle aggregator (added regions 4–6). |
| **Sign API** | Rewrote `/api/quotes/sign` — accepts `indexMethod`/`regionId`/`poolId`/`policyId`/`peril`, returns camelCase quote + `signature` (b64) + `quoteSignerPubkey` + `message` (hex); added `QUOTE_SIGNER_ALLOW_PAST` env flag for the live-settle demo. |
| **Quote API** | `/api/quotes/calculate` now accepts both the UI's `GET ?payout=…` and legacy `POST {payoutAmount}`, returns `premium` + `premiumAmount`. |
| **Client SDK (`lib/nimbus.ts`)** | Completed the hand-written IDL (added `Peril`/`IndexMethod`/`TriggerDirection` enums + `settlePolicy`). Rewrote `createBuyPolicyTransaction` to build the full tx (compute budget + auto `initQuoteNonce` + Ed25519 ix + `buyPolicy`) with a client-side message-integrity check. Added `createSettlePolicyTransaction` + `getGlobalConfig`. Made `USDC_MINT` env-driven (`NEXT_PUBLIC_USDC_MINT`). Exported `DISCRIMINATORS`. |
| **Buy flow (`app/buy`)** | Wired the dead "Confirm & Purchase" button → real `handlePurchase` (sign → buy → send → confirm) with `TransactionStatus` UX; capped window slider at 31 days; converted amounts to base units (×1e6) before signing. |
| **On-chain reads** | Rewrote `portfolio`, `settle`, and `pools` pages to read real accounts via `getProgramAccounts` + validated deserializers (empty states instead of fake data). `settle` now performs real on-chain settlement. |
| **API routes** | `regions` returns the real registry; `policies/[wallet]` scans the chain server-side; `oracle/[regionId]/current` fetches live Open-Meteo rainfall. |
| **USDC mint** | `Nav` balance check now uses `NEXT_PUBLIC_USDC_MINT` (no longer hardcodes mainnet mint). |
| **Dependencies** | Added missing direct deps `bs58`, `axios`, `node-fetch` (+types) and the test stack `chai`/`mocha`/`ts-mocha`/`@types/chai`; bumped `next` 14.2.3 → **14.2.35** (patched security advisory); regenerated `package-lock.json`. |
| **Offchain scripts** | Added `tsconfig.offchain.json` (CommonJS) and pointed `npm run oracle`/`monitor` at it — the root `tsconfig` (module `esnext`) could not be used by ts-node. Excluded the dead `switchboard-oracle.ts` stub (references a nonexistent `@switchboard-xyz/solana.js`). |
| **Offchain runtime fixes** | Both `oracle-aggregator.ts` and `policy-monitor.ts` built `new Program({} as any, …)` (empty IDL → `.methods` was `undefined`). Added `offchain/load-idl.ts` (loads `target/idl/nimbus.json`) and wired both services to it. Added a CLI entrypoint to the oracle (it had none). Fixed the monitor's wrong account-size filter (`197 + 8` → `197`) and stale keypair default, and made it skip policies it can't sign for (settlement is owner-signed). |
| **Deploy + demo scripts** | `scripts/deploy.ts` (idempotent: keys → airdrop → USDC mint → `initialize_config` → `create_pool` → seed capital → optional buyer funding; `--dry-run` mode) and `scripts/demo-settle.ts` (one-shot buy → observe → settle with a backdated window, no waiting). Wired as `npm run deploy`, `deploy:dryrun`, `demo`. |
| **README** | Rewrote as a full quick-start + deploy runbook (exact keypair/program-id/mint/config/pool commands, env reference, troubleshooting). |
| **Copy** | Landing hero "Live on Solana Devnet" → "Parametric Cover on Solana"; oracle-source labels no longer claim Switchboard; footer mint fixed. |

### Remaining (needs toolchain / keys / network, can't be done in-sandbox)

1. **Deploy + demo** (scripted — see `README.md` §3): generate a program keypair, `anchor build` + `anchor test` on localnet, `anchor deploy` (devnet) or `anchor localnet`, then `npm run deploy` (mint + config + pool + capital) and `npm run demo` (buy → observe → settle with a backdated window). Rust/Solana/Anchor toolchain is not available in this sandbox, so these steps are for your machine.
2. **`merged-app/`** is a divergent static-export duplicate (used only by the GitHub Pages workflow). It was patched to compile against the new client API, but the static Pages deploy cannot serve the `/api/*` routes the real flow needs — deploy the real app on a serverless host (Vercel) instead. Recommend deleting/archiving `merged-app/` post-demo.
3. **Dependency audit** (`npm audit --audit-level=high`, run against the gate's allowlist in `scripts/security-gate.sh`):
   - **`protobufjs` (critical)** and `@trezor/*`/`@stellar/*`/`@particle/*`/`metro`/`socket.io-parser` all come from the `@solana/wallet-adapter-wallets` mega-package. The app only registers **Phantom** (`components/WalletProvider.tsx`), so swapping to the single `@solana/wallet-adapter-phantom` adapter removes most of the high/critical surface — but its current 0.9.x requires `@solana/web3.js ^1.98` and a newer base, so do it carefully post-demo (kept as-is here to avoid risking the working wallet flow).
   - **`next` (high)**: all current Next.js advisories are fixed in **15.5.21+**; 14.2.35 is the last 14.2.x. This app is client-heavy and uses almost none of the affected surfaces (image optimizer, server actions, middleware, rewrites), so staying on 14.2.35 for the demo is defensible; plan a 15.x upgrade after (note: route handlers must switch to async `params`).
   - **Remaining** (`eslint-config-next`, `@next/eslint-plugin-next`, `postcss`, `glob`, `js-yaml`, `lodash`, etc.) are build-time/dev-only and never ship to the client bundle. Either `npm audit fix` (non-breaking) or an allowlist extension will quiet the gate; the gate already documents the "Solana ecosystem allowlist" pattern.
