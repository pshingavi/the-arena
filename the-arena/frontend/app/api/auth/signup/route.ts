/**
 * POST /api/auth/signup
 *
 * Three accepted flows:
 *   1. Email only            → regular 'user' role
 *   2. Email + owner code    → 'owner' role, email stored
 *   3. Owner code only       → 'owner' role, no email required
 *      (session email set to a stable anonymous owner identifier)
 *
 * Body: { email?: string, ownerCode?: string }
 * Response: { ok: true, email, role } + Set-Cookie session
 */

import { NextRequest, NextResponse } from 'next/server'
import { upsertUser } from '../../../../lib/db'
import { makeSessionCookie, SessionData } from '../../../../lib/session'

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const OWNER_PLACEHOLDER = 'owner@arena.local'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email: string = (body.email ?? '').trim().toLowerCase()
    const ownerCode: string = (body.ownerCode ?? '').trim()

    const serverOwnerCode = process.env.ARENA_OWNER_CODE ?? ''
    const isOwner = serverOwnerCode && ownerCode === serverOwnerCode

    // Code-only flow: no email needed if the code is correct
    if (!email && ownerCode) {
      if (!isOwner) {
        return NextResponse.json({ error: 'Invalid access code' }, { status: 401 })
      }
      const user = await upsertUser(OWNER_PLACEHOLDER, 'owner')
      const sessionData: SessionData = { email: user.email, role: 'owner', createdAt: Date.now() }
      const cookie = makeSessionCookie(sessionData)
      return NextResponse.json(
        { ok: true, email: user.email, role: 'owner' },
        { status: 200, headers: { 'Set-Cookie': cookie } }
      )
    }

    // Email required for regular signup
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    const user = await upsertUser(email, isOwner ? 'owner' : undefined)

    const sessionData: SessionData = {
      email: user.email,
      role: user.role,
      createdAt: Date.now(),
    }

    const cookie = makeSessionCookie(sessionData)

    return NextResponse.json(
      { ok: true, email: user.email, role: user.role },
      { status: 200, headers: { 'Set-Cookie': cookie } }
    )
  } catch (err) {
    console.error('[/api/auth/signup]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
