'use client'

/**
 * StudioStage — cinematic three-panel podcast studio for The Arena.
 *
 * Visual design goals:
 *   - Dark broadcast studio aesthetic (think: late-night debate show)
 *   - Active speaker: spotlight focus, larger frame, colored rim light, ON AIR badge
 *   - Preparing speaker: slightly brightened, subtle pulsing "NEXT" badge
 *   - Listening speakers: blurred edges, dimmed, breathing animation
 *   - Idle: grayscale, stepped back further
 *   - Smooth flex-grow transitions as active speaker changes
 *   - Studio lighting simulation via CSS gradients (key light, fill, rim)
 *   - HeyGen video slots in seamlessly when ready — onVideoReady drives typewriter
 *   - Audio-reactive waveform bars via AnalyserNode
 */

import { useEffect, useRef } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────
export type SpeakerState = 'speaking' | 'preparing' | 'listening' | 'idle'

export interface SpeakerConfig {
  name: string
  role: 'host' | 'guest'
  color: 'orange' | 'purple' | 'gold'
  state: SpeakerState
  videoUrl?: string        // URL of video to play (current-turn HeyGen video)
  turnCount: number
  // Callbacks for HeyGen video synchronization
  onVideoReady?: (durationMs: number) => void  // fires on loadedmetadata
  onVideoEnded?: () => void                     // fires when video playback ends
}

// ─── Color palette ───────────────────────────────────────────────────────────
const COLORS = {
  orange: { hex: '#f97316', rgb: '249,115,22', glow: 'rgba(249,115,22,0.35)', rim: 'rgba(249,115,22,0.7)' },
  purple: { hex: '#7c3aed', rgb: '124,58,237', glow: 'rgba(124,58,237,0.35)', rim: 'rgba(124,58,237,0.7)'  },
  gold:   { hex: '#f59e0b', rgb: '245,158,11', glow: 'rgba(245,158,11,0.35)',  rim: 'rgba(245,158,11,0.7)'  },
}

// ─── Audio-reactive waveform ─────────────────────────────────────────────────
function AudioWaveform({
  active,
  color,
  analyserRef,
}: {
  active: boolean
  color: 'orange' | 'purple' | 'gold'
  analyserRef: React.MutableRefObject<AnalyserNode | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number>(0)
  const c = COLORS[color]

  useEffect(() => {
    if (!active) {
      cancelAnimationFrame(frameRef.current)
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const BAR_COUNT = 14
    const fallback = [0.15, 0.3, 0.5, 0.35, 0.7, 0.45, 0.9, 0.55, 0.4, 0.75, 0.3, 0.6, 0.2, 0.5]
    let simPhase = 0

    const draw = () => {
      frameRef.current = requestAnimationFrame(draw)
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      let levels: number[] = []

      if (analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(data)
        const step = Math.floor(data.length / BAR_COUNT)
        for (let i = 0; i < BAR_COUNT; i++) {
          levels.push(data[i * step] / 255)
        }
        if (levels.every(v => v === 0)) {
          simPhase += 0.05
          levels = fallback.map((v, i) => v * 0.6 + Math.sin(simPhase + i * 0.5) * 0.3 + 0.1)
        }
      } else {
        simPhase += 0.04
        levels = fallback.map((v, i) => v * 0.5 + Math.sin(simPhase + i * 0.6) * 0.35 + 0.15)
      }

      const barW = Math.floor(W / (BAR_COUNT * 1.8))
      const gap = Math.floor((W - barW * BAR_COUNT) / (BAR_COUNT + 1))

      for (let i = 0; i < BAR_COUNT; i++) {
        const h = Math.max(3, levels[i] * H)
        const x = gap + i * (barW + gap)
        const y = (H - h) / 2

        const grad = ctx.createLinearGradient(x, y, x, y + h)
        grad.addColorStop(0, c.hex + 'ff')
        grad.addColorStop(1, c.hex + '44')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.roundRect(x, y, barW, h, 2)
        ctx.fill()
      }
    }

    draw()
    return () => cancelAnimationFrame(frameRef.current)
  }, [active, c.hex, analyserRef])

  if (!active) {
    return (
      <div className="flex items-center gap-0.5 h-4">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} style={{ width: 3, height: 3, borderRadius: 1, background: 'rgba(255,255,255,0.12)' }} />
        ))}
      </div>
    )
  }

  return (
    <canvas
      ref={canvasRef}
      width={100}
      height={32}
      style={{ width: 100, height: 32 }}
    />
  )
}

