'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSuggestedTopics, getGuests } from '@/lib/api'
import { SuggestedTopic, Guest } from '@/lib/types'
import { Mic2, Zap, Users, Trophy, ArrowRight, Play } from 'lucide-react'

export default function HomePage() {
  const router = useRouter()
  const [topics, setTopics] = useState<SuggestedTopic[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getSuggestedTopics(), getGuests()])
      .then(([t, g]) => {
        setTopics(t.filter(t => t.available_guests.length >= 2).slice(0, 6))
        setGuests(g.slice(0, 8))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleTopicClick = (topic: SuggestedTopic) => {
    const params = new URLSearchParams({
      topic: topic.title,
      guest1: topic.available_guests[0] || '',
      guest2: topic.available_guests[1] || '',
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
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'linear-gradient(135deg, #f97316, #ea580c)' }}
          >
            Start a Debate <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/10 text-orange-400 text-sm font-medium mb-6">
          <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
          Live AI Debates · Grounded in Real Interviews
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-6 leading-tight">
          Watch the greatest<br />
          <span style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            minds debate
          </span>
        </h1>
        <p className="text-xl text-arena-muted max-w-2xl mx-auto mb-10">
          Ben Horowitz vs. Brian Halligan. Elena Verna vs. Jason Lemkin.
          Every argument grounded in their actual words — hosted by AI Lenny.
        </p>
        <button
          onClick={() => router.push('/arena')}
          className="inline-flex items-center gap-3 px-8 py-4 rounded-xl text-lg font-bold text-white shadow-lg"
          style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)', boxShadow: '0 0 40px rgba(249,115,22,0.3)' }}
        >
          <Play className="w-5 h-5" />
          Enter The Arena
        </button>
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

      {/* Suggested Debates */}
      <section className="max-w-6xl mx-auto px-6 mb-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">🔥 Hot Debates</h2>
          <button onClick={() => router.push('/arena')} className="text-sm text-orange-400 hover:text-orange-300 flex items-center gap-1">
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
                className="rounded-xl border border-arena-border bg-arena-card p-5 text-left hover:border-orange-500/40 transition-all hover:-translate-y-0.5 group"
              >
                <h3 className="font-semibold text-white mb-2 group-hover:text-orange-400 transition-colors line-clamp-2">
                  {topic.title}
                </h3>
                <p className="text-sm text-arena-muted mb-4 line-clamp-2">{topic.description}</p>
                <div className="flex items-center gap-2">
                  {topic.available_guests.slice(0, 2).map((g, i) => (
                    <span key={g} className="flex items-center gap-1">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-orange-500/20 text-orange-400' : 'bg-purple-500/20 text-purple-400'}`}>
                        {g[0]}
                      </span>
                      <span className="text-xs text-arena-muted truncate max-w-[80px]">{g.split(' ')[0]}</span>
                      {i === 0 && <span className="text-arena-muted text-xs">vs</span>}
                    </span>
                  ))}
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-bold text-white text-center mb-10">How The Arena Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { step: '01', title: 'Pick a Topic', desc: 'Choose from hot debates or enter your own question' },
            { step: '02', title: 'Select Guests', desc: 'Pick two guests from Lenny\'s podcast archive' },
            { step: '03', title: 'Watch the Debate', desc: 'Each guest argues from their actual interview data, moderated by AI Lenny' },
            { step: '04', title: 'Vote & Share', desc: 'Decide who made the stronger case and share the highlights' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="text-center">
              <div className="text-5xl font-black mb-3" style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {step}
              </div>
              <h3 className="font-semibold text-white mb-2">{title}</h3>
              <p className="text-sm text-arena-muted">{desc}</p>
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
