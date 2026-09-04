import { Program, AnchorProvider, web3, BN } from '@coral-xyz/anchor'
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  Ed25519Program,
  AccountMeta,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'
import { Buffer } from 'buffer'
import bs58 from 'bs58'
import {
  serializeQuote,
  toBigInt,
  type Peril,
  type IndexMethod,
  type Direction,
} from './quote'
import { deserializeGlobalConfig, type GlobalConfigData } from './deserialize'

export const PROGRAM_ID = new PublicKey('CLiMaFi1111111111111111111111111111111111111')

// USDC mint. On mainnet this is the real USDC (EPjFWdd5...); on devnet you mint
// your own 6-decimal token and set NEXT_PUBLIC_USDC_MINT to its address.
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
)

const PERIL_SHAPES = [{ rainfall: {} }, { temperature: {} }, { windSpeed: {} }]
const INDEX_METHOD_SHAPES = [{ sum: {} }, { mean: {} }, { max: {} }]
const DIRECTION_SHAPES = [{ lessThan: {} }, { greaterThan: {} }]

export interface SignedQuote {
  quote: {
    policyId: string
    poolId: string
    regionId: string
    peril: Peril
    windowStartUnix: string
    windowEndUnix: string
    indexMethod: IndexMethod
    direction: Direction
    threshold: string
    payoutAmount: string
    premiumAmount: string
    quoteExpiryUnix: string
    nonce: string
  }
  signature: string // base64
  quoteSignerPubkey: string // base58
  message: string // hex
  expiresUnix: number
}

