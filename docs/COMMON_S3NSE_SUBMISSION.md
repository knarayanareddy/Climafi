# Common S3nse — Nimbus Submission Pack

> Main-track Taikai submission text + a 2-minute demo narration.
> Deadline: final submissions **Sept 5 @ 07:00 UTC (09:00 Amsterdam)**.
> Everything below is honest about the current build (devnet, permissioned oracle
> MVP) so it holds up under judge Q&A.

---

## 1. Taikai fields (copy-paste)

### 1.1 Project name

**Nimbus**

### 1.2 Short description (≤ ~280 chars)

> Permissionless parametric climate cover on Solana — oracle-verified rainfall
> indices trigger automatic USDC payouts. No claims. No adjusters. Just data.

*(If Taikai caps shorter, use the tagline only:)*
> Parametric climate cover on Solana: rainfall index crosses a threshold → USDC
> hits your wallet. Automatic, oracle-verified, permissionless.

### 1.3 Track

**Security** (primary) · **DeFi** (secondary)

### 1.4 Full description

**The problem.** Climate risk hits the people least able to bear it — smallholder
farmers and communities in climate-vulnerable regions. Traditional insurance is
claims-based, slow, and out of reach. Parametric cover — payouts triggered by
objective data, not assessed loss — fixes the speed, but existing offerings are
centralized and opaque.

**What Nimbus does.** Nimbus is a Solana-native protocol for parametric climate
cover. Anyone picks a region (Nairobi, Mumbai, Manila, São Paulo, Addis Ababa,
Dhaka), a peril (drought = below threshold, flood = above), an index (Sum / Mean /
Max rainfall), a 7–31 day window, a threshold, and a payout. They pay a USDC
premium and get an on-chain policy. When the observation window ends, the daily
oracle index is checked against the threshold — if it triggered, USDC is sent
automatically. No claims process, no adjusters, no waiting.

**How it works.**
1. A quote API prices the policy and **Ed25519-signs** the exact parameters.
2. `buy_policy` verifies that signature **on-chain** (by inspecting the Ed25519
   instruction in the transaction) and mints the policy account.
3. A daily oracle posts rainfall `ObservationSnapshot` accounts.
4. `settle_policy` validates the snapshots (ownership, region/peril match, day
   alignment, staleness), aggregates the index, and pays out deterministically.

**Capital.** Permissionless underwriting pools: LPs deposit USDC, earn premiums,
and share risk. Dynamic LTV limits, utilization-based pricing, a capital-solvency
invariant, and a 90%-utilization circuit breaker keep pools safe.

**Why the Security track.** The protocol is built security-first:
- Ed25519-signed quotes verified on-chain (not "trust the API")
- per-signer nonce replay protection
- reentrancy guard (no CPI in transaction)
- checked arithmetic everywhere
- LTV limits + solvency invariant + circuit breakers
- oracle snapshot validation at settlement
- timelock + M-of-N multisig governance
- CI security gate: Semgrep, CodeQL (Rust + TS), Gitleaks, cargo-audit, dependency audit

**Where it stands honestly.** The MVP runs a **permissioned oracle publisher**
(pulling Open-Meteo data); the **Switchboard V2 on-chain read path is implemented**
and staged as the decentralization step. Core protocol work predates hack week;
hack week was spent hardening the codebase, wiring the full buy → settle loop, and
preparing the devnet demo. Nimbus has not been presented at any prior hackathon.

### 1.5 What was built during hack week

- Wired the end-to-end flow: signed quote → on-chain `buy_policy` → portfolio →
  `settle_policy` (the UI flow was previously incomplete).
- Unified the program ID across all layers and recreated the Anchor deploy harness.
- Replaced mock data with real on-chain reads (portfolio / pools / settle).
- Built the idempotent deploy script (`USDC mint → config → pool → capital`) and a
  one-shot demo script (buy → observe → settle in seconds).
- Hardened offchain services: real IDL loading, oracle CLI, settlement keeper fixes.

### 1.6 Technologies

Anchor (Rust) · Solana SPL · Next.js 14 · TypeScript · Open-Meteo · PostgreSQL/
TimescaleDB schema · Redis rate limiting · tweetnacl (Ed25519)

### 1.7 Links (fill in before submitting)

