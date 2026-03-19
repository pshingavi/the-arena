'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), ownerCode: ownerCode.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        return
      }

      // Success — redirect to the page they came from
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
      {/* Logo area */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-3 mb-3">
          <span className="text-3xl font-black tracking-tight text-white">THE</span>
          <span className="px-3 py-1 rounded bg-amber-500 text-black text-3xl font-black tracking-tight">
            ARENA
          </span>
        </div>
        <p className="text-neutral-400 text-sm">AI-powered podcast debates with your favourite tech leaders</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-2xl p-8">
        <h1 className="text-xl font-bold text-white mb-1">Get access</h1>
        <p className="text-neutral-400 text-sm mb-6">
          Enter your email to watch hot-topic debates for free. Custom topics require your own API keys.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
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
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition"
              />
              <p className="mt-1 text-xs text-neutral-500">
                Full access — no API keys needed.
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
            disabled={loading || !email}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-neutral-700 disabled:text-neutral-500 text-black font-semibold rounded-lg transition text-sm"
          >
            {loading ? 'Signing in…' : 'Continue →'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-neutral-600">
          By continuing you agree to receive occasional product updates.
          No spam. Unsubscribe any time.
        </p>
      </div>

      {/* Feature list */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-sm w-full text-xs text-neutral-500">
        {[
          { icon: '🎙️', label: 'Hot debates — free' },
          { icon: '🔑', label: 'Custom topics with your keys' },
          { icon: '🔒', label: 'Keys never stored' },
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
