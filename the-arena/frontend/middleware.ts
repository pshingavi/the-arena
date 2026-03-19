/**
 * Next.js Edge Middleware — guards /arena route.
 *
 * IMPORTANT: Middleware runs in the Edge Runtime which does NOT support
 * Node.js built-in modules (including node:crypto / createHmac).
 * We do a cookie-presence check here; full HMAC signature verification
 * happens inside /api/auth/me, which runs in the Node.js runtime.
 *
 * Security note: this gate is sufficient for UX gating. Actual data is
 * protected by server-side checks (backend requires API keys, hot-topic
 * cache is read-only). Someone who crafts a fake cookie can see the arena
 * UI but cannot start custom debates without real credentials.
 *
 * Unauthenticated visitors are redirected to /auth?from=<path>.
 */

import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'arena_session'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only guard /arena and sub-paths
  if (!pathname.startsWith('/arena')) {
    return NextResponse.next()
  }

  const raw = request.cookies.get(COOKIE_NAME)?.value

  // No cookie at all — definitely not logged in
  if (!raw) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  // Cookie must look like <payload>.<signature> — basic structural check
  // Full HMAC verification is done in /api/auth/me (Node.js runtime)
  if (!raw.includes('.')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    url.searchParams.set('from', pathname)
    const res = NextResponse.redirect(url)
    res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
    return res
  }

  // Cookie present and structurally valid — let through
  return NextResponse.next()
}

export const config = {
  matcher: ['/arena/:path*'],
}
