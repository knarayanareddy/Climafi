// Borsh-compatible serialization of the on-chain `Quote` struct.
//
// Field order and types MUST match `programs/nimbus/src/state.rs` (`Quote`) and
// what Anchor's `Quote::try_to_vec()` produces: little-endian integers, single-byte
// enum discriminants, no length prefixes.
//
// This module is shared by the quote-signing API (server) and the client, so the
// message the server signs is guaranteed to be the same bytes the on-chain program
// re-serializes during Ed25519 verification.

import { Buffer } from 'buffer'

export type Peril = 0 | 1 | 2
export type IndexMethod = 0 | 1 | 2
export type Direction = 0 | 1

export interface QuoteFields {
  policyId: bigint
  poolId: bigint
  regionId: bigint
  peril: Peril
  windowStartUnix: bigint
  windowEndUnix: bigint
  indexMethod: IndexMethod
  direction: Direction
  threshold: bigint
  payoutAmount: bigint
  premiumAmount: bigint
  quoteExpiryUnix: bigint
  nonce: bigint
}

function u64(value: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(value)
  return buf
}

function i64(value: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigInt64LE(value)
  return buf
}

export function serializeQuote(quote: QuoteFields): Buffer {
  return Buffer.concat([
    u64(quote.policyId),
    u64(quote.poolId),
    u64(quote.regionId),
    Buffer.from([quote.peril]),
    i64(quote.windowStartUnix),
    i64(quote.windowEndUnix),
    Buffer.from([quote.indexMethod]),
    Buffer.from([quote.direction]),
    i64(quote.threshold),
    u64(quote.payoutAmount),
    u64(quote.premiumAmount),
    i64(quote.quoteExpiryUnix),
    u64(quote.nonce),
  ])
}

export function toBigInt(value: string | number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value)
}
