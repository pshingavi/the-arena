"""
Debate router — start, advance, and manage live debates.
Uses Server-Sent Events (SSE) for real-time streaming of debate turns.

Audio + Video pipeline per turn:
  - ElevenLabs TTS: runs immediately after streaming, audio stored in memory
  - HeyGen video: job submitted in parallel with ElevenLabs; frontend polls for completion
"""

import json
import asyncio
import uuid
import time
from typing import Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/debate", tags=["debate"])

# In-memory debate sessions (would use Redis in production)
_sessions: Dict[str, "DebateSession"] = {}

# ── Token store for user-provided API keys ────────────────────────────────────
# Maps token (UUID) → {anthropic_key, elevenlabs_key, created_at}
# Tokens expire after 1 hour. Keys are NEVER logged or persisted to disk.
_API_KEY_TOKENS: Dict[str, Dict] = {}
_TOKEN_TTL_SECONDS = 3600  # 1 hour


def _purge_expired_tokens():
    """Remove tokens older than TTL. Called lazily on each register."""
    now = time.time()
    expired = [t for t, v in _API_KEY_TOKENS.items() if now - v["created_at"] > _TOKEN_TTL_SECONDS]
    for t in expired:
        del _API_KEY_TOKENS[t]


def _resolve_token(token: Optional[str]) -> Dict:
    """
    Return {'anthropic_key': ..., 'elevenlabs_key': ...} for a given token.
    Returns empty dict if token is None/invalid/expired (caller uses server keys).
    """
    if not token:
        return {}
    entry = _API_KEY_TOKENS.get(token)
    if not entry:
        return {}
    if time.time() - entry["created_at"] > _TOKEN_TTL_SECONDS:
        del _API_KEY_TOKENS[token]
        return {}
    return entry


class RegisterKeysRequest(BaseModel):
    anthropic_key: Optional[str] = None
    elevenlabs_key: Optional[str] = None


@router.post("/keys/register")
async def register_api_keys(request: RegisterKeysRequest):
    """
    Accept user-provided API keys and return a short-lived token.
    Keys are stored in memory only (never logged, never persisted).
    Token expires after 1 hour.
    """
    _purge_expired_tokens()

    if not request.anthropic_key and not request.elevenlabs_key:
        raise HTTPException(status_code=400, detail="At least one API key must be provided")

    token = str(uuid.uuid4())
    _API_KEY_TOKENS[token] = {
        "anthropic_key":  request.anthropic_key or "",
        "elevenlabs_key": request.elevenlabs_key or "",
        "created_at": time.time(),
    }

    return {"token": token, "expires_in": _TOKEN_TTL_SECONDS}


class StartDebateRequest(BaseModel):
    guest1: str
    guest2: str
    topic: str
    custom_topic: Optional[bool] = False


class VoteRequest(BaseModel):
    session_id: str
    voted_for: str  # guest name


class DebateSession:
    def __init__(self, session_id: str, guest1: str, guest2: str, topic: str):
        self.session_id = session_id
        self.guest1 = guest1
        self.guest2 = guest2
        self.topic = topic
        self.turns: List[Dict] = []
        self.turn_number = 0
        self.votes: Dict[str, int] = {guest1: 0, guest2: 0}
        self.status = "active"  # active | completed
        self.summary: Optional[str] = None
        self._audio_cache: Dict[str, bytes] = {}
        self._video_ids: Dict[str, str] = {}  # turn_id -> heygen video_id

    def add_turn(self, speaker: str, text: str, turn_type: str = "guest", sources: list = None):
        turn = {
            "id": str(uuid.uuid4()),
            "speaker": speaker,
            "text": text,
            "turn_type": turn_type,
            "turn_number": self.turn_number,
            "sources": sources or [],
        }
        self.turns.append(turn)
        self.turn_number += 1
        return turn

    def to_dict(self):
        return {
            "session_id": self.session_id,
            "guest1": self.guest1,
            "guest2": self.guest2,
            "topic": self.topic,
            "turns": self.turns,
            "turn_number": self.turn_number,
            "votes": self.votes,
            "status": self.status,
            "summary": self.summary
        }


