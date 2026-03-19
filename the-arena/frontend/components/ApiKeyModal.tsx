'use client'

/**
 * ApiKeyModal
 *
 * Shown when a user tries to start a debate that requires API keys
 * (custom topic or non-suggested guest pairing).
 *
 * Keys are sent to the backend, which returns a short-lived token.
 * The token is stored in component state only — never in localStorage,
 * cookies, or any persistent store.
 */

import { useState } from 'react'
import { registerApiKeys } from '../lib/api'

interface Props {
  onToken: (token: string) => void
  onClose: () => void
}

export default function ApiKeyModal({ onToken, onClose }: Props) {
  const [anthropicKey, setAnthropicKey] = useState('')
  const [elevenLabsKey, setElevenLabsKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!anthropicKey.trim()) {
      setError('Anthropic API key is required to generate debate content.')
      return
    }

    setLoading(true)
    try {
      const { token } = await registerApiKeys(
        anthropicKey.trim() || undefined,
        elevenLabsKey.trim() || undefined
      )
      onToken(token)
    } catch (err: any) {
      setError(err?.message || 'Failed to register keys. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-2xl p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-white font-bold text-lg">API keys required</h2>
            <p className="text-neutral-400 text-sm mt-0.5">
              Custom debates use your own keys — nothing is stored.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-white transition text-xl leading-none ml-4 mt-0.5"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Security notice */}
        <div className="mb-5 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 text-xs text-amber-300 space-y-1.5">
          <p className="font-semibold">🔒 Your privacy is protected:</p>
          <ul className="space-y-1 text-amber-400/80 list-none">
            <li>• Keys live in server memory for 1 hour, then deleted</li>
            <li>• Keys are never logged, stored, or sent to third parties</li>
            <li>• We strongly recommend invalidating these keys after your session</li>
          </ul>
          <p className="pt-1 text-amber-300/70">
            You can rotate your keys at:{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-amber-200"
            >
              console.anthropic.com
            </a>
            {' '}·{' '}
            <a
              href="https://elevenlabs.io/app/settings/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-amber-200"
            >
              elevenlabs.io
            </a>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Anthropic key */}
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Anthropic API key <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              value={anthropicKey}
              onChange={e => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-neutral-600 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition"
            />
            <p className="mt-1 text-xs text-neutral-600">
              Required for LLM debate generation.
            </p>
          </div>

          {/* ElevenLabs key */}
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              ElevenLabs API key <span className="text-neutral-600">(optional)</span>
            </label>
            <input
              type="password"
              value={elevenLabsKey}
              onChange={e => setElevenLabsKey(e.target.value)}
              placeholder="sk_..."
              autoComplete="off"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-neutral-600 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition"
            />
            <p className="mt-1 text-xs text-neutral-600">
              Required for voice synthesis. Leave blank for text-only mode.
            </p>
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium rounded-lg transition text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !anthropicKey.trim()}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-neutral-700 disabled:text-neutral-500 text-black font-semibold rounded-lg transition text-sm"
            >
              {loading ? 'Connecting…' : 'Start debate →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
