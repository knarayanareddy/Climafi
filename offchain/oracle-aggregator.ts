/**
 * Production Oracle Aggregator
 * Fetches real weather data and posts daily observations to Solana
 * M-04 fix: validates coordinates against region registry
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import fetch from 'node-fetch';
import * as fs from 'fs';
import { loadProgramIdl } from './load-idl';

const PROGRAM_ID = new PublicKey("CLiMaFi1111111111111111111111111111111111111");

interface WeatherResponse {
  daily: {
    time: string[];
    precipitation_sum: number[];
  };
}

/**
 * M-04 fix: Region registry for coordinate validation.
 * Maps region_id to expected lat/lon bounds.
 * In production, this would be loaded from a database or config file.
 */
interface RegionBounds {
  name: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  centerLat: number;
  centerLon: number;
}

// Region ids MUST match lib/regions.ts so the u64 ids agree with the frontend.
const REGION_REGISTRY: Map<number, RegionBounds> = new Map([
  [1, { name: 'Nairobi', latMin: -1.5, latMax: -1.0, lonMin: 36.5, lonMax: 37.0, centerLat: -1.2921, centerLon: 36.8219 }],
  [2, { name: 'Mumbai', latMin: 18.8, latMax: 19.3, lonMin: 72.7, lonMax: 73.0, centerLat: 19.076, centerLon: 72.8777 }],
  [3, { name: 'Manila', latMin: 14.4, latMax: 14.7, lonMin: 120.9, lonMax: 121.1, centerLat: 14.5995, centerLon: 120.9842 }],
  [4, { name: 'São Paulo', latMin: -24.0, latMax: -23.0, lonMin: -47.0, lonMax: -46.0, centerLat: -23.55, centerLon: -46.63 }],
  [5, { name: 'Addis Ababa', latMin: 8.5, latMax: 9.5, lonMin: 38.2, lonMax: 39.2, centerLat: 9.01, centerLon: 38.75 }],
  [6, { name: 'Dhaka', latMin: 23.3, latMax: 24.3, lonMin: 89.9, lonMax: 90.9, centerLat: 23.81, centerLon: 90.41 }],
]);

export class OracleAggregator {
  private connection: Connection;
  private oracleKeypair: Keypair;
  private program: Program;

  constructor(rpcUrl: string, keypairPath: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    this.oracleKeypair = Keypair.fromSecretKey(new Uint8Array(secret));

    const wallet = new Wallet(this.oracleKeypair);
    const provider = new AnchorProvider(this.connection, wallet, {});
    this.program = new Program(loadProgramIdl(), PROGRAM_ID, provider);
  }

  /**
   * Fetch real rainfall data from Open-Meteo with coordinate validation
   */
  async fetchDailyRainfall(lat: number, lon: number, date: string, regionId?: number): Promise<number> {
    // M-04 fix: validate coordinates
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new Error(`Invalid latitude: ${lat}. Must be between -90 and 90.`);
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error(`Invalid longitude: ${lon}. Must be between -180 and 180.`);
    }

    // If regionId provided, validate coordinates match the region
    if (regionId !== undefined) {
      const region = REGION_REGISTRY.get(regionId);
      if (region) {
        if (lat < region.latMin || lat > region.latMax || lon < region.lonMin || lon > region.lonMax) {
          throw new Error(
            `Coordinates (${lat}, ${lon}) are outside region ${regionId} (${region.name}) bounds. ` +
            `Expected lat: [${region.latMin}, ${region.latMax}], lon: [${region.lonMin}, ${region.lonMax}]`
          );
        }
      }
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&daily=precipitation_sum&start_date=${encodeURIComponent(date)}&end_date=${encodeURIComponent(date)}&timezone=UTC`;
    
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo API returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as WeatherResponse;
    
    if (!data.daily || !data.daily.precipitation_sum || data.daily.precipitation_sum.length === 0) {
      throw new Error(`No precipitation data returned for ${date}`);
    }

    return (data.daily.precipitation_sum[0] || 0) * 100; // mm * 100
  }

  /**
   * Fetch rainfall using region center coordinates
   */
  async fetchDailyRainfallByRegion(regionId: number, date: string): Promise<number> {
    const region = REGION_REGISTRY.get(regionId);
    if (!region) {
      throw new Error(`Unknown region_id: ${regionId}. Register it in REGION_REGISTRY first.`);
    }
    return this.fetchDailyRainfall(region.centerLat, region.centerLon, date, regionId);
  }

  /**
   * Post daily observation to Solana
   */
  async publishDailySnapshot(regionId: number, dayStartUnix: number, valueMmX100: number) {
    // Validate dayStartUnix is midnight-aligned
    if (dayStartUnix % 86400 !== 0) {
      throw new Error(`dayStartUnix must be midnight-aligned (multiple of 86400). Got: ${dayStartUnix}`);
    }

    const tx = await this.program.methods
      .recordObservation(
        new BN(regionId),
        { rainfall: {} },
        new BN(dayStartUnix),
        new BN(valueMmX100),
        1 // sources_bitmap
      )
      .accounts({
        config: this.getConfigPDA(),
        observation: this.getObservationPDA(regionId, dayStartUnix),
        oracle: this.oracleKeypair.publicKey,
        systemProgram: PublicKey.default,
      })
      .signers([this.oracleKeypair])
      .rpc();

    console.log(`Published observation for region ${regionId}: ${tx}`);
    return tx;
  }

  private getConfigPDA() {
    return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
  }

  private getObservationPDA(regionId: number, dayStart: number) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("obs"),
        new BN(regionId).toArrayLike(Buffer, "le", 8),
        Buffer.from([0]), // Rainfall
        new BN(dayStart).toArrayLike(Buffer, "le", 8),
      ],
      PROGRAM_ID
    )[0];
  }
}

// Example usage:
// const aggregator = new OracleAggregator(rpcUrl, keypairPath);
// const rainfall = await aggregator.fetchDailyRainfallByRegion(1, "2026-06-21");
// await aggregator.publishDailySnapshot(1, 1750464000, rainfall);

// ==================== CLI ====================
// Posts one daily observation for a region to the Nimbus program.
//
//   npm run oracle                              # today's rainfall for region 1
//   REGION_ID=2 DATE=2026-09-03 npm run oracle  # specific region + date
//
// Env:
//   RPC_URL              (default https://api.devnet.solana.com)
//   ORACLE_KEYPAIR_PATH  (default ./keys/oracle.json — must be the configured oracle_authority)
//   REGION_ID            (default 1)
//   DATE                 YYYY-MM-DD (default: today UTC)
if (require.main === module) {
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const keypairPath = process.env.ORACLE_KEYPAIR_PATH || './keys/oracle.json';
  const regionId = parseInt(process.env.REGION_ID || '1', 10);
  const date = process.env.DATE || new Date().toISOString().slice(0, 10);

  (async () => {
    if (!fs.existsSync(keypairPath)) {
      throw new Error(`Oracle keypair not found at ${keypairPath}. Run the deploy script first (npm run deploy).`);
    }
    const aggregator = new OracleAggregator(rpcUrl, keypairPath);
    const dayStartUnix = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
    const rainfall = await aggregator.fetchDailyRainfallByRegion(regionId, date);
    await aggregator.publishDailySnapshot(regionId, dayStartUnix, rainfall);
    console.log(`[Oracle] region ${regionId} on ${date}: ${rainfall / 100} mm (${rainfall} mm*100)`);
  })().catch((err) => {
    console.error('[Oracle] publish failed:', err);
    process.exit(1);
  });
}
