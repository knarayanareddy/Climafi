'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { PublicKey } from '@solana/web3.js'
import Nav from '../../components/Nav'
import TransactionStatus from '../../components/TransactionStatus'
import type { TxState } from '../../components/TransactionStatus'
import { PROGRAM_ID, getGlobalConfig, createSettlePolicyTransaction } from '../../lib/nimbus'
import { deserializePolicy, type PolicyData } from '../../lib/deserialize'
import { getRegionByU64 } from '../../lib/regions'
import {
  Search, CheckCircle2, AlertTriangle, Zap, CloudRain, CloudSun, ArrowRight, Wallet
} from 'lucide-react'

const POLICY_ACCOUNT_SIZE = 197

interface PolicyRow {
  address: string
  data: PolicyData
}

function fmtUsdc(baseUnits: number): string {
  return (baseUnits / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function SettleContent() {
  const searchParams = useSearchParams()
  const { publicKey, connected, sendTransaction } = useWallet()
  const { setVisible } = useWalletModal()
  const { connection } = useConnection()

  const [policies, setPolicies] = useState<PolicyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txState, setTxState] = useState<TxState>('idle')
  const [txMessage, setTxMessage] = useState('')
  const [txSignature, setTxSignature] = useState<string | undefined>(undefined)

  const loadPolicies = useCallback(async () => {
    if (!publicKey) return
    setLoading(true)
    setError(null)
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [{ dataSize: POLICY_ACCOUNT_SIZE }],
      })
      const rows: PolicyRow[] = []
      for (const { pubkey, account } of accounts) {
        try {
          const data = deserializePolicy(account.data, account.owner)
          if (data.owner.equals(publicKey)) {
            rows.push({ address: pubkey.toBase58(), data })
          }
        } catch {
          // skip non-Policy accounts
        }
      }
      rows.sort((a, b) => b.data.createdAtUnix - a.data.createdAtUnix)
      setPolicies(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policies')
    } finally {
      setLoading(false)
    }
  }, [connection, publicKey])

  useEffect(() => {
    loadPolicies()
  }, [loadPolicies])

  const handleSettle = async (row: PolicyRow) => {
    if (!publicKey) {
      setVisible(true)
      return
    }

    setTxState('signing')
    setTxMessage('Building settlement transaction…')
    setTxSignature(undefined)

    try {
      const config = await getGlobalConfig(connection)
      const tx = await createSettlePolicyTransaction(
        connection,
        { publicKey },
        new PublicKey(row.address),
        {
          pool: row.data.pool,
          poolId: row.data.poolId,
          regionId: row.data.regionId,
          peril: row.data.peril,
          windowStartUnix: row.data.windowStartUnix,
          windowEndUnix: row.data.windowEndUnix,
        },
        { usdcMint: config.usdcMint },
      )

      setTxMessage('Waiting for wallet approval…')
      const sig = await sendTransaction(tx, connection)

      setTxSignature(sig)
      setTxState('confirming')
      setTxMessage('Confirming settlement…')
      const latest = await connection.getLatestBlockhash('confirmed')
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed')

      setTxState('success')
      setTxMessage('Policy settled.')
      loadPolicies()
    } catch (err) {
      console.error('Settlement failed:', err)
      setTxState('error')
      setTxMessage(err instanceof Error ? err.message : 'Settlement failed')
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const focusPolicy = searchParams.get('policy')
  const settleable = policies.filter((p) => p.data.status === 0 && p.data.windowEndUnix <= now)

  return (
    <main className="min-h-screen bg-surface-0 noise">
      <Nav />
      <div className="section py-8 lg:py-12">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="heading-md text-white mb-2">Settle Policies</h1>
            <p className="body-md">Settlement is deterministic — the on-chain program checks the daily oracle snapshots against your threshold and pays out automatically.</p>
          </div>

          <TransactionStatus
            state={txState}
            message={txMessage}
            txSignature={txSignature}
            onDismiss={() => setTxState('idle')}
          />

          {!connected ? (
            <div className="card p-10 text-center mt-6">
              <Wallet className="w-10 h-10 text-nimbus-400 mx-auto mb-4" />
              <p className="body-md mb-6">Connect your wallet to settle policies.</p>
              <button onClick={() => setVisible(true)} className="btn-primary inline-flex items-center gap-2">
                Connect Wallet <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-3 mt-6">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-24 bg-surface-2 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="card p-6 mt-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-status-danger mt-0.5" />
              <div>
                <div className="text-sm font-medium text-white">Couldn&apos;t load policies</div>
                <div className="text-xs text-white/40 mt-1">{error}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 mt-6">
              {settleable.length === 0 && (
                <div className="card p-8 text-center">
                  <Search className="w-8 h-8 text-nimbus-400 mx-auto mb-3" />
                  <p className="text-sm text-white/50">No matured policies ready to settle.</p>
                  <p className="text-xs text-white/30 mt-1">
                    A policy can be settled once its window has ended and all daily oracle snapshots are posted.
                  </p>
                </div>
              )}

              {settleable.map((row) => {
                const region = getRegionByU64(row.data.regionId)
                const isDrought = row.data.direction === 0
                const focused = focusPolicy === row.address
                return (
                  <div key={row.address} className={`card p-5 ${focused ? 'border-nimbus-400/40' : ''}`}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        {isDrought ? (
                          <CloudSun className="w-6 h-6 text-status-triggered mt-0.5" />
                        ) : (
                          <CloudRain className="w-6 h-6 text-nimbus-400 mt-0.5" />
                        )}
                        <div>
                          <div className="text-sm font-medium text-white">{region?.name ?? `Region #${row.data.regionId}`}</div>
                          <div className="text-xs text-white/30 font-mono mt-0.5">Policy #{row.data.policyId}</div>
                          <div className="text-xs text-white/40 mt-1">
                            Threshold {isDrought ? '<' : '≥'} {(row.data.threshold / 100).toFixed(0)}mm · Payout {fmtUsdc(row.data.payoutAmount)} USDC
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleSettle(row)}
                        disabled={txState === 'signing' || txState === 'confirming'}
                        className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
                      >
                        <Zap className="w-4 h-4" /> Settle
                      </button>
                    </div>
                  </div>
                )
              })}

              <div className="mt-8">
                <div className="label mb-3">Settlement history</div>
                {policies.filter((p) => p.data.status === 2 || p.data.status === 3).map((row) => {
                  const region = getRegionByU64(row.data.regionId)
                  const paid = row.data.status === 2
                  return (
                    <div key={row.address} className="card p-4 mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {paid ? (
                          <CheckCircle2 className="w-5 h-5 text-status-active" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-white/30" />
                        )}
                        <div>
                          <div className="text-sm text-white font-medium">{region?.name ?? `Region #${row.data.regionId}`} — Policy #{row.data.policyId}</div>
                          <div className="text-xs text-white/40">
                            {paid ? `Paid ${fmtUsdc(row.data.payoutAmount)} USDC` : 'Window ended, trigger not met'}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-white/30">
                        Observed {(row.data.observedValue / 100).toFixed(0)}mm
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

export default function SettlePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-0 noise"><Nav /></div>}>
      <SettleContent />
    </Suspense>
  )
}