- **Repository:** https://github.com/knarayanareddy/Nimbus
- **Demo video:** `[YouTube/Loom link]`
- **Live demo:** `[Vercel URL]`
- **Contract address (devnet):** `[paste from anchor deploy]`
- **Deployment:** devnet (program + USDC test mint + Pool #1)

### 1.8 Team

`[Team name]` — `[member names / roles / one line each]`

### 1.9 Partner bounties (optional)

Not targeting a specific partner bounty; aligned with the **Security** and **DeFi**
tracks. *(ENS subnames + EthSwarm data pinning are designed as next-step
integrations — mention only if actually shipped.)*

---

## 2. Demo script / narration (~2 min)

**Format:** screen recording, 16:9, ~2:00 at a relaxed speaking pace (~300 words).
Keep the explorer links on screen whenever a transaction confirms.

### Segment 1 — Hook (0:00–0:15)

**[On screen: landing hero — "Weather data crosses threshold. USDC hits your wallet."]**

> "Climate risk is a shared problem, but the people who bear it most can't get
> covered. Nimbus turns rainfall data into automatic protection on Solana — no
> claims, no adjusters, just data. Let me show you."

### Segment 2 — Configure coverage (0:15–0:55)

**[On screen: /buy — walk the steps briskly, don't linger]**

> "I pick a region — Nairobi. I choose drought protection, so I get paid if
> rainfall falls *below* my threshold. I'll use the Sum index: total rain over the
> window. Fourteen days. And I set a threshold of eighty millimeters — if Nairobi
> gets less than that over two weeks, I get paid. Max payout: five hundred USDC."

### Segment 3 — The signed quote (0:55–1:15)

**[On screen: click "Get Quote" → premium + 120s countdown]**

> "Nimbus prices the policy and returns a quote that is cryptographically signed —
> Ed25519 — by the protocol's quote signer. That signature is checked *on-chain*
> when I buy, so nobody can tamper with my premium or payout. The quote is good for
> two minutes."

### Segment 4 — On-chain purchase (1:15–1:35)

**[On screen: click "Confirm & Purchase" → wallet prompt → success + explorer link]**

> "I confirm. The transaction verifies the signature, checks the pool's risk
> limits, takes my premium in USDC, and mints a policy account on Solana. Here's
> the transaction — final in seconds. My portfolio now shows the live policy."

### Segment 5 — Settlement + payout (1:35–1:55)

**[On screen: /settle → click Settle → tx confirms; or the demo script output]**

> "The window has ended, so I settle. The program loads each daily oracle
> snapshot, validates it, and aggregates the index. Nairobi came in under the
> threshold — triggered — and the payout is sent to my wallet automatically. Same
> instruction, fully deterministic."

### Segment 6 — Close (1:55–2:00)

**[On screen: pools page or explorer, then back to title]**

> "Parametric climate cover, permissionless capital, and settlement you can verify
> on-chain. Nimbus — built for the Security track, on Solana."

---

### If you need a 90-second cut

Drop Segment 2's detail to: *"Region, peril, index, window, threshold, payout —
configured in seconds."* Merge Segments 4–5: *"I confirm; the policy mints
on-chain. When the window ends, one settle instruction validates the oracle
snapshots and pays out automatically — here's the transaction."*

---

### Recording tips

- Record on **localnet** (`anchor localnet`) or devnet — both show real tx
  signatures; localnet never rate-limits.
- For Segment 5, use the pre-built path so you don't wait for a real window:
  either `npm run demo` (buy → observe → settle with a backdated window, prints
  explorer links) or the **/settle** page if you prepared a matured policy.
- Pause on the **explorer link** for 2–3 seconds on each confirmation.
- Voiceover: ~300 words ≈ 2:00 at a calm pace; keep captions on for judges who
  watch muted.

---

## 3. Judge Q&A — likely questions & crisp answers

| Question | Answer |
|---|---|
| "Is this insurance?" | No — parametric risk cover. Payout is tied to an objective data trigger, not an assessed loss. We never call it insurance and we disclose the difference in `LEGAL.md`. |
| "Who is the oracle?" | MVP: a permissioned publisher posting daily Open-Meteo rainfall. The Switchboard V2 on-chain read path is implemented; decentralization is the stated next step. |
| "What stops quote manipulation?" | Quotes are Ed25519-signed server-side and re-verified on-chain, plus a per-signer nonce prevents replay. |
| "How is the pool protected?" | LTV limits, a capital ≥ locked invariant, dynamic utilization pricing, and a 90% utilization circuit breaker. |
| "What if the oracle stops posting?" | Settlement requires valid daily snapshots within a staleness bound — missing data means no settlement (policyholder-safe). Monitoring alerts on oracle gaps. |
| "Who can settle?" | Settlement is owner-signed; the program itself enforces the trigger logic and payout — the caller can't choose the outcome. |
| "What did you build this week vs before?" | Core protocol predates hack week; this week we wired the full buy→settle loop, rebuilt the deploy harness, replaced mock UI with on-chain data, and hardened offchain services. |
| "Mainnet?" | Devnet for the demo. Mainnet is a deployment choice after audit, not a hack-week goal. |
