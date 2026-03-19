/**
 * Lightweight signed-cookie session.
 *
 * Uses only Node.js built-in `crypto` — no extra npm packages.
 *
 * Cookie format:
 *   <base64url(JSON payload)>.<hmac-sha256(base64url payload, SESSION_SECRET)>
 *
 * Required env var:
 *   SESSION_SECRET  — random 32+ character string
 *
 * Optional env var:
 *   SESSION_COOKIE_NAME  — defaults to "arena_session"
 *   SESSION_MAX_AGE      — seconds, defaults to 7 days
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

export interface SessionData {
  email: string
  role: 'user' | 'owner'
  createdAt: number
}

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'arena_session'
const MAX_AGE = parseInt(process.env.SESSION_MAX_AGE ?? String(60 * 60 * 24 * 7)) // 7 days
const SECRET = process.env.SESSION_SECRET ?? ''

function getSecret(): string {
  if (!SECRET) throw new Error('SESSION_SECRET env var is not set')
  return SECRET
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

export function encodeSession(data: SessionData): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = sign(payload)
  return `${payload}.${sig}`
}

export function decodeSession(cookie: string): SessionData | null {
  try {
    const dot = cookie.lastIndexOf('.')
    if (dot === -1) return null
    const payload = cookie.slice(0, dot)
    const sig = cookie.slice(dot + 1)
    // Timing-safe comparison to prevent timing attacks
    const expected = sign(payload)
    const expectedBuf = Buffer.from(expected)
    const actualBuf = Buffer.from(sig)
    if (expectedBuf.length !== actualBuf.length) return null
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    // Validate shape
    if (!data.email || !data.role || !data.createdAt) return null
    return data as SessionData
  } catch {
    return null
  }
}

/** Read the current session from the incoming request cookies. */
export async function getSession(): Promise<SessionData | null> {
  const cookieStore = cookies()
  const raw = cookieStore.get(COOKIE_NAME)?.value
  if (!raw) return null
  return decodeSession(raw)
}

/** Build Set-Cookie header value for a new session. */
export function makeSessionCookie(data: SessionData): string {
  const value = encodeSession(data)
  return [
    `${COOKIE_NAME}=${value}`,
    `Max-Age=${MAX_AGE}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
}

/** Build a cookie that immediately expires (for logout). */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
}
