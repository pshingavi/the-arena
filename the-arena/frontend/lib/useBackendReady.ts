'use client'

/**
 * useBackendReady — polls /health until the backend finishes its background
 * initialisation (loading transcripts, building vector store, etc.).
 *
 * Returns:
 *   ready   — true once initialising=false and guests_indexed > 0
 *   status  — "connecting" | "initialising" | "ready" | "error"
 *   elapsed — seconds since first poll (for display)
 */

import { useState, useEffect, useRef } from 'react'
import { getHealth } from './api'

export type BackendStatus = 'connecting' | 'initialising' | 'ready' | 'error'

export function useBackendReady() {
  const [status, setStatus] = useState<BackendStatus>('connecting')
  const [elapsed, setElapsed] = useState(0)
  const [guestsIndexed, setGuestsIndexed] = useState(0)
  const startRef = useRef(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Elapsed seconds counter
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)

    const poll = async () => {
      try {
        const health = await getHealth()
        setGuestsIndexed(health.guests_indexed || 0)

        if (health.initialising) {
          setStatus('initialising')
        } else if (health.status === 'healthy' || health.status === 'live') {
          setStatus('ready')
          clearInterval(pollRef.current!)
          clearInterval(timerRef.current!)
        } else {
          setStatus('initialising')
        }
      } catch {
        // Backend not up yet — keep trying
        setStatus('connecting')
      }
    }

    // First poll immediately
    poll()
    // Then every 2s
    pollRef.current = setInterval(poll, 2000)

    return () => {
      clearInterval(pollRef.current!)
      clearInterval(timerRef.current!)
    }
  }, [])

  return { ready: status === 'ready', status, elapsed, guestsIndexed }
}