@router.post("/start")
async def start_debate(request: StartDebateRequest):
    """Create a new debate session."""
    from routers.guests import _guest_registry

    if request.guest1 not in _guest_registry:
        raise HTTPException(status_code=404, detail=f"Guest '{request.guest1}' not found")
    if request.guest2 not in _guest_registry:
        raise HTTPException(status_code=404, detail=f"Guest '{request.guest2}' not found")
    if request.guest1 == request.guest2:
        raise HTTPException(status_code=400, detail="Guests must be different")

    session_id = str(uuid.uuid4())
    session = DebateSession(
        session_id=session_id,
        guest1=request.guest1,
        guest2=request.guest2,
        topic=request.topic
    )
    _sessions[session_id] = session

    return {
        "session_id": session_id,
        "guest1": request.guest1,
        "guest2": request.guest2,
        "topic": request.topic,
        "status": "ready"
    }


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    """Get current state of a debate session."""
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return _sessions[session_id].to_dict()


@router.get("/stream/{session_id}/{speaker}")
async def stream_turn(session_id: str, speaker: str, token: Optional[str] = Query(default=None)):
    """
    Stream the next debate turn via SSE.
    speaker: guest name or 'lenny' for host turn
    token: optional API-key token from /debate/keys/register (for user-provided keys)
    """
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = _sessions[session_id]

    if session.status == "completed":
        raise HTTPException(status_code=400, detail="Debate has concluded")

    # Resolve user keys from token (empty dict = use server env keys)
    user_keys = _resolve_token(token)

    async def event_generator():
        import app_state
        from cache_manager import find_pregenerated
        from debate.engine import DebateEngine

        # Use user-provided Anthropic key if supplied, else fall back to server engine
        if user_keys.get("anthropic_key"):
            engine = DebateEngine(
                vector_store=app_state.vector_store,
                model=app_state.debate_engine.model,
                api_key=user_keys["anthropic_key"],
            )
        else:
            engine = app_state.debate_engine
        full_text = []

        try:
            # ── Hot-topic cache: replay pre-generated turn ────────────────────
            pregen = find_pregenerated(session.guest1, session.guest2, session.topic)
            if pregen and session.turn_number < len(pregen["turns"]):
                turn_data = pregen["turns"][session.turn_number]
                expected_speaker = "Lenny Rachitsky" if speaker.lower() == "lenny" else speaker

                if turn_data["speaker"].lower() == expected_speaker.lower():
                    text      = turn_data["text"]
                    turn_type = turn_data["turn_type"]
                    sources   = turn_data.get("sources", [])

                    yield {
                        "event": "turn_start",
                        "data": json.dumps({
                            "speaker": expected_speaker,
                            "turn_type": turn_type,
                            "session_id": session_id,
                        })
                    }

                    # Stream 3 words at a time (~20 ms gap) to simulate
                    # real-time LLM generation at a natural reading pace.
                    words = text.split(" ")
                    for i in range(0, len(words), 3):
                        chunk = " ".join(words[i : i + 3])
                        if i + 3 < len(words):
                            chunk += " "
                        yield {"event": "text_chunk", "data": json.dumps({"chunk": chunk})}
                        await asyncio.sleep(0.020)

                    turn = session.add_turn(expected_speaker, text, turn_type, sources=sources)
                    yield {
                        "event": "turn_complete",
                        "data": json.dumps({
                            "turn": turn, "audio_url": None, "video_id": None,
                            "session_id": session_id, "safety_filtered": False,
                            "safe_text": None, "sources": sources,
                        })
                    }
                    return  # ← skip live LLM path

            # ── Live LLM generation ───────────────────────────────────────────
            is_opening = session.turn_number == 0 or (
                session.turn_number == 1 and speaker == session.guest2
            )

            if speaker.lower() == "lenny":
                yield {
                    "event": "turn_start",
                    "data": json.dumps({
                        "speaker": "Lenny Rachitsky",
                        "turn_type": "host",
                        "session_id": session_id
                    })
                }

                async for chunk in engine.generate_host_turn(
                    topic=session.topic,
                    guest1=session.guest1,
                    guest2=session.guest2,
                    debate_turns=session.turns,
                    turn_number=session.turn_number
                ):
                    full_text.append(chunk)
                    yield {
                        "event": "text_chunk",
                        "data": json.dumps({"chunk": chunk})
                    }
            else:
                other_guest = session.guest2 if speaker == session.guest1 else session.guest1

                yield {
                    "event": "turn_start",
                    "data": json.dumps({
                        "speaker": speaker,
                        "turn_type": "guest",
                        "is_opening": is_opening,
                        "session_id": session_id
                    })
                }

                async for chunk in engine.generate_guest_turn(
                    guest=speaker,
                    topic=session.topic,
                    other_guest=other_guest,
                    debate_turns=session.turns,
                    is_opening=is_opening
                ):
                    full_text.append(chunk)
                    yield {
                        "event": "text_chunk",
                        "data": json.dumps({"chunk": chunk})
                    }

            # ── Save the completed turn ──────────────────────────────────────
            complete_text = "".join(full_text)
            turn_type = "host" if speaker.lower() == "lenny" else "guest"
            speaker_name = "Lenny Rachitsky" if speaker.lower() == "lenny" else speaker

            # ── Collect RAG sources (guest turns only) ───────────────────────
            # engine._last_guest_sources is set before the first yield in
            # generate_guest_turn, so it's always populated by the time we
            # reach here. Host turns have no RAG retrieval — leave empty.
            raw_sources = engine._last_guest_sources if turn_type == "guest" else []
            sources = _serialize_sources(raw_sources)

            # ── Safety validation + citation enforcement ──────────────────────
            # Runs AFTER streaming so real-time UX is preserved.
            # If content violates safety rules, the stored turn gets a clean
            # fallback (the streamed preview already cleared). A safety_filtered
            # flag is sent to the frontend via turn_complete so it can update
            # the displayed bubble with the safe version.
            from debate.safety import validate_and_prepare
            is_host_turn = turn_type == "host"
            safety_ok, safe_text = validate_and_prepare(
                text=complete_text,
                speaker=speaker_name,
                topic=session.topic,
                chunks=[],        # RAG chunks pre-fetched in engine; citation fallback appended if missing
                is_host=is_host_turn
            )
            saved_text = safe_text  # Always use the safety-processed version for storage
            safety_filtered = not safety_ok

            turn = session.add_turn(speaker_name, saved_text, turn_type, sources=sources)

            # ── MVP: fire turn_complete immediately — no blocking TTS/HeyGen ─
            # The frontend synthesises audio sentence-by-sentence via /debate/tts
            # so pre-caching the full turn here is redundant and only adds latency.
            # HeyGen is fully disabled for MVP; video_id is always null.
            audio_url = None
            video_id  = None

            yield {
                "event": "turn_complete",
                "data": json.dumps({
                    "turn": turn,
                    "audio_url": audio_url,
                    "video_id": video_id,
                    "session_id": session_id,
                    "safety_filtered": safety_filtered,
                    # safe_text lets the frontend update the displayed bubble
                    # to the safety-processed version if it was filtered
                    "safe_text": saved_text if safety_filtered else None,
                    # RAG source cards — tells frontend which episodes/newsletters
                    # grounded this response
                    "sources": sources,
                })
            }

            # Debate ends after 10 turns (12-turn sequence but capped)
            if session.turn_number >= 10:
                session.status = "completed"
                yield {
                    "event": "debate_complete",
                    "data": json.dumps({
                        "session_id": session_id,
                        "message": "The debate has concluded. Cast your vote!"
                    })
                }

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)})
            }

    return EventSourceResponse(event_generator())


