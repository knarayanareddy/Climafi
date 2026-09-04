'use client'

import { useState, useEffect, useCallback } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import Nav from '../../components/Nav'
import { PROGRAM_ID } from '../../lib/nimbus'
import { deserializePool, type PoolData } from '../../lib/deserialize'
import { Droplets, TrendingUp, AlertTriangle, Shield, ExternalLink } from 'lucide-react'

const POOL_ACCOUNT_SIZE = 143 // Pool::LEN (includes 8-byte discriminator)

const PERIL_LABEL = ['Rainfall', 'Temperature', 'Wind Speed']

function fmtUsdc(baseUnits: number): string {
  return (baseUnits / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export default function PoolsPage() {
  const { connection } = useConnection()

  const [pools, setPools] = useState<PoolData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPools = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [{ dataSize: POOL_ACCOUNT_SIZE }],
      })
      const rows: PoolData[] = []
      for (const { account } of accounts) {
        try {
          rows.push(deserializePool(account.data, account.owner))
        } catch {
          // skip non-Pool accounts
        }
      }
      rows.sort((a, b) => a.poolId - b.poolId)
      setPools(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pools')
    } finally {
      setLoading(false)
    }
  }, [connection])

  useEffect(() => {
    loadPools()
  }, [loadPools])

  return (
    <main className="min-h-screen bg-surface-0 noise">
      <Nav />
      <div className="section py-8 lg:py-12">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="heading-md text-white mb-2">Underwriting Pools</h1>
            <p className="body-md">Liquidity pools that back parametric coverage. Premiums flow in, payouts flow out.</p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-28 bg-surface-2 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="card p-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-status-danger mt-0.5" />
              <div>
                <div className="text-sm font-medium text-white">Couldn&apos;t load pools</div>
                <div className="text-xs text-white/40 mt-1">{error}</div>
              </div>
            </div>
          ) : pools.length === 0 ? (
            <div className="card p-10 text-center">
              <Droplets className="w-10 h-10 text-nimbus-400 mx-auto mb-4" />
              <p className="body-md mb-2">No pools deployed yet.</p>
              <p className="text-xs text-white/30">Pools are created by the protocol admin via create_pool.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pools.map((pool) => {
                const utilization = pool.capital > 0 ? (pool.locked / pool.capital) * 100 : 0
                return (
                  <div key={pool.poolId} className="card p-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Shield className="w-6 h-6 text-nimbus-400" />
                        <div>
                          <div className="text-sm font-medium text-white">
                            Pool #{pool.poolId} · {PERIL_LABEL[pool.peril] ?? `Peril ${pool.peril}`}
                          </div>
                          <div className="text-xs text-white/30 font-mono mt-0.5">
                            LTV limit {pool.ltvLimitBps / 100}%
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-right">
                        <div>
                          <div className="label">Capital</div>
                          <div className="text-sm text-white font-medium">{fmtUsdc(pool.capital)} USDC</div>
                        </div>
                        <div>
                          <div className="label">Locked</div>
                          <div className="text-sm text-white font-medium">{fmtUsdc(pool.locked)} USDC</div>
                        </div>
                        <div>
                          <div className="label">Utilization</div>
                          <div className={`text-sm font-medium ${utilization >= 90 ? 'text-status-danger' : utilization >= 80 ? 'text-status-triggered' : 'text-nimbus-300'}`}>
                            {utilization.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-white/40">
                        <TrendingUp className="w-3.5 h-3.5" />
                        Utilization meter
                      </div>
                      <div className="w-1/2 h-2 bg-surface-3 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${utilization >= 90 ? 'bg-status-danger' : utilization >= 80 ? 'bg-status-triggered' : 'bg-nimbus-400'}`}
                          style={{ width: `${Math.min(100, utilization)}%` }}
                        />
                      </div>
                      <a
                        href={`https://explorer.solana.com/account/${pool.vaultUsdcAta.toBase58()}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-white/30 hover:text-white/60 inline-flex items-center gap-1"
                      >
                        Vault <ExternalLink className="w-3.5 h-3.5" />
                      </a>
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
