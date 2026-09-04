/**
 * Production Policy Monitor
 * 
 * Scans for matured policies and settles them automatically.
 * Integrates with alerting system for operational visibility.
 *
 * Architecture:
 * 1. Fetches all Policy PDA accounts from the program using getProgramAccounts
 * 2. Filters for Active policies whose window has ended
 * 3. Validates observation coverage before attempting settlement
 * 4. Submits settle_policy transactions with proper compute budget
 * 5. Reports results to alerting system (Slack + PagerDuty)
 */

import { Connection, Keypair, PublicKey, ComputeBudgetProgram, Transaction } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import { NimbusAlerting, AlertPayload } from './alerting';
import { loadProgramIdl } from './load-idl';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/**
 * Derives the associated token address for a given wallet and mint.
 * Mirrors the SPL getAssociatedTokenAddress logic without requiring the
 * @solana/spl-token dependency.
 */
function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

const PROGRAM_ID = new PublicKey("CLiMaFi1111111111111111111111111111111111111");
const SETTLEMENT_COMPUTE_UNITS = 400_000;

// Policy status enum (matches on-chain)
enum PolicyStatus { Active = 0, Cancelled = 1, SettledPaid = 2, SettledExpired = 3 }

interface ParsedPolicy {
  pubkey: PublicKey;
  policyId: number;
  owner: PublicKey;
  poolId: number;
  pool: PublicKey;
  regionId: number;
  peril: number;
  windowStartUnix: number;
  windowEndUnix: number;
  status: PolicyStatus;
  payoutAmount: number;
}

export class PolicyMonitor {
  private connection: Connection;
  private wallet: Wallet;
  private program: Program;
  private alerting: NimbusAlerting;
  private pollIntervalMs: number;
  private running: boolean = false;

