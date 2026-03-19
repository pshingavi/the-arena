'use client'

/**
 * useAudioQueue
 *
 * Plays synthesised speech sentence-by-sentence in perfect sync with text.
 *
 * Callbacks:
 *   onSentenceStart(text, durationMs) — fires when a sentence's audio begins
 *     playing. Use this to drive the typewriter: reveal `text` over `durationMs`.
 *   onQueueEmpty() — fires when every sentence has finished playing AND all
 *     in-flight TTS fetches are done. Use this to advance to the next turn.
 *
 * The hook also exposes:
 *   analyserRef  — Web Audio AnalyserNode for waveform visualisation
 *   isPlayingRef — true while audio is playing
 *   synthInFlightRef — number of pending TTS fetch requests
 */

import { useRef, useCallback, useEffect } from 'react'
import { API_URL } from './api'

export interface AudioQueueOptions {
  /**
   * Fires when a sentence's audio begins playing.
   * @param text       The sentence text being spoken
   * @param durationMs The exact duration of this audio clip (ms)
   * @param priorText  Everything that was spoken before this sentence —
   *                   use this to snap the display to the correct position
   *                   before starting the per-sentence typewriter.
   */
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
  // Keep callbacks in a ref so they're always fresh without causing re-renders
  const callbacksRef = useRef(options)
  useEffect(() => { callbacksRef.current = options })

  const queueRef       = useRef<Array<{ url: string; text: string }>>([])
  const pendingTextRef = useRef('')
  const isPlayingRef   = useRef(false)
  const synthInFlightRef  = useRef(0)
  const currentAudioRef   = useRef<HTMLAudioElement | null>(null)
  // Tracks the concatenation of every sentence that has FINISHED playing.
  // Passed to onSentenceStart as `priorText` so the caller can snap the
  // typewriter display to the correct position before revealing the next sentence.
  const cumulativeTextRef = useRef('')

  // Web Audio for waveform visualisation
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const analyserRef  = useRef<AnalyserNode | null>(null)

  const getAudioCtx = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext
        audioCtxRef.current = new Ctx()
        const analyser = audioCtxRef.current.createAnalyser()
        analyser.fftSize = 32
        analyser.connect(audioCtxRef.current.destination)
        analyserRef.current = analyser
      }
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
      return audioCtxRef.current
    } catch {
      return null
    }
  }, [])

  // Check whether the queue is truly exhausted (no items + no pending fetches)
  const checkEmpty = useCallback(() => {
    if (queueRef.current.length === 0 && synthInFlightRef.current === 0 && !isPlayingRef.current) {
      callbacksRef.current.onQueueEmpty?.()
    }
  }, [])

  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      isPlayingRef.current = false
      // Poll briefly in case synthesis is still in flight
      if (synthInFlightRef.current > 0) {
        setTimeout(playNext, 120)
      } else {
        callbacksRef.current.onQueueEmpty?.()
      }
      return
    }

    isPlayingRef.current = true
    const { url, text } = queueRef.current.shift()!
    const audio = new Audio(url)
    currentAudioRef.current = audio

    // Capture priorText at the moment this sentence STARTS — it's everything
    // spoken before this sentence, which the caller uses to snap the display.
    const priorText = cumulativeTextRef.current

    // Connect to analyser for waveform
    const ctx = getAudioCtx()
    if (ctx && analyserRef.current) {
      try {
        const src = ctx.createMediaElementSource(audio)
        src.connect(analyserRef.current)
      } catch { /* Safari: can only attach once per element */ }
    }

    // Fire onSentenceStart with the actual audio duration once metadata is loaded.
    // Pass priorText so the caller can snap the typewriter to the correct position
    // before revealing this sentence — prevents the display cursor from drifting
    // when sentences play faster than the previous typewriter animation completes.
    audio.onloadedmetadata = () => {
      const durationMs = Math.max((audio.duration || 1) * 1000, 200)
      callbacksRef.current.onSentenceStart?.(text, durationMs, priorText)
    }

    audio.onended = () => {
      // Commit this sentence to the cumulative log so the NEXT sentence's
      // priorText will include it.
      cumulativeTextRef.current = priorText + text
      URL.revokeObjectURL(url)
      currentAudioRef.current = null
      playNext()
    }
    audio.onerror = () => {
      // Even on error, advance cumulative so subsequent sentences position correctly.
      cumulativeTextRef.current = priorText + text
      URL.revokeObjectURL(url)
      currentAudioRef.current = null
      playNext()
    }

    audio.play().catch(() => {
      cumulativeTextRef.current = priorText + text
      URL.revokeObjectURL(url)
      currentAudioRef.current = null
      playNext()
    })
  }, [getAudioCtx, checkEmpty])

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
      if (!res.ok) return

      const blob = await res.blob()
      if (blob.size < 100) return

      const url = URL.createObjectURL(blob)
      queueRef.current.push({ url, text: trimmed })

      if (!isPlayingRef.current) playNext()
    } catch {
      // ElevenLabs not configured or network error — silent fallback
    } finally {
      synthInFlightRef.current -= 1
      // If we decremented to 0 and nothing is playing, check if queue is done
      if (synthInFlightRef.current === 0 && !isPlayingRef.current && queueRef.current.length === 0) {
        callbacksRef.current.onQueueEmpty?.()
      }
    }
  }, [playNext])

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
    // If ElevenLabs not configured nothing will be enqueued, so fire empty immediately
    setTimeout(() => {
      if (queueRef.current.length === 0 && synthInFlightRef.current === 0 && !isPlayingRef.current) {
        callbacksRef.current.onQueueEmpty?.()
      }
    }, 200)
  }, [enqueue])

  const stopAll = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current.src = ''
      currentAudioRef.current = null
    }
    queueRef.current.forEach(({ url }) => { try { URL.revokeObjectURL(url) } catch {} })
    queueRef.current = []
    pendingTextRef.current = ''
    cumulativeTextRef.current = ''
    isPlayingRef.current = false
    // Don't fire onQueueEmpty on stopAll — caller is explicitly stopping
  }, [])

  useEffect(() => () => {
    stopAll()
    audioCtxRef.current?.close()
    audioCtxRef.current = null
  }, [stopAll])

  return { addChunk, flush, stopAll, enqueue, analyserRef, isPlayingRef, synthInFlightRef }
}
