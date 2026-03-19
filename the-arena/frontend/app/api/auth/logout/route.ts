/**
 * POST /api/auth/logout
 *
 * Clears the session cookie.
 * Response: { ok: true } + Set-Cookie (maxAge=0 to delete)
 */

import { NextResponse } from 'next/server'
import { clearSessionCookie } from '../../../../lib/session'

export async function POST() {
  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: { 'Set-Cookie': clearSessionCookie() },
    }
  )
}
