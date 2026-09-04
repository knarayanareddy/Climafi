/**
 * Production-Grade Pool Health Monitoring
 * 
 * Monitors on-chain pool state and emits alerts when economic invariants
 * are at risk. Integrates with Slack + PagerDuty via alerting module.
 *
 * Checks performed:
 * 1. Utilization ratio (locked/capital) — alerts at 80%, critical at 90%
 * 2. Pool solvency (capital must cover locked exposure)
 * 3. Oracle staleness (no observations in last 24h for active regions)
 * 4. Protocol pause state changes
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { NimbusAlerting, AlertPayload } from './alerting';

const PROGRAM_ID = new PublicKey("CLiMaFi1111111111111111111111111111111111111");
const UTILIZATION_WARNING = 0.80;
const UTILIZATION_CRITICAL = 0.90;

export interface MonitoringConfig {
  rpcUrl: string;
  programId?: PublicKey;
  slackWebhook?: string;
  pagerDutyKey?: string;
  pollIntervalMs?: number;
  poolIds?: number[];
}

interface PoolState {
  poolId: number;
  capital: number;
  locked: number;
  utilization: number;
}

export class NimbusMonitoring {
  private connection: Connection;
  private alerting: NimbusAlerting;
  private config: MonitoringConfig;
  private running: boolean = false;
  private lastPausedState: boolean | null = null;
  private alertedPools: Set<string> = new Set(); // Prevent alert storms

  constructor(config: MonitoringConfig) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.alerting = new NimbusAlerting(config.slackWebhook, config.pagerDutyKey);
    this.config = config;
  }

  async start() {
    this.running = true;
    const interval = this.config.pollIntervalMs || 30_000;
    console.log(`[Monitoring] Starting pool health monitor (every ${interval / 1000}s)...`);

    while (this.running) {
      try {
        await this.runHealthChecks();
      } catch (err) {
        console.error('[Monitoring] Health check error:', err);
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  stop() {
    this.running = false;
    console.log('[Monitoring] Stopping...');
  }

  private async runHealthChecks() {
    // 1. Check protocol pause state
    await this.checkPauseState();

    // 2. Check pool health for configured pools
    const poolIds = this.config.poolIds || [1, 2, 3];
    for (const poolId of poolIds) {
      await this.checkPoolHealth(poolId);
    }

    // 3. Check oracle freshness
    await this.checkOracleFreshness();
  }

  private async checkPauseState() {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      this.config.programId || PROGRAM_ID
    );

    const account = await this.connection.getAccountInfo(configPda);
    if (!account) return;

    // paused is at offset 8(disc) + 32(admin) = 40, 1 byte
    const paused = account.data[40] !== 0;

    if (this.lastPausedState !== null && paused !== this.lastPausedState) {
      const severity = paused ? 'critical' : 'info';
      await this.alerting.sendAlert({
        type: 'PAUSED',
        severity,
        message: paused ? 'Protocol has been PAUSED' : 'Protocol has been UNPAUSED',
        data: { paused },
      });
    }

    this.lastPausedState = paused;
  }

  private async checkPoolHealth(poolId: number) {
    const [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), new BN(poolId).toArrayLike(Buffer, "le", 8)],
      this.config.programId || PROGRAM_ID
    );

    const account = await this.connection.getAccountInfo(poolPda);
    if (!account) return;

    // Parse Pool account:
    // After 8(disc): pool_id(8) + peril(1) + region_set_hash(32) + max_tenor(4) + ltv_limit(2) = 47
    // capital at offset 8 + 47 = 55 (u64)
    // locked at offset 55 + 8 = 63 (u64)
    const capital = Number(account.data.readBigUInt64LE(55));
    const locked = Number(account.data.readBigUInt64LE(63));

    const utilization = capital > 0 ? locked / capital : 0;
    const alertKey = `pool_${poolId}_util`;

    this.logEvent('pool_health_check', { poolId, capital, locked, utilization: (utilization * 100).toFixed(1) + '%' });

    // Critical: utilization > 90%
    if (utilization >= UTILIZATION_CRITICAL) {
      if (!this.alertedPools.has(alertKey + '_critical')) {
        await this.alerting.sendAlert({
          type: 'HIGH_UTILIZATION',
          severity: 'critical',
          message: `Pool #${poolId} utilization CRITICAL: ${(utilization * 100).toFixed(1)}%`,
          data: { poolId, utilization: utilization * 100, capital, locked },
        });
        this.alertedPools.add(alertKey + '_critical');
      }
    }
    // Warning: utilization > 80%
    else if (utilization >= UTILIZATION_WARNING) {
      if (!this.alertedPools.has(alertKey + '_warning')) {
        await this.alerting.sendAlert({
          type: 'HIGH_UTILIZATION',
          severity: 'warning',
          message: `Pool #${poolId} utilization HIGH: ${(utilization * 100).toFixed(1)}%`,
          data: { poolId, utilization: utilization * 100, capital, locked },
        });
        this.alertedPools.add(alertKey + '_warning');
      }
    }
    // Recovery: clear alerts when below threshold
    else {
      this.alertedPools.delete(alertKey + '_warning');
      this.alertedPools.delete(alertKey + '_critical');
    }

    // Solvency check: capital must be >= locked
    if (capital < locked) {
      await this.alerting.sendAlert({
        type: 'CRITICAL_ERROR',
        severity: 'critical',
        message: `Pool #${poolId} INSOLVENT: capital (${capital}) < locked (${locked})`,
        data: { poolId, capital, locked, deficit: locked - capital },
      });
    }
  }

  private async checkOracleFreshness() {
    // Check if observations have been posted in the last 24 hours
    // by checking the most recent observation PDA for known regions
    const now = Math.floor(Date.now() / 1000);
    const yesterdayMidnight = now - (now % 86400) - 86400;

    const regions = [1, 2, 3]; // Known region IDs

    for (const regionId of regions) {
      const [obsPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("obs"),
          new BN(regionId).toArrayLike(Buffer, "le", 8),
          Buffer.from([0]), // Rainfall
          new BN(yesterdayMidnight).toArrayLike(Buffer, "le", 8),
        ],
        this.config.programId || PROGRAM_ID
      );

      const account = await this.connection.getAccountInfo(obsPda);
      if (!account) {
        const alertKey = `oracle_stale_${regionId}`;
        if (!this.alertedPools.has(alertKey)) {
          await this.alerting.sendAlert({
            type: 'ORACLE_FAILURE',
            severity: 'warning',
            message: `No observation for region ${regionId} on ${new Date(yesterdayMidnight * 1000).toISOString().split('T')[0]}`,
            data: { regionId, expectedDay: yesterdayMidnight },
          });
          this.alertedPools.add(alertKey);
        }
      }
    }
  }

  logEvent(event: string, data: Record<string, any>) {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({ timestamp, event, ...data }));
  }
}

// CLI entrypoint
if (require.main === module) {
  const monitor = new NimbusMonitoring({
    rpcUrl: process.env.RPC_URL || 'https://api.devnet.solana.com',
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    pagerDutyKey: process.env.PAGERDUTY_ROUTING_KEY,
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000'),
    poolIds: [1, 2, 3],
  });

  process.on('SIGINT', () => monitor.stop());
  process.on('SIGTERM', () => monitor.stop());

  monitor.start().catch(console.error);
}
