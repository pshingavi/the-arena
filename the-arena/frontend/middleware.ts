/**
 * Next.js Edge Middleware
 *
 * /arena is intentionally open — hot-topic debates are free to watch
 * without any account. Auth gating for custom debates is handled
 * client-side inside ArenaClient.tsx (redirects to /auth when needed).
 *
 * Nothing to do here for now; file kept so Next.js doesn't warn about
 * a missing matcher export.
 */

export function middleware() {
  // pass-through — all gating is in ArenaClient
}

export const config = {
  matcher: [], // no routes intercepted
}
