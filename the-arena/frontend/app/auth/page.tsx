'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Play } from 'lucide-react'
import { getSuggestedTopics } from '@/lib/api'
import { SuggestedTopic } from '@/lib/types'

function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') || '/arena'

  const [email, setEmail] = useState('')
  const [ownerCode, setOwnerCode] = useState('')
  const [showOwnerCode, setShowOwnerCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [firstHotTopic, setFirstHotTopic] = useState<SuggestedTopic | null>(null)

  // Load a hot topic to link the "watch free" button to a real debate
  useEffect(() => {
    getSuggestedTopics()
      .then(topics => {
        const valid = topics.find(t => t.available_guests.length >= 2)
        if (valid) setFirstHotTopic(valid)
      })
      .catch(() => {})
  }, [])

  // If already logged in, redirect immediately
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.email) router.replace(from)
        else setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [from, router])

  // Code-only is valid if code field is shown and non-empty
  const codeOnly = showOwnerCode && ownerCode.trim() && !email.trim()
  const canSubmit = codeOnly || email.trim().length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim() || undefined,
          ownerCode: ownerCode.trim() || undefined,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        return
      }

      router.replace(from)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-3 mb-3">
          <span className="text-3xl font-black tracking-tight text-white">THE</span>
          <span className="px-3 py-1 rounded bg-amber-500 text-black text-3xl font-black tracking-tight">
            ARENA
          </span>
        </div>
        <p className="text-neutral-400 text-sm">AI-powered debates with your favourite tech leaders</p>
      </div>

      {/* Free watch callout — links to a real debate, not just the setup page */}
      <button
        onClick={() => {
          if (firstHotTopic) {
            const params = new URLSearchParams({
              topic: firstHotTopic.title,
              guest1: firstHotTopic.available_guests[0] || '',
              guest2: firstHotTopic.available_guests[1] || '',
              autostart: '1',
            })
            router.push(`/arena?${params.toString()}`)
          } else {
            router.push('/')
          }
        }}
        className="w-full max-w-sm flex items-center justify-between px-4 py-3 rounded-xl border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/15 transition mb-4"
      >
        <div className="text-left">
          <div className="text-sm font-semibold text-orange-400">🔥 Hot debates are free</div>
          <div className="text-xs text-neutral-400">
            {firstHotTopic
              ? `Watch: ${firstHotTopic.available_guests[0]?.split(' ')[0]} vs ${firstHotTopic.available_guests[1]?.split(' ')[0]} — no account needed`
              : 'No account needed — watch now'}
          </div>
        </div>
        <Play className="w-4 h-4 text-orange-400 flex-shrink-0" />
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 w-full max-w-sm mb-4">
        <div className="flex-1 h-px bg-neutral-800" />
        <span className="text-xs text-neutral-600">or sign up for custom debates</span>
        <div className="flex-1 h-px bg-neutral-800" />
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-2xl p-8">
        <h1 className="text-xl font-bold text-white mb-1">Get access</h1>
        <p className="text-neutral-400 text-sm mb-6">
          {showOwnerCode && ownerCode && !email
            ? 'Enter your access code to get full owner access.'
            : 'Sign up with your email to pick custom topics and guests.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5" htmlFor="email">
              Email address {codeOnly && <span className="text-neutral-600">(optional with a code)</span>}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus={!showOwnerCode}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition"
            />
          </div>

          {/* Owner code toggle */}
          {!showOwnerCode ? (
            <button
              type="button"
              onClick={() => setShowOwnerCode(true)}
              className="text-xs text-neutral-500 hover:text-neutral-300 transition"
            >
              I have an access code →
            </button>
          ) : (
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5" htmlFor="code">
                Access code
              </label>
              <input
                id="code"
                type="text"
                value={ownerCode}
                onChange={e => setOwnerCode(e.target.value)}
                placeholder="Enter code"
                autoFocus
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition"
              />
              <p className="mt-1 text-xs text-neutral-500">
                Full owner access — no API keys needed.
              </p>
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-neutral-700 disabled:text-neutral-500 text-black font-semibold rounded-lg transition text-sm"
          >
            {loading ? 'Signing in…' : codeOnly ? 'Enter with code →' : 'Continue →'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-neutral-600">
          By continuing you agree to receive occasional product updates.
          No spam. Unsubscribe any time.
        </p>
      </div>

      {/* Feature hints */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-sm w-full text-xs text-neutral-500">
        {[
          { icon: '🎙️', label: 'Hot debates — always free' },
          { icon: '✏️', label: 'Custom topics with sign-up' },
          { icon: '🔒', label: 'API keys never stored' },
        ].map(f => (
          <div key={f.label} className="flex items-center gap-2">
            <span>{f.icon}</span>
            <span>{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  )
}
