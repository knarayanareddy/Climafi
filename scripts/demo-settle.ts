/**
 * Nimbus one-shot end-to-end demo: buy → observe → settle (no waiting).
 *
 * To avoid waiting for a policy window to elapse, this script uses a BACKDATED
 * window (yesterday 00:00 UTC → today 00:00 UTC), posts yesterday's real rainfall
 * observation, buys a policy that is guaranteed to trigger, then settles it —
 * all in a few seconds. The on-chain program enforces its normal rules the whole
 * way (Ed25519 quote verification, nonce, LTV, staleness, ownership).
 *
 * Usage:
 *   npm run demo                        # devnet
 *   SOLANA_RPC_URL=http://localhost:8899 npm run demo
 *
 * Prereqs: `npm run deploy` has run (keys/, mint, config, pool, capital exist)
 * and the program is deployed.
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { Program, AnchorProvider, Wallet, BN, web3 } from '@coral-xyz/anchor'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import fetch from 'node-fetch'
import * as fs from 'fs'
import * as path from 'path'
import { serializeQuote, type QuoteFields } from '../lib/quote'
import {
  PROGRAM_ID,
  getConfigPda,
  getPoolPda,
  getPolicyPda,
  getObservationPda,
  getQuoteNoncePda,
  getGlobalConfig,
  createInitQuoteNonceTransaction,
  createBuyPolicyTransaction,
  createSettlePolicyTransaction,
  type SignedQuote,
} from '../lib/nimbus'
import { deserializePolicy } from '../lib/deserialize'
import { loadProgramIdl } from '../offchain/load-idl'

const DAY = 86400
const KEYS_DIR = path.join(__dirname, '..', 'keys')

function loadKeypair(name: string): Keypair {
  const file = path.join(KEYS_DIR, `${name}.json`)
  if (!fs.existsSync(file)) {
    throw new Error(`${file} not found. Run \`npm run deploy\` first.`)
  }
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(file, 'utf8'))))
}

async function airdropIfNeeded(connection: Connection, kp: Keypair, lamports: number) {
  const balance = await connection.getBalance(kp.publicKey)
  if (balance >= lamports / 2) return
  const sig = await connection.requestAirdrop(kp.publicKey, lamports)
  await connection.confirmTransaction(sig, 'confirmed')
  console.log(`  + airdropped ${lamports / web3.LAMPORTS_PER_SOL} SOL to ${kp.publicKey.toBase58()}`)
}

async function fetchRainfallMmX100(lat: number, lon: number, date: string): Promise<number> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_sum&start_date=${date}&end_date=${date}&timezone=UTC`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
    const data = await res.json() as { daily?: { precipitation_sum?: number[] } }
    const mm = data.daily?.precipitation_sum?.[0] ?? 0
    return Math.round(mm * 100)
  } catch (err) {
    console.warn(`  ! rainfall fetch failed (${(err as Error).message}) — using 0 mm`)
    return 0
  }
}

async function main() {
  const rpcUrl = process.env.RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
  const isLocal = rpcUrl.includes('localhost') || rpcUrl.includes('127.0.0.1')
  const connection = new Connection(rpcUrl, 'confirmed')

  const admin = loadKeypair('admin')
  const oracle = loadKeypair('oracle')
  const quoteSigner = loadKeypair('quote_signer')

  // Sanity: deployed program id must match the client SDK
  const idl = loadProgramIdl()
  if (idl?.metadata?.address && idl.metadata.address !== PROGRAM_ID.toBase58()) {
    throw new Error(
      `IDL program id (${idl.metadata.address}) does not match lib/nimbus PROGRAM_ID (${PROGRAM_ID.toBase58()}). ` +
      `Run the program-id replace step from the README so all layers agree.`
    )
  }

  if (!isLocal && process.env.SKIP_AIRDROP !== '1') {
    await airdropIfNeeded(connection, admin, web3.LAMPORTS_PER_SOL)
    await airdropIfNeeded(connection, oracle, web3.LAMPORTS_PER_SOL)
  }

  const config = await getGlobalConfig(connection)
  console.log(`USDC mint: ${config.usdcMint.toBase58()}`)

  // Backdated 1-day window (yesterday 00:00 → today 00:00 UTC)
  const now = Math.floor(Date.now() / 1000)
  const todayStart = Math.floor(now / DAY) * DAY
  const windowStartUnix = todayStart - DAY
  const windowEndUnix = todayStart
  const dateStr = new Date(windowStartUnix * 1000).toISOString().slice(0, 10)

  // Nairobi (region 1) rainfall for the window day
  const rainMmX100 = await fetchRainfallMmX100(-1.2921, 36.8219, dateStr)
  console.log(`Rainfall ${dateStr}: ${(rainMmX100 / 100).toFixed(1)} mm`)

  // Drought trigger: observed sum <= threshold. Set threshold above the observed
  // value so the policy is guaranteed to trigger (demo).
  const threshold = rainMmX100 + 1000 // +10.00 mm
  const payoutAmount = 100_000_000n // 100 USDC
  const premiumAmount = 5_000_000n // 5 USDC
  const policyId = BigInt(Date.now())
  const nonce = BigInt(Date.now())

  const q: QuoteFields = {
    policyId,
    poolId: 1n,
    regionId: 1n,
    peril: 0, // Rainfall
    windowStartUnix: BigInt(windowStartUnix),
    windowEndUnix: BigInt(windowEndUnix),
    indexMethod: 0, // Sum
    direction: 0, // LessThan (drought)
    threshold: BigInt(threshold),
    payoutAmount,
    premiumAmount,
    quoteExpiryUnix: BigInt(now + 300),
    nonce,
  }

  const message = serializeQuote(q)
  const signature = nacl.sign.detached(message, quoteSigner.secretKey)
  const signedQuote: SignedQuote = {
    quote: {
      policyId: q.policyId.toString(),
      poolId: q.poolId.toString(),
      regionId: q.regionId.toString(),
      peril: q.peril,
      windowStartUnix: q.windowStartUnix.toString(),
      windowEndUnix: q.windowEndUnix.toString(),
      indexMethod: q.indexMethod,
      direction: q.direction,
      threshold: q.threshold.toString(),
      payoutAmount: q.payoutAmount.toString(),
      premiumAmount: q.premiumAmount.toString(),
      quoteExpiryUnix: q.quoteExpiryUnix.toString(),
      nonce: q.nonce.toString(),
    },
    signature: Buffer.from(signature).toString('base64'),
    quoteSignerPubkey: bs58.encode(quoteSigner.publicKey.toBytes()),
    message: message.toString('hex'),
    expiresUnix: Number(q.quoteExpiryUnix),
  }

  // 1. BUY (nonce account first, in its own tx — buy_policy's reentrancy guard
  //    rejects any transaction with more than one Nimbus invocation)
  const noncePda = getQuoteNoncePda(admin.publicKey)
  if (!(await connection.getAccountInfo(noncePda))) {
    const initTx = await createInitQuoteNonceTransaction(connection, { publicKey: admin.publicKey })
    initTx.partialSign(admin)
    const initSig = await connection.sendRawTransaction(initTx.serialize())
    await connection.confirmTransaction(initSig, 'confirmed')
    console.log(`   nonce tx: https://explorer.solana.com/tx/${initSig}?cluster=${isLocal ? 'custom' : 'devnet'}`)
  }

  console.log('\n1. Buying policy…')
  const buyTx = await createBuyPolicyTransaction(
    connection,
    { publicKey: admin.publicKey },
    signedQuote,
    { usdcMint: config.usdcMint, treasuryUsdcAta: config.treasuryUsdcAta },
  )
  buyTx.partialSign(admin)
  const buySig = await connection.sendRawTransaction(buyTx.serialize())
  await connection.confirmTransaction(buySig, 'confirmed')
  console.log(`   buy tx: https://explorer.solana.com/tx/${buySig}?cluster=${isLocal ? 'custom' : 'devnet'}`)

  // 2. OBSERVE (post yesterday's rainfall)
  console.log('2. Posting observation…')
  const program = new Program(idl, PROGRAM_ID, new AnchorProvider(connection, new Wallet(admin), { commitment: 'confirmed' }))
  const obsSig = await program.methods
    .recordObservation(new BN(1), { rainfall: {} }, new BN(windowStartUnix), new BN(rainMmX100), 1)
    .accounts({
      config: getConfigPda(),
      observation: getObservationPda(1, 0, windowStartUnix),
      oracle: oracle.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([oracle])
    .rpc()
  console.log(`   obs tx: https://explorer.solana.com/tx/${obsSig}?cluster=${isLocal ? 'custom' : 'devnet'}`)

  // 3. SETTLE
  console.log('3. Settling policy…')
  const settleTx = await createSettlePolicyTransaction(
    connection,
    { publicKey: admin.publicKey },
    getPolicyPda(new BN(policyId.toString())),
    {
      pool: getPoolPda(1),
      poolId: 1,
      regionId: 1,
      peril: 0,
      windowStartUnix,
      windowEndUnix,
    },
    { usdcMint: config.usdcMint },
  )
  settleTx.partialSign(admin)
  const settleSig = await connection.sendRawTransaction(settleTx.serialize())
  await connection.confirmTransaction(settleSig, 'confirmed')
  console.log(`   settle tx: https://explorer.solana.com/tx/${settleSig}?cluster=${isLocal ? 'custom' : 'devnet'}`)

  // 4. Result
  const policyAccount = await connection.getAccountInfo(getPolicyPda(new BN(policyId.toString())))
  if (!policyAccount) throw new Error('Policy account missing after settle')
  const policy = deserializePolicy(policyAccount.data, policyAccount.owner)
  console.log('\n────────────────────────────────────────────')
  console.log(`Policy #${policy.policyId}`)
  console.log(`  status:      ${['Active', 'Cancelled', 'SettledPaid', 'SettledExpired'][policy.status]}`)
  console.log(`  triggered:   ${policy.triggered}`)
  console.log(`  observed:    ${(policy.observedValue / 100).toFixed(1)} mm`)
  console.log(`  threshold:   ${(policy.threshold / 100).toFixed(1)} mm (<=)`)
  console.log(`  payout:      ${policy.triggered ? policy.payoutAmount / 1_000_000 + ' USDC paid' : '0 USDC'}`)
  console.log('────────────────────────────────────────────\n')
}

main().catch((err) => {
  console.error('\nDemo failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
