#!/usr/bin/env python3
"""
Pre-generate debates for all suggested hot topics.

Run from the backend/ directory:

    python scripts/pregenerate.py                  # all topics, first guest pair each
    python scripts/pregenerate.py --topic ai-replacing-pms   # single topic
    python scripts/pregenerate.py --all-pairs      # all guest permutations per topic
    python scripts/pregenerate.py --warmup-tts     # also pre-generate ElevenLabs TTS audio

This script uses the real debate engine (RAG + LLM) to produce authentic content,
saves it to debate_cache/, and optionally warms up the TTS audio cache so replays
never need to call ElevenLabs at all.

Costs per debate (12 turns + intro):
  - ~13 LLM calls (Anthropic API)
  - ~0 ElevenLabs calls (unless --warmup-tts is passed)
"""

import asyncio
import argparse
import os
import sys
from itertools import permutations
from pathlib import Path

# Ensure backend/ is on the import path regardless of where the script is called from
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

# Change working dir to backend/ so relative paths (chroma_db, etc.) resolve correctly
os.chdir(ROOT)

# Load .env so ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, etc. are available
# (FastAPI does this via its startup lifecycle; we replicate it here)
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass  # python-dotenv not installed — assume env vars are set externally


async def generate_intro(engine, guest1: str, guest2: str, topic_title: str) -> str:
    from debate.personas import get_intro_prompt
    parts = []
    async with engine.client.messages.stream(
        model=engine.model,
        max_tokens=250,
        system=get_intro_prompt(guest1, guest2, topic_title),
        messages=[{"role": "user", "content": "Open the show."}]
    ) as stream:
        async for chunk in stream.text_stream:
            parts.append(chunk)
    return "".join(parts).strip()


def _bootstrap_app_state():
    """
    Replicate the FastAPI startup sequence so the script works standalone.
    Idempotent — safe to call multiple times.
    """
    import app_state
    if app_state.debate_engine is not None:
        return  # already initialised

    from pathlib import Path as _Path
    from ingestion.parser import load_all_data
    from rag.vectorstore import ArenaVectorStore
    from debate.engine import DebateEngine
    from routers.guests import register_guests

    data_dir   = _Path("data")
    chroma_dir = str(_Path("chroma_db"))   # ChromaDB requires str, not PosixPath

    print("  [init] Loading transcript data...")
    data = load_all_data(data_dir)
    podcasts    = data["podcasts"]
    newsletters = data["newsletters"]

    print("  [init] Initialising vector store (first run may take a moment)...")
    vector_store = ArenaVectorStore(persist_dir=chroma_dir)

    print("  [init] Indexing guests...")
    for podcast in podcasts:
        n = vector_store.index_guest(podcast)
        if n > 0:
            print(f"    ✓ {podcast['guest']} — {n} chunks")

    lenny_data = {
        "guest": "Lenny Rachitsky", "title": "Lenny's Newsletter",
        "date": "", "tags": ["product-management", "startups", "growth"], "chunks": []
    }
    for newsletter in newsletters:
        lenny_data["chunks"].extend(newsletter.get("chunks", []))
    if lenny_data["chunks"]:
        vector_store.index_guest(lenny_data)

    register_guests(podcasts)

    app_state.debate_engine = DebateEngine(
        vector_store=vector_store,
        model="claude-sonnet-4-6",
    )
    app_state.vector_store = vector_store
    print("  [init] Engine ready.\n")


async def generate_debate(topic_data: dict, guest1: str, guest2: str) -> list:
    """
    Generate all turns for a debate and return the list of turn dicts.

    Turn schema:
        {
          "index":     int,          # 0 = intro, 1..N = debate turns
          "speaker":   str,
          "turn_type": "intro" | "guest" | "host",
          "text":      str,
          "sources":   list          # RAG source cards (guest turns only)
        }
    """
    import app_state
    _bootstrap_app_state()

    engine = app_state.debate_engine
    topic_title = topic_data["title"]

    # Minimal in-memory session to feed debate_turns context to the engine
    class _Session:
        def __init__(self):
            self.turns = []
            self.turn_number = 0

        def add_turn(self, speaker, text, turn_type, sources=None):
            t = {
                "index":     self.turn_number,
                "speaker":   speaker,
                "turn_type": turn_type,
                "text":      text,
                "sources":   sources or [],
            }
            self.turns.append(t)
            self.turn_number += 1
            return t

    session = _Session()

    # ── Intro ─────────────────────────────────────────────────────────────────
    print(f"    [0/12] intro (Lenny Rachitsky) ...", end="", flush=True)
    intro_text = await generate_intro(engine, guest1, guest2, topic_title)
    session.add_turn("Lenny Rachitsky", intro_text, "intro")
    print(f" {len(intro_text)} chars")

    # ── 11-turn debate sequence ───────────────────────────────────────────────
    # Matches the frontend DEBATE_SEQUENCE:
    #   g1, g2, host, g1, g2, host, g1, g2, host, g1, g2
    SEQUENCE = [
        guest1, guest2, "lenny",
        guest1, guest2, "lenny",
        guest1, guest2, "lenny",
        guest1, guest2,
    ]

    for i, raw_speaker in enumerate(SEQUENCE):
        is_opening = i == 0 or (i == 1)

        if raw_speaker == "lenny":
            print(f"    [{i+1}/12] host (Lenny Rachitsky) ...", end="", flush=True)
            chunks = []
            async for chunk in engine.generate_host_turn(
                topic=topic_title,
                guest1=guest1,
                guest2=guest2,
                debate_turns=session.turns,
                turn_number=session.turn_number,
            ):
                chunks.append(chunk)
            text = "".join(chunks).strip()
            session.add_turn("Lenny Rachitsky", text, "host")
            print(f" {len(text)} chars")
        else:
            print(f"    [{i+1}/12] guest ({raw_speaker}) ...", end="", flush=True)
            other_guest = guest2 if raw_speaker == guest1 else guest1
            chunks = []
            async for chunk in engine.generate_guest_turn(
                guest=raw_speaker,
                topic=topic_title,
                other_guest=other_guest,
                debate_turns=session.turns,
                is_opening=is_opening,
            ):
                chunks.append(chunk)
            text = "".join(chunks).strip()
            sources = getattr(engine, "_last_guest_sources", []) or []
            # Serialize sources to plain dicts (same as _serialize_sources in router)
            from routers.debate import _serialize_sources
            serialized_sources = _serialize_sources(sources)
            session.add_turn(raw_speaker, text, "guest", sources=serialized_sources)
            print(f" {len(text)} chars")

    return session.turns


