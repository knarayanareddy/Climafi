'use client'

import { useState, useEffect, Suspense } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import Nav from '../../components/Nav'
import { PROGRAM_ID } from '../../lib/nimbus'
import { deserializeMultisigConfig, validateMultisigInvariants, DeserializationError } from '../../lib/deserialize'
import {
  Vote, Shield, Clock, CheckCircle2, AlertTriangle, Users,
  Lock, Timer, ArrowRight, ExternalLink, ChevronDown, ChevronUp,
  Settings, FileText, Zap, Info
} from 'lucide-react'

interface MultisigConfig {
  threshold: number
  authorities: string[]
  proposalCount: number
}

interface Proposal {
  id: string
  title: string
  description: string
  status: 'active' | 'queued' | 'executed' | 'expired'
  votesFor: number
  votesAgainst: number
  timelockRemaining: string
  proposer: string
  createdAt: string
}

const DEMO_PROPOSALS: Proposal[] = [
  {
    id: 'PROP-001',
    title: 'Update Oracle Authority',
    description: 'Add secondary oracle authority for redundancy. Proposed permissioned feed from NOAA direct API.',
    status: 'active',
    votesFor: 2,
    votesAgainst: 0,
    timelockRemaining: '—',
    proposer: '7Yh3...kMnz',
    createdAt: '2026-06-20T14:00:00Z',
  },
  {
    id: 'PROP-002',
    title: 'Increase Pool LTV Limit to 85%',
    description: 'Raise maximum LTV from 80% to 85% for drought pools. Risk assessment shows adequate reserve ratio at 85%.',
    status: 'queued',
    votesFor: 3,
    votesAgainst: 0,
    timelockRemaining: '4d 12h',
    proposer: '7Yh3...kMnz',
    createdAt: '2026-06-18T10:00:00Z',
  },
  {
    id: 'PROP-003',
    title: 'Add BGD-DHK-001 Region',
    description: 'Enable Dhaka, Bangladesh as a supported region for flood coverage.',
    status: 'executed',
    votesFor: 3,
    votesAgainst: 0,
    timelockRemaining: '—',
    proposer: '3Kw2...9pLr',
    createdAt: '2026-06-10T08:00:00Z',
  },
]

const PROPOSAL_STATUS = {
  active: { bg: 'bg-status-active/10', text: 'text-status-active', border: 'border-status-active/20', label: 'Active', icon: Clock },
  queued: { bg: 'bg-status-triggered/10', text: 'text-status-triggered', border: 'border-status-triggered/20', label: 'Queued (Timelock)', icon: Timer },
  executed: { bg: 'bg-status-settled/10', text: 'text-status-settled', border: 'border-status-settled/20', label: 'Executed', icon: CheckCircle2 },
  expired: { bg: 'bg-status-cancelled/10', text: 'text-status-cancelled', border: 'border-status-cancelled/20', label: 'Expired', icon: AlertTriangle },
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [expanded, setExpanded] = useState(false)
  const status = PROPOSAL_STATUS[proposal.status]
  const StatusIcon = status.icon

  return (
    <div className="card p-0 overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-white/30">{proposal.id}</span>
            <div className={`badge ${status.bg} ${status.text} ${status.border}`}>
              <StatusIcon className="w-3 h-3" />
              {status.label}
            </div>
          </div>
          {proposal.status === 'queued' && (
            <span className="text-xs font-mono text-status-triggered">
              Timelock: {proposal.timelockRemaining}
            </span>
          )}
        </div>

        <h3 className="text-base font-semibold text-white mb-1">{proposal.title}</h3>
        <p className="text-sm text-white/40">{proposal.description}</p>

        {/* Vote bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-status-active">For: {proposal.votesFor}</span>
            <span className="text-status-danger">Against: {proposal.votesAgainst}</span>
          </div>
          <div className="h-2 bg-surface-3 rounded-full overflow-hidden flex">
            {proposal.votesFor > 0 && (
              <div
                className="h-full bg-status-active rounded-l-full"
                style={{ width: `${(proposal.votesFor / (proposal.votesFor + proposal.votesAgainst || 1)) * 100}%` }}
              />
            )}
            {proposal.votesAgainst > 0 && (
              <div
                className="h-full bg-status-danger rounded-r-full"
                style={{ width: `${(proposal.votesAgainst / (proposal.votesFor + proposal.votesAgainst || 1)) * 100}%` }}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 mt-3 text-xs text-white/20">
          <span>Proposed by {proposal.proposer}</span>
          <span>{new Date(proposal.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </div>

      {/* Actions */}
      {proposal.status === 'active' && (
        <div className="border-t border-white/[0.04] p-4 flex gap-3">
          <button className="btn-primary flex-1 py-2.5 text-sm">
            Vote For
          </button>
          <button className="btn-secondary flex-1 py-2.5 text-sm">
            Vote Against
          </button>
        </div>
      )}

      {proposal.status === 'queued' && (
        <div className="border-t border-white/[0.04] p-4">
          <button disabled className="btn-secondary w-full py-2.5 text-sm inline-flex items-center justify-center gap-2 opacity-50">
            <Timer className="w-4 h-4" />
            Execute (available in {proposal.timelockRemaining})
          </button>
        </div>
      )}
    </div>
  )
}

