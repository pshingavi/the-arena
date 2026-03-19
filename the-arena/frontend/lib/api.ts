import { Guest, DebateSession, SuggestedTopic, TurnSource } from './types'

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8002'

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(error.detail || `API error ${res.status}`)
  }
  return res.json()
}

// Guests
export const getHealth = (): Promise<{ status: string; initialising: boolean; guests_indexed: number }> =>
  fetchAPI('/health')

export const getGuests = (tag?: string): Promise<Guest[]> =>
  fetchAPI(`/guests/${tag ? `?tag=${tag}` : ''}`)

export const getGuest = (name: string): Promise<Guest> =>
  fetchAPI(`/guests/${encodeURIComponent(name)}`)

export const getSuggestedPairs = (): Promise<SuggestedTopic[]> =>
  fetchAPI('/guests/suggest/pairs')

// Topics
export const getSuggestedTopics = (): Promise<SuggestedTopic[]> =>
  fetchAPI('/debate/topics/suggested')

// Debate
export const startDebate = (guest1: string, guest2: string, topic: string): Promise<{ session_id: string }> =>
  fetchAPI('/debate/start', {
    method: 'POST',
    body: JSON.stringify({ guest1, guest2, topic }),
  })

// Register user-provided API keys — returns a short-lived token
export const registerApiKeys = (
  anthropicKey?: string,
  elevenLabsKey?: string
): Promise<{ token: string; expires_in: number }> =>
  fetchAPI('/debate/keys/register', {
    method: 'POST',
    body: JSON.stringify({ anthropic_key: anthropicKey, elevenlabs_key: elevenLabsKey }),
  })

export const getSession = (sessionId: string): Promise<DebateSession> =>
  fetchAPI(`/debate/session/${sessionId}`)

export const castVote = (sessionId: string, votedFor: string): Promise<{ votes: Record<string, number> }> =>
  fetchAPI('/debate/vote', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, voted_for: votedFor }),
  })

export const generateSummary = (sessionId: string): Promise<{ summary: string; votes: Record<string, number> }> =>
  fetchAPI(`/debate/summary/${sessionId}`, { method: 'POST' })

// HeyGen video status polling
export const getVideoStatus = (videoId: string): Promise<{
  video_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  video_url?: string
  thumbnail_url?: string
}> => fetchAPI(`/debate/video/${videoId}`)

// SSE streaming — Lenny's opening intro
export function streamIntro(
  sessionId: string,
  onChunk: (chunk: string) => void,
  onComplete: (turn: any, audioUrl?: string, videoId?: string) => void,
  onError: (error: string) => void,
  token?: string
): () => void {
  const params = token ? `?token=${encodeURIComponent(token)}` : ''
  const url = `${API_URL}/debate/intro/${sessionId}${params}`
  const eventSource = new EventSource(url)

  eventSource.addEventListener('text_chunk', (e) => {
    const data = JSON.parse(e.data)
    onChunk(data.chunk)
  })

  eventSource.addEventListener('turn_complete', (e) => {
    const data = JSON.parse(e.data)
    onComplete(data.turn, data.audio_url || undefined, data.video_id || undefined)
    eventSource.close()
  })

  eventSource.addEventListener('error', (e: any) => {
    try {
      const data = JSON.parse(e.data)
      onError(data.error)
    } catch {
      onError('Intro stream error')
    }
    eventSource.close()
  })

  eventSource.onerror = () => {
    onError('Intro connection lost')
    eventSource.close()
  }

  return () => eventSource.close()
}

// SSE streaming
export function streamTurn(
  sessionId: string,
  speaker: string,
  onChunk: (chunk: string) => void,
  onComplete: (turn: any, audioUrl?: string, videoId?: string, sources?: TurnSource[]) => void,
  onError: (error: string) => void,
  token?: string
): () => void {
  const params = token ? `?token=${encodeURIComponent(token)}` : ''
  const url = `${API_URL}/debate/stream/${sessionId}/${encodeURIComponent(speaker)}${params}`
  const eventSource = new EventSource(url)

  eventSource.addEventListener('text_chunk', (e) => {
    const data = JSON.parse(e.data)
    onChunk(data.chunk)
  })

  eventSource.addEventListener('turn_complete', (e) => {
    const data = JSON.parse(e.data)
    // If the safety filter fired, replace the turn text with the safe version
    const turn = data.safe_text
      ? { ...data.turn, text: data.safe_text }
      : data.turn
    // audio_url from backend is already an absolute URL (http://localhost:8002/...)
    onComplete(turn, data.audio_url || undefined, data.video_id || undefined, data.sources || [])
    eventSource.close()
  })

  eventSource.addEventListener('debate_complete', () => {
    eventSource.close()
  })

  eventSource.addEventListener('error', (e: any) => {
    try {
      const data = JSON.parse(e.data)
      onError(data.error)
    } catch {
      onError('Stream error')
    }
    eventSource.close()
  })

  eventSource.onerror = () => {
    onError('Connection lost')
    eventSource.close()
  }

  return () => eventSource.close()
}
