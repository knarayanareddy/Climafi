'use client'

import Link from 'next/link'
import Nav from '../components/Nav'
import { Cloud, Zap, Shield, BarChart3, Droplets, ArrowRight, CheckCircle2, Database, Lock, Timer, Vote } from 'lucide-react'

function RainParticles() {
  // Deterministic pseudo-random (seeded) so SSR + hydration render identical
  // particle positions — avoids React hydration mismatch warnings and prevents
  // the particles from re-randomizing on every client render.
  let seed = 0x9e3779b9
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const particles = Array.from({ length: 40 }, () => {
    const duration = 1.5 + rand() * 2
    return {
      left: rand() * 100,
      top: rand() * 100,
      height: 20 + rand() * 40,
      delay: rand() * 3,
      duration,
      opacity: 0.3 + rand() * 0.4,
    }
  })

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute w-px bg-gradient-to-b from-transparent via-nimbus-400/20 to-transparent"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            height: `${p.height}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            animation: `rain ${p.duration}s linear infinite`,
            opacity: p.opacity,
          }}
        />
      ))}
    </div>
  )
}

function HeroSection() {
  return (
    <section className="relative min-h-[90vh] flex items-center overflow-hidden">
      {/* Atmospheric background */}
      <div className="absolute inset-0 bg-gradient-nimbus" />
      <div className="absolute inset-0 bg-gradient-radial from-nimbus-500/[0.07] via-transparent to-transparent" />
      <RainParticles />

      {/* Glow orb */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-nimbus-500/[0.04] rounded-full blur-[120px]" />

      <div className="section relative z-10 py-24 lg:py-32">
        <div className="max-w-4xl">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-nimbus-500/10 border border-nimbus-400/20 rounded-full mb-8 animate-fade-in">
            <div className="w-1.5 h-1.5 bg-nimbus-400 rounded-full animate-pulse-soft" />
            <span className="text-xs font-medium text-nimbus-300">Parametric Cover on Solana</span>
          </div>

          {/* Headline */}
          <h1 className="heading-xl text-white mb-6 animate-slide-up">
            Weather data crosses threshold.{' '}
            <span className="text-gradient">USDC hits your wallet.</span>
          </h1>

          {/* Subheadline */}
          <p className="body-lg max-w-2xl mb-10 animate-slide-up" style={{ animationDelay: '100ms' }}>
            Nimbus is deterministic parametric climate coverage on Solana.
            Oracle-verified rainfall indices trigger automatic payouts.
            No claims process. No adjusters. No waiting.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 animate-slide-up" style={{ animationDelay: '200ms' }}>
            <Link href="/buy" className="btn-primary inline-flex items-center justify-center gap-2 text-base">
              <Shield className="w-4 h-4" />
              Buy Cover
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/pools" className="btn-secondary inline-flex items-center justify-center gap-2 text-base">
              <Droplets className="w-4 h-4" />
              View Pools
            </Link>
          </div>

          {/* Trust line */}
          <div className="flex flex-wrap items-center gap-6 mt-12 animate-slide-up" style={{ animationDelay: '300ms' }}>
            <div className="flex items-center gap-2 text-sm text-white/40">
              <CheckCircle2 className="w-4 h-4 text-nimbus-400" />
              USDC settlements
            </div>
            <div className="flex items-center gap-2 text-sm text-white/40">
              <CheckCircle2 className="w-4 h-4 text-nimbus-400" />
              Deterministic payouts
            </div>
            <div className="flex items-center gap-2 text-sm text-white/40">
              <CheckCircle2 className="w-4 h-4 text-nimbus-400" />
              Oracle-verified indices
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function HowItWorksSection() {
  const steps = [
    {
      number: '01',
      title: 'Choose your coverage',
      description: 'Select a region, peril type (drought or flood), observation window, and payout amount.',
      icon: Shield,
    },
    {
      number: '02',
      title: 'Get a signed quote',
      description: 'Our oracle system calculates your premium based on historical risk data. Quote is Ed25519-signed and valid for 120 seconds.',
      icon: Timer,
    },
    {
      number: '03',
      title: 'Policy mints on-chain',
      description: 'Your premium is paid in USDC. A policy account is created on Solana with your exact trigger conditions.',
      icon: Database,
    },
    {
      number: '04',
      title: 'Automatic settlement',
      description: 'When the observation window ends, the oracle index is checked against your threshold. If triggered, USDC is sent to your wallet automatically.',
      icon: Zap,
    },
  ]

  return (
    <section className="relative py-24 lg:py-32">
      <div className="section">
        <div className="text-center mb-16">
          <h2 className="heading-lg text-white mb-4">
            How Nimbus works
          </h2>
          <p className="body-lg max-w-2xl mx-auto">
            Four steps from coverage selection to automatic payout.
            No claims. No human decision. Pure data.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, i) => (
            <div key={step.number} className="card group" style={{ animationDelay: `${i * 100}ms` }}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs font-mono text-nimbus-400/60">{step.number}</span>
                <div className="w-10 h-10 bg-nimbus-500/10 border border-nimbus-400/20 rounded-xl flex items-center justify-center group-hover:bg-nimbus-500/20 transition-colors">
                  <step.icon className="w-5 h-5 text-nimbus-400" />
                </div>
              </div>
              <h3 className="heading-sm text-white mb-2">{step.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function MechanicsVisualization() {
  return (
    <section className="relative py-24 lg:py-32 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-nimbus-950/30 to-transparent" />
      <div className="section relative z-10">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Explanation */}
          <div>
            <span className="label text-nimbus-400 mb-4 block">Parametric Mechanics</span>
            <h2 className="heading-lg text-white mb-6">
              Index crosses threshold.<br />
              <span className="text-gradient">Payout is automatic.</span>
            </h2>
            <p className="body-md mb-8">
              Unlike traditional insurance, Nimbus uses objective weather data indices.
              Choose how rainfall is measured over your observation window:
            </p>

            <div className="space-y-4">
              {[
                { method: 'Sum', desc: 'Total accumulated rainfall over the entire window', example: 'Best for drought — did the region receive enough total rain?' },
                { method: 'Mean', desc: 'Average daily rainfall across the window', example: 'Best for sustained dry/wet spells — was it consistently too dry?' },
                { method: 'Max', desc: 'Single highest-rainfall day within the window', example: 'Best for flash floods — did any single day exceed safe levels?' },
              ].map((item) => (
                <div key={item.method} className="card-glass p-4">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-mono text-sm font-semibold text-nimbus-300">{item.method}</span>
                    <span className="text-xs text-white/30">—</span>
                    <span className="text-sm text-white/60">{item.desc}</span>
                  </div>
                  <p className="text-xs text-white/30 ml-0">{item.example}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Visual: Threshold chart (illustrative example) */}
          <div className="card p-8">
            <div className="flex items-center justify-between mb-6">
              <span className="label">Rainfall Index — Nairobi (KEN-NRB-001)</span>
              <span className="badge-muted">
                <span className="w-1.5 h-1.5 bg-white/40 rounded-full" />
                Illustrative
              </span>
            </div>

            {/* Chart visualization */}
            <div className="relative h-48 mb-6">
              {/* Threshold line */}
              <div className="absolute left-0 right-0 top-[40%] border-t border-dashed border-status-triggered/40">
                <span className="absolute -top-5 right-0 text-[10px] font-mono text-status-triggered/70">Threshold: 80mm</span>
              </div>

              {/* Simulated bar chart */}
              <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-1.5 h-full pt-8">
                {[35, 42, 28, 55, 62, 48, 72, 88, 95, 78, 65, 52, 45, 38].map((val, i) => (
                  <div
                    key={i}
                    className={`flex-1 rounded-t transition-all duration-300 ${
                      val > 80 ? 'bg-status-triggered/60 border border-status-triggered/30' : 'bg-nimbus-500/30 border border-nimbus-400/10'
                    }`}
                    style={{ height: `${(val / 100) * 100}%` }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-white/30">
              <span>Day 1</span>
              <span>Day 14</span>
            </div>

            <div className="mt-4 p-3 bg-status-triggered/5 border border-status-triggered/20 rounded-xl">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-status-triggered" />
                <span className="text-sm text-status-triggered font-medium">Trigger detected</span>
              </div>
              <p className="text-xs text-white/40 mt-1">Max index (95mm) exceeded threshold (80mm) on Day 9. Payout: 500 USDC</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function TrustSection() {
  const stats = [
    { value: '83', label: 'On-chain safety checks', icon: Lock },
    { value: 'Ed25519', label: 'Quote signature verification', icon: Shield },
    { value: 'M-of-N', label: 'Multisig governance', icon: Vote },
    { value: 'Auto', label: 'Deterministic settlement', icon: Zap },
  ]

  const features = [
    { name: 'Oracle-verified rainfall', desc: 'Daily Open-Meteo data, validated on-chain at settlement' },
    { name: 'OWASP Hardened', desc: 'Full security audit with validated deserialization' },
    { name: 'USDC Native', desc: 'All premiums and payouts in stablecoin' },
    { name: 'Open Source', desc: 'Fully verifiable on-chain program code' },
  ]

  return (
    <section className="relative py-24 lg:py-32">
      <div className="section">
        <div className="text-center mb-16">
          <h2 className="heading-lg text-white mb-4">
            Built for trust
          </h2>
          <p className="body-lg max-w-2xl mx-auto">
            Every design decision prioritizes verifiability.
            Every data point is traceable to its oracle source.
          </p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {stats.map((stat) => (
            <div key={stat.label} className="card text-center py-8">
              <stat.icon className="w-5 h-5 text-nimbus-400 mx-auto mb-3" />
              <div className="data-value text-nimbus-300">{stat.value}</div>
              <div className="data-label">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map((feature) => (
            <div key={feature.name} className="flex items-start gap-3 p-4 rounded-xl bg-surface-1/50 border border-white/[0.03]">
              <CheckCircle2 className="w-4 h-4 text-nimbus-400 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-white">{feature.name}</div>
                <div className="text-xs text-white/40 mt-0.5">{feature.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function CTASection() {
  return (
    <section className="relative py-24 lg:py-32">
      <div className="section">
        <div className="card p-12 lg:p-16 text-center relative overflow-hidden">
          {/* Background glow */}
          <div className="absolute inset-0 bg-gradient-radial from-nimbus-500/[0.05] via-transparent to-transparent" />

          <div className="relative z-10">
            <Cloud className="w-12 h-12 text-nimbus-400 mx-auto mb-6 animate-float" />
            <h2 className="heading-lg text-white mb-4">
              Ready to protect against climate risk?
            </h2>
            <p className="body-lg max-w-xl mx-auto mb-8">
              Coverage from as little as 5 USDC. Payouts within seconds of trigger.
              Connect your Phantom, Backpack, or Solflare wallet to begin.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/buy" className="btn-primary inline-flex items-center justify-center gap-2 text-base">
                Get Coverage Now
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/pools" className="btn-secondary inline-flex items-center justify-center gap-2 text-base">
                Explore Pools
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.04] py-12">
      <div className="section">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-nimbus-400 to-accent-cyan rounded-xl flex items-center justify-center">
              <Cloud className="w-4 h-4 text-white" />
            </div>
            <span className="font-display font-semibold text-white/60">Nimbus Protocol</span>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6 text-sm text-white/30">
            <a href="https://github.com/knarayanareddy/Nimbus" target="_blank" rel="noopener noreferrer" className="hover:text-white/60 transition-colors">
              GitHub
            </a>
            <Link href="/governance" className="hover:text-white/60 transition-colors">
              Governance
            </Link>
            <span>Solana</span>
          </div>

          {/* Legal */}
          <p className="text-xs text-white/20">
            Nimbus provides parametric risk coverage, not traditional insurance.
          </p>
        </div>
      </div>
    </footer>
  )
}

export default function HomePage() {
  return (
    <main className="relative noise">
      <Nav />
      <HeroSection />
      <HowItWorksSection />
      <MechanicsVisualization />
      <TrustSection />
      <CTASection />
      <Footer />
    </main>
  )
}
