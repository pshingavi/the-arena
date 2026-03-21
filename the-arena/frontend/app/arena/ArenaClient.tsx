'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getGuests, getSuggestedTopics, startDebate, castVote, generateSummary, streamTurn, streamIntro, getVideoStatus } from '@/lib/api'
import { Guest, DebateTurn, TurnSource, SuggestedTopic, DebateState } from '@/lib/types'
import { useBackendReady } from '@/lib/useBackendReady'
import { Mic2, ArrowLeft, Play, Trophy, RefreshCw, Zap, VolumeX, Volume2, LogOut } from 'lucide-react'
import { useArenaMusic } from '@/lib/music'
import { useAudioQueue } from '@/lib/audioQueue'
import { StudioStage, type SpeakerState } from './StudioStage'
import { useAuth } from '@/lib/useAuth'
import ApiKeyModal from '@/components/ApiKeyModal'
import { unlockAudioOnGesture } from '@/lib/audioUnlock'

// ─────────────────────────────────────────────────────────────────────────────
// Prefetch types — live at module level so refs are typed correctly
// ─────────────────────────────────────────────────────────────────────────────
type PrefetchStatus = 'sseStreaming' | 'waitingVideo' | 'videoReady' | 'sseComplete' | 'failed'
interface PrefetchData {
  turnIdx: number
  speaker: string
  rawSpeaker: string
  text: string
  videoId?: string
  videoUrl?: string
  enrichedTurn?: import('@/lib/types').DebateTurn
  isLastTurn: boolean
  status: PrefetchStatus
  sseCleanup?: () => void
  pollInterval?: ReturnType<typeof setInterval>
  sources?: TurnSource[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Guest Selector (setup phase)
// ─────────────────────────────────────────────────────────────────────────────
function GuestSelector({
  guests, selected, onSelect, color, label
}: {
  guests: Guest[], selected: string, onSelect: (name: string) => void
  color: 'orange' | 'purple', label: string
}) {
  const [search, setSearch] = useState('')
  const filtered = guests.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    g.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  )
  const textColor  = color === 'orange' ? 'text-orange-400' : 'text-purple-400'
  const selBorder  = color === 'orange' ? 'border-orange-500 bg-orange-500/10' : 'border-purple-500 bg-purple-500/10'
  const selDot     = color === 'orange' ? 'bg-orange-500' : 'bg-purple-500'
  const selText    = color === 'orange' ? 'bg-orange-500/20 text-orange-400' : 'bg-purple-500/20 text-purple-400'

  return (
    <div className="flex flex-col gap-3">
      <div className={`text-sm font-semibold ${textColor}`}>{label}</div>
      <input
        type="text"
        placeholder="Search guests..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-arena-border bg-arena-card text-sm text-white placeholder-arena-muted focus:outline-none focus:border-orange-500/50"
      />
      <div className="grid grid-cols-1 gap-1.5 max-h-60 overflow-y-auto pr-1">
        {filtered.map(guest => (
          <button key={guest.name} onClick={() => onSelect(guest.name)}
            className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all
              ${selected === guest.name ? selBorder : 'border-arena-border bg-arena-card hover:border-white/20'}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${selected === guest.name ? selText : 'bg-white/10 text-white/60'}`}>
              {guest.name[0]}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-white truncate">{guest.name}</div>
              <div className="text-xs text-arena-muted truncate">{guest.tags.slice(0, 2).join(' · ')}</div>
            </div>
            {selected === guest.name && <div className={`ml-auto w-3 h-3 rounded-full flex-shrink-0 ${selDot}`} />}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Arena Client
// ─────────────────────────────────────────────────────────────────────────────
export default function ArenaClient() {
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const scrollRef     = useRef<HTMLDivElement>(null)

  // ── Auth ───────────────────────────────────────────────────────────────────
  const { user, loading: authLoading, logout } = useAuth()

  // ── API key gating ─────────────────────────────────────────────────────────
  // apiToken: short-lived token from /debate/keys/register (user-provided keys)
  // showKeyModal: true when user tries a custom/non-cached debate without a token
  const [apiToken, setApiToken]       = useState<string | null>(null)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const pendingStartRef = useRef<(() => void) | null>(null)

  // ── Setup ──────────────────────────────────────────────────────────────────
  const [debateState, setDebateState] = useState<DebateState>('setup')
  const [guests, setGuests]     = useState<Guest[]>([])
  const [topics, setTopics]     = useState<SuggestedTopic[]>([])
  const [guest1, setGuest1]     = useState(searchParams.get('guest1') || '')
  const [guest2, setGuest2]     = useState(searchParams.get('guest2') || '')
  const [topic, setTopic]       = useState(searchParams.get('topic') || '')
  const [customTopic, setCustomTopic] = useState(searchParams.get('customTopic') || '')
  const autostart = searchParams.get('autostart') === '1'

  // ── Debate ─────────────────────────────────────────────────────────────────
  const [sessionId, setSessionId]   = useState<string | null>(null)
  const [turns, setTurns]           = useState<DebateTurn[]>([])
  const [streamingTurn, setStreamingTurn] = useState<{ speaker: string; text: string } | null>(null)
  const [turnNumber, setTurnNumber] = useState(0)
  const [votes, setVotes]           = useState<Record<string, number>>({})
  const [hasVoted, setHasVoted]     = useState(false)
  const [summary, setSummary]       = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [autoAdvance, setAutoAdvance] = useState(true)
  const [introPhase, setIntroPhase] = useState<'idle' | 'playing' | 'done'>('idle')
  const cleanupRef = useRef<(() => void) | null>(null)

  // ── HeyGen-first video state ───────────────────────────────────────────────
  // activeTurnVideo: URL of the playing HeyGen video for the current turn.
  //   Set once polling confirms completed, cleared after video ends.
  const [activeTurnVideo, setActiveTurnVideo] = useState<string | null>(null)
  // isWaitingForVideo: true while we have videoId but no videoUrl yet.
  const [isWaitingForVideo, setIsWaitingForVideo] = useState(false)

  // ── Refs ───────────────────────────────────────────────────────────────────
  // Text buffer for the current SSE stream (not displayed until video ready)
  const sseBufferRef      = useRef('')
  // Text currently shown on screen (typewriter output)
  const displayedRef      = useRef('')
  // RAF handle for the typewriter animation
  const typewriterRafRef  = useRef(0)

  // Advance function for HeyGen path — fired by onVideoEnded only.
  const videoAdvanceRef = useRef<(() => void) | null>(null)
  // Advance function for ElevenLabs fallback path — fired by onQueueEmpty only.
  const elevenAdvanceRef = useRef<(() => void) | null>(null)

  // Full turn data stored while waiting for HeyGen video to render.
  const pendingTurnRef = useRef<{
    text: string
    enrichedTurn: DebateTurn
    isLastTurn: boolean
    speaker: string
  } | null>(null)

  // Polling interval for current turn's HeyGen video.
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Background pre-streaming ───────────────────────────────────────────────
  // While turn N's video is playing, we pre-stream turn N+1's SSE and kick off
  // its HeyGen render. This way, by the time turn N ends, turn N+1's video may
  // already be ready → near-instant start.
  const prefetchRef     = useRef<PrefetchData | null>(null)
  const prefetchPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Music ──────────────────────────────────────────────────────────────────
  const { musicOn, toggleMusic, startIntroJingle, startAmbient, stopAll } = useArenaMusic()

  // ── Backend ready ──────────────────────────────────────────────────────────
  const { ready: backendReady, status: backendStatus, elapsed, guestsIndexed } = useBackendReady()

  // ── ElevenLabs audio queue — only used when HeyGen NOT configured ──────────
  // onSentenceStart: drives the per-sentence typewriter in ElevenLabs mode.
  // onQueueEmpty: fires elevenAdvanceRef to commit turn and advance.
  const audioQ = useAudioQueue({
    onSentenceStart: useCallback((sentence: string, durationMs: number, priorText: string) => {
      // 1. Cancel any in-flight typewriter from the previous sentence.
      cancelAnimationFrame(typewriterRafRef.current)

      // 2. Snap the display to priorText — all text from sentences that have
      //    already finished playing.  This ensures the cursor is at exactly
      //    the right position even if the previous typewriter RAF hadn't
      //    completed yet when this sentence's audio began.
      displayedRef.current = priorText
      setStreamingTurn(prev => prev ? { ...prev, text: priorText } : null)

      // 3. Reveal this sentence progressively over 95% of the audio duration
      //    (the 5% slack means the typewriter finishes before the audio ends,
      //    never leaving text half-shown when the next sentence starts).
      const budget    = durationMs * 0.95
      const startTime = performance.now()

      const tick = (now: number) => {
        const progress = Math.min((now - startTime) / budget, 1)
        const chars    = Math.floor(progress * sentence.length)
        const newText  = priorText + sentence.slice(0, chars)
        if (newText !== displayedRef.current) {
          displayedRef.current = newText
          setStreamingTurn(prev => prev ? { ...prev, text: newText } : null)
        }
        if (progress < 1) {
          typewriterRafRef.current = requestAnimationFrame(tick)
        } else {
          const complete = priorText + sentence
          displayedRef.current = complete
          setStreamingTurn(prev => prev ? { ...prev, text: complete } : null)
        }
      }
      typewriterRafRef.current = requestAnimationFrame(tick)
    }, []),

    onQueueEmpty: useCallback(() => {
      // All audio has finished — this is the ONLY signal to advance the turn
      // in ElevenLabs mode.  Steps:
      //   1. Cancel any lingering typewriter RAF
      //   2. Snap display to the full SSE-buffered text so every word is
      //      visible before the bubble transitions away
      //   3. Advance on the next animation frame so React paints the complete
      //      text before removing the streaming bubble
      cancelAnimationFrame(typewriterRafRef.current)
      const fullText = sseBufferRef.current
      if (fullText && fullText !== displayedRef.current) {
        displayedRef.current = fullText
        setStreamingTurn(prev => prev ? { ...prev, text: fullText } : null)
      }
      requestAnimationFrame(() => {
        elevenAdvanceRef.current?.()
        elevenAdvanceRef.current = null
      })
    }, []),
  })

  // ── HeyGen video-driven typewriter ─────────────────────────────────────────
  // Reveals the full buffered SSE text over exactly the video's playback duration.
  // Called by StudioAvatar via onVideoReady(durationMs) when loadedmetadata fires.
  const typewriteFullTurn = useCallback((fullText: string, durationMs: number) => {
    displayedRef.current = ''
    const startTime = performance.now()
    const budget    = durationMs * 0.95  // finish text just before video ends

    cancelAnimationFrame(typewriterRafRef.current)

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / budget, 1)
      const chars    = Math.floor(progress * fullText.length)
      const newText  = fullText.slice(0, chars)

      if (newText !== displayedRef.current) {
        displayedRef.current = newText
        setStreamingTurn(prev => prev ? { ...prev, text: newText } : null)
      }

      if (progress < 1) {
        typewriterRafRef.current = requestAnimationFrame(tick)
      } else {
        displayedRef.current = fullText
        setStreamingTurn(prev => prev ? { ...prev, text: fullText } : null)
      }
    }
    typewriterRafRef.current = requestAnimationFrame(tick)
  }, [])

  // Callback: StudioAvatar calls this when it has a real video duration.
  // We clamp to a text-length-based minimum so that even if the browser
  // returns a very short or zero duration (e.g. due to autoplay policy),
  // the typewriter still runs at a legible pace (~50 ms per character).
  const onVideoReady = useCallback((durationMs: number) => {
    const pending = pendingTurnRef.current
    if (!pending) return
    const minMs = Math.max(pending.text.length * 50, 6_000)  // never faster than ~50ms/char
    typewriteFullTurn(pending.text, Math.max(durationMs, minMs))
  }, [typewriteFullTurn])

  // Callback: StudioAvatar calls this when <video> ends.
  const onVideoEnded = useCallback(() => {
    cancelAnimationFrame(typewriterRafRef.current)
    setActiveTurnVideo(null)
    setIsWaitingForVideo(false)
    // Fire the HeyGen-path advance (never the ElevenLabs one).
    videoAdvanceRef.current?.()
    videoAdvanceRef.current = null
    pendingTurnRef.current = null
  }, [])

  // ── Debate sequence ────────────────────────────────────────────────────────
  const DEBATE_SEQUENCE = [
    guest1, guest2, 'lenny',
    guest1, guest2, 'lenny',
    guest1, guest2, 'lenny',
    guest1, guest2,
  ]
  const currentSpeaker = DEBATE_SEQUENCE[turnNumber] || null
  const isComplete = turnNumber >= DEBATE_SEQUENCE.length || debateState === 'voting' || debateState === 'results'

  const turnCounts = turns.reduce<Record<string, number>>((acc, t) => {
    acc[t.speaker] = (acc[t.speaker] || 0) + 1; return acc
  }, {})

  const getSpeakerState = (name: string): SpeakerState => {
    if (streamingTurn?.speaker === name) {
      if (isWaitingForVideo) return 'preparing'   // spotlight on, video generating
      return 'speaking'                            // video playing
    }
    if (streamingTurn !== null) return 'listening'
    const hasTurns = (turnCounts[name] || 0) > 0
    if (!hasTurns && debateState === 'live') return 'idle'
    return 'listening'
  }

  // ── Load guests/topics ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!backendReady) return
    Promise.all([getGuests(), getSuggestedTopics()])
      .then(([g, t]) => { setGuests(g); setTopics(t) })
      .catch(console.error)
  }, [backendReady])

  // ── Auto-start: when ?autostart=1 is in the URL and it's a hot topic, launch immediately
  const autoStartFiredRef = useRef(false)
  useEffect(() => {
    if (!autostart || autoStartFiredRef.current) return
    if (!backendReady || !topics.length || !guest1 || !guest2 || !topic) return
    if (authLoading) return  // wait for auth to resolve before proceeding

    const matchingTopic = topics.find(
      t => t.title === topic &&
        t.suggested_guests?.includes(guest1) &&
        t.suggested_guests?.includes(guest2)
    )

    autoStartFiredRef.current = true  // mark fired regardless so we don't loop

    if (matchingTopic) {
      // Call doStartDebate directly — we've verified it's a free hot topic,
      // no need to go through handleStart's auth/key checks.
      setTimeout(() => doStartDebate(), 400)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, backendReady, topics, guest1, guest2, topic, authLoading])

  // ── Scroll transcript to top when new turns arrive (newest-first layout) ────
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [turns.length])

  // ── Stop all audio/music on unmount AND on iOS BFCache pagehide ────────────
  useEffect(() => {
    const handlePageHide = () => {
      audioQ.stopAll()
      stopAll()
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      audioQ.stopAll()
      stopAll()
      cancelAnimationFrame(typewriterRafRef.current)
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Poll helper: given videoId, poll until completed or failed ─────────────
  // Returns a cleanup function to stop polling.
  const startVideoPoll = useCallback((
    videoId: string,
    onReady: (url: string) => void,
    onFailed: () => void,
    intervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>
  ) => {
    let attempts = 0
    const MAX = 40  // 40 × 3 s = 2 min

    const poll = async () => {
      attempts++
      try {
        const res = await getVideoStatus(videoId)
        if (res.status === 'completed' && res.video_url) {
          if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
          onReady(res.video_url)
        } else if (res.status === 'failed' || attempts >= MAX) {
          if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
          onFailed()
        }
      } catch { /* retry */ }
    }

    poll()  // immediate first attempt
    intervalRef.current = setInterval(poll, 3_000)

    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }
  }, [])

  // ── Background pre-fetch: SSE + HeyGen for turn N+1 ───────────────────────
  // Called when turn N's video starts playing (activeTurnVideo is set).
  // Starts SSE for the next turn immediately so the LLM generates text and
  // HeyGen begins rendering — by the time turn N ends, N+1 may be ready.
  const startPrefetch = useCallback((rawSpeaker: string, turnIdx: number, sid: string, token?: string) => {
    if (prefetchRef.current) return   // already prefetching
    const speakerName = rawSpeaker === 'lenny' ? 'Lenny Rachitsky' : rawSpeaker
    const isLastTurn  = turnIdx >= DEBATE_SEQUENCE.length - 1

    const pf: PrefetchData = {
      turnIdx,
      speaker: speakerName,
      rawSpeaker,
      text: '',
      isLastTurn,
      status: 'sseStreaming',
    }
    prefetchRef.current = pf

    const sseCleanup = streamTurn(
      sid, rawSpeaker,
      (chunk) => { pf.text += chunk },
      (turn, audioUrl, videoId, sources) => {
        pf.sources      = sources || []
        pf.enrichedTurn = { ...turn, audio_url: audioUrl, video_id: videoId, sources: pf.sources }
        if (!videoId) {
          // ElevenLabs-only mode: SSE text is ready, no video to wait for
          pf.status = 'sseComplete'
          return
        }
        pf.videoId = videoId
        pf.status  = 'waitingVideo'

        startVideoPoll(
          videoId,
          (url) => { pf.videoUrl = url; pf.status = 'videoReady' },
          ()    => { pf.status = 'failed' },
          prefetchPollRef
        )
      },
      () => { pf.status = 'failed' },
      token
    )
    pf.sseCleanup = sseCleanup
  }, [DEBATE_SEQUENCE.length, startVideoPoll])

  // Cancel any in-flight prefetch
  const cancelPrefetch = useCallback(() => {
    const pf = prefetchRef.current
    if (!pf) return
    pf.sseCleanup?.()
    if (prefetchPollRef.current) { clearInterval(prefetchPollRef.current); prefetchPollRef.current = null }
    prefetchRef.current = null
  }, [])

  // ── Gating: check if the current selection is a pre-cached hot topic ────────
  // Hot topics are free for signed-in users. Custom topics / non-suggested
  // guest combos require user-provided API keys (owner bypasses this).
  const isHotTopicCombo = useCallback(() => {
    if (!topics.length || !guest1 || !guest2 || customTopic) return false
    if (user?.role === 'owner') return true // owner always has server keys
    const matchingTopic = topics.find(
      t => t.title === topic &&
        t.suggested_guests?.includes(guest1) &&
        t.suggested_guests?.includes(guest2)
    )
    return !!matchingTopic
  }, [topics, guest1, guest2, topic, customTopic, user])

  // ── Debate start ───────────────────────────────────────────────────────────
  const canStartDebate = guest1 && guest2 && guest1 !== guest2 && (topic || customTopic)

  const doStartDebate = async () => {
    const finalTopic = customTopic || topic
    if (!canStartDebate) return
    setError(null)
    startIntroJingle()

    try {
      const { session_id } = await startDebate(guest1, guest2, finalTopic)
      if (customTopic) setTopic(customTopic)

      setDebateState('live')
      setIntroPhase('playing')
      setStreamingTurn({ speaker: 'Lenny Rachitsky', text: '' })
      sseBufferRef.current  = ''
      displayedRef.current  = ''
      cancelAnimationFrame(typewriterRafRef.current)
      audioQ.stopAll()

      // Capture token at start time so all calls in this debate use the same token
      const currentToken = apiToken || undefined

      // Intro always uses ElevenLabs (fast, no HeyGen delay for the welcome)
      streamIntro(
        session_id,
        (chunk) => {
          sseBufferRef.current += chunk
          audioQ.addChunk(chunk, 'Lenny Rachitsky')
        },
        (turn, audioUrl) => {
          audioQ.flush('Lenny Rachitsky')
          const enrichedTurn: DebateTurn = { ...turn, audio_url: audioUrl }

          elevenAdvanceRef.current = () => {
            setTurns(prev => [...prev, enrichedTurn])
            setStreamingTurn(null)
            sseBufferRef.current = ''
            displayedRef.current = ''
            setIntroPhase('done')
            setSessionId(session_id)
            setTimeout(() => startAmbient(), 400)
          }

          // While the intro plays, pre-fetch the first debate turn so it
          // starts (near-)instantly when the intro audio finishes.
          const firstSpeaker = DEBATE_SEQUENCE[0]
          if (firstSpeaker && session_id) {
            setTimeout(() => startPrefetch(firstSpeaker, 0, session_id, currentToken), 500)
          }
        },
        (err) => {
          console.warn('Intro error:', err)
          setStreamingTurn(null)
          elevenAdvanceRef.current = null
          setIntroPhase('done')
          setSessionId(session_id)
          setTimeout(() => startAmbient(), 400)
        },
        currentToken
      )
    } catch (e: any) {
      setError(e.message)
      setDebateState('setup')
      stopAll()
    }
  }

  // ── Public handleStart: gate on auth + API keys ────────────────────────────
  const handleStart = () => {
    if (!canStartDebate) return

    // Still loading auth — don't act yet (avoids false "not logged in" redirects)
    if (authLoading) return

    // Unlock iOS audio synchronously — must be first thing in any gesture handler
    unlockAudioOnGesture()

    // Owners: always start immediately using server keys
    if (user?.role === 'owner') {
      doStartDebate()
      return
    }

    // Hot-topic combos: free for everyone, no login required
    if (isHotTopicCombo()) {
      doStartDebate()
      return
    }

    // Custom debate: require login first.
    // Encode ALL current selections into the return URL so nothing is lost.
    if (!user) {
      const params = new URLSearchParams()
      if (guest1)       params.set('guest1', guest1)
      if (guest2)       params.set('guest2', guest2)
      if (topic)        params.set('topic', topic)
      if (customTopic)  params.set('customTopic', customTopic)
      const returnUrl = '/arena?' + params.toString()
      router.push('/auth?from=' + encodeURIComponent(returnUrl))
      return
    }

    // Logged-in user with a custom debate: need their own API keys
    if (apiToken) {
      doStartDebate()
      return
    }

    // Show the API key modal
    pendingStartRef.current = doStartDebate
    setShowKeyModal(true)
  }

  useEffect(() => {
    if (introPhase === 'done') setIntroPhase('idle')
  }, [introPhase])

  // ── Stream a debate turn ───────────────────────────────────────────────────
  const streamNextTurn = useCallback(async () => {
    if (!sessionId || !currentSpeaker || isComplete || debateState === 'streaming') return

    setDebateState('streaming')

    const speakerName = currentSpeaker === 'lenny' ? 'Lenny Rachitsky' : currentSpeaker

    // Spotlight the speaker immediately (state: 'speaking' or 'preparing')
    setStreamingTurn({ speaker: speakerName, text: '' })
    setActiveTurnVideo(null)

    // Reset per-turn state
    cancelAnimationFrame(typewriterRafRef.current)
    videoAdvanceRef.current  = null
    elevenAdvanceRef.current = null
    pendingTurnRef.current   = null
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    audioQ.stopAll()

    // ── Check if the next-turn pre-fetch already has this data ready ─────────
    const pf = prefetchRef.current

    // ElevenLabs pre-fetch path: SSE already complete, jump straight to TTS
    if (pf && pf.turnIdx === turnNumber && pf.status === 'sseComplete' && pf.enrichedTurn) {
      sseBufferRef.current = pf.text
      displayedRef.current = ''
      const enrichedTurn = pf.enrichedTurn
      const isLastTurn   = pf.isLastTurn
      const text         = pf.text
      const thisTurnIdx  = pf.turnIdx
      prefetchRef.current = null

      elevenAdvanceRef.current = () => {
        setTurns(prev => [...prev, enrichedTurn])
        setStreamingTurn(null)
        setActiveTurnVideo(null)
        setIsWaitingForVideo(false)
        sseBufferRef.current = ''
        displayedRef.current = ''
        setTurnNumber(prev => prev + 1)
        setDebateState(prev => prev === 'streaming' ? 'live' : prev)
        if (isLastTurn) setTimeout(() => setDebateState('voting'), 500)
      }

      // Start pre-fetching the turn AFTER this one while audio plays
      const nextRawSpeaker = DEBATE_SEQUENCE[thisTurnIdx + 1]
      if (nextRawSpeaker && sessionId) {
        setTimeout(() => startPrefetch(nextRawSpeaker, thisTurnIdx + 1, sessionId, apiToken || undefined), 300)
      }

      // Feed the buffered text into the audio queue — sentence-by-sentence TTS
      audioQ.addChunk(text, speakerName)
      audioQ.flush(speakerName)
      return
    }

    if (pf && pf.turnIdx === turnNumber && (pf.status === 'videoReady' || pf.status === 'waitingVideo') && pf.enrichedTurn) {
      sseBufferRef.current = pf.text
      displayedRef.current = ''
      const enrichedTurn = pf.enrichedTurn
      const isLastTurn   = pf.isLastTurn

      const advance = () => {
        setTurns(prev => [...prev, enrichedTurn])
        setStreamingTurn(null)
        setActiveTurnVideo(null)
        setIsWaitingForVideo(false)
        sseBufferRef.current = ''
        displayedRef.current = ''
        setTurnNumber(prev => prev + 1)
        setDebateState(prev => prev === 'streaming' ? 'live' : prev)
        if (isLastTurn) setTimeout(() => setDebateState('voting'), 500)
      }

      if (pf.status === 'videoReady' && pf.videoUrl) {
        // 🎉 Video already rendered — instant start!
        pendingTurnRef.current = { text: pf.text, enrichedTurn, isLastTurn, speaker: speakerName }
        videoAdvanceRef.current = advance
        setIsWaitingForVideo(false)
        prefetchRef.current = null
        setActiveTurnVideo(pf.videoUrl)
        return
      }

      if (pf.status === 'waitingVideo' && pf.videoId) {
        // SSE done, video still rendering — take over the poll
        pendingTurnRef.current = { text: pf.text, enrichedTurn, isLastTurn, speaker: speakerName }
        videoAdvanceRef.current = advance
        setIsWaitingForVideo(true)
        const videoId = pf.videoId
        prefetchRef.current = null
        if (prefetchPollRef.current) { clearInterval(prefetchPollRef.current); prefetchPollRef.current = null }

        startVideoPoll(
          videoId,
          (url) => { setIsWaitingForVideo(false); setActiveTurnVideo(url) },
          ()    => {
            setIsWaitingForVideo(false)
            const text = pendingTurnRef.current?.text || ''
            displayedRef.current = text
            setStreamingTurn(prev => prev ? { ...prev, text } : null)
            setTimeout(() => { videoAdvanceRef.current?.(); videoAdvanceRef.current = null; pendingTurnRef.current = null }, 4_000)
          },
          pollingRef
        )
        return
      }
    }

    // Cancel stale prefetch if it's for a different turn or failed
    cancelPrefetch()

    // ── Normal flow: SSE → buffer text → wait for HeyGen or use ElevenLabs ──
    sseBufferRef.current = ''
    displayedRef.current = ''

    const cleanup = streamTurn(
      sessionId, currentSpeaker,

      // ── Chunk handler: ONLY buffer — no audio synthesis here ──────────────
      // HeyGen path: typewriter starts when video loads (onVideoReady).
      // ElevenLabs path: we'll synthesize after turn_complete.
      (chunk) => {
        sseBufferRef.current += chunk
      },

      // ── turn_complete ──────────────────────────────────────────────────────
      (turn, audioUrl, videoId, sources) => {
        const enrichedTurn: DebateTurn = { ...turn, audio_url: audioUrl, video_id: videoId, sources: sources || [] }
        const isLastTurn = turn.turn_number >= DEBATE_SEQUENCE.length - 1

        const advance = () => {
          setTurns(prev => [...prev, enrichedTurn])
          setStreamingTurn(null)
          setActiveTurnVideo(null)
          setIsWaitingForVideo(false)
          sseBufferRef.current = ''
          displayedRef.current = ''
          setTurnNumber(prev => prev + 1)
          setDebateState(prev => prev === 'streaming' ? 'live' : prev)
          if (isLastTurn) setTimeout(() => setDebateState('voting'), 500)
        }

        if (videoId) {
          // ── HeyGen path ────────────────────────────────────────────────────
          // No ElevenLabs. Video has its own built-in TTS voice.
          // Text typewriter starts when the video's loadedmetadata fires.
          // Turn advances when the video's ended event fires.

          pendingTurnRef.current = { text: sseBufferRef.current, enrichedTurn, isLastTurn, speaker: speakerName }
          videoAdvanceRef.current = advance
          setIsWaitingForVideo(true)

          // Capture current sessionId for the prefetch closure
          const currentSessionId = sessionId
          const thisTurnIdx = turn.turn_number

          startVideoPoll(
            videoId,
            (url) => {
              setIsWaitingForVideo(false)
              setActiveTurnVideo(url)

              // 🔮 Background pre-fetch for the NEXT turn.
              // While this turn's video plays, pre-stream and pre-render the next one.
              const nextRawSpeaker = DEBATE_SEQUENCE[thisTurnIdx + 1]
              if (nextRawSpeaker && currentSessionId && !prefetchRef.current) {
                setTimeout(() => startPrefetch(nextRawSpeaker, thisTurnIdx + 1, currentSessionId, apiToken || undefined), 200)
              }
            },
            () => {
              // Video failed — show text immediately, advance after 4s
              setIsWaitingForVideo(false)
              const text = pendingTurnRef.current?.text || ''
              displayedRef.current = text
              setStreamingTurn(prev => prev ? { ...prev, text } : null)
              setTimeout(() => {
                videoAdvanceRef.current?.()
                videoAdvanceRef.current = null
                pendingTurnRef.current  = null
              }, 4_000)
            },
            pollingRef
          )

        } else {
          // ── ElevenLabs fallback path ───────────────────────────────────────
          // HeyGen not configured. Synthesize the full buffered text via the
          // audio queue (sentence-by-sentence). onSentenceStart drives the
          // typewriter; onQueueEmpty fires elevenAdvanceRef.
          const fullText  = sseBufferRef.current
          const thisTurnN = turn.turn_number
          elevenAdvanceRef.current = advance

          // 🔮 Start pre-fetching the NEXT turn immediately — the LLM will
          // generate it in the background while this turn's audio plays.
          const nextRawSpeaker = DEBATE_SEQUENCE[thisTurnN + 1]
          if (nextRawSpeaker && sessionId && !prefetchRef.current) {
            setTimeout(() => startPrefetch(nextRawSpeaker, thisTurnN + 1, sessionId, apiToken || undefined), 300)
          }

          // Feed the full text to the audio queue now that SSE is done.
          // The queue's own flush() already has a 200ms safety check that
          // fires onQueueEmpty when ElevenLabs is NOT configured, so we
          // don't need an extra timer here.
          audioQ.addChunk(fullText, speakerName)
          audioQ.flush(speakerName)
        }
      },

      // ── Error handler ──────────────────────────────────────────────────────
      (err) => {
        setError(err)
        setStreamingTurn(null)
        setActiveTurnVideo(null)
        setIsWaitingForVideo(false)
        sseBufferRef.current = ''
        displayedRef.current = ''
        videoAdvanceRef.current  = null
        elevenAdvanceRef.current = null
        pendingTurnRef.current   = null
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
        setDebateState('live')
      },
      apiToken || undefined
    )
    cleanupRef.current = cleanup
  }, [sessionId, currentSpeaker, isComplete, debateState, turnNumber, DEBATE_SEQUENCE,
      audioQ, startVideoPoll, startPrefetch, cancelPrefetch, apiToken])

  // ── Auto-advance ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (debateState === 'live' && sessionId && autoAdvance && !isComplete && introPhase === 'idle') {
      const delay = turns.length === 0 ? 1_200 : 1_500
      const t = setTimeout(streamNextTurn, delay)
      return () => clearTimeout(t)
    }
  }, [debateState, sessionId, autoAdvance, turns.length, isComplete, streamNextTurn, introPhase])

  const handleVote = async (guestName: string) => {
    if (!sessionId || hasVoted) return
    try {
      const result = await castVote(sessionId, guestName)
      setVotes(result.votes)
      setHasVoted(true)
      const summaryResult = await generateSummary(sessionId)
      setSummary(summaryResult.summary)
      setDebateState('results')
      stopAll()
    } catch (e: any) { setError(e.message) }
  }

  const resetDebate = () => {
    cleanupRef.current?.()
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    cancelPrefetch()
    cancelAnimationFrame(typewriterRafRef.current)
    videoAdvanceRef.current  = null
    elevenAdvanceRef.current = null
    pendingTurnRef.current   = null
    sseBufferRef.current     = ''
    displayedRef.current     = ''
    audioQ.stopAll()
    stopAll()
    setDebateState('setup')
    setSessionId(null)
    setTurns([])
    setStreamingTurn(null)
    setActiveTurnVideo(null)
    setIsWaitingForVideo(false)
    setTurnNumber(0)
    setVotes({})
    setHasVoted(false)
    setSummary(null)
    setError(null)
    setIntroPhase('idle')
  }

  const finalTopic  = topic || customTopic
  const progressPct = Math.min(100, (turnNumber / DEBATE_SEQUENCE.length) * 100)

  // Back navigation: hot-topic flows return home; custom flows return to setup
  const handleBack = () => {
    audioQ.stopAll()
    stopAll()
    cancelAnimationFrame(typewriterRafRef.current)
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    cancelPrefetch()
    if (autostart) {
      router.push('/')
    } else {
      resetDebate()
    }
  }

  // StudioStage speaker config — only the current-turn speaker gets video/callbacks.
  const studioSpeakers = [
    {
      name: guest1, role: 'guest' as const, color: 'orange' as const,
      state: getSpeakerState(guest1),
      videoUrl:     streamingTurn?.speaker === guest1 && activeTurnVideo ? activeTurnVideo : undefined,
      turnCount:    turnCounts[guest1] || 0,
      onVideoReady: streamingTurn?.speaker === guest1 ? onVideoReady  : undefined,
      onVideoEnded: streamingTurn?.speaker === guest1 ? onVideoEnded  : undefined,
    },
    {
      name: 'Lenny Rachitsky', role: 'host' as const, color: 'gold' as const,
      state: getSpeakerState('Lenny Rachitsky'),
      videoUrl:     streamingTurn?.speaker === 'Lenny Rachitsky' && activeTurnVideo ? activeTurnVideo : undefined,
      turnCount:    turnCounts['Lenny Rachitsky'] || 0,
      onVideoReady: streamingTurn?.speaker === 'Lenny Rachitsky' ? onVideoReady  : undefined,
      onVideoEnded: streamingTurn?.speaker === 'Lenny Rachitsky' ? onVideoEnded  : undefined,
    },
    {
      name: guest2, role: 'guest' as const, color: 'purple' as const,
      state: getSpeakerState(guest2),
      videoUrl:     streamingTurn?.speaker === guest2 && activeTurnVideo ? activeTurnVideo : undefined,
      turnCount:    turnCounts[guest2] || 0,
      onVideoReady: streamingTurn?.speaker === guest2 ? onVideoReady  : undefined,
      onVideoEnded: streamingTurn?.speaker === guest2 ? onVideoEnded  : undefined,
    },
  ]

  // ────────────────────────────────────────────────────────────────────────────
  // ── Auth guard — only redirect if trying a custom debate without login ──────
  // Hot-topic debates are free and open; no redirect on mount.
  // Redirection for custom debates is handled inside handleStart below.

  // ────────────────────────────────────────────────────────────────────────────
  // BACKEND LOADING SPLASH
  // ────────────────────────────────────────────────────────────────────────────
  if (!backendReady && debateState === 'setup') {
    const msgs: Record<string, string> = {
      connecting:   'Connecting to The Arena...',
      initialising: `Loading ${guestsIndexed > 0 ? guestsIndexed + ' guests' : 'transcripts & voices'}...`,
      error:        'Connection error — is the backend running?',
    }
    const colors: Record<string, string> = {
      connecting: 'text-arena-muted', initialising: 'text-yellow-400', error: 'text-red-400',
    }
    return (
      <div className="min-h-screen bg-arena-bg flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
            <Mic2 className="w-10 h-10 text-white" />
          </div>
          {backendStatus !== 'error' && (
            <div className="absolute -bottom-2 -right-2 w-5 h-5 rounded-full bg-yellow-400 animate-pulse" />
          )}
        </div>
        <div className="text-center">
          <div className="text-2xl font-black text-white mb-1 tracking-tight">The Arena</div>
          <div className="text-sm text-arena-muted">AI debate powered by Lenny's podcast</div>
        </div>
        <div className={`text-sm font-medium ${colors[backendStatus] || 'text-arena-muted'}`}>
          {msgs[backendStatus] || 'Loading...'}
        </div>
        {backendStatus !== 'error' && (
          <div className="flex gap-2">
            {[0, 200, 400].map(d => (
              <div key={d} className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
        )}
        {elapsed > 3 && backendStatus !== 'error' && (
          <div className="text-xs text-arena-muted">{elapsed}s — indexing transcripts...</div>
        )}
        {backendStatus === 'error' && (
          <div className="text-xs text-arena-muted max-w-xs text-center">
            Start the backend: <code className="text-orange-400">cd the-arena/backend && uv run uvicorn main:app --port 8002 --reload</code>
          </div>
        )}
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  // AUTOSTART LOADING SCREEN — skip setup form, show spinner until debate starts
  // ────────────────────────────────────────────────────────────────────────────
  if (debateState === 'setup' && autostart && guest1 && guest2 && topic) {
    return (
      <div className="min-h-screen bg-arena-bg flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
            <Mic2 className="w-10 h-10 text-white" />
          </div>
          <div className="absolute -bottom-2 -right-2 w-5 h-5 rounded-full bg-orange-400 animate-pulse" />
        </div>
        <div className="text-center">
          <div className="text-xl font-black text-white mb-1">Starting debate…</div>
          <div className="text-sm text-arena-muted mb-4">{topic}</div>
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="text-orange-400 font-medium">{guest1.split(' ')[0]}</span>
            <span className="text-arena-muted">vs</span>
            <span className="text-purple-400 font-medium">{guest2.split(' ')[0]}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {[0, 200, 400].map(d => (
            <div key={d} className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
        <button onClick={() => router.push('/')} className="text-xs text-arena-muted hover:text-white transition-colors mt-2">
          ← Back to debates
        </button>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SETUP VIEW
  // ────────────────────────────────────────────────────────────────────────────
  if (debateState === 'setup') {
    return (
      <div className="min-h-screen bg-arena-bg">
        <header className="border-b border-arena-border px-6 py-4 flex items-center gap-4">
          <button onClick={() => router.push('/')} className="text-arena-muted hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
              <Mic2 className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-white">Set Up Your Debate</span>
          </div>
          {/* User info + logout */}
          {user && (
            <div className="flex items-center gap-2">
              {user.role === 'owner' && (
                <span className="px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-400 font-medium">
                  Owner
                </span>
              )}
              <span className="text-xs text-arena-muted hidden sm:inline truncate max-w-[160px]">{user.email}</span>
              <button onClick={logout} className="text-arena-muted hover:text-white transition-colors" title="Sign out">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </header>

        {/* API Key Modal */}
        {showKeyModal && (
          <ApiKeyModal
            onToken={(token) => {
              setApiToken(token)
              setShowKeyModal(false)
              pendingStartRef.current?.()
              pendingStartRef.current = null
            }}
            onClose={() => {
              setShowKeyModal(false)
              pendingStartRef.current = null
            }}
          />
        )}

        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="mb-10">
            <h2 className="text-xl font-bold text-white mb-2">Choose a Topic</h2>
            <p className="text-arena-muted text-sm mb-5">Pick a pre-loaded debate or write your own.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {topics.filter(t => t.available_guests.length >= 2).slice(0, 6).map(t => (
                <button key={t.id}
                  onClick={() => { setTopic(t.title); setCustomTopic(''); if (t.available_guests[0]) setGuest1(t.available_guests[0]); if (t.available_guests[1]) setGuest2(t.available_guests[1]) }}
                  className={`p-4 rounded-xl border text-left transition-all ${topic === t.title ? 'border-orange-500 bg-orange-500/10' : 'border-arena-border bg-arena-card hover:border-white/20'}`}
                >
                  <div className="text-sm font-medium text-white mb-1 line-clamp-2">{t.title}</div>
                  <div className="text-xs text-arena-muted line-clamp-1">{t.description}</div>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-4">
              <div className="h-px flex-1 bg-arena-border" />
              <span className="text-xs text-arena-muted">or write your own</span>
              <div className="h-px flex-1 bg-arena-border" />
            </div>
            <input type="text"
              placeholder="e.g. Should PMs have engineering backgrounds?"
              value={customTopic}
              onChange={e => { setCustomTopic(e.target.value); if (e.target.value) setTopic('') }}
              className="mt-4 w-full px-4 py-3 rounded-xl border border-arena-border bg-arena-card text-white placeholder-arena-muted focus:outline-none focus:border-orange-500/50"
            />
          </div>

          <div className="mb-10">
            <h2 className="text-xl font-bold text-white mb-2">Select Your Debaters</h2>
            <p className="text-arena-muted text-sm mb-5">Two voices. One arena.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <GuestSelector guests={guests.filter(g => g.name !== guest2)} selected={guest1} onSelect={setGuest1} color="orange" label="🟠 Guest 1" />
              <GuestSelector guests={guests.filter(g => g.name !== guest1)} selected={guest2} onSelect={setGuest2} color="purple" label="🟣 Guest 2" />
            </div>
          </div>

          {error && <div className="mb-4 px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>}

          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={handleStart} disabled={!canStartDebate}
              className="flex items-center gap-3 px-8 py-4 rounded-xl font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: canStartDebate ? 'linear-gradient(135deg, #f97316, #7c3aed)' : '#1e1e2e' }}
            >
              <Zap className="w-5 h-5" />
              Enter The Arena
            </button>
            {guest1 && guest2 && (
              <div className="text-sm text-arena-muted">
                <span className="text-orange-400">{guest1.split(' ')[0]}</span>
                <span className="mx-2">vs</span>
                <span className="text-purple-400">{guest2.split(' ')[0]}</span>
              </div>
            )}
            {/* Show gating hint */}
            {canStartDebate && isHotTopicCombo() && (
              <span className="text-xs text-green-400/70 flex items-center gap-1">
                ✓ Free — no sign-up needed
              </span>
            )}
            {canStartDebate && !isHotTopicCombo() && user?.role === 'owner' && (
              <span className="text-xs text-green-400/70 flex items-center gap-1">
                ✓ Owner — server keys active
              </span>
            )}
            {canStartDebate && !isHotTopicCombo() && user && user.role !== 'owner' && (
              <span className="text-xs text-amber-400/70 flex items-center gap-1">
                🔑 Your API keys required for custom debates
              </span>
            )}
            {canStartDebate && !isHotTopicCombo() && !user && (
              <span className="text-xs text-amber-400/70 flex items-center gap-1">
                → Sign up free to run custom debates
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  // LIVE ARENA VIEW
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-arena-bg flex flex-col">

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <header className="border-b border-arena-border px-4 py-2.5 flex items-center gap-3 flex-shrink-0 bg-arena-card/50 backdrop-blur-sm">
        <button onClick={handleBack} className="text-arena-muted hover:text-white transition-colors flex-shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Guest 1 */}
        <span className="text-sm font-bold text-orange-400 truncate max-w-[100px] hidden sm:inline flex-shrink-0">
          {guest1.split(' ')[0]}
        </span>
        <span className="text-arena-muted text-xs flex-shrink-0 hidden sm:inline">vs</span>
        {/* Guest 2 */}
        <span className="text-sm font-bold text-purple-400 truncate max-w-[100px] hidden sm:inline flex-shrink-0">
          {guest2.split(' ')[0]}
        </span>

        {/* Topic — centre, most prominent */}
        <div className="flex-1 min-w-0 text-center">
          <div className="text-sm font-semibold text-white truncate leading-tight">{finalTopic}</div>
          <div className="flex items-center justify-center gap-2 mt-0.5">
            <span className="text-[10px] text-arena-muted">hosted by Lenny</span>
            {activeTurnVideo && (
              <span className="flex items-center gap-1 text-[10px] text-red-400 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />
                LIVE
              </span>
            )}
            {isWaitingForVideo && !activeTurnVideo && (
              <span className="flex items-center gap-1 text-[10px] text-yellow-400/80">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/80 animate-pulse inline-block" />
                rendering…
              </span>
            )}
          </div>
        </div>

        {/* Turn counter */}
        <div className="hidden md:flex items-center gap-1 text-xs text-arena-muted flex-shrink-0">
          <span className="font-mono">{Math.min(turnNumber + 1, DEBATE_SEQUENCE.length)}</span>
          <span>/</span>
          <span className="font-mono">{DEBATE_SEQUENCE.length}</span>
        </div>

        <button onClick={toggleMusic}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-arena-border text-xs text-arena-muted hover:text-white hover:border-white/30 transition-all flex-shrink-0">
          {musicOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </button>
      </header>

      {/* ── Progress bar ───────────────────────────────────────────────────── */}
      <div className="h-0.5 bg-arena-border flex-shrink-0">
        <div className="h-full transition-all duration-700"
          style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #f97316, #7c3aed)' }} />
      </div>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Studio Stage */}
        <div className="flex-shrink-0 px-4 pt-4">
          <StudioStage speakers={studioSpeakers} analyserRef={audioQ.analyserRef} />
        </div>

        {/* Live transcript area */}
        <div className="flex-1 overflow-hidden flex flex-col px-4 pb-4 pt-3 gap-3 min-h-0">

          {/* Current streaming turn bubble */}
          {streamingTurn && (streamingTurn.text || isWaitingForVideo) && (
            <div className="flex-shrink-0 px-5 py-4 rounded-2xl border" style={{
              background: 'rgba(255,255,255,0.03)',
              borderColor:
                streamingTurn.speaker === guest1   ? 'rgba(249,115,22,0.25)' :
                streamingTurn.speaker === guest2   ? 'rgba(124,58,237,0.25)' :
                                                     'rgba(245,158,11,0.25)',
            }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-white/70 uppercase tracking-wider">
                  {streamingTurn.speaker}
                </span>
                {isWaitingForVideo && (
                  <span className="text-xs text-arena-muted italic">— preparing video...</span>
                )}
                {!isWaitingForVideo && activeTurnVideo && (
                  <span className="flex items-center gap-1 text-xs text-red-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />
                    speaking
                  </span>
                )}
              </div>
              <p className="text-sm text-white/90 leading-relaxed">
                {streamingTurn.text}
                {!isWaitingForVideo && activeTurnVideo && (
                  <span className="inline-block w-0.5 h-4 bg-white/60 ml-0.5 animate-pulse align-middle" />
                )}
              </p>
            </div>
          )}

          {/* Turn history — newest first */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {[...turns].reverse().map((turn, i) => (
              <div key={turn.id || i} className="px-4 py-3 rounded-xl border border-arena-border bg-arena-card/50">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold uppercase tracking-wider ${
                    turn.speaker === guest1 ? 'text-orange-400' :
                    turn.speaker === guest2 ? 'text-purple-400' : 'text-yellow-400'
                  }`}>{turn.speaker}</span>
                  <span className="text-xs text-arena-muted">Turn {turn.turn_number + 1}</span>
                </div>
                <p className="text-sm text-white/80 leading-relaxed">{turn.text}</p>

                {/* ── RAG Source Attribution ───────────────────────────────── */}
                {turn.turn_type === 'guest' && turn.sources && turn.sources.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-white/5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-arena-muted mb-1.5">
                      Grounded from
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {turn.sources.map((src, si) => (
                        <div
                          key={si}
                          title={src.snippet}
                          className="group relative flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] cursor-default"
                          style={{
                            background: turn.speaker === guest1
                              ? 'rgba(249,115,22,0.08)'
                              : turn.speaker === guest2
                              ? 'rgba(124,58,237,0.08)'
                              : 'rgba(245,158,11,0.08)',
                            border: turn.speaker === guest1
                              ? '1px solid rgba(249,115,22,0.2)'
                              : turn.speaker === guest2
                              ? '1px solid rgba(124,58,237,0.2)'
                              : '1px solid rgba(245,158,11,0.2)',
                          }}
                        >
                          {/* Source type dot */}
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{
                              background: src.chunk_type === 'newsletter'
                                ? '#34d399'
                                : '#60a5fa',
                            }}
                          />
                          {/* Episode title — truncated */}
                          <span className="text-white/70 max-w-[160px] truncate">
                            {src.title}
                          </span>
                          {/* Relevance badge */}
                          <span
                            className="ml-0.5 text-[10px] font-mono font-semibold flex-shrink-0"
                            style={{
                              color: src.relevance_score >= 0.75 ? '#4ade80'
                                   : src.relevance_score >= 0.5  ? '#facc15'
                                   : '#9ca3af'
                            }}
                          >
                            {Math.round(src.relevance_score * 100)}%
                          </span>
                          {/* Hover tooltip snippet */}
                          {src.snippet && (
                            <div className="absolute bottom-full left-0 mb-1 z-10 hidden group-hover:block w-64 p-2 rounded-lg text-[11px] text-white/80 leading-snug pointer-events-none"
                              style={{ background: 'rgba(15,15,20,0.97)', border: '1px solid rgba(255,255,255,0.1)' }}>
                              <span className="block font-semibold text-white/50 mb-0.5 text-[10px] uppercase tracking-wider">
                                {src.chunk_type === 'newsletter' ? '📰 Newsletter' : '🎙 Podcast'} · {src.date}
                              </span>
                              "{src.snippet}…"
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {turns.length === 0 && !streamingTurn && (
              <div className="flex flex-col items-center justify-center py-12 text-arena-muted">
                <Mic2 className="w-8 h-8 mb-3 opacity-30" />
                <p className="text-sm">The debate is about to begin...</p>
              </div>
            )}
          </div>

          {/* Manual next turn + auto-advance toggle */}
          {!autoAdvance && debateState === 'live' && !isComplete && sessionId && (
            <button onClick={streamNextTurn}
              className="flex-shrink-0 flex items-center justify-center gap-2 py-3 rounded-xl border border-arena-border bg-arena-card text-sm font-medium text-white hover:border-white/30 transition-all">
              <Play className="w-4 h-4" />
              Next Turn
            </button>
          )}

          <div className="flex-shrink-0 flex items-center justify-between px-1">
            <button onClick={() => setAutoAdvance(prev => !prev)}
              className="flex items-center gap-2 text-xs text-arena-muted hover:text-white transition-colors">
              <div className={`w-8 h-4 rounded-full transition-colors ${autoAdvance ? 'bg-orange-500' : 'bg-arena-border'} relative`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${autoAdvance ? 'left-4.5' : 'left-0.5'}`} />
              </div>
              Auto-advance
            </button>
            {error && <div className="text-xs text-red-400">⚠ {error}</div>}
          </div>
        </div>
      </div>

      {/* ── Voting overlay ───────────────────────────────────────────────────── */}
      {debateState === 'voting' && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6">
          <div className="w-full max-w-md bg-arena-card border border-arena-border rounded-2xl p-8 text-center">
            <Trophy className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
            <h2 className="text-2xl font-black text-white mb-2">Who won the debate?</h2>
            <p className="text-arena-muted text-sm mb-8">Cast your vote for the stronger argument</p>
            <div className="flex gap-4">
              {[guest1, guest2].map((name, i) => (
                <button key={name} onClick={() => handleVote(name)}
                  className={`flex-1 py-4 rounded-xl border-2 font-bold text-white transition-all hover:scale-105 ${
                    i === 0 ? 'border-orange-500 bg-orange-500/20 hover:bg-orange-500/30'
                             : 'border-purple-500 bg-purple-500/20 hover:bg-purple-500/30'
                  }`}>
                  {name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Results overlay ──────────────────────────────────────────────────── */}
      {debateState === 'results' && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-6 overflow-y-auto">
          <div className="w-full max-w-lg bg-arena-card border border-arena-border rounded-2xl p-8">
            <div className="text-center mb-6">
              <Trophy className="w-10 h-10 text-yellow-400 mx-auto mb-3" />
              <h2 className="text-2xl font-black text-white">Debate Results</h2>
            </div>

            <div className="flex gap-4 mb-6">
              {[guest1, guest2].map((name, i) => {
                const voteCount = votes[name] || 0
                const total = Object.values(votes).reduce((a, b) => a + b, 0) || 1
                const pct = Math.round((voteCount / total) * 100)
                return (
                  <div key={name} className={`flex-1 p-4 rounded-xl border text-center ${
                    i === 0 ? 'border-orange-500/40 bg-orange-500/10' : 'border-purple-500/40 bg-purple-500/10'
                  }`}>
                    <div className={`text-2xl font-black mb-1 ${i === 0 ? 'text-orange-400' : 'text-purple-400'}`}>{pct}%</div>
                    <div className="text-sm font-medium text-white">{name.split(' ')[0]}</div>
                    <div className="text-xs text-arena-muted mt-0.5">{voteCount} vote{voteCount !== 1 ? 's' : ''}</div>
                  </div>
                )
              })}
            </div>

            {summary && (
              <div className="mb-6 p-4 rounded-xl bg-white/5 border border-arena-border">
                <div className="text-xs font-bold text-arena-muted uppercase tracking-wider mb-2">Debate Summary</div>
                <p className="text-sm text-white/80 leading-relaxed">{summary}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={handleBack}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white border border-arena-border hover:border-white/30 transition-all">
                <ArrowLeft className="w-4 h-4" />
                {autostart ? 'Home' : 'Back'}
              </button>
              <button onClick={resetDebate}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
                <RefreshCw className="w-4 h-4" />
                New Debate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