async def _noop():
    """No-op coroutine for when ElevenLabs/HeyGen is not configured."""
    return None


def _serialize_sources(chunks: list) -> list:
    """
    Convert raw RAG chunks into lightweight source cards for the frontend.
    Each card contains: title, date, chunk_type, relevance_score, snippet.
    """
    seen_titles: set = set()
    result = []
    for c in chunks:
        meta = c.get("metadata", {})
        title = meta.get("title") or "Lenny's Podcast"
        # Deduplicate by episode title so we don't show the same episode 3× for contextual chunks
        if title in seen_titles:
            continue
        seen_titles.add(title)
        result.append({
            "title": title,
            "date": meta.get("date", ""),
            "chunk_type": meta.get("chunk_type", "individual"),
            "relevance_score": round(float(c.get("relevance_score", 0)), 3),
            "snippet": c.get("text", "")[:140].strip(),
        })
    return result


@router.get("/audio/{session_id}/{turn_id}")
async def get_turn_audio(session_id: str, turn_id: str):
    """Serve pre-generated ElevenLabs audio for a debate turn."""
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = _sessions[session_id]
    audio_bytes = session._audio_cache.get(turn_id)

    if not audio_bytes:
        raise HTTPException(status_code=404, detail="Audio not found for this turn")

    return StreamingResponse(
        iter([audio_bytes]),
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": f"inline; filename=turn_{turn_id}.mp3",
            "Cache-Control": "public, max-age=3600",
        }
    )


