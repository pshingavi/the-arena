/**
 * useArenaMusic — Web Audio API hook for arena music.
 *
 * Provides:
 *   - startIntroJingle(): fanfare + crowd ambience intro sequence
 *   - startAmbient(): low-energy background drone during debate
 *   - stopAll(): silence everything
 *   - toggleMusic(): on/off toggle
 *   - musicOn: boolean state
 *
 * Pure Web Audio API — no external files needed.
 */
'use client'

import { useRef, useState, useCallback, useEffect } from 'react'

interface ArenaMusic {
  musicOn: boolean
  toggleMusic: () => void
  startIntroJingle: () => Promise<void>
  startAmbient: () => void
  stopAll: () => void
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createCtx(): AudioContext {
  return new (window.AudioContext || (window as any).webkitAudioContext)()
}

/** Play a single tone via OscillatorNode */
function tone(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  type: OscillatorType,
  startAt: number,
  duration: number,
  gainPeak: number = 0.18
): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(dest)

  osc.type = type
  osc.frequency.setValueAtTime(freq, startAt)

  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.05)
  gain.gain.setValueAtTime(gainPeak, startAt + duration - 0.1)
  gain.gain.linearRampToValueAtTime(0, startAt + duration)

  osc.start(startAt)
  osc.stop(startAt + duration + 0.01)
}

/** Create a reverb convolver with a synthetic impulse */
function createReverb(ctx: AudioContext, seconds = 1.5, decay = 2.0): ConvolverNode {
  const convolver = ctx.createConvolver()
  const sampleRate = ctx.sampleRate
  const length = sampleRate * seconds
  const impulse = ctx.createBuffer(2, length, sampleRate)

  for (let c = 0; c < 2; c++) {
    const channel = impulse.getChannelData(c)
    for (let i = 0; i < length; i++) {
      channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }
  convolver.buffer = impulse
  return convolver
}

/** Crowd murmur — filtered noise */
function createCrowdMurmur(ctx: AudioContext, dest: AudioNode, volume = 0.04): () => void {
  const bufferSize = ctx.sampleRate * 2
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1

  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 400
  filter.Q.value = 0.8

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, ctx.currentTime)
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.0)

  src.connect(filter)
  filter.connect(gain)
  gain.connect(dest)
  src.start()

  return () => {
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5)
    setTimeout(() => { try { src.stop() } catch {} }, 600)
  }
}

// ─── Intro Jingle ────────────────────────────────────────────────────────────
// "The Arena" fanfare: ascending triad + final resolution chord
// Inspired by podcast intro stings — bright, energetic, short (~4s)

const JINGLE_NOTES = [
  // [freq, type, offsetSec, durSec, gain]
  // Bass hit
  [55, 'sawtooth', 0.0, 0.3, 0.22],
  [55, 'sine', 0.0, 0.3, 0.15],
  // Rising arpeggio (A minor → C major feel)
  [220, 'triangle', 0.1, 0.25, 0.16],
  [277.18, 'triangle', 0.25, 0.25, 0.16],
  [329.63, 'triangle', 0.4, 0.25, 0.16],
  [440, 'triangle', 0.55, 0.35, 0.18],
  // Chord hit
  [261.63, 'sine', 0.9, 0.6, 0.12],
  [329.63, 'sine', 0.9, 0.6, 0.12],
  [392.0, 'sine', 0.9, 0.6, 0.12],
  [523.25, 'sine', 0.9, 0.6, 0.14],
  // Sparkle high
  [1046.5, 'sine', 1.0, 0.2, 0.08],
  [1174.66, 'sine', 1.15, 0.15, 0.06],
  // Final resolution
  [130.81, 'sawtooth', 1.6, 0.8, 0.18],
  [261.63, 'sine', 1.6, 0.8, 0.10],
  [392.0, 'sine', 1.6, 0.8, 0.10],
  [523.25, 'sine', 1.6, 0.8, 0.12],
] as const

