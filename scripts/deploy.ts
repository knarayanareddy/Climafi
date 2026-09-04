/**
 * Nimbus devnet/localnet bootstrap.
 *
 * Does everything needed to go from "program deployed" to "app can buy coverage":
 *   1. Ensures local keypairs exist (admin, oracle, quote_signer, treasury, usdc_mint)
 *   2. Funds the admin on devnet (airdrop) unless skipped
 *   3. Creates the devnet USDC mint (6 decimals) and mints supply to the admin
 *   4. initialize_config  (quote signer + oracle authority + fee/staleness params)
 *   5. create_pool 1 (Rainfall)
 *   6. deposit_liquidity to seed the pool with capital (buy_policy needs capital)
 *   7. (optional) funds a buyer wallet with SOL + USDC
 *
 * Usage:
 *   npm run deploy            # devnet
 *   SOLANA_RPC_URL=http://localhost:8899 npm run deploy   # local validator
 *   npm run deploy:dryrun     # print the plan + addresses without network
 *   FUND_WALLET=<base58> npm run deploy                   # also fund a buyer wallet
 *   SKIP_AIRDROP=1 npm run deploy                          # admin already funded
 *
 * Prereqs: `anchor build` (generates target/idl/nimbus.json) and the program must be
 * deployed (`anchor deploy` or `anchor localnet`).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor'
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  mintTo,
  transfer,
} from '@solana/spl-token'
import * as fs from 'fs'
import * as path from 'path'
import bs58 from 'bs58'

// ── Tunables ─────────────────────────────────────────────────────────────────
const DEFAULT_PROGRAM_ID = 'CLiMaFi1111111111111111111111111111111111111'
const POOL_ID = 1
const PROTOCOL_FEE_BPS = 100 // 1%
const MAX_ORACLE_STALENESS_SECS = 86400 // 1 day
const MIN_POLICY_DURATION_SECS = 86400 // 1 day
const MAX_POLICY_DURATION_SECS = 31 * 86400 // 31 days
const MAX_TENOR_SECS = 31 * 86400
const LTV_LIMIT_BPS = 8000 // 80%
const SEED_CAPITAL_USDC = 10_000n // deposit this much USDC into pool 1
const MINT_SUPPLY_USDC = 1_000_000n // mint this much USDC to the admin
const BUYER_FUND_USDC = 100n // USDC sent to FUND_WALLET
const BUYER_FUND_SOL = 1 // SOL airdropped to FUND_WALLET on devnet

const KEYS_DIR = path.join(__dirname, '..', 'keys')
const IDL_PATH = path.join(__dirname, '..', 'target', 'idl', 'nimbus.json')
const DRY_RUN = process.argv.includes('--dry-run')
const IS_LOCAL = (process.env.SOLANA_RPC_URL || '').includes('localhost') ||
  (process.env.SOLANA_RPC_URL || '').includes('127.0.0.1')

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadOrCreateKeypair(name: string): Keypair {
  const file = path.join(KEYS_DIR, `${name}.json`)
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(file, 'utf8'))))
  }
  const kp = Keypair.generate()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)))
  console.log(`  + generated keypair ${file} → ${kp.publicKey.toBase58()}`)
  return kp
}

function getProgramId(): PublicKey {
  if (fs.existsSync(IDL_PATH)) {
    const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'))
    if (idl?.metadata?.address) return new PublicKey(idl.metadata.address)
  }
  if (!DRY_RUN) {
    console.warn(`  ! ${IDL_PATH} not found — run \`anchor build\` first. Using default program id.`)
  }
  return new PublicKey(DEFAULT_PROGRAM_ID)
}

function findPda(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, getProgramId())[0]
}
const configPda = () => findPda([Buffer.from('config')])
const poolPda = (id: number) => findPda([Buffer.from('pool'), new BN(id).toArrayLike(Buffer, 'le', 8)])
const vaultAuthPda = (id: number) => findPda([Buffer.from('vault_auth'), new BN(id).toArrayLike(Buffer, 'le', 8)])
const lpMintPda = (id: number) => findPda([Buffer.from('lp_mint'), new BN(id).toArrayLike(Buffer, 'le', 8)])

async function airdrop(connection: Connection, pubkey: PublicKey, lamports: number) {
  const balance = await connection.getBalance(pubkey)
  if (balance >= lamports / 2) return
  for (let i = 0; i < 5; i++) {
    try {
      const sig = await connection.requestAirdrop(pubkey, lamports)
      await connection.confirmTransaction(sig, 'confirmed')
      console.log(`  + airdropped ${lamports / LAMPORTS_PER_SOL} SOL to ${pubkey.toBase58()}`)
      return
    } catch (err) {
      console.warn(`  ! airdrop attempt ${i + 1} failed (${(err as Error).message}), retrying…`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  throw new Error(`Could not airdrop to ${pubkey.toBase58()}. Fund manually or set SKIP_AIRDROP=1.`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
  const programId = getProgramId()

  const admin = loadOrCreateKeypair('admin')
  const oracle = loadOrCreateKeypair('oracle')
  const quoteSigner = loadOrCreateKeypair('quote_signer')
  const treasury = loadOrCreateKeypair('treasury')
  const usdcMintKp = loadOrCreateKeypair('usdc_mint')

  console.log(`\nNimbus bootstrap — program ${programId.toBase58()}\ncluster  ${rpcUrl}\nmode     ${DRY_RUN ? 'DRY-RUN (no network)' : 'live'}\n`)
  console.log('admin        ', admin.publicKey.toBase58())
  console.log('oracle       ', oracle.publicKey.toBase58())
  console.log('quote signer ', quoteSigner.publicKey.toBase58())
  console.log('treasury     ', treasury.publicKey.toBase58())
  console.log('usdc mint    ', usdcMintKp.publicKey.toBase58())
  console.log('config PDA   ', configPda().toBase58())
  console.log('pool PDA     ', poolPda(POOL_ID).toBase58())
  console.log('lp mint PDA  ', lpMintPda(POOL_ID).toBase58())
  console.log('vault auth   ', vaultAuthPda(POOL_ID).toBase58())
  console.log('pool vault   ', (await getAssociatedTokenAddress(usdcMintKp.publicKey, vaultAuthPda(POOL_ID), true)).toBase58())
  console.log('')

  if (DRY_RUN) {
    console.log('Dry run complete. Run `npm run deploy` to execute against the cluster above.\n')
    return
  }

  const connection = new Connection(rpcUrl, 'confirmed')
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: 'confirmed' })
  if (!fs.existsSync(IDL_PATH)) {
    throw new Error(`${IDL_PATH} not found. Run \`anchor build\` first (deploy needs the generated IDL).`)
  }
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'))
  const program = new Program(idl, programId, provider)

  const skipAirdrop = process.env.SKIP_AIRDROP === '1'
  if (IS_LOCAL || skipAirdrop) {
    console.log(skipAirdrop ? 'SKIP_AIRDROP=1 — skipping airdrop.' : 'Local cluster — skipping airdrop.')
  } else {
    await airdrop(connection, admin.publicKey, 2 * LAMPORTS_PER_SOL)
    await airdrop(connection, oracle.publicKey, 1 * LAMPORTS_PER_SOL)
  }

  // 1. USDC mint
  const mint = usdcMintKp.publicKey
  const mintExists = await connection.getAccountInfo(mint)
  if (!mintExists) {
    await createMint(connection, admin, admin.publicKey, null, 6, usdcMintKp)
    console.log('1. USDC mint created')
  } else {
    console.log('1. USDC mint already exists — skipping')
  }

  const adminAta = await getAssociatedTokenAddress(mint, admin.publicKey)
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury.publicKey)
  const adminAtaExists = await connection.getAccountInfo(adminAta)
  const treasuryAtaExists = await connection.getAccountInfo(treasuryAta)
  if (!adminAtaExists) await createAssociatedTokenAccount(connection, admin, mint, admin.publicKey)
  if (!treasuryAtaExists) await createAssociatedTokenAccount(connection, admin, mint, treasury.publicKey)
  await mintTo(connection, admin, mint, adminAta, admin, MINT_SUPPLY_USDC * 1_000_000n)
  console.log(`2. Minted ${MINT_SUPPLY_USDC.toLocaleString()} USDC to admin`)

  // 2. initialize_config
  const cfgExists = await connection.getAccountInfo(configPda())
  if (!cfgExists) {
    await program.methods
      .initializeConfig(
        PROTOCOL_FEE_BPS,
        MAX_ORACLE_STALENESS_SECS,
        MIN_POLICY_DURATION_SECS,
        MAX_POLICY_DURATION_SECS,
        quoteSigner.publicKey,
        oracle.publicKey,
      )
      .accounts({
        config: configPda(),
        usdcMint: mint,
        treasuryUsdcAta: treasuryAta,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
    console.log('3. GlobalConfig initialized')
  } else {
    console.log('3. GlobalConfig already exists — skipping')
  }

  // 3. create_pool
  const pool = poolPda(POOL_ID)
  const poolExists = await connection.getAccountInfo(pool)
  if (!poolExists) {
    await program.methods
      .createPool(
        new BN(POOL_ID),
        { rainfall: {} },
        Array(32).fill(0), // region_set_hash — placeholder commitment for the region set
        MAX_TENOR_SECS,
        LTV_LIMIT_BPS,
      )
      .accounts({
        config: configPda(),
        pool,
        vaultAuth: vaultAuthPda(POOL_ID),
        lpMint: lpMintPda(POOL_ID),
        poolVaultUsdcAta: await getAssociatedTokenAddress(mint, vaultAuthPda(POOL_ID), true),
        usdcMint: mint,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc()
    console.log('4. Pool #1 (Rainfall) created')
  } else {
    console.log('4. Pool #1 already exists — skipping')
  }

  // 4. seed pool capital
  const poolVaultAta = await getAssociatedTokenAddress(mint, vaultAuthPda(POOL_ID), true)
  const vaultBalance = await connection.getTokenAccountBalance(poolVaultAta).catch(() => null)
  const hasCapital = vaultBalance !== null && BigInt(vaultBalance.value.amount) > 0n
  if (!hasCapital) {
    const amount = SEED_CAPITAL_USDC * 1_000_000n
    await program.methods
      .depositLiquidity(new BN(amount.toString()))
      .accounts({
        config: configPda(),
        pool,
        vaultAuth: vaultAuthPda(POOL_ID),
        lpMint: lpMintPda(POOL_ID),
        depositor: admin.publicKey,
        depositorUsdcAta: adminAta,
        poolVaultUsdcAta: poolVaultAta,
        depositorLpAta: await getAssociatedTokenAddress(lpMintPda(POOL_ID), admin.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc()
    console.log(`5. Pool #1 seeded with ${SEED_CAPITAL_USDC.toLocaleString()} USDC (LP tokens minted to admin)`)
  } else {
    console.log('5. Pool #1 already capitalized — skipping deposit')
  }

  // 5. optional buyer funding
  const fundWallet = process.env.FUND_WALLET
  if (fundWallet) {
    const buyer = new PublicKey(fundWallet)
    if (!IS_LOCAL && !skipAirdrop) await airdrop(connection, buyer, BUYER_FUND_SOL * LAMPORTS_PER_SOL)
    const buyerAta = await getAssociatedTokenAddress(mint, buyer)
    if (!(await connection.getAccountInfo(buyerAta))) {
      await createAssociatedTokenAccount(connection, admin, mint, buyer)
    }
    await transfer(connection, admin, adminAta, buyerAta, admin, BUYER_FUND_USDC * 1_000_000n)
    console.log(`6. Funded buyer ${buyer.toBase58()} with ${BUYER_FUND_USDC} USDC`)
  }

  // ── Summary ──
  console.log('\n────────────────────────────────────────────────────────────')
  console.log('Deploy complete. Copy these into .env.local:')
  console.log('────────────────────────────────────────────────────────────')
  console.log(`SOLANA_RPC_URL=${rpcUrl}`)
  console.log(`NEXT_PUBLIC_USDC_MINT=${mint.toBase58()}`)
  console.log(`NEXT_PUBLIC_RPC_URL=${rpcUrl}`)
  console.log(`QUOTE_SIGNER_SECRET_KEY=${bs58.encode(quoteSigner.secretKey)}`)
  console.log('')
  console.log('For the offchain services (oracle + monitor):')
  console.log(`  RPC_URL=${rpcUrl}`)
  console.log(`  ORACLE_KEYPAIR_PATH=${path.relative(process.cwd(), path.join(KEYS_DIR, 'oracle.json'))}`)
  console.log('')
  console.log('Demo quick path:')
  console.log('  1. npm run dev')
  console.log('  2. airdrop devnet SOL to your wallet (Phantom settings or `solana airdrop 2 <addr>`)')
  console.log(`  3. FUND_WALLET=<your wallet> npm run deploy   # sends ${BUYER_FUND_USDC} USDC`)
  console.log('  4. npm run demo                               # one-shot buy → observe → settle')
  console.log('────────────────────────────────────────────────────────────\n')
}

main().catch((err) => {
  console.error('\nDeploy failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
