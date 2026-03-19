/**
 * User database abstraction.
 *
 * Production:  Vercel KV  (Redis-backed, configured via KV_REST_API_URL env var)
 * Development: In-memory  (resets on server restart — suitable for local testing)
 *
 * Schema:
 *   Key:   "user:<email>"
 *   Value: { email: string, role: 'user' | 'owner', createdAt: number }
 *
 * Install for production:
 *   npm install @vercel/kv
 */

export interface UserRecord {
  email: string
  role: 'user' | 'owner'
  createdAt: number
}

// ── In-memory fallback ────────────────────────────────────────────────────────
const _memStore = new Map<string, UserRecord>()

function userKey(email: string): string {
  return `user:${email.toLowerCase().trim()}`
}

// ── KV helpers ────────────────────────────────────────────────────────────────
async function kv() {
  // Dynamic import so the app doesn't crash if @vercel/kv isn't installed
  try {
    const mod = await import('@vercel/kv')
    return mod.kv
  } catch {
    return null
  }
}

const useKV = !!process.env.KV_REST_API_URL

// ── Public API ────────────────────────────────────────────────────────────────

export async function getUser(email: string): Promise<UserRecord | null> {
  const key = userKey(email)
  if (useKV) {
    const store = await kv()
    if (store) return store.get<UserRecord>(key)
  }
  return _memStore.get(key) ?? null
}

export async function createUser(email: string, role: 'user' | 'owner' = 'user'): Promise<UserRecord> {
  const key = userKey(email)
  const record: UserRecord = {
    email: email.toLowerCase().trim(),
    role,
    createdAt: Date.now(),
  }
  if (useKV) {
    const store = await kv()
    if (store) {
      await store.set(key, record)
      return record
    }
  }
  _memStore.set(key, record)
  return record
}

export async function upsertUser(email: string, role?: 'user' | 'owner'): Promise<UserRecord> {
  const existing = await getUser(email)
  if (existing) {
    // Promote role if requested
    if (role && role !== existing.role) {
      const upgraded = { ...existing, role }
      const key = userKey(email)
      if (useKV) {
        const store = await kv()
        if (store) await store.set(key, upgraded)
      } else {
        _memStore.set(key, upgraded)
      }
      return upgraded
    }
    return existing
  }
  return createUser(email, role ?? 'user')
}
