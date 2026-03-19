/**
 * User database abstraction.
 *
 * Production:  Upstash Redis  (configured via UPSTASH_REDIS_REST_URL env var)
 * Development: In-memory      (resets on server restart — suitable for local testing)
 *
 * Schema:
 *   Key:   "user:<email>"
 *   Value: { email: string, role: 'user' | 'owner', createdAt: number }
 *
 * Install for production:
 *   npm install @upstash/redis
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

// ── Redis helpers ─────────────────────────────────────────────────────────────
async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    return new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  } catch {
    return null
  }
}

const useRedis = !!process.env.UPSTASH_REDIS_REST_URL

// ── Public API ────────────────────────────────────────────────────────────────

export async function getUser(email: string): Promise<UserRecord | null> {
  const key = userKey(email)
  if (useRedis) {
    const redis = await getRedis()
    if (redis) return redis.get<UserRecord>(key)
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
  if (useRedis) {
    const redis = await getRedis()
    if (redis) {
      await redis.set(key, record)
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
      if (useRedis) {
        const redis = await getRedis()
        if (redis) await redis.set(key, upgraded)
      } else {
        _memStore.set(key, upgraded)
      }
      return upgraded
    }
    return existing
  }
  return createUser(email, role ?? 'user')
}
