import { NextResponse } from 'next/server'

/**
 * Compute a premium for a policy request.
 *
 * Accepts BOTH:
 *   - GET  /api/quotes/calculate?payout=500&region=KEN-NRB-001&direction=LT&days=14&threshold=80
 *     (what the /buy flow currently sends)
 *   - POST { payoutAmount: 500 }
 *
 * Returns `premium` (USDC dollars, for display) and `premiumAmount` (same value,
 * kept for backward compatibility with callers expecting the old field name).
 *
 * NOTE (units): payouts/premiums here are expressed in whole USDC dollars.
 * On-chain amounts are u64 base units (6 decimals) — multiply by 1_000_000
 * before signing/buying. See /api/quotes/sign.
 */

const MAX_PAYOUT = 1_000_000_000_000

function computePremium(payout: number) {
  // MVP pricing formula from the design doc (flat; see risk.rs for the on-chain
  // dynamic-LTV / utilization-surcharge model this should eventually mirror).
  const purePremium = Math.floor(payout * 0.035)
  const surcharge = Math.floor(payout * 0.01)
  const fee = Math.floor((purePremium + surcharge) * 0.05)
  const total = purePremium + surcharge + fee

  return {
    premium: total,
    premiumAmount: total,
    breakdown: {
      purePremium,
      utilizationSurcharge: surcharge,
      protocolFee: fee,
    },
    quoteValiditySecs: 120,
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const payout = Number(searchParams.get('payout'))
  if (!Number.isFinite(payout) || payout <= 0 || payout > MAX_PAYOUT) {
    return NextResponse.json({ error: 'payout must be a positive number' }, { status: 400 })
  }

  // region / direction / days / threshold are accepted (and echoed) but do not
  // affect the MVP flat pricing formula yet.
  return NextResponse.json({
    region: searchParams.get('region') ?? undefined,
    direction: searchParams.get('direction') ?? undefined,
    days: searchParams.get('days') ?? undefined,
    threshold: searchParams.get('threshold') ?? undefined,
    ...computePremium(payout),
  })
}

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // M-05 fix: validate inputs
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const payout = Number(body.payoutAmount ?? body.payout)
  if (!Number.isFinite(payout) || payout <= 0 || payout > MAX_PAYOUT) {
    return NextResponse.json({ error: 'payoutAmount must be a positive number' }, { status: 400 })
  }

  return NextResponse.json(computePremium(payout))
}