@router.get("/video/{video_id}")
async def get_heygen_video_status(video_id: str):
    """
    Poll HeyGen for video generation status.
    Frontend calls this every 5s after receiving a video_id in turn_complete.
    When status == 'completed', video_url is available for playback.
    """
    from avatar.heygen import get_video_status
    result = await get_video_status(video_id)
    if not result:
        raise HTTPException(status_code=404, detail="Video not found or HeyGen unavailable")
    return result


@router.post("/vote")
async def cast_vote(request: VoteRequest):
    """Cast a vote for the winning guest."""
    if request.session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = _sessions[request.session_id]

    if request.voted_for not in [session.guest1, session.guest2]:
        raise HTTPException(status_code=400, detail="Invalid vote — must be one of the debating guests")

    session.votes[request.voted_for] += 1

    return {
        "session_id": request.session_id,
        "votes": session.votes,
        "message": f"Vote registered for {request.voted_for}"
    }


@router.post("/summary/{session_id}")
async def generate_summary(session_id: str):
    """Generate Lenny's post-debate verdict."""
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = _sessions[session_id]
    import app_state

    summary = await app_state.debate_engine.generate_vote_summary(
        topic=session.topic,
        guest1=session.guest1,
        guest2=session.guest2,
        debate_turns=session.turns,
        vote_counts=session.votes
    )

    session.summary = summary
    return {"session_id": session_id, "summary": summary, "votes": session.votes}


@router.get("/intro/{session_id}")
async def stream_intro(session_id: str, token: Optional[str] = Query(default=None)):
    """
    Stream Lenny's opening introduction for the debate via SSE.
    Call this once after /debate/start, before any guest turns.
    token: optional API-key token from /debate/keys/register
    """
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = _sessions[session_id]

    # Resolve user keys from token
    user_keys = _resolve_token(token)

    async def intro_generator():
        from debate.personas import get_intro_prompt
        from cache_manager import find_pregenerated
        from debate.engine import DebateEngine
        import app_state

        full_text = []

        # Use user-provided Anthropic key if supplied
        if user_keys.get("anthropic_key"):
            engine = DebateEngine(
                vector_store=app_state.vector_store,
                model=app_state.debate_engine.model,
                api_key=user_keys["anthropic_key"],
            )
        else:
            engine = app_state.debate_engine

        try:
            # ── Hot-topic cache: replay pre-generated intro ───────────────────
            pregen = find_pregenerated(session.guest1, session.guest2, session.topic)
            if pregen and pregen.get("turns") and pregen["turns"][0].get("turn_type") == "intro":
                turn_data = pregen["turns"][0]
                text = turn_data["text"]

                yield {
                    "event": "turn_start",
                    "data": json.dumps({
                        "speaker": "Lenny Rachitsky",
                        "turn_type": "intro",
                        "session_id": session_id
                    })
                }

                # Stream word-pairs with a natural ~22 ms cadence so the
                # frontend typewriter / TTS pipeline behaves identically to
                # a live LLM stream.
                words = text.split(" ")
                for i in range(0, len(words), 2):
                    chunk = " ".join(words[i : i + 2])
                    if i + 2 < len(words):
                        chunk += " "
                    yield {"event": "text_chunk", "data": json.dumps({"chunk": chunk})}
                    await asyncio.sleep(0.022)

                turn = session.add_turn("Lenny Rachitsky", text, "intro")
                yield {
                    "event": "turn_complete",
                    "data": json.dumps({
                        "turn": turn, "audio_url": None, "video_id": None,
                        "session_id": session_id, "safety_filtered": False, "safe_text": None,
                    })
                }
                return  # ← skip live LLM path

            # ── Live LLM generation ───────────────────────────────────────────
            system_prompt = get_intro_prompt(session.guest1, session.guest2, session.topic)

            yield {
                "event": "turn_start",
                "data": json.dumps({
                    "speaker": "Lenny Rachitsky",
                    "turn_type": "intro",
                    "session_id": session_id
                })
            }
            async with engine.client.messages.stream(
                model=engine.model,
                max_tokens=250,
                system=system_prompt,
                messages=[{"role": "user", "content": "Open the show."}]
            ) as stream:
                async for chunk in stream.text_stream:
                    full_text.append(chunk)
                    yield {
                        "event": "text_chunk",
                        "data": json.dumps({"chunk": chunk})
                    }

            complete_text = "".join(full_text)
            turn = session.add_turn("Lenny Rachitsky", complete_text, "intro")

            yield {
                "event": "turn_complete",
                "data": json.dumps({
                    "turn": turn,
                    "audio_url": None,
                    "video_id": None,
                    "session_id": session_id,
                    "safety_filtered": False,
                    "safe_text": None,
                })
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)})
            }

    return EventSourceResponse(intro_generator())