async def warmup_tts(turns: list, guest1: str, guest2: str):
    """
    Pre-synthesise all sentences via ElevenLabs and populate the TTS cache.
    Each sentence the frontend will request is synthesised once and cached.
    """
    from voice.elevenlabs import synthesize_speech, is_elevenlabs_configured
    from cache_manager import get_tts_cache, set_tts_cache, slugify
    import re

    if not is_elevenlabs_configured():
        print("    [tts] ElevenLabs not configured — skipping TTS warmup")
        return

    # Replicate the sentence-splitter from audioQueue.ts
    def extract_sentences(text: str):
        pattern = r"[^.!?…\n]*[.!?…]+(?:\s+|$)"
        sentences = [m.strip() for m in re.findall(pattern, text) if len(m.strip()) >= 16]
        # Handle leftover (no trailing punctuation)
        last_end = 0
        for m in re.finditer(pattern, text):
            last_end = m.end()
        leftover = text[last_end:].strip()
        if leftover and len(leftover) >= 4:
            sentences.append(leftover)
        return sentences

    total, cached, synthesised = 0, 0, 0
    for turn in turns:
        sentences = extract_sentences(turn["text"])
        speaker = turn["speaker"]
        for s in sentences:
            total += 1
            if get_tts_cache(s, speaker):
                cached += 1
                continue
            try:
                audio = await synthesize_speech(s, speaker)
                if audio:
                    set_tts_cache(s, speaker, audio)
                    synthesised += 1
            except Exception as e:
                print(f"    [tts] Error synthesising for {speaker}: {e}")
            await asyncio.sleep(0.1)  # gentle rate-limiting

    print(f"    [tts] {total} sentences: {cached} already cached, {synthesised} newly synthesised")


async def run(args):
    from debate.personas import SUGGESTED_TOPICS
    from cache_manager import save_pregenerated, find_pregenerated

    topics = SUGGESTED_TOPICS
    if args.topic:
        topics = [t for t in SUGGESTED_TOPICS if t["id"] == args.topic]
        if not topics:
            print(f"Topic '{args.topic}' not found. Available: {[t['id'] for t in SUGGESTED_TOPICS]}")
            return

    for topic in topics:
        guests = topic["suggested_guests"]
        # Build guest pairs: all permutations or just the first pair
        if args.all_pairs:
            pairs = [(g1, g2) for g1, g2 in permutations(guests, 2)]
        else:
            # Default: generate the canonical first pairing only
            pairs = [(guests[0], guests[1])]

        for guest1, guest2 in pairs:
            print(f"\n{'='*60}")
            print(f"Topic : {topic['title']}")
            print(f"Guests: {guest1}  vs  {guest2}")
            print(f"{'='*60}")

            # Skip if already cached (unless --force)
            if not args.force and find_pregenerated(guest1, guest2, topic["title"]) is not None:
                print("  Already cached — skipping (use --force to regenerate)")
                continue

            turns = await generate_debate(topic, guest1, guest2)
            save_pregenerated(topic, guest1, guest2, turns)

            if args.warmup_tts:
                print("  Warming up TTS cache...")
                await warmup_tts(turns, guest1, guest2)

    print("\n✅ Pre-generation complete.")


def main():
    parser = argparse.ArgumentParser(description="Pre-generate hot-topic debates")
    parser.add_argument("--topic",       help="Single topic ID to generate (default: all)")
    parser.add_argument("--all-pairs",   action="store_true", help="Generate all guest permutations per topic")
    parser.add_argument("--warmup-tts",  action="store_true", help="Also pre-warm the ElevenLabs TTS audio cache")
    parser.add_argument("--force",       action="store_true", help="Regenerate even if cache file already exists")
    args = parser.parse_args()

    asyncio.run(run(args))


if __name__ == "__main__":
    main()
