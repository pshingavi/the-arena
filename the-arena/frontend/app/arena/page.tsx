'use client'

import { Suspense } from 'react'
import ArenaClient from './ArenaClient'

export default function ArenaPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-arena-bg flex items-center justify-center">
        <div className="text-arena-muted animate-pulse">Loading The Arena...</div>
      </div>
    }>
      <ArenaClient />
    </Suspense>
  )
}
