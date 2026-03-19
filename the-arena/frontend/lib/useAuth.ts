'use client'

/**
 * useAuth — client-side hook to read current session user.
 *
 * Calls GET /api/auth/me on mount. Returns:
 *   { user, loading, logout }
 *
 * user is null while loading or if not authenticated.
 */

import { useState, useEffect, useCallback } from 'react'

export interface AuthUser {
  email: string
  role: 'user' | 'owner'
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        setUser(data?.email ? { email: data.email, role: data.role } : null)
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    window.location.href = '/auth'
  }, [])

  return { user, loading, logout }
}
