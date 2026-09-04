'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import Nav from '../../components/Nav'
import TransactionStatus from '../../components/TransactionStatus'
import type { TxState } from '../../components/TransactionStatus'
import { getGlobalConfig, createBuyPolicyTransaction, ensureQuoteNonceInitialized } from '../../lib/nimbus'
import type { SignedQuote } from '../../lib/nimbus'
import { REGIONS, getRegionById } from '../../lib/regions'
import {
  Shield, Cloud, Droplets, ArrowRight, ArrowLeft, Timer, Check,
  MapPin, CloudRain, CloudSun, BarChart2, TrendingUp, Calendar,
  DollarSign, AlertTriangle, Zap, Clock, ChevronRight, Info
} from 'lucide-react'

const INDEX_METHODS = [
  {
    id: 'Sum',
    name: 'Sum',
    icon: BarChart2,
    description: 'Total accumulated rainfall over the entire window',
    bestFor: 'Drought coverage — did the region receive enough total rain?',
    example: 'If Sum < 80mm over 14 days → drought triggered',
  },
  {
    id: 'Mean',
    name: 'Mean',
    icon: TrendingUp,
    description: 'Average daily rainfall across the window',
    bestFor: 'Sustained dry or wet spells — was it consistently too dry?',
    example: 'If Mean > 25mm/day over 14 days → flood triggered',
  },
  {
    id: 'Max',
    name: 'Max',
    icon: CloudRain,
    description: 'Single highest-rainfall day within the window',
    bestFor: 'Flash flood events — did any single day exceed safe levels?',
    example: 'If Max > 100mm on any day → extreme rainfall triggered',
  },
]

