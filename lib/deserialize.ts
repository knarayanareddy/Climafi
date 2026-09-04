import { PublicKey } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import { PROGRAM_ID } from './nimbus'

// Anchor discriminators: sha256("account:<Name>")[0..8]
export const DISCRIMINATORS = {
  GlobalConfig:        [149, 8, 156, 202, 160, 252, 176, 217],
  MultisigConfig:      [44, 62, 172, 225, 246, 3, 178, 33],
  MultisigProposal:    [13, 15, 144, 55, 252, 164, 83, 208],
  Pool:                [241, 154, 109, 4, 17, 177, 109, 188],
  Policy:              [222, 135, 7, 163, 235, 177, 33, 68],
  ObservationSnapshot: [245, 199, 79, 96, 93, 79, 118, 182],
} as const

type AccountName = keyof typeof DISCRIMINATORS

class DeserializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeserializationError'
  }
}

/**
 * Validate account header: owner, discriminator, and minimum data length.
 * Throws DeserializationError if any check fails.
 */
function validateAccountHeader(
  data: Buffer | Uint8Array,
  owner: PublicKey,
  accountName: AccountName,
  minLength: number,
): void {
  if (!owner.equals(PROGRAM_ID)) {
    throw new DeserializationError(
      `Account owner mismatch: expected ${PROGRAM_ID.toBase58()}, got ${owner.toBase58()}`
    )
  }
  if (data.length < minLength) {
    throw new DeserializationError(
      `${accountName} data too short: expected >= ${minLength} bytes, got ${data.length}`
    )
  }
  const expected = DISCRIMINATORS[accountName]
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) {
      throw new DeserializationError(
        `${accountName} discriminator mismatch at byte ${i}: expected ${expected[i]}, got ${data[i]}`
      )
    }
  }
}

function readPublicKey(data: Buffer | Uint8Array, offset: number): PublicKey {
  return new PublicKey(data.slice(offset, offset + 32))
}

function readU8(data: Buffer | Uint8Array, offset: number): number {
  return data[offset]
}

function readU16LE(data: Buffer | Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8)
}

function readU32LE(data: Buffer | Uint8Array, offset: number): number {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    ((data[offset + 3] << 24) >>> 0)
  ) >>> 0
}

function readI64LE(data: Buffer | Uint8Array, offset: number): number {
  return new BN(data.slice(offset, offset + 8), 'le').toNumber()
}

function readU64LE(data: Buffer | Uint8Array, offset: number): number {
  return new BN(data.slice(offset, offset + 8), 'le').toNumber()
}

function readBigU64LE(data: Buffer | Uint8Array, offset: number): bigint {
  const buf = Buffer.from(data.slice(offset, offset + 8))
  return buf.readBigUInt64LE(0)
}

function readBool(data: Buffer | Uint8Array, offset: number): boolean {
  return data[offset] !== 0
}

// ── GlobalConfig ──

const GLOBAL_CONFIG_MIN_LEN = 8 + 32 + 1 + 32 + 2 + 32 + 4 + 32 + 32 + 4 + 4 + 2 + 8 // 193

export interface GlobalConfigData {
  admin: PublicKey
  paused: boolean
  usdcMint: PublicKey
  protocolFeeBps: number
  treasuryUsdcAta: PublicKey
  maxOracleStaleness: number
  quoteSigner: PublicKey
  oracleAuthority: PublicKey
  minPolicyDuration: number
  maxPolicyDuration: number
  version: number
  lastUsedNonce: bigint
}

export function deserializeGlobalConfig(
  data: Buffer | Uint8Array,
  owner: PublicKey,
): GlobalConfigData {
  validateAccountHeader(data, owner, 'GlobalConfig', GLOBAL_CONFIG_MIN_LEN)

  let offset = 8
  const admin = readPublicKey(data, offset); offset += 32
  const paused = readBool(data, offset); offset += 1
  const usdcMint = readPublicKey(data, offset); offset += 32
  const protocolFeeBps = readU16LE(data, offset); offset += 2
  const treasuryUsdcAta = readPublicKey(data, offset); offset += 32
  const maxOracleStaleness = readU32LE(data, offset); offset += 4
  const quoteSigner = readPublicKey(data, offset); offset += 32
  const oracleAuthority = readPublicKey(data, offset); offset += 32
  const minPolicyDuration = readU32LE(data, offset); offset += 4
  const maxPolicyDuration = readU32LE(data, offset); offset += 4
  const version = readU16LE(data, offset); offset += 2
  const lastUsedNonce = readBigU64LE(data, offset)

  return {
    admin, paused, usdcMint, protocolFeeBps, treasuryUsdcAta,
    maxOracleStaleness, quoteSigner, oracleAuthority,
    minPolicyDuration, maxPolicyDuration, version, lastUsedNonce,
  }
}