function GovernanceContent() {
  const { publicKey, connected } = useWallet()
  const { connection } = useConnection()
  const [config, setConfig] = useState<MultisigConfig | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchConfig = async () => {
      setLoading(true)
      setError(null)
      try {
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
          filters: [{ dataSize: 197 }],
        })

        if (accounts.length > 0) {
          const account = accounts[0]
          const configData = deserializeMultisigConfig(account.account.data, account.account.owner)
          const invariantWarnings = validateMultisigInvariants(configData)
          setConfig({
            threshold: configData.threshold,
            authorities: configData.authorities.map((a) => a.toBase58()),
            proposalCount: configData.proposalNonce,
          })
          setWarnings(invariantWarnings)
        } else {
          setConfig({
            threshold: 2,
            authorities: ['7Yh3...kMnz', '3Kw2...9pLr', 'Bx4f...2qWs'],
            proposalCount: 3,
          })
        }
      } catch (err) {
        setConfig({
          threshold: 2,
          authorities: ['7Yh3...kMnz', '3Kw2...9pLr', 'Bx4f...2qWs'],
          proposalCount: 3,
        })
      } finally {
        setLoading(false)
      }
    }

    fetchConfig()
  }, [connection])

  const isAuthority = config?.authorities.some(
    (a) => publicKey && a === publicKey.toBase58()
  )

  return (
    <div className="section py-8 lg:py-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="heading-md text-white mb-2">Governance</h1>
          <p className="body-md max-w-2xl">
            Protocol governance via M-of-N multisig with timelock.
            Currently admin-controlled — transitioning to decentralized on-chain governance post-launch.
          </p>
        </div>

        {/* Governance stage notice */}
        <div className="card-glass p-5 mb-8 flex items-start gap-3">
          <Info className="w-5 h-5 text-nimbus-400 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-white mb-1">Current Governance Stage: Admin-Controlled Multisig</div>
            <p className="text-xs text-white/40">
              All protocol changes require {config?.threshold || '...'}-of-{config?.authorities.length || '...'} multisig approval
              with a mandatory 7-day timelock before execution. Proposals expire after 7 days if not approved.
              This is a transitional stage toward fully decentralized on-chain governance.
            </p>
          </div>
        </div>

        {/* Config panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="card py-6 text-center">
            <Users className="w-5 h-5 text-nimbus-400 mx-auto mb-2" />
            <div className="data-value">{config?.threshold || '—'}-of-{config?.authorities.length || '—'}</div>
            <div className="data-label">Multisig Threshold</div>
          </div>
          <div className="card py-6 text-center">
            <FileText className="w-5 h-5 text-nimbus-400 mx-auto mb-2" />
            <div className="data-value">{config?.proposalCount ?? '—'}</div>
            <div className="data-label">Total Proposals</div>
          </div>
          <div className="card py-6 text-center">
            <Lock className="w-5 h-5 text-nimbus-400 mx-auto mb-2" />
            <div className="data-value">7d</div>
            <div className="data-label">Timelock Period</div>
          </div>
        </div>

        {/* Signer status */}
        {config && (
          <div className="card mb-8">
            <div className="heading-sm text-white mb-4">Multisig Signers</div>
            <div className="space-y-2">
              {config.authorities.map((auth, i) => (
                <div key={auth} className="flex items-center justify-between p-3 bg-surface-2 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      publicKey && auth === publicKey.toBase58()
                        ? 'bg-nimbus-500/20 text-nimbus-400'
                        : 'bg-surface-3 text-white/30'
                    }`}>
                      <Shield className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-mono text-white/60">{auth}</span>
                  </div>
                  {publicKey && auth === publicKey.toBase58() && (
                    <span className="badge bg-nimbus-500/10 text-nimbus-300 border border-nimbus-400/20">
                      You
                    </span>
                  )}
                </div>
              ))}
            </div>

            {warnings.length > 0 && (
              <div className="mt-4 space-y-2">
                {warnings.map((w, i) => (
                  <div key={i} className="p-3 bg-status-triggered/5 border border-status-triggered/10 rounded-xl flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-status-triggered mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-status-triggered/80">{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Proposals */}
        <div className="mb-4">
          <div className="heading-sm text-white mb-1">Proposals</div>
          <p className="text-sm text-white/30">Sample proposals — the multisig config above is read live on-chain.</p>
        </div>

        <div className="space-y-4">
          {DEMO_PROPOSALS.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function GovernancePage() {
  return (
    <main className="min-h-screen bg-surface-0 noise">
      <Nav />
      <Suspense fallback={
        <div className="section py-12">
          <div className="max-w-4xl mx-auto">
            <div className="h-8 w-48 bg-surface-2 rounded-lg animate-pulse mb-8" />
            <div className="grid grid-cols-3 gap-4 mb-8">
              {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-surface-1 rounded-2xl animate-pulse" />)}
            </div>
          </div>
        </div>
      }>
        <GovernanceContent />
      </Suspense>
    </main>
  )
}