// Minimal IDL (matches programs/nimbus/src/lib.rs). Enum types are included so
// Anchor can build correct serializers for the Quote argument.
export const IDL = {
  version: '0.1.0',
  name: 'nimbus',
  instructions: [
    {
      name: 'initQuoteNonce',
      accounts: [
        { name: 'quoteNonce', isMut: true, isSigner: false },
        { name: 'buyer', isMut: true, isSigner: true },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: 'buyPolicy',
      accounts: [
        { name: 'config', isMut: false, isSigner: false },
        { name: 'pool', isMut: true, isSigner: false },
        { name: 'poolVaultUsdcAta', isMut: true, isSigner: false },
        { name: 'treasuryUsdcAta', isMut: true, isSigner: false },
        { name: 'policy', isMut: true, isSigner: false },
        { name: 'buyer', isMut: true, isSigner: true },
        { name: 'buyerNonce', isMut: true, isSigner: false },
        { name: 'buyerUsdcAta', isMut: true, isSigner: false },
        { name: 'instructionsSysvar', isMut: false, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'quote', type: 'defined' },
        { name: 'signature', type: { array: ['u8', 64] } },
        { name: 'ed25519IxIndex', type: 'u8' },
      ],
    },
    {
      name: 'settlePolicy',
      accounts: [
        { name: 'config', isMut: false, isSigner: false },
        { name: 'pool', isMut: true, isSigner: false },
        { name: 'vaultAuth', isMut: false, isSigner: false },
        { name: 'poolVaultUsdcAta', isMut: true, isSigner: false },
        { name: 'policy', isMut: true, isSigner: false },
        { name: 'policyOwner', isMut: true, isSigner: true },
        { name: 'policyOwnerUsdcAta', isMut: true, isSigner: false },
        { name: 'instructionsSysvar', isMut: false, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: 'depositLiquidity',
      accounts: [
        { name: 'config', isMut: false, isSigner: false },
        { name: 'pool', isMut: true, isSigner: false },
        { name: 'vaultAuth', isMut: false, isSigner: false },
        { name: 'lpMint', isMut: true, isSigner: false },
        { name: 'depositor', isMut: true, isSigner: true },
        { name: 'depositorUsdcAta', isMut: true, isSigner: false },
        { name: 'poolVaultUsdcAta', isMut: true, isSigner: false },
        { name: 'depositorLpAta', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'associatedTokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
        { name: 'rent', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'withdrawLiquidity',
      accounts: [
        { name: 'config', isMut: false, isSigner: false },
        { name: 'pool', isMut: true, isSigner: false },
        { name: 'vaultAuth', isMut: false, isSigner: false },
        { name: 'lpMint', isMut: true, isSigner: false },
        { name: 'withdrawer', isMut: true, isSigner: true },
        { name: 'withdrawerUsdcAta', isMut: true, isSigner: false },
        { name: 'poolVaultUsdcAta', isMut: true, isSigner: false },
        { name: 'withdrawerLpAta', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'lpAmount', type: 'u64' }],
    },
  ],
  types: [
    {
      name: 'Peril',
      type: {
        kind: 'enum',
        variants: [{ name: 'Rainfall' }, { name: 'Temperature' }, { name: 'WindSpeed' }],
      },
    },
    {
      name: 'IndexMethod',
      type: {
        kind: 'enum',
        variants: [{ name: 'Sum' }, { name: 'Mean' }, { name: 'Max' }],
      },
    },
    {
      name: 'TriggerDirection',
      type: {
        kind: 'enum',
        variants: [{ name: 'LessThan' }, { name: 'GreaterThan' }],
      },
    },
    {
      name: 'Quote',
      type: {
        kind: 'struct',
        fields: [
          { name: 'policyId', type: 'u64' },
          { name: 'poolId', type: 'u64' },
          { name: 'regionId', type: 'u64' },
          { name: 'peril', type: { defined: 'Peril' } },
          { name: 'windowStartUnix', type: 'i64' },
          { name: 'windowEndUnix', type: 'i64' },
          { name: 'indexMethod', type: { defined: 'IndexMethod' } },
          { name: 'direction', type: { defined: 'TriggerDirection' } },
          { name: 'threshold', type: 'i64' },
          { name: 'payoutAmount', type: 'u64' },
          { name: 'premiumAmount', type: 'u64' },
          { name: 'quoteExpiryUnix', type: 'i64' },
          { name: 'nonce', type: 'u64' },
        ],
      },
    },
  ],
}

// PDA helpers
export function getConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0]
}

export function getPoolPda(poolId: number | BN): PublicKey {
  const id = poolId instanceof BN ? poolId : new BN(poolId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), id.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  )[0]
}

export function getVaultAuthPda(poolId: number | BN): PublicKey {
  const id = poolId instanceof BN ? poolId : new BN(poolId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault_auth'), id.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  )[0]
}

export function getLpMintPda(poolId: number | BN): PublicKey {
  const id = poolId instanceof BN ? poolId : new BN(poolId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lp_mint'), id.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  )[0]
}

export function getPolicyPda(policyId: number | BN): PublicKey {
  const id = policyId instanceof BN ? policyId : new BN(policyId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), id.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  )[0]
}

export function getQuoteNoncePda(buyerPubkey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('quote_nonce'), buyerPubkey.toBuffer()],
    PROGRAM_ID
  )[0]
}

export function getTimelockPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('timelock')], PROGRAM_ID)[0]
}

export function getObservationPda(
  regionId: number | BN,
  peril: number,
  dayStartUnix: number | BN,
): PublicKey {
  const rid = regionId instanceof BN ? regionId : new BN(regionId)
  const day = dayStartUnix instanceof BN ? dayStartUnix : new BN(dayStartUnix)
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('obs'),
      rid.toArrayLike(Buffer, 'le', 8),
      Buffer.from([peril]),
      day.toArrayLike(Buffer, 'le', 8),
    ],
    PROGRAM_ID
  )[0]
}

export function buildObservationAccountKeys(
  regionId: number,
  peril: number,
  windowStartUnix: number,
  windowEndUnix: number,
): PublicKey[] {
  const daySeconds = 86400
  const keys: PublicKey[] = []
  for (let day = windowStartUnix; day < windowEndUnix; day += daySeconds) {
    keys.push(getObservationPda(regionId, peril, day))
  }
  return keys
}

