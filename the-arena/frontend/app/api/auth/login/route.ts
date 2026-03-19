/**
 * POST /api/auth/login
 *
 * Logs in an existing user by email. If they don't exist yet, creates them.
 * An optional ownerCode can upgrade role to 'owner'.
 *
 * This is essentially the same as signup but kept as a separate endpoint
 * for semantic clarity in the UI.
 *
 * Body: { email: string, ownerCode?: string }
 * Response: { ok: true, email, role } + Set-Cookie session
 */

import { NextRequest, NextResponse } from 'next/server'
import { upsertUser } from '../../../../lib/db'
import { makeSessionCookie, SessionData } from '../../../../lib/session'

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email: string = (body.email ?? '').trim().toLowerCase()
    const ownerCode: string = (body.ownerCode ?? '').trim()

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    const serverOwnerCode = process.env.ARENA_OWNER_CODE ?? ''
    const isOwner = serverOwnerCode && ownerCode === serverOwnerCode

    const user = await upsertUser(email, isOwner ? 'owner' : undefined)

    const sessionData: SessionData = {
      email: user.email,
      role: user.role,
      createdAt: Date.now(),
    }

    const cookie = makeSessionCookie(sessionData)

    return NextResponse.json(
      { ok: true, email: user.email, role: user.role },
      {
        status: 200,
        headers: { 'Set-Cookie': cookie },
      }
    )
  } catch (err) {
    console.error('[/api/auth/login]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