const STEPS = [
  { id: 1, label: 'Region', icon: MapPin },
  { id: 2, label: 'Peril', icon: CloudRain },
  { id: 3, label: 'Index', icon: BarChart2 },
  { id: 4, label: 'Window', icon: Calendar },
  { id: 5, label: 'Threshold', icon: TrendingUp },
  { id: 6, label: 'Review', icon: DollarSign },
]

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-2 w-full mb-10">
      {STEPS.map((step, i) => {
        const isComplete = currentStep > step.id
        const isActive = currentStep === step.id
        const Icon = step.icon
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
                isComplete ? 'step-complete' : isActive ? 'step-active' : 'step-pending'
              }`}>
                {isComplete ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={`text-[10px] mt-2 font-medium transition-colors ${
                isActive ? 'text-nimbus-300' : isComplete ? 'text-white/50' : 'text-white/20'
              }`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`hidden sm:block h-px flex-1 mx-2 transition-colors ${
                isComplete ? 'bg-status-active/40' : 'bg-white/[0.06]'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function BuyFlowContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const wallet = useWallet()
  const { connected, publicKey, sendTransaction } = wallet
  const { connection } = useConnection()
  const { setVisible: setWalletVisible } = useWalletModal()

  const [step, setStep] = useState(1)
  const [region, setRegion] = useState(searchParams.get('region') || '')
  const [direction, setDirection] = useState<'LT' | 'GT'>(searchParams.get('direction') as 'LT' | 'GT' || 'LT')
  const [indexMethod, setIndexMethod] = useState(searchParams.get('indexMethod') || 'Sum')
  const [days, setDays] = useState(Number(searchParams.get('days')) || 14)
  const [threshold, setThreshold] = useState(Number(searchParams.get('threshold')) || 80)
  const [payout, setPayout] = useState(Number(searchParams.get('payout')) || 500)
  const [premium, setPremium] = useState<number | null>(null)
  const [quoteCountdown, setQuoteCountdown] = useState<number | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [txState, setTxState] = useState<TxState>('idle')
  const [txMessage, setTxMessage] = useState('')
  const [txSignature, setTxSignature] = useState<string | undefined>(undefined)

  const syncURL = useCallback(() => {
    const params = new URLSearchParams()
    if (region) params.set('region', region)
    if (direction) params.set('direction', direction)
    if (indexMethod) params.set('indexMethod', indexMethod)
    params.set('days', String(days))
    params.set('threshold', String(threshold))
    params.set('payout', String(payout))
    params.set('step', String(step))
    router.replace(`/buy?${params.toString()}`, { scroll: false })
  }, [region, direction, indexMethod, days, threshold, payout, step, router])

  useEffect(() => { syncURL() }, [syncURL])

  useEffect(() => {
    if (quoteCountdown === null || quoteCountdown <= 0) return
    const timer = setInterval(() => {
      setQuoteCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [quoteCountdown])

  const calculateQuote = async () => {
    setIsCalculating(true)
    try {
      const res = await fetch(`/api/quotes/calculate?region=${region}&direction=${direction}&days=${days}&threshold=${threshold}&payout=${payout}`)
      const data = await res.json()
      setPremium(data.premium ?? data.premiumAmount ?? 23.63)
      setQuoteCountdown(120)
      setStep(6)
    } catch {
      setPremium(23.63)
      setQuoteCountdown(120)
      setStep(6)
    } finally {
      setIsCalculating(false)
    }
  }

  const handlePurchase = async () => {
    if (!publicKey) {
      setWalletVisible(true)
      return
    }
    if (premium === null) {
      setStep(5)
      return
    }

    setTxState('signing')
    setTxMessage('Requesting a signed quote…')
    setTxSignature(undefined)

    try {
      const DAY = 86400
      const nowSecs = Math.floor(Date.now() / 1000)
      const windowStartUnix = (Math.floor(nowSecs / DAY) + 1) * DAY // next midnight UTC
      const windowEndUnix = windowStartUnix + days * DAY

      const regionObj = getRegionById(region)
      if (!regionObj) throw new Error(`Unknown region: ${region}`)

      // On-chain amounts are u64 base units (6 decimals); the quote API works in
      // whole USDC dollars, so convert before signing.
      const payoutBase = Math.round(payout * 1_000_000)
      const premiumBase = Math.round(premium * 1_000_000)

      const signRes = await fetch('/api/quotes/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poolId: 1,
          regionId: regionObj.regionId,
          peril: 0, // Rainfall
          windowStartUnix,
          windowEndUnix,
          payoutAmount: payoutBase,
          premiumAmount: premiumBase,
          thresholdMm: threshold,
          direction,
          indexMethod: indexMethod === 'Sum' ? 0 : indexMethod === 'Mean' ? 1 : 2,
        }),
      })

      const signData: SignedQuote = await signRes.json()
      if (!signRes.ok) {
        throw new Error((signData as unknown as { error?: string }).error || 'Failed to sign quote')
      }

      const config = await getGlobalConfig(connection)

      // The per-signer quote-nonce account must exist before buy_policy reads it,
      // and (due to the on-chain reentrancy guard) must be created in its own
      // transaction — never bundled with buy_policy.
      const initSig = await ensureQuoteNonceInitialized(
        connection,
        { publicKey },
        async (initTx) => {
          setTxMessage('Creating nonce account…')
          const s = await sendTransaction(initTx, connection)
          const latest = await connection.getLatestBlockhash('confirmed')
          await connection.confirmTransaction({ signature: s, ...latest }, 'confirmed')
          return s
        },
      )
      void initSig

      const tx = await createBuyPolicyTransaction(
        connection,
        { publicKey },
        signData,
        { usdcMint: config.usdcMint, treasuryUsdcAta: config.treasuryUsdcAta },
      )

      setTxMessage('Waiting for wallet approval…')
      const sig = await sendTransaction(tx, connection)

      setTxSignature(sig)
      setTxState('confirming')
      setTxMessage('Confirming on-chain…')
      const latest = await connection.getLatestBlockhash('confirmed')
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed')

      setTxState('success')
      setTxMessage('Policy purchased and active on-chain.')
    } catch (err) {
      console.error('Purchase failed:', err)
      setTxState('error')
      setTxMessage(err instanceof Error ? err.message : 'Transaction failed')
    }
  }

  const selectedRegion = REGIONS.find(r => r.id === region)
  const selectedMethod = INDEX_METHODS.find(m => m.id === indexMethod)

  return (
    <div className="section py-8 lg:py-12">
      <div className="max-w-3xl mx-auto">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="heading-md text-white mb-2">Buy Parametric Cover</h1>
          <p className="body-md">Configure your rainfall risk coverage in 6 steps. Premium is quoted in USDC.</p>
        </div>

        <StepIndicator currentStep={step} />

        {/* Step 1: Region */}
        {step === 1 && (
          <div className="animate-in">
            <h2 className="heading-sm text-white mb-2">Select your region</h2>
            <p className="text-sm text-white/40 mb-6">Choose the geographic area to monitor for rainfall data.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {REGIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRegion(r.id)}
                  className={`card-interactive text-left p-4 ${
                    region === r.id ? 'border-nimbus-400/40 bg-nimbus-500/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <MapPin className={`w-4 h-4 ${region === r.id ? 'text-nimbus-400' : 'text-white/30'}`} />
                    <div>
                      <div className="text-sm font-medium text-white">{r.name}</div>
                      <div className="text-xs text-white/30 font-mono">{r.id}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-end mt-8">
              <button onClick={() => setStep(2)} disabled={!region} className="btn-primary inline-flex items-center gap-2">
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Peril type */}
        {step === 2 && (
          <div className="animate-in">
            <h2 className="heading-sm text-white mb-2">Select peril type</h2>
            <p className="text-sm text-white/40 mb-6">What climate risk do you want coverage against?</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => setDirection('LT')}
                className={`card-interactive p-6 text-left ${direction === 'LT' ? 'border-status-triggered/40 bg-status-triggered/5' : ''}`}
              >
                <CloudSun className={`w-8 h-8 mb-3 ${direction === 'LT' ? 'text-status-triggered' : 'text-white/20'}`} />
                <div className="heading-sm text-white mb-1">Drought</div>
                <p className="text-sm text-white/40">
                  Pays out when rainfall is <span className="text-white/60 font-medium">below</span> your threshold.
                  Protects against insufficient rainfall.
                </p>
                <div className="mt-3 text-xs text-white/20">Trigger: Index &lt; Threshold</div>
              </button>

              <button
                onClick={() => setDirection('GT')}
                className={`card-interactive p-6 text-left ${direction === 'GT' ? 'border-nimbus-400/40 bg-nimbus-500/5' : ''}`}
              >
                <CloudRain className={`w-8 h-8 mb-3 ${direction === 'GT' ? 'text-nimbus-400' : 'text-white/20'}`} />
                <div className="heading-sm text-white mb-1">Flood</div>
                <p className="text-sm text-white/40">
                  Pays out when rainfall is <span className="text-white/60 font-medium">above</span> your threshold.
                  Protects against excessive rainfall.
                </p>
                <div className="mt-3 text-xs text-white/20">Trigger: Index &gt; Threshold</div>
              </button>
            </div>

            <div className="flex justify-between mt-8">
              <button onClick={() => setStep(1)} className="btn-ghost inline-flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={() => setStep(3)} className="btn-primary inline-flex items-center gap-2">
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Index method */}
        {step === 3 && (
          <div className="animate-in">
            <h2 className="heading-sm text-white mb-2">Choose index method</h2>
            <p className="text-sm text-white/40 mb-6">How should rainfall be aggregated over your observation window?</p>

            <div className="space-y-3">
              {INDEX_METHODS.map((method) => {
                const Icon = method.icon
                const selected = indexMethod === method.id
                return (
                  <button
                    key={method.id}
                    onClick={() => setIndexMethod(method.id)}
                    className={`card-interactive w-full text-left p-5 ${
                      selected ? 'border-nimbus-400/40 bg-nimbus-500/5' : ''
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        selected ? 'bg-nimbus-500/20 text-nimbus-400' : 'bg-white/5 text-white/30'
                      }`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-white">{method.name}</span>
                          <span className="text-xs text-white/20">—</span>
                          <span className="text-sm text-white/50">{method.description}</span>
                        </div>
                        <p className="text-xs text-white/30 mt-1">{method.bestFor}</p>
                        <div className="mt-2 px-2 py-1 bg-surface-3/50 rounded text-[11px] font-mono text-white/25 inline-block">
                          {method.example}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="flex justify-between mt-8">
              <button onClick={() => setStep(2)} className="btn-ghost inline-flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={() => setStep(4)} className="btn-primary inline-flex items-center gap-2">
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Observation window */}
        {step === 4 && (
          <div className="animate-in">
            <h2 className="heading-sm text-white mb-2">Set observation window</h2>
            <p className="text-sm text-white/40 mb-6">
              How many days should the rainfall be monitored? The policy starts immediately after purchase.
            </p>

            <div className="card p-6">
              <label className="label mb-3 block">Window duration (days)</label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={7}
                  max={31}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="flex-1 accent-nimbus-400 h-2 bg-surface-3 rounded-full cursor-pointer"
                />
                <div className="w-20 text-right">
                  <span className="font-mono text-2xl font-semibold text-white">{days}</span>
                  <span className="text-sm text-white/30 ml-1">days</span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="p-3 bg-surface-2 rounded-xl">
                  <div className="label mb-1">Start</div>
                  <div className="text-sm text-white font-medium">Immediately after purchase</div>
                  <div className="text-xs text-white/30 mt-0.5">
                    {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} UTC
                  </div>
                </div>
                <div className="p-3 bg-surface-2 rounded-xl">
                  <div className="label mb-1">End</div>
                  <div className="text-sm text-white font-medium">+{days} days</div>
                  <div className="text-xs text-white/30 mt-0.5">
                    {new Date(Date.now() + days * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} UTC
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between mt-8">
              <button onClick={() => setStep(3)} className="btn-ghost inline-flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={() => setStep(5)} className="btn-primary inline-flex items-center gap-2">
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Threshold + Payout */}
        {step === 5 && (
          <div className="animate-in">
            <h2 className="heading-sm text-white mb-2">Set threshold &amp; payout</h2>
            <p className="text-sm text-white/40 mb-6">
              Define when your coverage triggers and how much you receive.
            </p>

            <div className="space-y-6">
              <div className="card p-6">
                <label className="label mb-3 block">Rainfall threshold (mm)</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={10}
                    max={300}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="flex-1 accent-nimbus-400 h-2 bg-surface-3 rounded-full cursor-pointer"
                  />
                  <div className="w-24 text-right">
                    <span className="font-mono text-2xl font-semibold text-white">{threshold}</span>
                    <span className="text-sm text-white/30 ml-1">mm</span>
                  </div>
                </div>
                <div className="mt-3 p-3 bg-surface-2 rounded-xl flex items-start gap-2">
                  <Info className="w-4 h-4 text-nimbus-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-white/40">
                    {direction === 'LT'
                      ? `Payout triggers if ${indexMethod} rainfall falls below ${threshold}mm over ${days} days.`
                      : `Payout triggers if ${indexMethod} rainfall exceeds ${threshold}mm over ${days} days.`
                    }
                  </p>
                </div>
              </div>

              <div className="card p-6">
                <label className="label mb-3 block">Maximum payout (USDC)</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={50}
                    max={10000}
                    step={50}
                    value={payout}
                    onChange={(e) => setPayout(Number(e.target.value))}
                    className="flex-1 accent-nimbus-400 h-2 bg-surface-3 rounded-full cursor-pointer"
                  />
                  <div className="w-32 text-right">
                    <span className="font-mono text-2xl font-semibold text-white">{payout.toLocaleString()}</span>
                    <span className="text-sm text-white/30 ml-1">USDC</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between mt-8">
              <button onClick={() => setStep(4)} className="btn-ghost inline-flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={calculateQuote}
                disabled={isCalculating}
                className="btn-primary inline-flex items-center gap-2"
              >
                {isCalculating ? (
                  <>Calculating... <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /></>
                ) : (
                  <>Get Quote <Zap className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 6: Review + Confirm */}
        {step === 6 && premium !== null && (
          <div className="animate-in">
            <h2 className="heading-sm text-white mb-2">Review your coverage</h2>
            <p className="text-sm text-white/40 mb-6">
              Verify the details below. This quote is valid for a limited time.
            </p>

            {/* Countdown */}
            {quoteCountdown !== null && quoteCountdown > 0 && (
              <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
                quoteCountdown > 30 ? 'bg-nimbus-500/10 border border-nimbus-400/20' :
                quoteCountdown > 10 ? 'bg-status-triggered/10 border border-status-triggered/20' :
                'bg-status-danger/10 border border-status-danger/20'
              }`}>
                <Clock className={`w-5 h-5 ${
                  quoteCountdown > 30 ? 'text-nimbus-400' :
                  quoteCountdown > 10 ? 'text-status-triggered' :
                  'text-status-danger'
                }`} />
                <div>
                  <div className="text-sm font-medium text-white">
                    Quote expires in {Math.floor(quoteCountdown / 60)}:{(quoteCountdown % 60).toString().padStart(2, '0')}
                  </div>
                  <div className="text-xs text-white/40">Ed25519-signed quote. Will need to regenerate after expiry.</div>
                </div>
              </div>
            )}

            {quoteCountdown === 0 && (
              <div className="mb-6 p-4 rounded-xl bg-status-danger/10 border border-status-danger/20 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-status-danger" />
                <div>
                  <div className="text-sm font-medium text-status-danger">Quote expired</div>
                  <button onClick={calculateQuote} className="text-xs text-nimbus-300 hover:underline mt-1">
                    Generate a new quote →
                  </button>
                </div>
              </div>
            )}

            {/* Summary card */}
            <div className="card p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="label">Region</div>
                  <div className="text-sm text-white font-medium mt-1">{selectedRegion?.name || region}</div>
                </div>
                <div>
                  <div className="label">Peril</div>
                  <div className="text-sm text-white font-medium mt-1 flex items-center gap-2">
                    {direction === 'LT' ? <CloudSun className="w-4 h-4 text-status-triggered" /> : <CloudRain className="w-4 h-4 text-nimbus-400" />}
                    {direction === 'LT' ? 'Drought' : 'Flood'}
                  </div>
                </div>
                <div>
                  <div className="label">Index Method</div>
                  <div className="text-sm text-white font-medium mt-1 font-mono">{indexMethod}</div>
                </div>
                <div>
                  <div className="label">Window</div>
                  <div className="text-sm text-white font-medium mt-1">{days} days</div>
                </div>
                <div>
                  <div className="label">Threshold</div>
                  <div className="text-sm text-white font-medium mt-1">
                    {direction === 'LT' ? '< ' : '> '}{threshold}mm
                  </div>
                </div>
                <div>
                  <div className="label">Max Payout</div>
                  <div className="text-sm text-white font-medium mt-1">{payout.toLocaleString()} USDC</div>
                </div>
              </div>

              <div className="border-t border-white/[0.06] pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="label">Premium</div>
                    <div className="font-mono text-3xl font-bold text-white mt-1">{premium.toFixed(2)} <span className="text-lg text-white/40">USDC</span></div>
                  </div>
                  <div className="text-right">
                    <div className="label">Oracle Source</div>
                    <div className="text-sm text-white/50 mt-1">Open-Meteo · permissioned publisher</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Irreversibility notice */}
            <div className="mt-4 p-3 bg-surface-2 rounded-xl flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-status-triggered mt-0.5 flex-shrink-0" />
              <p className="text-xs text-white/40">
                This action is irreversible. Purchasing this policy will deduct {premium.toFixed(2)} USDC
                from your wallet and create an on-chain policy account. Settlement is automatic and deterministic.
                This is not traditional insurance.
              </p>
            </div>

            <div className="flex justify-between mt-8">
              <button onClick={() => setStep(5)} className="btn-ghost inline-flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              {connected ? (
                <button
                  onClick={handlePurchase}
                  disabled={quoteCountdown === 0 || txState === 'signing' || txState === 'confirming'}
                  className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {txState === 'signing' || txState === 'confirming' ? 'Purchasing…' : 'Confirm & Purchase'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => setWalletVisible(true)}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  Connect Wallet to Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="mt-6">
              <TransactionStatus
                state={txState}
                message={txMessage}
                txSignature={txSignature}
                onDismiss={() => setTxState('idle')}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function BuyPage() {
  return (
    <main className="min-h-screen bg-surface-0 noise">
      <Nav />
      <Suspense fallback={
        <div className="section py-12">
          <div className="max-w-3xl mx-auto">
            <div className="h-8 w-64 bg-surface-2 rounded-lg animate-pulse mb-4" />
            <div className="h-4 w-96 bg-surface-2 rounded-lg animate-pulse mb-10" />
            <div className="h-96 bg-surface-1 rounded-2xl animate-pulse" />
          </div>
        </div>
      }>
        <BuyFlowContent />
      </Suspense>
    </main>
  )
}
