'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import Nav from '../../components/Nav'
import { PROGRAM_ID } from '../../lib/nimbus'
import { deserializePolicy, type PolicyData } from '../../lib/deserialize'
import { getRegionByU64 } from '../../lib/regions'
import {
  Wallet, Shield, CloudSun, CloudRain, Clock, CheckCircle2,
  AlertTriangle, ArrowRight, ExternalLink
} from 'lucide-react'

const POLICY_ACCOUNT_SIZE = 197 // Policy::LEN (includes 8-byte discriminator)

const STATUS_LABEL: Record<number, { label: string; className: string }> = {
  0: { label: 'Active', className: 'text-nimbus-300' },
  1: { label: 'Cancelled', className: 'text-white/40' },
  2: { label: 'Settled · Paid', className: 'text-status-active' },
  3: { label: 'Settled · Expired', className: 'text-white/40' },
}

interface PolicyRow {
  address: string
  data: PolicyData
}

function fmtUsdc(baseUnits: number): string {
  return (baseUnits / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export default function PortfolioPage() {
  const { publicKey, connected } = useWallet()
  const { setVisible } = useWalletModal()
  const { connection } = useConnection()

  const [policies, setPolicies] = useState<PolicyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          // not a Policy account (or malformed) — skip
        }
      }
      rows.sort((a, b) => b.data.createdAtUnix - a.data.createdAtUnix)
      setPolicies(rows)
    } catch (err) {
      console.error('Failed to load policies:', err)
      setError(err instanceof Error ? err.message : 'Failed to load policies')
    } finally {
      setLoading(false)
    }
  }, [connection, publicKey])

  useEffect(() => {
    loadPolicies()
  }, [loadPolicies])

  return (
    <main className="min-h-screen bg-surface-0 noise">
      <Nav />
      <div className="section py-8 lg:py-12">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="heading-md text-white mb-2">Your Portfolio</h1>
            <p className="body-md">On-chain policies owned by your connected wallet.</p>
          </div>

          {!connected ? (
            <div className="card p-10 text-center">
              <Wallet className="w-10 h-10 text-nimbus-400 mx-auto mb-4" />
              <p className="body-md mb-6">Connect your wallet to view your coverage.</p>
              <button onClick={() => setVisible(true)} className="btn-primary inline-flex items-center gap-2">
                Connect Wallet <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 bg-surface-2 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="card p-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-status-danger mt-0.5" />
              <div>
                <div className="text-sm font-medium text-white">Couldn&apos;t load policies</div>
                <div className="text-xs text-white/40 mt-1">{error}</div>
              </div>
            </div>
          ) : policies.length === 0 ? (
            <div className="card p-10 text-center">
              <Shield className="w-10 h-10 text-nimbus-400 mx-auto mb-4" />
              <p className="body-md mb-6">No policies yet. Buy rainfall coverage to get started.</p>
              <Link href="/buy" className="btn-primary inline-flex items-center gap-2">
                Buy Cover <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {policies.map(({ address, data }) => {
                const region = getRegionByU64(data.regionId)
                const status = STATUS_LABEL[data.status] ?? { label: `Status ${data.status}`, className: 'text-white/40' }
                const isDrought = data.direction === 0
                return (
                  <div key={address} className="card p-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        {isDrought ? (
                          <CloudSun className="w-6 h-6 text-status-triggered mt-0.5" />
                        ) : (
                          <CloudRain className="w-6 h-6 text-nimbus-400 mt-0.5" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white">{region?.name ?? `Region #${data.regionId}`}</span>
                            <span className="badge-active"><span className="w-1.5 h-1.5 bg-current rounded-full" />{status.label}</span>
                          </div>
                          <div className="text-xs text-white/30 font-mono mt-0.5">
                            Policy #{data.policyId} · {isDrought ? 'Drought' : 'Flood'} · {['Sum', 'Mean', 'Max'][data.indexMethod]}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-white/60">
                          Payout <span className="text-white font-semibold">{fmtUsdc(data.payoutAmount)} USDC</span>
                        </div>
                        <div className="text-xs text-white/30">Premium {fmtUsdc(data.premiumAmount)} USDC</div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3 text-xs text-white/40">
                      <div className="flex items-center gap-4">
                        <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />
                          {new Date(data.windowStartUnix * 1000).toLocaleDateString()} → {new Date(data.windowEndUnix * 1000).toLocaleDateString()}
                        </span>
                        <span>Threshold {isDrought ? '<' : '≥'} {(data.threshold / 100).toFixed(0)}mm</span>
                        {data.triggered && <span className="inline-flex items-center gap-1 text-status-active"><CheckCircle2 className="w-3.5 h-3.5" /> Triggered</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        {data.status === 0 && (
                          <Link href={`/settle?policy=${address}`} className="btn-ghost inline-flex items-center gap-1">
                            Settle <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        )}
                        <a
                          href={`https://explorer.solana.com/account/${address}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 hover:text-white/70"
                        >
                          View <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
