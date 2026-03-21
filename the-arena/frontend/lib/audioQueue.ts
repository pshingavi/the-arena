'use client'

/**
 * useAudioQueue
 *
 * Plays synthesised speech sentence-by-sentence in perfect sync with text.
 *
 * iOS Safari note: HTMLAudioElement.play() is blocked after async operations
 * (e.g. a fetch) unless directly triggered by a user gesture. We pre-decode
 * each clip into an AudioBuffer via Web Audio API (which IS reusable once the
 * AudioContext is unlocked by the first gesture) and play through a
 * BufferSource. HTMLAudioElement is kept as desktop fallback only.
 *
 * Callbacks:
 *   onSentenceStart(text, durationMs, priorText) — fires when sentence starts
 *   onQueueEmpty()  — fires when every sentence has finished playing
 */

import { useRef, useCallback, useEffect } from 'react'
import { API_URL } from './api'
import { getUnlockedAudioContext } from './audioUnlock'

export interface AudioQueueOptions {
  onSentenceStart?: (text: string, durationMs: number, priorText: string) => void
  onQueueEmpty?: () => void
}

export interface AudioQueueHandle {
  addChunk: (chunk: string, speaker: string) => void
  flush: (speaker: string) => void
  stopAll: () => void
  enqueue: (text: string, speaker: string) => Promise<void>
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  isPlayingRef: React.MutableRefObject<boolean>
  synthInFlightRef: React.MutableRefObject<number>
}

// Stored queue item — carries a decoded AudioBuffer (preferred) or blob URL fallback
interface QueueItem {
  text: string
  audioBuffer?: AudioBuffer   // decoded via Web Audio — works on iOS
  blobUrl?: string            // fallback for browsers where decoding fails
}

