export interface Guest {
  name: string
  title: string
  description: string
  tags: string[]
  date: string
  youtube_url: string
  video_id: string
  episode_count: number
}

/** A single RAG source that grounded a guest's response */
export interface TurnSource {
  title: string           // Episode or newsletter title
  date: string            // Publication date (ISO or human-readable)
  chunk_type: 'individual' | 'contextual' | 'newsletter'
  relevance_score: number // 0–1 cosine similarity
  snippet: string         // First ~140 chars of the matching chunk
}

export interface DebateTurn {
  id: string
  speaker: string
  text: string
  turn_type: 'guest' | 'host'
  turn_number: number
  audio_url?: string
  video_id?: string       // HeyGen job ID — poll /debate/video/{video_id}
  video_url?: string      // Populated once HeyGen render completes
  video_status?: 'pending' | 'processing' | 'completed' | 'failed'
  sources?: TurnSource[]  // RAG sources that grounded this response (guest turns only)
}

export interface DebateSession {
  session_id: string
  guest1: string
  guest2: string
  topic: string
  turns: DebateTurn[]
  turn_number: number
  votes: Record<string, number>
  status: 'active' | 'completed'
  summary?: string
}

export interface SuggestedTopic {
  id: string
  title: string
  description: string
  tags: string[]
  suggested_guests: string[]
  available_guests: string[]
}

export type DebateState =
  | 'idle'           // Not started
  | 'setup'          // Choosing guests + topic
  | 'live'           // Debate in progress
  | 'streaming'      // Currently generating a turn
  | 'voting'         // Debate done, voting open
  | 'results'        // Final results shown