// ── MultisigConfig ──

const MAX_AUTHORITIES = 7
const MULTISIG_CONFIG_MIN_LEN = 8 + 1 + 1 + (32 * MAX_AUTHORITIES) + 8 + 1 // 243

export interface MultisigConfigData {
  threshold: number
  numAuthorities: number
  authorities: PublicKey[]
  proposalNonce: number
  bump: number
}

export function deserializeMultisigConfig(
  data: Buffer | Uint8Array,
  owner: PublicKey,
): MultisigConfigData {
  validateAccountHeader(data, owner, 'MultisigConfig', MULTISIG_CONFIG_MIN_LEN)

  let offset = 8
  const threshold = readU8(data, offset); offset += 1
  const numAuthorities = readU8(data, offset); offset += 1

  if (numAuthorities > MAX_AUTHORITIES) {
    throw new DeserializationError(
      `MultisigConfig numAuthorities (${numAuthorities}) exceeds MAX_AUTHORITIES (${MAX_AUTHORITIES})`
    )
  }

  const authorities: PublicKey[] = []
  for (let i = 0; i < MAX_AUTHORITIES; i++) {
    const key = readPublicKey(data, offset)
    offset += 32
    if (i < numAuthorities) {
      authorities.push(key)
    }
  }

  const proposalNonce = readU64LE(data, offset); offset += 8
  const bump = readU8(data, offset)

  return { threshold, numAuthorities, authorities, proposalNonce, bump }
}

/**
 * Validate multisig invariants client-side.
 * Returns a list of warning strings (empty if clean).
 */
export function validateMultisigInvariants(config: MultisigConfigData): string[] {
  const warnings: string[] = []

  if (config.threshold < 1) {
    warnings.push('Threshold is 0 — no approvals required to execute proposals')
  }
  if (config.threshold > config.numAuthorities) {
    warnings.push(`Threshold (${config.threshold}) exceeds authority count (${config.numAuthorities}) — proposals can never reach quorum`)
  }

  // Duplicate authority detection
  const seen = new Set<string>()
  for (const auth of config.authorities) {
    const b58 = auth.toBase58()
    if (seen.has(b58)) {
      warnings.push(`Duplicate authority detected: ${b58}`)
    }
    seen.add(b58)
  }

  return warnings
}

// ── Pool ──

// disc(8) + pool_id(8) + peril(1) + region_set_hash(32) + max_tenor_secs(4) + ltv_limit_bps(2) + capital(8) + locked(8) + lp_mint(32) + vault_usdc_ata(32) + created_at_unix(8)
export const POOL_MIN_LEN = 8 + 8 + 1 + 32 + 4 + 2 + 8 + 8 + 32 + 32 + 8 // 143

export interface PoolData {
  poolId: number
  peril: number
  regionSetHash: Uint8Array
  maxTenorSecs: number
  ltvLimitBps: number
  capital: number
  locked: number
  lpMint: PublicKey
  vaultUsdcAta: PublicKey
  createdAtUnix: number
}

export function deserializePool(
  data: Buffer | Uint8Array,
  owner: PublicKey,
): PoolData {
  validateAccountHeader(data, owner, 'Pool', POOL_MIN_LEN)

  let offset = 8
  const poolId = readU64LE(data, offset); offset += 8
  const peril = readU8(data, offset); offset += 1
  const regionSetHash = data.slice(offset, offset + 32); offset += 32
  const maxTenorSecs = readU32LE(data, offset); offset += 4
  const ltvLimitBps = readU16LE(data, offset); offset += 2
  const capital = readU64LE(data, offset); offset += 8
  const locked = readU64LE(data, offset); offset += 8
  const lpMint = readPublicKey(data, offset); offset += 32
  const vaultUsdcAta = readPublicKey(data, offset); offset += 32
  const createdAtUnix = readI64LE(data, offset)

  return {
    poolId, peril, regionSetHash: new Uint8Array(regionSetHash),
    maxTenorSecs, ltvLimitBps, capital, locked, lpMint, vaultUsdcAta, createdAtUnix,
  }
}

/**
 * Validate pool invariants client-side.
 * Returns a list of warning strings (empty if clean).
 */
