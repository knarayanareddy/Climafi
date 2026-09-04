import { NextResponse } from 'next/server'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { PersistentRateLimiter } from '../../../../offchain/rate-limiter'
import { serializeQuote } from '../../../../lib/quote'

// Lazy initialization to avoid failing at build time
let _quoteSigner: nacl.SignKeyPair | null = null
function getQuoteSigner(): nacl.SignKeyPair {
  if (!_quoteSigner) {
    const secret = process.env.QUOTE_SIGNER_SECRET_KEY
    if (!secret) {
      throw new Error('QUOTE_SIGNER_SECRET_KEY environment variable is required')
    }
    _quoteSigner = nacl.sign.keyPair.fromSecretKey(bs58.decode(secret))
  }
  return _quoteSigner
}

let _rateLimiter: PersistentRateLimiter | null = null
function getRateLimiter(): PersistentRateLimiter {
  if (!_rateLimiter) {
    _rateLimiter = new PersistentRateLimiter(
      process.env.REDIS_URL || 'redis://localhost:6379'
    )
  }
  return _rateLimiter
}

const DAY_SECS = 86400
const MAX_WINDOW_DAYS = 31

/**
 * M-05 fix: Validate and sanitize request body
 */
function validateQuoteRequest(body: any): { valid: boolean; error?: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' }
  }

  const requiredNumeric = ['windowStartUnix', 'windowEndUnix', 'payoutAmount', 'premiumAmount', 'thresholdMm']
  for (const field of requiredNumeric) {
    if (body[field] === undefined || body[field] === null) {
      return { valid: false, error: `Missing required field: ${field}` }
    }
    const num = Number(body[field])
    if (!Number.isFinite(num) || num < 0) {
      return { valid: false, error: `Invalid value for ${field}: must be a non-negative number` }
    }
  }

  const windowStart = Number(body.windowStartUnix)
  const windowEnd = Number(body.windowEndUnix)
  const now = Math.floor(Date.now() / 1000)

  if (windowEnd <= windowStart) {
    return { valid: false, error: 'windowEndUnix must be after windowStartUnix' }
  }

  const durationDays = (windowEnd - windowStart) / DAY_SECS
  if (durationDays < 1 || durationDays > MAX_WINDOW_DAYS) {
    return { valid: false, error: `Policy duration must be between 1 and ${MAX_WINDOW_DAYS} days` }
  }

  // Windows must start in the future, unless the signer explicitly opts into
  // backdated quotes for the live settle demo (QUOTE_SIGNER_ALLOW_PAST=true).
  if (windowStart < now && process.env.QUOTE_SIGNER_ALLOW_PAST !== 'true') {
    return { valid: false, error: 'windowStartUnix must be in the future' }
  }

  if (Number(body.payoutAmount) === 0) {
    return { valid: false, error: 'payoutAmount must be greater than 0' }
  }

  if (Number(body.premiumAmount) === 0) {
    return { valid: false, error: 'premiumAmount must be greater than 0' }
  }

  if (body.direction !== undefined && !['LT', 'GT'].includes(body.direction)) {
    return { valid: false, error: 'direction must be "LT" or "GT"' }
  }

  if (body.indexMethod !== undefined) {
    const m = Number(body.indexMethod)
    if (![0, 1, 2].includes(m)) {
      return { valid: false, error: 'indexMethod must be 0 (Sum), 1 (Mean), or 2 (Max)' }
    }
  }

  return { valid: true }
}

/**
 * L-04 fix: Extract real client IP from trusted proxy headers
 */
function getClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp

  const vercelIp = request.headers.get('x-real-ip')
  if (vercelIp) return vercelIp

  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map(s => s.trim())
    return parts[parts.length - 1] || 'unknown'
  }

  return 'unknown'
}

export async function POST(request: Request) {
  const ip = getClientIp(request)

  const allowed = await getRateLimiter().isAllowed(ip)
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validation = validateQuoteRequest(body)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const now = Math.floor(Date.now() / 1000)
  const nonce = BigInt(Date.now())
  const policyId = body.policyId !== undefined && body.policyId !== null
    ? BigInt(body.policyId)
    : nonce

  const quote = {
    policyId,
    poolId: BigInt(body.poolId ?? 1),
    regionId: BigInt(body.regionId ?? 0),
    peril: (body.peril ?? 0) as 0 | 1 | 2, // 0 = Rainfall
    windowStartUnix: BigInt(Math.floor(Number(body.windowStartUnix))),
    windowEndUnix: BigInt(Math.floor(Number(body.windowEndUnix))),
    indexMethod: (Number(body.indexMethod ?? 0)) as 0 | 1 | 2, // 0 = Sum
    direction: (body.direction === 'GT' ? 1 : 0) as 0 | 1,
    threshold: BigInt(Math.floor(Number(body.thresholdMm) * 100)), // mm -> mm*100 (SCALE_RAIN_MM)
    payoutAmount: BigInt(Math.floor(Number(body.payoutAmount))),
    premiumAmount: BigInt(Math.floor(Number(body.premiumAmount))),
    quoteExpiryUnix: BigInt(now + 120),
    nonce,
  }

  // Borsh-compatible message (must equal on-chain Quote::try_to_vec())
  const message = serializeQuote(quote)
  const signature = nacl.sign.detached(message, getQuoteSigner().secretKey)

  return NextResponse.json({
    quote: {
      policyId: quote.policyId.toString(),
      poolId: quote.poolId.toString(),
      regionId: quote.regionId.toString(),
      peril: quote.peril,
      windowStartUnix: quote.windowStartUnix.toString(),
      windowEndUnix: quote.windowEndUnix.toString(),
      indexMethod: quote.indexMethod,
      direction: quote.direction,
      threshold: quote.threshold.toString(),
      payoutAmount: quote.payoutAmount.toString(),
      premiumAmount: quote.premiumAmount.toString(),
      quoteExpiryUnix: quote.quoteExpiryUnix.toString(),
      nonce: quote.nonce.toString(),
    },
    signature: Buffer.from(signature).toString('base64'),
    quoteSignerPubkey: bs58.encode(getQuoteSigner().publicKey),
    message: message.toString('hex'),
    expiresUnix: Number(quote.quoteExpiryUnix),
  })
}