  constructor(
    rpcUrl: string,
    keypairPath: string,
    options?: { pollIntervalMs?: number; slackWebhook?: string; pagerDutyKey?: string }
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const keypair = Keypair.fromSecretKey(new Uint8Array(secret));
    this.wallet = new Wallet(keypair);
    this.pollIntervalMs = options?.pollIntervalMs || 60_000;

    const provider = new AnchorProvider(this.connection, this.wallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });
    this.program = new Program(loadProgramIdl(), PROGRAM_ID, provider);
    this.alerting = new NimbusAlerting(options?.slackWebhook, options?.pagerDutyKey);
  }

  /**
   * Start the monitoring loop
   */
  async start() {
    this.running = true;
    console.log(`[PolicyMonitor] Starting (poll every ${this.pollIntervalMs / 1000}s)...`);

    while (this.running) {
      try {
        await this.checkAndSettleMaturedPolicies();
      } catch (err) {
        console.error('[PolicyMonitor] Cycle error:', err);
        await this.alerting.sendAlert({
          type: 'CRITICAL_ERROR',
          severity: 'warning',
          message: `Policy monitor cycle failed: ${(err as Error).message}`,
          data: { error: String(err) },
        });
      }

      await this.sleep(this.pollIntervalMs);
    }
  }

  stop() {
    this.running = false;
    console.log('[PolicyMonitor] Stopping...');
  }

  /**
   * Core logic: find matured policies and settle them
   */
  private async checkAndSettleMaturedPolicies() {
    const now = Math.floor(Date.now() / 1000);
    console.log(`[PolicyMonitor] Scanning for matured policies (now=${now})...`);

    const maturedPolicies = await this.fetchMaturedPolicies(now);
    console.log(`[PolicyMonitor] Found ${maturedPolicies.length} matured policies`);

    let settled = 0;
    let failed = 0;

    for (const policy of maturedPolicies) {
      try {
        // Check if observations exist for the full window
        const observationsCovered = await this.validateObservationCoverage(policy);
        if (!observationsCovered) {
          console.log(`[PolicyMonitor] Policy #${policy.policyId}: incomplete observations, skipping`);
          continue;
        }

        await this.settlePolicy(policy);
        settled++;
      } catch (err) {
        failed++;
        console.error(`[PolicyMonitor] Failed to settle policy #${policy.policyId}:`, err);
        await this.alerting.sendAlert({
          type: 'CRITICAL_ERROR',
          severity: 'warning',
          message: `Settlement failed for policy #${policy.policyId}`,
          data: { policyId: policy.policyId, error: String(err) },
        });
      }
    }

    if (settled > 0 || failed > 0) {
      console.log(`[PolicyMonitor] Cycle complete: ${settled} settled, ${failed} failed`);
    }
  }

  /**
   * Fetch all Active policies whose window has ended using getProgramAccounts
   */
  private async fetchMaturedPolicies(now: number): Promise<ParsedPolicy[]> {
    // Fetch all Policy accounts from the program
    // Policy accounts use seeds: ["policy", policy_id.to_le_bytes()]
    // We filter by: status == Active (byte at offset 8+8+32+8+32+8+1+8+8+1+1+8+8 = 133)
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { dataSize: 197 }, // Policy::LEN = 197 (includes the 8-byte discriminator)
      ],
    });

    const matured: ParsedPolicy[] = [];

    for (const { pubkey, account } of accounts) {
      try {
        const parsed = this.parsePolicy(pubkey, account.data);
        if (parsed && parsed.status === PolicyStatus.Active && parsed.windowEndUnix <= now) {
          matured.push(parsed);
        }
      } catch {
        // Skip accounts that don't parse as Policy
      }
    }

    return matured;
  }

  /**
   * Parse raw Policy account data
   * Layout (after 8-byte discriminator):
   *   policy_id: u64, owner: Pubkey, pool_id: u64, pool: Pubkey,
   *   region_id: u64, peril: u8, window_start_unix: i64, window_end_unix: i64,
   *   index_method: u8, direction: u8, threshold: i64,
   *   payout_amount: u64, premium_amount: u64, status: u8, ...
   */
  private parsePolicy(pubkey: PublicKey, data: Buffer): ParsedPolicy | null {
    if (data.length < 150) return null;

    let offset = 8; // discriminator

    const policyId = Number(data.readBigUInt64LE(offset)); offset += 8;
    const owner = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const poolId = Number(data.readBigUInt64LE(offset)); offset += 8;
    const pool = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const regionId = Number(data.readBigUInt64LE(offset)); offset += 8;
    const peril = data[offset]; offset += 1;
    const windowStartUnix = Number(data.readBigInt64LE(offset)); offset += 8;
    const windowEndUnix = Number(data.readBigInt64LE(offset)); offset += 8;
    offset += 1; // index_method
    offset += 1; // direction
    offset += 8; // threshold
    const payoutAmount = Number(data.readBigUInt64LE(offset)); offset += 8;
    offset += 8; // premium_amount
    const status = data[offset] as PolicyStatus;

    return { pubkey, policyId, owner, poolId, pool, regionId, peril, windowStartUnix, windowEndUnix, status, payoutAmount };
  }

  /**
   * Validate that all required observation PDAs exist
   */
  private async validateObservationCoverage(policy: ParsedPolicy): Promise<boolean> {
    const numDays = (policy.windowEndUnix - policy.windowStartUnix) / 86400;
    const pdas: PublicKey[] = [];

    for (let i = 0; i < numDays; i++) {
      const dayStart = policy.windowStartUnix + i * 86400;
      const [pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("obs"),
          new BN(policy.regionId).toArrayLike(Buffer, "le", 8),
          Buffer.from([policy.peril]),
          new BN(dayStart).toArrayLike(Buffer, "le", 8),
        ],
        PROGRAM_ID
      );
      pdas.push(pda);
    }

    // Batch check: getMultipleAccountsInfo
    const accounts = await this.connection.getMultipleAccountsInfo(pdas);
    const missing = accounts.filter(a => a === null).length;

    if (missing > 0) {
      console.log(`[PolicyMonitor] Policy #${policy.policyId}: ${missing}/${numDays} observations missing`);
      return false;
    }

    return true;
  }

  /**
   * Submit settle_policy transaction with compute budget
   */
  private async settlePolicy(policy: ParsedPolicy) {
    console.log(`[PolicyMonitor] Settling policy #${policy.policyId}...`);

    // NOTE: settle_policy requires the policy OWNER to be the transaction signer
    // (C-01 fix on-chain). This keeper can therefore only settle policies whose
    // owner is this wallet's keypair. For policies owned by other users, settlement
    // is done by the owner through the /settle page (which signs as the owner).
    if (policy.owner.toBase58() !== this.wallet.publicKey.toBase58()) {
      console.log(`[PolicyMonitor] Skipping policy #${policy.policyId}: owner != keeper (owner-signed settlement)`);
      return;
    }

    const numDays = (policy.windowEndUnix - policy.windowStartUnix) / 86400;
    const remainingAccounts = [];

    for (let i = 0; i < numDays; i++) {
      const dayStart = policy.windowStartUnix + i * 86400;
      const [pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("obs"),
          new BN(policy.regionId).toArrayLike(Buffer, "le", 8),
          Buffer.from([policy.peril]),
          new BN(dayStart).toArrayLike(Buffer, "le", 8),
        ],
        PROGRAM_ID
      );
      remainingAccounts.push({ pubkey: pda, isWritable: false, isSigner: false });
    }

    // Derive vault authority PDA and proper ATAs
    const [vaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_auth"), new BN(policy.poolId).toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    );

    // Derive USDC ATAs for vault and policy owner
    const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
    const configAccount = await this.connection.getAccountInfo(configPda);
    if (!configAccount) {
      throw new Error('Config account not found');
    }
    // USDC mint layout in GlobalConfig: disc(8) + admin(32) + paused(1) → usdc_mint starts at offset 41
    const usdcMint = new PublicKey(configAccount.data.subarray(41, 41 + 32));

    const poolVaultUsdcAta = deriveAta(vaultAuth, usdcMint);
    const policyOwnerUsdcAta = deriveAta(policy.owner, usdcMint);

    // Build transaction with compute budget
    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: SETTLEMENT_COMPUTE_UNITS });

    const settleIx = await this.program.methods
      .settlePolicy()
      .accounts({
        config: configPda,
        pool: policy.pool,
        vaultAuth,
        poolVaultUsdcAta,
        policy: policy.pubkey,
        policyOwner: policy.owner,
        policyOwnerUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();

    const tx = new Transaction().add(computeIx, settleIx);
    const provider = this.program.provider as import('@coral-xyz/anchor').AnchorProvider;
    const sig = await provider.sendAndConfirm(tx);

    console.log(`[PolicyMonitor] Policy #${policy.policyId} settled: ${sig}`);

    await this.alerting.sendAlert({
      type: 'POLICY_SETTLED',
      severity: 'info',
      message: `Policy #${policy.policyId} settled successfully`,
      data: { policyId: policy.policyId, owner: policy.owner.toBase58(), txSig: sig },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI entrypoint
if (require.main === module) {
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const keypairPath = process.env.ORACLE_KEYPAIR_PATH || './keys/oracle.json';

  const monitor = new PolicyMonitor(rpcUrl, keypairPath, {
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '60000'),
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    pagerDutyKey: process.env.PAGERDUTY_ROUTING_KEY,
  });

  process.on('SIGINT', () => monitor.stop());
  process.on('SIGTERM', () => monitor.stop());

  monitor.start().catch(console.error);
}