/**
 * Fetch and deserialize the on-chain GlobalConfig (needed for usdc_mint +
 * treasury ATA when building transactions).
 */
export async function getGlobalConfig(connection: Connection): Promise<GlobalConfigData> {
  const configPda = getConfigPda()
  const account = await connection.getAccountInfo(configPda)
  if (!account) {
    throw new Error('Nimbus GlobalConfig not found — is the program deployed on this network?')
  }
  return deserializeGlobalConfig(account.data, account.owner)
}

export async function createInitQuoteNonceTransaction(
  connection: Connection,
  wallet: { publicKey: PublicKey },
): Promise<Transaction> {
  const provider = new AnchorProvider(connection, wallet as any, {})
  const program = new Program(IDL as any, PROGRAM_ID, provider)
  const noncePda = getQuoteNoncePda(wallet.publicKey)

  const tx = await program.methods
    .initQuoteNonce()
    .accounts({
      quoteNonce: noncePda,
      buyer: wallet.publicKey,
      systemProgram: web3.SystemProgram.programId,
    })
    .transaction()
  tx.feePayer = wallet.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
  return tx
}

/**
 * Creates the per-signer quote-nonce account if it does not exist yet.
 *
 * Must be called in its OWN transaction (before createBuyPolicyTransaction), since
 * buy_policy's reentrancy guard rejects transactions with more than one Nimbus
 * invocation. `send` receives the ready-to-sign init transaction.
 *
 * Returns the transaction signature if one was sent, or null if the account
 * already existed.
 */
export async function ensureQuoteNonceInitialized(
  connection: Connection,
  wallet: { publicKey: PublicKey },
  send: (tx: Transaction) => Promise<string>,
): Promise<string | null> {
  const noncePda = getQuoteNoncePda(wallet.publicKey)
  const existing = await connection.getAccountInfo(noncePda)
  if (existing) return null
  const tx = await createInitQuoteNonceTransaction(connection, wallet)
  return send(tx)
}

/**
 * Build the full buy_policy transaction for a signed quote:
 *   [compute budget] → [initQuoteNonce (if missing)] → [Ed25519 verify ix] → [buyPolicy]
 *
 * The Ed25519 instruction is built from the exact `message` bytes the server
 * signed, so the on-chain `verify_ed25519_ix` check passes as long as the client
 * and server serialize the Quote identically (enforced by the mismatch check below).
 */