// ─── Studio Avatar frame ──────────────────────────────────────────────────────
function StudioAvatar({
  name, role, state, color, videoUrl, turnCount, analyserRef,
  onVideoReady, onVideoEnded,
}: SpeakerConfig & { analyserRef: React.MutableRefObject<AnalyserNode | null> }) {
  const isSpeaking  = state === 'speaking'
  const isPreparing = state === 'preparing'
  const isListening = state === 'listening'
  const c = COLORS[color]

  const videoRef = useRef<HTMLVideoElement>(null)

  // Attach video callbacks whenever videoUrl changes.
  // We call video.play() explicitly rather than relying on the autoPlay
  // HTML attribute — this gives us a Promise we can catch, allowing silent
  // fallback to muted play when the browser's autoplay-with-audio policy
  // blocks playback (common on fresh page loads).
  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl) return

    let readyFired = false

    // Fire onVideoReady exactly once, only when we have a real duration.
    // Both loadedmetadata and durationchange can deliver the duration —
    // whichever arrives first with a finite non-zero value wins.
    const fireReady = () => {
      if (readyFired) return
      const dur = video.duration
      if (!dur || isNaN(dur) || !isFinite(dur) || dur <= 0) return
      readyFired = true
      onVideoReady?.(dur * 1000)
    }

    const handleMeta         = () => fireReady()
    const handleDurationChange = () => fireReady()
    const handleEnded        = () => onVideoEnded?.()

    video.addEventListener('loadedmetadata',  handleMeta,           { once: true })
    video.addEventListener('durationchange',  handleDurationChange)
    video.addEventListener('ended',           handleEnded,          { once: true })

    // If the browser already has metadata (e.g. cached HeyGen video), fire now.
    if (video.readyState >= 1 && video.duration > 0 && isFinite(video.duration)) {
      fireReady()
    }

    // Explicitly call play() — the HTML autoPlay attribute alone is often
    // blocked when the video has audio and the browser has a strict
    // Autoplay with Sound policy.  We try unmuted first (full experience),
    // then fall back to muted (visual only) so the avatar at least moves.
    video.play().catch(() => {
      video.muted = true
      video.play().catch(() => {
        // Even muted autoplay was rejected.  loadedmetadata / durationchange
        // will still fire once the browser loads metadata, so the typewriter
        // will start.  The video just won't play visually.
      })
    })

    return () => {
      video.removeEventListener('loadedmetadata',  handleMeta)
      video.removeEventListener('durationchange',  handleDurationChange)
      video.removeEventListener('ended',           handleEnded)
      video.pause()
    }
  }, [videoUrl, onVideoReady, onVideoEnded])

  const shortName = role === 'host'
    ? 'Lenny R.'
    : name.split(' ').length >= 2
      ? `${name.split(' ')[0]} ${name.split(' ')[1][0]}.`
      : name

  // Frame sizing by state
  const frameStyle: React.CSSProperties = {
    flex: isSpeaking ? '1.9 1 0' : isPreparing ? '1.3 1 0' : '1 1 0',
    minWidth: isSpeaking ? 200 : isPreparing ? 150 : 130,
    maxWidth: isSpeaking ? 320 : isPreparing ? 240 : 200,
    transition: 'all 0.55s cubic-bezier(0.34, 1.2, 0.64, 1)',
    opacity: state === 'idle' ? 0.42 : state === 'listening' ? 0.72 : state === 'preparing' ? 0.85 : 1,
    filter: state === 'idle' ? 'grayscale(65%)' : 'none',
    transform: isSpeaking ? 'translateY(0) scale(1)' : isPreparing ? 'translateY(4px) scale(0.97)' : isListening ? 'translateY(6px) scale(0.95)' : 'translateY(12px) scale(0.88)',
    zIndex: isSpeaking ? 10 : isPreparing ? 7 : isListening ? 5 : 1,
    position: 'relative' as const,
  }

  const portraitSize = isSpeaking ? 110 : isPreparing ? 88 : 76

  return (
    <div style={frameStyle}>
      {/* Camera frame card */}
      <div style={{
        borderRadius: 14,
        overflow: 'hidden',
        border: isSpeaking
          ? `1.5px solid ${c.hex}bb`
          : isPreparing
          ? `1px solid ${c.hex}44`
          : '1px solid rgba(255,255,255,0.05)',
        background: isSpeaking
          ? `radial-gradient(ellipse at 45% 18%, rgba(255,248,220,0.05) 0%, #060610 55%)`
          : '#060610',
        boxShadow: isSpeaking
          ? `0 0 70px rgba(${c.rgb},0.22), 0 0 140px rgba(${c.rgb},0.08), inset 0 0 40px rgba(${c.rgb},0.04), 0 20px 60px rgba(0,0,0,0.8)`
          : isPreparing
          ? `0 0 30px rgba(${c.rgb},0.08), 0 8px 32px rgba(0,0,0,0.6)`
          : '0 8px 32px rgba(0,0,0,0.6)',
        padding: isSpeaking ? '24px 18px 18px' : '16px 12px 12px',
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        gap: 10,
        minHeight: isSpeaking ? 280 : 195,
        transition: 'all 0.55s cubic-bezier(0.34, 1.2, 0.64, 1)',
        position: 'relative' as const,
      }}>

        {/* ON AIR badge — shown whenever this speaker is active (audio or video) */}
        {isSpeaking && (
          <div style={{
            position: 'absolute', top: 10, right: 10,
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(0,0,0,0.75)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 100, padding: '3px 9px',
            fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: '#fff',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#ef4444',
              boxShadow: '0 0 6px #ef4444',
              animation: 'pulse 1s cubic-bezier(0.4,0,0.6,1) infinite',
              display: 'inline-block',
            }} />
            ON AIR
          </div>
        )}

        {/* NEXT UP badge — for preparing state */}
        {isPreparing && (
          <div style={{
            position: 'absolute', top: 10, right: 10,
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(0,0,0,0.55)',
            border: `1px solid ${c.hex}33`,
            borderRadius: 100, padding: '2px 7px',
            fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
            color: `rgba(${c.rgb},0.7)`,
          }}>
            <span style={{
              width: 4, height: 4, borderRadius: '50%', background: c.hex,
              opacity: 0.7,
              animation: 'pulse 1.8s ease-in-out infinite',
              display: 'inline-block',
            }} />
            NEXT
          </div>
        )}

        {/* Portrait circle */}
        <div style={{
          width: portraitSize,
          height: portraitSize,
          borderRadius: '50%',
          overflow: 'hidden',
          position: 'relative' as const,
          flexShrink: 0,
          transition: 'all 0.5s ease',
          background: [
            `radial-gradient(circle at 35% 25%, rgba(255,245,210,0.22) 0%, transparent 42%)`,
            `radial-gradient(circle at 72% 75%, rgba(${c.rgb},0.28) 0%, transparent 45%)`,
            `radial-gradient(ellipse at 50% 50%, #1a1a2a 0%, #050508 100%)`,
          ].join(', '),
          boxShadow: isSpeaking
            ? `0 0 0 2.5px ${c.hex}cc, 0 0 25px rgba(${c.rgb},0.45), 0 0 50px rgba(${c.rgb},0.15), inset 0 0 15px rgba(${c.rgb},0.08)`
            : isPreparing
            ? `0 0 0 1.5px ${c.hex}44`
            : `0 0 0 1px rgba(255,255,255,0.07)`,
          animation: isListening ? 'breathe 4.5s ease-in-out infinite' : 'none',
        }}>

          {videoUrl ? (
            /* HeyGen video — no loop, no autoPlay attr (play() called in useEffect) */
            <video
              ref={videoRef}
              src={videoUrl}
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <>
              {/* Key light overlay */}
              <div style={{
                position: 'absolute', inset: 0,
                background: `radial-gradient(circle at 30% 22%, rgba(255,240,200,0.12) 0%, transparent 55%)`,
                pointerEvents: 'none',
              }} />

              {/* Rim light sweep — right edge when speaking */}
              {(isSpeaking || isPreparing) && (
                <div style={{
                  position: 'absolute', top: 0, right: 0, bottom: 0, width: '30%',
                  background: `linear-gradient(to left, rgba(${c.rgb},${isSpeaking ? '0.18' : '0.10'}) 0%, transparent 100%)`,
                  pointerEvents: 'none',
                }} />
              )}

              {/* Initial / emoji */}
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: isSpeaking ? 40 : 28,
                fontWeight: 900,
                color: isSpeaking
                  ? `rgba(${c.rgb},1)`
                  : isPreparing
                  ? `rgba(${c.rgb},0.65)`
                  : 'rgba(255,255,255,0.45)',
                textShadow: isSpeaking
                  ? `0 0 30px rgba(${c.rgb},0.6), 0 0 60px rgba(${c.rgb},0.3)`
                  : 'none',
                fontFamily: 'Inter, sans-serif',
                userSelect: 'none',
                transition: 'all 0.4s ease',
              }}>
                {role === 'host' ? '🎙' : name[0].toUpperCase()}
              </div>
            </>
          )}

          {/* Speaking ring — shown whenever this speaker is active */}
          {isSpeaking && (
            <div style={{
              position: 'absolute', inset: -4,
              borderRadius: '50%',
              border: `2px solid ${c.hex}88`,
              animation: 'speakingRing 1.3s ease-in-out infinite',
              pointerEvents: 'none',
            }} />
          )}
        </div>

        {/* Name lower-third */}
        <div style={{ textAlign: 'center', width: '100%', lineHeight: 1.3 }}>
          <div style={{
            fontSize: isSpeaking ? 13 : 11,
            fontWeight: 700,
            color: isSpeaking ? '#fff' : isPreparing ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.45)',
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'all 0.4s ease',
          }}>
            {shortName}
          </div>

          {role === 'host' && (
            <div style={{ fontSize: 9, color: c.hex, fontWeight: 700, letterSpacing: '0.1em', marginTop: 2 }}>
              HOST
            </div>
          )}
          {isSpeaking && role !== 'host' && (
            <div style={{ fontSize: 9, color: c.hex, fontWeight: 700, letterSpacing: '0.1em', marginTop: 2 }}>
              ● SPEAKING
            </div>
          )}
        </div>

        {/* Waveform — active whenever this speaker is on air */}
        <AudioWaveform active={isSpeaking} color={color} analyserRef={analyserRef} />

        {/* Turn count */}
        {turnCount > 0 && !isSpeaking && !isPreparing && (
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)', marginTop: -4 }}>
            {turnCount} turn{turnCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stage backdrop ───────────────────────────────────────────────────────────
function StageBackdrop({ activeSpeakerColor }: { activeSpeakerColor: 'orange' | 'purple' | 'gold' | null }) {
  const fog = {
    orange: 'radial-gradient(ellipse 55% 70% at 22% 60%, rgba(249,115,22,0.06) 0%, transparent 70%)',
    purple: 'radial-gradient(ellipse 55% 70% at 78% 60%, rgba(124,58,237,0.06) 0%, transparent 70%)',
    gold:   'radial-gradient(ellipse 55% 70% at 50% 60%, rgba(245,158,11,0.06) 0%, transparent 70%)',
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 16 }}>
      {/* Base studio dark */}
      <div style={{ position: 'absolute', inset: 0, background: '#03030a' }} />

      {/* Subtle top-down stage lighting */}
      <div style={{
        position: 'absolute', inset: 0,
        background: [
          'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(255,255,255,0.025) 0%, transparent 60%)',
          fog.orange,
          fog.purple,
          fog.gold,
        ].join(', '),
        transition: 'opacity 1.2s ease',
      }} />

      {/* Active speaker colored spotlight beam from above */}
      {activeSpeakerColor && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: activeSpeakerColor === 'orange' ? '18%' : activeSpeakerColor === 'gold' ? '50%' : '82%',
          transform: 'translateX(-50%)',
          width: '25%',
          height: '100%',
          background: `linear-gradient(to bottom, rgba(${COLORS[activeSpeakerColor].rgb},0.08) 0%, transparent 60%)`,
          transition: 'left 0.6s ease, background 0.6s ease',
          pointerEvents: 'none',
        }} />
      )}

      {/* Stage floor reflection line */}
      <div style={{
        position: 'absolute', bottom: 0, left: '5%', right: '5%', height: 1,
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 20%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 80%, transparent 100%)',
      }} />

      {/* Subtle ceiling track lights */}
      <div style={{
        position: 'absolute', top: 0, left: '25%', right: '25%', height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05) 50%, transparent)',
      }} />

      {/* Left and right edge vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to right, rgba(0,0,0,0.35) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.35) 100%)',
        pointerEvents: 'none',
      }} />
    </div>
  )
}

// ─── Main StudioStage export ──────────────────────────────────────────────────
export function StudioStage({
  speakers,
  analyserRef,
}: {
  speakers: SpeakerConfig[]
  analyserRef: React.MutableRefObject<AnalyserNode | null>
}) {
  const activeSpeaker = speakers.find(s => s.state === 'speaking')

  return (
    <div style={{
      position: 'relative',
      borderRadius: 16,
      overflow: 'hidden',
      padding: '0 0 8px',
      minHeight: 300,
    }}>
      <StageBackdrop activeSpeakerColor={activeSpeaker?.color ?? null} />

      {/* Three-camera stage */}
      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: 10,
        padding: '28px 20px 20px',
        zIndex: 1,
      }}>
        {speakers.map((sp) => (
          <StudioAvatar
            key={sp.name}
            {...sp}
            analyserRef={analyserRef}
          />
        ))}
      </div>
    </div>
  )
}
