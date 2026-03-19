/**
 * POST /api/auth/signup
 *
 * Creates a new user or logs in an existing one.
 * If an owner code is provided and matches ARENA_OWNER_CODE, the role becomes 'owner'.
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

    // Check if the owner code matches
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
    console.error('[/api/auth/signup]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