export async function createBuyPolicyTransaction(
  connection: Connection,
  wallet: { publicKey: PublicKey },
  signedQuote: SignedQuote,
  config: { usdcMint: PublicKey; treasuryUsdcAta: PublicKey },
): Promise<Transaction> {
  const q = signedQuote.quote

  // Guard: verify the message the server signed equals our own borsh serialization.
  const expectedMessage = serializeQuote({
    policyId: toBigInt(q.policyId),
    poolId: toBigInt(q.poolId),
    regionId: toBigInt(q.regionId),
    peril: q.peril,
    windowStartUnix: toBigInt(q.windowStartUnix),
    windowEndUnix: toBigInt(q.windowEndUnix),
    indexMethod: q.indexMethod,
    direction: q.direction,
    threshold: toBigInt(q.threshold),
    payoutAmount: toBigInt(q.payoutAmount),
    premiumAmount: toBigInt(q.premiumAmount),
    quoteExpiryUnix: toBigInt(q.quoteExpiryUnix),
    nonce: toBigInt(q.nonce),
  })
  if (expectedMessage.toString('hex') !== signedQuote.message) {
    throw new Error('Signed quote message mismatch — server and client serialization differ')
  }

  const signatureBytes = new Uint8Array(Buffer.from(signedQuote.signature, 'base64'))
  if (signatureBytes.length !== 64) {
    throw new Error(`Invalid signature length: expected 64 bytes, got ${signatureBytes.length}`)
  }
  const signerPubkey = bs58.decode(signedQuote.quoteSignerPubkey)

  const provider = new AnchorProvider(connection, wallet as any, {})
  const program = new Program(IDL as any, PROGRAM_ID, provider)

  const configPda = getConfigPda()
  const poolPda = getPoolPda(new BN(q.poolId))
  const policyPda = getPolicyPda(new BN(q.policyId))
  const vaultAuthPda = getVaultAuthPda(new BN(q.poolId))
  const noncePda = getQuoteNoncePda(wallet.publicKey)

  const buyerUsdcAta = await getAssociatedTokenAddress(config.usdcMint, wallet.publicKey)
  const poolVaultUsdcAta = await getAssociatedTokenAddress(config.usdcMint, vaultAuthPda, true)

  const instructions: TransactionInstruction[] = []
  instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))

  // NOTE: initQuoteNonce must NOT be added here. The on-chain reentrancy guard
  // (assert_no_cpi_in_transaction) rejects any transaction containing more than
  // ONE top-level invocation of the Nimbus program. The per-signer nonce account
  // must be created in its own transaction first (see ensureQuoteNonceInitialized).

  // Buyer's USDC token account must exist before buy_policy transfers from it.
  // (ATA program, not Nimbus — safe to include here.)
  const buyerAtaInfo = await connection.getAccountInfo(buyerUsdcAta)
  if (!buyerAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey, // payer
        buyerUsdcAta,
        wallet.publicKey, // owner
        config.usdcMint,
      )
    )
  }

  const ed25519IxIndex = instructions.length
  instructions.push(
    Ed25519Program.createInstructionWithPublicKey({
      publicKey: signerPubkey,
      message: expectedMessage,
      signature: signatureBytes,
    })
  )

  const buyIx = await program.methods
    .buyPolicy(
      {
        policyId: new BN(q.policyId),
        poolId: new BN(q.poolId),
        regionId: new BN(q.regionId),
        peril: PERIL_SHAPES[q.peril] ?? PERIL_SHAPES[0],
        windowStartUnix: new BN(q.windowStartUnix),
        windowEndUnix: new BN(q.windowEndUnix),
        indexMethod: INDEX_METHOD_SHAPES[q.indexMethod] ?? INDEX_METHOD_SHAPES[0],
        direction: DIRECTION_SHAPES[q.direction] ?? DIRECTION_SHAPES[0],
        threshold: new BN(q.threshold),
        payoutAmount: new BN(q.payoutAmount),
        premiumAmount: new BN(q.premiumAmount),
        quoteExpiryUnix: new BN(q.quoteExpiryUnix),
        nonce: new BN(q.nonce),
      },
      Array.from(signatureBytes),
      ed25519IxIndex,
    )
    .accounts({
      config: configPda,
      pool: poolPda,
      poolVaultUsdcAta,
      treasuryUsdcAta: config.treasuryUsdcAta,
      policy: policyPda,
      buyer: wallet.publicKey,
      buyerNonce: noncePda,
      buyerUsdcAta,
      instructionsSysvar: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: web3.SystemProgram.programId,
    })
    .instruction()

  instructions.push(buyIx)

  const tx = new Transaction().add(...instructions)
  tx.feePayer = wallet.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
  return tx
}

/**
 * Build a settle_policy transaction. `policy` must be owned by `wallet`, and all
 * daily observation accounts for the policy window must already exist.
 */