export function validatePoolInvariants(pool: PoolData): string[] {
  const warnings: string[] = []

  if (pool.locked > pool.capital) {
    warnings.push(`Locked capital (${pool.locked}) exceeds total capital (${pool.capital}) — pool may be insolvent`)
  }

  if (pool.capital > 0) {
    const utilization = (pool.locked / pool.capital) * 100
    if (utilization >= 90) {
      warnings.push(`Pool utilization at ${utilization.toFixed(1)}% — approaching capacity`)
    }
  }

  if (pool.ltvLimitBps === 0) {
    warnings.push('LTV limit is 0 — no policies can be written against this pool')
  }

  if (pool.ltvLimitBps > 10000) {
    warnings.push(`LTV limit (${pool.ltvLimitBps} bps) exceeds 100% — pool is over-leverageable`)
  }

  return warnings
}

/**
 * Validate policy invariants client-side.
 * Returns a list of warning strings (empty if clean).
 */
export function validatePolicyInvariants(policy: PolicyData): string[] {
  const warnings: string[] = []

  if (policy.windowEndUnix <= policy.windowStartUnix) {
    warnings.push('Policy window end is before or equal to start — invalid time range')
  }

  if (policy.payoutAmount === 0) {
    warnings.push('Payout amount is 0 — policy has no value')
  }

  if (policy.premiumAmount > policy.payoutAmount) {
    warnings.push(`Premium (${policy.premiumAmount}) exceeds payout (${policy.payoutAmount}) — unfavorable for policyholder`)
  }

  if (policy.peril > 2) {
    warnings.push(`Unknown peril type: ${policy.peril}`)
  }

  if (policy.status > 3) {
    warnings.push(`Unknown policy status: ${policy.status}`)
  }

  return warnings
}

// ── Policy ──

// disc(8) + policy_id(8) + owner(32) + pool_id(8) + pool(32) + region_id(8) + peril(1)
// + window_start_unix(8) + window_end_unix(8) + index_method(1) + direction(1) + threshold(8)
// + payout_amount(8) + premium_amount(8) + status(1) + observed_value(8) + triggered(1)
// + settled_at_unix(8) + quote_hash(32) + created_at_unix(8)
export const POLICY_MIN_LEN = 8 + 8 + 32 + 8 + 32 + 8 + 1 + 8 + 8 + 1 + 1 + 8 + 8 + 8 + 1 + 8 + 1 + 8 + 32 + 8 // 197

export interface PolicyData {
  policyId: number
  owner: PublicKey
  poolId: number
  pool: PublicKey
  regionId: number
  peril: number
  windowStartUnix: number
  windowEndUnix: number
  indexMethod: number
  direction: number
  threshold: number
  payoutAmount: number
  premiumAmount: number
  status: number
  observedValue: number
  triggered: boolean
  settledAtUnix: number
  quoteHash: Uint8Array
  createdAtUnix: number
}

export function deserializePolicy(
  data: Buffer | Uint8Array,
  owner: PublicKey,
): PolicyData {
  validateAccountHeader(data, owner, 'Policy', POLICY_MIN_LEN)

  let offset = 8
  const policyId = readU64LE(data, offset); offset += 8
  const policyOwner = readPublicKey(data, offset); offset += 32
  const poolId = readU64LE(data, offset); offset += 8
  const pool = readPublicKey(data, offset); offset += 32
  const regionId = readU64LE(data, offset); offset += 8
  const peril = readU8(data, offset); offset += 1
  const windowStartUnix = readI64LE(data, offset); offset += 8
  const windowEndUnix = readI64LE(data, offset); offset += 8
  const indexMethod = readU8(data, offset); offset += 1
  const direction = readU8(data, offset); offset += 1
  const threshold = readI64LE(data, offset); offset += 8
  const payoutAmount = readU64LE(data, offset); offset += 8
  const premiumAmount = readU64LE(data, offset); offset += 8
  const status = readU8(data, offset); offset += 1
  const observedValue = readI64LE(data, offset); offset += 8
  const triggered = readBool(data, offset); offset += 1
  const settledAtUnix = readI64LE(data, offset); offset += 8
  const quoteHash = data.slice(offset, offset + 32); offset += 32
  const createdAtUnix = readI64LE(data, offset)

  return {
    policyId, owner: policyOwner, poolId, pool, regionId, peril,
    windowStartUnix, windowEndUnix, indexMethod, direction, threshold,
    payoutAmount, premiumAmount, status, observedValue, triggered,
    settledAtUnix, quoteHash: new Uint8Array(quoteHash), createdAtUnix,
  }
}

export { DeserializationError }