async function playIntroJingle(ctx: AudioContext): Promise<void> {
  const reverb = createReverb(ctx, 1.2, 2.5)
  const masterGain = ctx.createGain()
  masterGain.gain.value = 0.7

  reverb.connect(masterGain)
  masterGain.connect(ctx.destination)

  const now = ctx.currentTime

  for (const [freq, type, offset, dur, gain] of JINGLE_NOTES) {
    tone(ctx, reverb, freq as number, type as OscillatorType, now + (offset as number), dur as number, gain as number)
  }

  // Wait for jingle to finish (longest note ends at ~2.4s)
  await new Promise<void>(resolve => setTimeout(resolve, 2600))
}

// ─── Ambient Background ──────────────────────────────────────────────────────
// Subtle drone: two detuned oscillators + slow LFO tremolo + filtered noise
// Volume is deliberately low — background texture only

interface AmbientNodes {
  stopFn: () => void
}

function startAmbientDrone(ctx: AudioContext): AmbientNodes {
  const masterGain = ctx.createGain()
  masterGain.gain.value = 0
  masterGain.connect(ctx.destination)

  // Fade in
  masterGain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 2.0)

  // LFO for slow tremolo
  const lfo = ctx.createOscillator()
  const lfoGain = ctx.createGain()
  lfo.frequency.value = 0.08  // very slow (12.5s period)
  lfoGain.gain.value = 0.03
  lfo.connect(lfoGain)
  lfoGain.connect(masterGain.gain)
  lfo.start()

  // Drone — two detuned oscillators for thickness
  const droneFreqs = [55.0, 54.6]  // very slight detune → gentle beating
  const droneOscs: OscillatorNode[] = []

  for (const freq of droneFreqs) {
    const osc = ctx.createOscillator()
    const oscGain = ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.value = freq
    oscGain.gain.value = 0.35

    // Low-pass to make it warm/soft
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 280
    filter.Q.value = 1.2

    osc.connect(filter)
    filter.connect(oscGain)
    oscGain.connect(masterGain)
    osc.start()
    droneOscs.push(osc)
  }

  // High harmonic shimmer (very subtle)
  const shimmer = ctx.createOscillator()
  const shimGain = ctx.createGain()
  shimmer.type = 'sine'
  shimmer.frequency.value = 440
  shimGain.gain.value = 0.018
  shimmer.connect(shimGain)
  shimGain.connect(masterGain)
  shimmer.start()

  // Crowd murmur underneath
  const stopCrowd = createCrowdMurmur(ctx, masterGain, 0.08)

  const stopFn = () => {
    masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5)
    stopCrowd()
    setTimeout(() => {
      try {
        droneOscs.forEach(o => o.stop())
        shimmer.stop()
        lfo.stop()
      } catch {}
    }, 1600)
  }

  return { stopFn }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useArenaMusic(): ArenaMusic {
  const ctxRef = useRef<AudioContext | null>(null)
  const ambientRef = useRef<AmbientNodes | null>(null)
  const [musicOn, setMusicOn] = useState(true)

  // Ensure AudioContext is created lazily (requires user gesture)
  const getCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) {
      ctxRef.current = createCtx()
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume()
    }
    return ctxRef.current
  }, [])

  const stopAll = useCallback(() => {
    if (ambientRef.current) {
      ambientRef.current.stopFn()
      ambientRef.current = null
    }
    if (ctxRef.current) {
      ctxRef.current.close()
      ctxRef.current = null
    }
  }, [])

  const startIntroJingle = useCallback(async () => {
    if (!musicOn) return
    const ctx = getCtx()
    await playIntroJingle(ctx)
  }, [musicOn, getCtx])

  const startAmbient = useCallback(() => {
    if (!musicOn) return
    if (ambientRef.current) return // already running
    const ctx = getCtx()
    ambientRef.current = startAmbientDrone(ctx)
  }, [musicOn, getCtx])

  const toggleMusic = useCallback(() => {
    setMusicOn(prev => {
      const next = !prev
      if (!next) {
        // Turning off — stop everything
        if (ambientRef.current) {
          ambientRef.current.stopFn()
          ambientRef.current = null
        }
      } else {
        // Turning on — restart ambient if debate is in progress
        // Caller can re-invoke startAmbient() after toggling
      }
      return next
    })
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll()
    }
  }, [stopAll])

  return { musicOn, toggleMusic, startIntroJingle, startAmbient, stopAll }
}
