import { NextResponse } from 'next/server'
import { Connection, PublicKey } from '@solana/web3.js'
import { PROGRAM_ID } from '../../../../lib/nimbus'
import { deserializePolicy } from '../../../../lib/deserialize'

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const POLICY_ACCOUNT_SIZE = 197 // Policy::LEN (includes 8-byte discriminator)

export async function GET(
  _request: Request,
  { params }: { params: { wallet: string } }
) {
  let owner: PublicKey
  try {
    owner = new PublicKey(params.wallet)
  } catch {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed')
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [{ dataSize: POLICY_ACCOUNT_SIZE }],
    })

    const policies: Record<string, unknown>[] = []
    for (const { pubkey, account } of accounts) {
      try {
        const p = deserializePolicy(account.data, account.owner)
        if (p.owner.equals(owner)) {
          policies.push({
            address: pubkey.toBase58(),
            policyId: p.policyId,
            regionId: p.regionId,
            status: p.status,
            triggered: p.triggered,
            threshold: p.threshold.toString(),
            payoutAmount: p.payoutAmount.toString(),
            premiumAmount: p.premiumAmount.toString(),
            windowStartUnix: p.windowStartUnix,
            windowEndUnix: p.windowEndUnix,
          })
        }
      } catch {
        // skip non-Policy accounts
      }
    }

    return NextResponse.json(policies)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