// ─── Sentence boundary detection ─────────────────────────────────────────────
function extractSentences(text: string): { sentences: string[]; remaining: string } {
  const pattern = /[^.!?…\n]*[.!?…]+(?:\s+|$)/g
  const sentences: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const s = match[0].trim()
    if (s.length >= 16) sentences.push(s)
    lastIndex = pattern.lastIndex
  }
  return { sentences, remaining: text.slice(lastIndex) }
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useAudioQueue(options: AudioQueueOptions = {}): AudioQueueHandle {
  const callbacksRef = useRef(options)
  useEffect(() => { callbacksRef.current = options })

  const queueRef          = useRef<QueueItem[]>([])
  const pendingTextRef    = useRef('')
  const isPlayingRef      = useRef(false)
  const synthInFlightRef  = useRef(0)
  const stoppedRef        = useRef(false)       // set by stopAll to abort in-flight plays

  // Web Audio
  const audioCtxRef    = useRef<AudioContext | null>(null)
  const analyserRef    = useRef<AnalyserNode | null>(null)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)  // Web Audio path
  const currentAudioRef  = useRef<HTMLAudioElement | null>(null)       // fallback path
  const cumulativeTextRef = useRef('')

  // ── AudioContext — prefer pre-unlocked singleton, create fallback if needed ──
  const getAudioCtx = useCallback(async (): Promise<AudioContext | null> => {
    if (typeof window === 'undefined') return null
    try {
      if (!audioCtxRef.current) {
        // Use the context that was created synchronously in the gesture handler
        // (unlockAudioOnGesture). This is already in iOS "playback" session.
        const unlocked = getUnlockedAudioContext()
        if (unlocked) {
          audioCtxRef.current = unlocked.ctx
          analyserRef.current  = unlocked.analyser
        } else {
          // Fallback: create fresh (works on desktop; may not play on iOS speaker)
          const Ctx = window.AudioContext || (window as any).webkitAudioContext
          audioCtxRef.current = new Ctx()
          const analyser = audioCtxRef.current.createAnalyser()
          analyser.fftSize = 32
          analyser.connect(audioCtxRef.current.destination)
          analyserRef.current = analyser
        }
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume()
      }
      return audioCtxRef.current
    } catch {
      return null
    }
  }, [])

  // ── Queue exhaustion check ──────────────────────────────────────────────────
  const checkEmpty = useCallback(() => {
    if (!stoppedRef.current &&
        queueRef.current.length === 0 &&
        synthInFlightRef.current === 0 &&
        !isPlayingRef.current) {
      callbacksRef.current.onQueueEmpty?.()
    }
  }, [])

  // ── Play next item from queue ───────────────────────────────────────────────
  const playNext = useCallback(async () => {
    if (stoppedRef.current) return

    if (queueRef.current.length === 0) {
      isPlayingRef.current = false
      if (synthInFlightRef.current > 0) {
        setTimeout(playNext, 120)
      } else {
        callbacksRef.current.onQueueEmpty?.()
      }
      return
    }

    isPlayingRef.current = true
    const item = queueRef.current.shift()!
    const { text } = item
    const priorText = cumulativeTextRef.current

    const advance = () => {
      if (stoppedRef.current) return
      cumulativeTextRef.current = priorText + text
      currentSourceRef.current = null
      currentAudioRef.current  = null
      isPlayingRef.current = false
      playNext()
    }

    // ── Web Audio path (preferred — works on iOS after context unlock) ────────
    if (item.audioBuffer) {
      try {
        const ctx = await getAudioCtx()
        if (!ctx || stoppedRef.current) return
        const source = ctx.createBufferSource()
        source.buffer = item.audioBuffer
        source.connect(analyserRef.current ?? ctx.destination)
        currentSourceRef.current = source

        const durationMs = item.audioBuffer.duration * 1000
        callbacksRef.current.onSentenceStart?.(text, durationMs, priorText)

        source.onended = advance

        // Ensure context is running (iOS may re-suspend between sentences)
        if (ctx.state === 'suspended') await ctx.resume()
        source.start(0)
        return
      } catch {
        advance()
        return
      }
    }

    // ── HTMLAudioElement fallback (desktop browsers) ──────────────────────────
    if (item.blobUrl) {
      const audio = new Audio(item.blobUrl)
      currentAudioRef.current = audio

      const ctx = await getAudioCtx()
      if (ctx && analyserRef.current && !stoppedRef.current) {
        try {
          const src = ctx.createMediaElementSource(audio)
          src.connect(analyserRef.current)
        } catch { /* Safari: can only attach once per element */ }
      }

      audio.onloadedmetadata = () => {
        if (stoppedRef.current) return
        const durationMs = Math.max((audio.duration || 1) * 1000, 200)
        callbacksRef.current.onSentenceStart?.(text, durationMs, priorText)
      }
      audio.onended = () => { URL.revokeObjectURL(item.blobUrl!); advance() }
      audio.onerror = () => { URL.revokeObjectURL(item.blobUrl!); advance() }
      audio.play().catch(() => { URL.revokeObjectURL(item.blobUrl!); advance() })
      return
    }

    // Nothing playable — skip
    advance()
  }, [getAudioCtx])

  // ── Enqueue a sentence: fetch TTS, decode into AudioBuffer ─────────────────
  const enqueue = useCallback(async (text: string, speaker: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length < 4) return

    synthInFlightRef.current += 1
    try {
      const res = await fetch(`${API_URL}/debate/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, speaker }),
      })
      if (!res.ok || stoppedRef.current) return

      const arrayBuffer = await res.arrayBuffer()
      if (arrayBuffer.byteLength < 100 || stoppedRef.current) return

      // Try to decode via Web Audio (iOS-safe path)
      const ctx = await getAudioCtx()
      if (ctx && !stoppedRef.current) {
        try {
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
          if (!stoppedRef.current) {
            queueRef.current.push({ text: trimmed, audioBuffer })
            if (!isPlayingRef.current) playNext()
            return
          }
        } catch {
          // decoding failed — fall through to blob URL
        }
      }

      // Fallback: blob URL + HTMLAudioElement
      if (!stoppedRef.current) {
        const blob = new Blob([arrayBuffer])
        const blobUrl = URL.createObjectURL(blob)
        queueRef.current.push({ text: trimmed, blobUrl })
        if (!isPlayingRef.current) playNext()
      }
    } catch {
      // ElevenLabs not configured or network error — silent fallback
    } finally {
      synthInFlightRef.current -= 1
      if (synthInFlightRef.current === 0 && !isPlayingRef.current && queueRef.current.length === 0) {
        if (!stoppedRef.current) callbacksRef.current.onQueueEmpty?.()
      }
    }
  }, [getAudioCtx, playNext])

  const addChunk = useCallback((chunk: string, speaker: string) => {
    pendingTextRef.current += chunk
    const { sentences, remaining } = extractSentences(pendingTextRef.current)
    pendingTextRef.current = remaining
    for (const s of sentences) enqueue(s, speaker)
  }, [enqueue])

  const flush = useCallback((speaker: string) => {
    const leftover = pendingTextRef.current.trim()
    pendingTextRef.current = ''
    if (leftover.length >= 4) enqueue(leftover, speaker)
    // If ElevenLabs not configured, nothing enqueued — fire empty after short delay
    setTimeout(() => {
      if (queueRef.current.length === 0 && synthInFlightRef.current === 0 && !isPlayingRef.current) {
        if (!stoppedRef.current) callbacksRef.current.onQueueEmpty?.()
      }
    }, 200)
  }, [enqueue])

  const stopAll = useCallback(() => {
    stoppedRef.current = true

    // Stop Web Audio BufferSource
    try { currentSourceRef.current?.stop() } catch {}
    currentSourceRef.current = null

    // Stop HTMLAudioElement fallback
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current.src = ''
      currentAudioRef.current = null
    }

    // Clear queue, revoke any blob URLs
    queueRef.current.forEach(item => {
      if (item.blobUrl) try { URL.revokeObjectURL(item.blobUrl) } catch {}
    })
    queueRef.current = []
    pendingTextRef.current    = ''
    cumulativeTextRef.current = ''
    isPlayingRef.current      = false

    // Re-arm for future use (e.g. after resetDebate)
    setTimeout(() => { stoppedRef.current = false }, 50)
  }, [])

  // Cleanup on unmount
  useEffect(() => () => {
    stoppedRef.current = true
    stopAll()
    audioCtxRef.current?.close()
    audioCtxRef.current = null
  }, [stopAll])

  return { addChunk, flush, stopAll, enqueue, analyserRef, isPlayingRef, synthInFlightRef }
}
