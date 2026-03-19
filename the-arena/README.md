# 🎙️ The Arena — AI Debate Show

> Watch the greatest minds in product and startups debate the hottest topics — every argument grounded in their actual words from Lenny's Podcast.

Built on [Lenny's Data](https://www.lennysdata.com) · Powered by Claude, ElevenLabs & HeyGen

---

## What It Does

The Arena is a live AI debate platform where:
- **You pick a topic** (or write your own)
- **Two guests from Lenny's podcast** argue their positions
- **Every argument is grounded** in their actual transcript data via RAG
- **Lenny moderates** — asking sharp follow-ups and dropping hot takes
- **You vote** on who made the stronger case

With ElevenLabs + HeyGen configured, each guest speaks in their own synthesized voice and appears as a talking-head video avatar.

---

## Quick Start

```bash
# 1. Clone or download this project
cd the-arena

# 2. Add your API keys
cp backend/.env.example backend/.env
# Edit backend/.env and add ANTHROPIC_API_KEY

# 3. Start everything
./start.sh
```

Then open **http://localhost:3001**

---

## Port Assignments

| Service    | Port | Notes                          |
|-----------|------|-------------------------------|
| Frontend  | 3001 | Next.js                       |
| Backend   | 8002 | FastAPI                       |
| ~~3000~~  | —    | Reserved (LMS)                |
| ~~8000~~  | —    | Reserved (Chat)               |
| ~~8001~~  | —    | Reserved (API)                |

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ Yes | Powers the debate engine (Claude) |
| `ELEVENLABS_API_KEY` | Optional | Enables voice synthesis per guest |
| `ELEVENLABS_VOICE_MAP` | Optional | Maps guest names to voice IDs |
| `HEYGEN_API_KEY` | Optional | Enables avatar video generation |
| `HEYGEN_AVATAR_MAP` | Optional | Maps guest names to avatar IDs |

### Frontend (`frontend/.env.local`)

| Variable | Default | Description |
|---------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8002` | Backend URL |

---

## Architecture

```
the-arena/
├── backend/                   # FastAPI (port 8002)
│   ├── main.py               # App entry point + startup ingestion
│   ├── ingestion/            # Markdown parser → speaker turn chunks
│   ├── rag/                  # ChromaDB vector store (per-guest)
│   ├── debate/               # Engine + persona prompts + Lenny host
│   ├── voice/                # ElevenLabs TTS integration
│   ├── avatar/               # HeyGen video generation
│   ├── routers/              # FastAPI endpoints
│   └── data/                 # Lenny's markdown files
│
└── frontend/                  # Next.js (port 3001)
    ├── app/
    │   ├── page.tsx          # Landing page
    │   └── arena/            # Live debate arena
    ├── lib/
    │   ├── api.ts            # API client + SSE streaming
    │   └── types.ts          # TypeScript types
    └── components/           # Reusable UI components
```

### Data Flow

1. **Startup**: All 50 podcast transcripts are parsed into speaker-turn chunks and embedded into per-guest ChromaDB collections
2. **Debate start**: User selects two guests + topic → session created
3. **Each turn**: Topic + conversation context → RAG retrieval for current speaker → Claude generates grounded response → SSE streams to frontend
4. **Voice** (optional): ElevenLabs converts text → audio served back to frontend
5. **Video** (optional): HeyGen generates talking-head video from audio

---

## Adding More Data

When you get Lenny's full paid dataset (350 newsletters + 300 podcasts):

1. Replace `backend/data/` with the full dataset
2. Delete `backend/chroma_db/` to force re-indexing
3. Restart the backend — it will automatically index all new content

---

## Extending The Arena

**Add new debate formats:**
- Edit `backend/debate/personas.py` → `SUGGESTED_TOPICS`

**Add guest voice mappings (ElevenLabs):**
```
ELEVENLABS_VOICE_MAP=Ben Horowitz:voice_id_here,Elena Verna:voice_id_2
```

**Add avatar mappings (HeyGen):**
```
HEYGEN_AVATAR_MAP=Ben Horowitz:avatar_id_here,Elena Verna:avatar_id_2
```

---

## Built With

- **Next.js 14** — Frontend (TypeScript + Tailwind CSS)
- **FastAPI** — Backend API + SSE streaming
- **ChromaDB** — Per-guest vector store
- **sentence-transformers** — Local embeddings (all-MiniLM-L6-v2)
- **Anthropic Claude** — Debate engine (claude-sonnet-4-6)
- **ElevenLabs** — Voice synthesis
- **HeyGen** — Avatar video generation
- **Lenny's Data** — 650+ pieces of real product/startup wisdom

---

*Built for Lenny's Data Challenge — April 2026*
