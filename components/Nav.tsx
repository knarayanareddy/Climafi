'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useEffect, useState } from 'react'
import { Cloud, Menu, X, Droplets, Shield, BarChart3, Scale, Vote } from 'lucide-react'

const NAV_LINKS = [
  { href: '/buy', label: 'Buy Cover', icon: Shield },
  { href: '/portfolio', label: 'Portfolio', icon: BarChart3 },
  { href: '/pools', label: 'Underwrite', icon: Droplets },
  { href: '/settle', label: 'Settle', icon: Scale },
  { href: '/governance', label: 'Governance', icon: Vote },
]

export default function Nav() {
  const pathname = usePathname()
  const { publicKey, connected } = useWallet()
  const { connection } = useConnection()
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!publicKey || !connected) {
      setUsdcBalance(null)
      return
    }

    const fetchBalance = async () => {
      try {
        const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: new (await import('@solana/web3.js')).PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        })
        const usdcAccount = tokenAccounts.value.find(
          (ta) => ta.account.data.parsed.info.mint === usdcMint
        )
        if (usdcAccount) {
          setUsdcBalance(usdcAccount.account.data.parsed.info.tokenAmount.uiAmount)
        } else {
          setUsdcBalance(0)
        }
      } catch {
        setUsdcBalance(null)
      }
    }

    fetchBalance()
    const interval = setInterval(fetchBalance, 15_000)
    return () => clearInterval(interval)
  }, [publicKey, connected, connection])

  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.04] bg-surface-0/80 backdrop-blur-2xl" role="navigation" aria-label="Main navigation">
      <div className="section py-4 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group" aria-label="Nimbus Home">
          <div className="relative w-9 h-9 bg-gradient-to-br from-nimbus-400 to-accent-cyan rounded-xl flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-all duration-300 group-hover:scale-105">
            <Cloud className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
          <span className="font-display font-bold text-xl tracking-tight text-white">
            Nimbus
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden lg:flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 text-sm rounded-lg transition-all duration-200 ${
                  active
                    ? 'bg-nimbus-500/10 text-nimbus-300 font-medium border border-nimbus-400/20'
                    : 'text-white/50 hover:text-white hover:bg-white/[0.04]'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                {link.label}
              </Link>
            )
          })}
        </div>

        {/* Wallet area */}
        <div className="flex items-center gap-3">
          {connected && usdcBalance !== null && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-surface-2 border border-white/[0.06] rounded-xl" aria-label={`USDC balance: ${usdcBalance.toFixed(2)}`}>
              <span className="text-[10px] font-medium text-white/40 uppercase tracking-wider">USDC</span>
              <span className="text-sm font-mono font-medium text-white tabular-nums">
                {usdcBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          <WalletMultiButton />

          {/* Mobile menu button */}
          <button
            className="lg:hidden p-2 text-white/50 hover:text-white rounded-lg hover:bg-white/[0.04] transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-white/[0.04] px-4 py-4 space-y-1 animate-in bg-surface-0/95 backdrop-blur-2xl">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href
            const Icon = link.icon
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all ${
                  active
                    ? 'bg-nimbus-500/10 text-nimbus-300 border border-nimbus-400/20'
                    : 'text-white/50 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {link.label}
              </Link>
            )
          })}
        </div>
      )}
    </nav>
  )
}