export async function createSettlePolicyTransaction(
  connection: Connection,
  wallet: { publicKey: PublicKey },
  policyAddress: PublicKey,
  policy: {
    pool: PublicKey
    poolId: number
    regionId: number
    peril: number
    windowStartUnix: number
    windowEndUnix: number
  },
  config: { usdcMint: PublicKey },
): Promise<Transaction> {
  const provider = new AnchorProvider(connection, wallet as any, {})
  const program = new Program(IDL as any, PROGRAM_ID, provider)

  const vaultAuthPda = getVaultAuthPda(policy.poolId)
  const poolVaultUsdcAta = await getAssociatedTokenAddress(config.usdcMint, vaultAuthPda, true)
  const policyOwnerUsdcAta = await getAssociatedTokenAddress(config.usdcMint, wallet.publicKey)

  const numDays = Math.round((policy.windowEndUnix - policy.windowStartUnix) / 86400)
  const remainingAccounts: AccountMeta[] = []
  for (let i = 0; i < numDays; i++) {
    const dayStart = policy.windowStartUnix + i * 86400
    remainingAccounts.push({
      pubkey: getObservationPda(policy.regionId, policy.peril, dayStart),
      isWritable: false,
      isSigner: false,
    })
  }

  const settleIx = await program.methods
    .settlePolicy()
    .accounts({
      config: getConfigPda(),
      pool: policy.pool,
      vaultAuth: vaultAuthPda,
      poolVaultUsdcAta,
      policy: policyAddress,
      policyOwner: wallet.publicKey,
      policyOwnerUsdcAta,
      instructionsSysvar: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(remainingAccounts)
    .instruction()

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    settleIx,
  )
  tx.feePayer = wallet.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
  return tx
}

export async function createDepositTransaction(
  connection: Connection,
  wallet: { publicKey: PublicKey },
  poolId: number,
  amount: number, // in USDC base units (6 decimals)
): Promise<Transaction> {
  const provider = new AnchorProvider(connection, wallet as any, {})
  const program = new Program(IDL as any, PROGRAM_ID, provider)

  const configPda = getConfigPda()
  const poolPda = getPoolPda(poolId)
  const vaultAuthPda = getVaultAuthPda(poolId)
  const lpMintPda = getLpMintPda(poolId)

  const depositorUsdcAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey)
  const poolVaultUsdcAta = await getAssociatedTokenAddress(USDC_MINT, vaultAuthPda, true)
  const depositorLpAta = await getAssociatedTokenAddress(lpMintPda, wallet.publicKey)

  return program.methods
    .depositLiquidity(new BN(amount))
    .accounts({
      config: configPda,
      pool: poolPda,
      vaultAuth: vaultAuthPda,
      lpMint: lpMintPda,
      depositor: wallet.publicKey,
      depositorUsdcAta,
      poolVaultUsdcAta,
      depositorLpAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
      systemProgram: web3.SystemProgram.programId,
      rent: web3.SYSVAR_RENT_PUBKEY,
    })
    .transaction()
}

export async function createWithdrawTransaction(
  connection: Connection,
  wallet: { publicKey: PublicKey },
  poolId: number,
  lpAmount: number, // in LP token base units
): Promise<Transaction> {
  const provider = new AnchorProvider(connection, wallet as any, {})
  const program = new Program(IDL as any, PROGRAM_ID, provider)

  const configPda = getConfigPda()
  const poolPda = getPoolPda(poolId)
  const vaultAuthPda = getVaultAuthPda(poolId)
  const lpMintPda = getLpMintPda(poolId)

  const withdrawerUsdcAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey)
  const poolVaultUsdcAta = await getAssociatedTokenAddress(USDC_MINT, vaultAuthPda, true)
  const withdrawerLpAta = await getAssociatedTokenAddress(lpMintPda, wallet.publicKey)

  return program.methods
    .withdrawLiquidity(new BN(lpAmount))
    .accounts({
      config: configPda,
      pool: poolPda,
      vaultAuth: vaultAuthPda,
      lpMint: lpMintPda,
      withdrawer: wallet.publicKey,
      withdrawerUsdcAta,
      poolVaultUsdcAta,
      withdrawerLpAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction()
}

// Re-export validated deserializers from centralized module
export {
  deserializeGlobalConfig,
  deserializeMultisigConfig,
  deserializePool,
  deserializePolicy,
  validateMultisigInvariants,
  validatePoolInvariants,
  validatePolicyInvariants,
  DeserializationError,
  DISCRIMINATORS,
} from './deserialize'

export type {
  GlobalConfigData,
  MultisigConfigData,
  PoolData as PoolAccountData,
  PolicyData as PolicyAccountData,
} from './deserialize'
