'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSuggestedTopics, getGuests } from '@/lib/api'
import { SuggestedTopic, Guest } from '@/lib/types'
import { Mic2, Zap, Users, ArrowRight, Pencil } from 'lucide-react'
import { useBackendReady } from '@/lib/useBackendReady'

export default function HomePage() {
  const router = useRouter()
  const [topics, setTopics] = useState<SuggestedTopic[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [loading, setLoading] = useState(true)
  const { ready: backendReady } = useBackendReady()

  useEffect(() => {
    if (!backendReady) return
    Promise.all([getSuggestedTopics(), getGuests()])
      .then(([t, g]) => {
        setTopics(t.filter(t => t.available_guests.length >= 2).slice(0, 6))
        setGuests(g.slice(0, 8))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [backendReady])

  const handleTopicClick = (topic: SuggestedTopic) => {
    const params = new URLSearchParams({
      topic: topic.title,
      guest1: topic.available_guests[0] || '',
      guest2: topic.available_guests[1] || '',
      autostart: '1',
    })
    router.push(`/arena?${params.toString()}`)
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #0a0a0f 0%, #0d0d18 100%)' }}>
      {/* Header */}
      <header className="border-b border-arena-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
              <Mic2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg text-white">The Arena</span>
            <span className="text-xs px-2 py-0.5 rounded-full border border-arena-border text-arena-muted">
              powered by Lenny's data
            </span>
          </div>
          <button
            onClick={() => router.push('/arena')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-arena-border text-arena-muted hover:text-white hover:border-white/30 transition-all"
          >
            <Pencil className="w-3.5 h-3.5" />
            Custom debate
          </button>
        </div>
      </header>

      {/* Hero — compact, not the primary CTA */}
      <section className="max-w-6xl mx-auto px-6 pt-12 pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/10 text-orange-400 text-sm font-medium mb-5">
          <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
          Free to watch · No sign-up needed
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold text-white mb-4 leading-tight">
          Watch the greatest<br />
          <span style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            minds debate
          </span>
        </h1>
        <p className="text-lg text-arena-muted max-w-xl mx-auto">
          Pick a debate below and watch it start instantly — no account needed.
        </p>
      </section>

      {/* 🔥 Hot Debates — FIRST and PRIMARY */}
      <section className="max-w-6xl mx-auto px-6 mb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white">🔥 Free Hot Debates</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25 font-medium">
              No sign-up · Watch instantly
            </span>
          </div>
          <button
            onClick={() => router.push('/arena')}
            className="text-sm text-orange-400 hover:text-orange-300 flex items-center gap-1"
          >
            Custom topic <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-arena-border bg-arena-card p-5 animate-pulse">
                <div className="h-4 bg-arena-border rounded mb-3 w-3/4" />
                <div className="h-3 bg-arena-border rounded mb-2" />
                <div className="h-3 bg-arena-border rounded w-2/3" />
              </div>
            ))
          ) : (
            topics.map((topic) => (
              <button
                key={topic.id}
                onClick={() => handleTopicClick(topic)}
                className="rounded-xl border border-arena-border bg-arena-card p-5 text-left hover:border-orange-500/40 transition-all hover:-translate-y-0.5 group relative"
              >
                {/* Free badge */}
                <span className="absolute top-3 right-3 text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20 font-medium">
                  FREE
                </span>

                <h3 className="font-semibold text-white mb-2 group-hover:text-orange-400 transition-colors line-clamp-2 pr-10">
                  {topic.title}
                </h3>
                <p className="text-sm text-arena-muted mb-4 line-clamp-2">{topic.description}</p>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {topic.available_guests.slice(0, 2).map((g, i) => (
                      <span key={g} className="flex items-center gap-1">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-orange-500/20 text-orange-400' : 'bg-purple-500/20 text-purple-400'}`}>
                          {g[0]}
                        </span>
                        <span className="text-xs text-arena-muted truncate max-w-[70px]">{g.split(' ')[0]}</span>
                        {i === 0 && <span className="text-arena-muted text-xs">vs</span>}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-orange-400 group-hover:text-orange-300 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    Watch now <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* Divider + Custom CTA */}
      <section className="max-w-6xl mx-auto px-6 mb-16">
        <div className="rounded-2xl border border-dashed border-arena-border bg-arena-card/40 p-8 text-center">
          <Pencil className="w-6 h-6 text-arena-muted mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white mb-2">Want a custom debate?</h3>
          <p className="text-sm text-arena-muted mb-5 max-w-sm mx-auto">
            Pick any topic and any two guests from Lenny's archive. Requires sign-up and your own API keys.
          </p>
          <button
            onClick={() => router.push('/arena')}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white border border-orange-500/40 hover:border-orange-500 hover:bg-orange-500/10 transition-all"
          >
            Build your own debate <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-6xl mx-auto px-6 mb-16">
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: Users, label: 'Guests', value: loading ? '...' : `${guests.length}+` },
            { icon: Mic2, label: 'Debate Topics', value: '8+' },
            { icon: Zap, label: 'Real interview data', value: '650+' },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-xl border border-arena-border bg-arena-card p-6 text-center">
              <Icon className="w-6 h-6 text-orange-400 mx-auto mb-3" />
              <div className="text-3xl font-bold text-white mb-1">{value}</div>
              <div className="text-sm text-arena-muted">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-arena-border py-8 text-center text-arena-muted text-sm">
        Built on <a href="https://www.lennysdata.com" className="text-orange-400 hover:underline" target="_blank" rel="noopener noreferrer">Lenny's Data</a> —
        All debates grounded in real interviews from Lenny's Podcast & Newsletter
      </footer>
    </div>
  )
}
