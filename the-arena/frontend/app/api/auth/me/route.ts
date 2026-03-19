/**
 * GET /api/auth/me
 *
 * Returns the current session user.
 * Response: { email, role } or 401 if not authenticated.
 */

import { NextResponse } from 'next/server'
import { getSession } from '../../../../lib/session'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  return NextResponse.json({ email: session.email, role: session.role })
}