class TTSRequest(BaseModel):
    text: str
    speaker: str
    token: Optional[str] = None  # API-key token for user-provided ElevenLabs key


@router.post("/tts")
async def synthesize_sentence_tts(request: TTSRequest):
    """
    Real-time sentence-level TTS endpoint.
    Called by the frontend as each sentence completes during streaming —
    so audio plays word-by-word as the response is generated.
    Returns audio/mpeg directly (no session required).
    token: optional API-key token with user's ElevenLabs key
    """
    from voice.elevenlabs import synthesize_speech, is_elevenlabs_configured

    # Check if user supplied their own ElevenLabs key via token
    user_keys = _resolve_token(request.token)
    user_elevenlabs_key = user_keys.get("elevenlabs_key") or ""

    if not is_elevenlabs_configured() and not user_elevenlabs_key:
        raise HTTPException(status_code=503, detail="ElevenLabs not configured")

    text = request.text.strip()
    if len(text) < 3:
        raise HTTPException(status_code=400, detail="Text too short")

    # Cap to avoid runaway long synthesis
    if len(text) > 600:
        text = text[:600]

    # ── TTS audio cache ───────────────────────────────────────────────────────
    # Check the local mp3 cache before hitting ElevenLabs. This is populated
    # by the pre-generation script AND filled on first use for any new text,
    # so repeat sentences (across all debates) are served instantly for free.
    from cache_manager import get_tts_cache, set_tts_cache
    cached = get_tts_cache(text, request.speaker)
    if cached:
        return StreamingResponse(
            iter([cached]),
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache", "X-Speaker": request.speaker, "X-Cache": "HIT"},
        )

    try:
        audio_bytes = await synthesize_speech(
            text, request.speaker,
            api_key=user_elevenlabs_key or None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS error: {e}")

    if not audio_bytes:
        raise HTTPException(status_code=500, detail="No audio generated")

    # Cache for future requests (both pre-generated replays and live debates)
    set_tts_cache(text, request.speaker, audio_bytes)

    return StreamingResponse(
        iter([audio_bytes]),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-cache",
            "X-Speaker": request.speaker,
        }
    )


@router.get("/topics/suggested")
async def get_suggested_topics():
    """Get pre-defined suggested debate topics with available guests."""
    from debate.personas import SUGGESTED_TOPICS
    from routers.guests import _guest_registry

    result = []
    for topic in SUGGESTED_TOPICS:
        available = [g for g in topic.get("suggested_guests", []) if g in _guest_registry]
        result.append({**topic, "available_guests": available})

    return result
