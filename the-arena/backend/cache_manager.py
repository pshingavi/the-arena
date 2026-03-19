"""
Debate pre-generation cache manager.

Two caches:
  1. Debate cache  — full pre-generated debate scripts stored as JSON.
     Filename: debate_cache/{topic_id}__{guest1_slug}__{guest2_slug}.json
     Keyed by (topic title, guest1, guest2) — guests sorted alphabetically
     so swapped order hits the same file.

  2. TTS audio cache — ElevenLabs synthesis results stored as mp3 files.
     Filename: debate_cache/tts/{md5(text|speaker)}.mp3
     Eliminates repeat ElevenLabs calls for the same sentence+speaker.
"""

import json
import hashlib
from pathlib import Path
from typing import Optional

CACHE_DIR     = Path(__file__).parent / "debate_cache"
TTS_CACHE_DIR = CACHE_DIR / "tts"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def slugify(s: str) -> str:
    """Convert a name/title to a filesystem-safe slug."""
    return (
        s.lower()
         .replace(" ", "-")
         .replace("'", "")
         .replace(".", "")
         .replace(",", "")
         .replace("(", "")
         .replace(")", "")
    )


def _cache_path(topic_id: str, guest1: str, guest2: str) -> Path:
    guests_sorted = sorted([slugify(guest1), slugify(guest2)])
    filename = f"{topic_id}__{guests_sorted[0]}__{guests_sorted[1]}.json"
    return CACHE_DIR / filename


# ─── Debate cache ─────────────────────────────────────────────────────────────

def find_pregenerated(guest1: str, guest2: str, topic: str) -> Optional[dict]:
    """
    Return the pre-generated debate dict if one exists for this
    topic + guest pair, otherwise None (→ use live LLM pipeline).

    Matching rules:
    - topic must exactly match a SUGGESTED_TOPIC title (case-insensitive)
    - both guests must appear in that topic's suggested_guests list
    """
    from debate.personas import SUGGESTED_TOPICS

    # Find matching suggested topic
    topic_data = None
    for t in SUGGESTED_TOPICS:
        if t["title"].lower() == topic.lower():
            topic_data = t
            break
    if topic_data is None:
        return None  # custom / new topic → live pipeline

    # Both guests must be from the suggested list for this topic
    suggested_lower = {g.lower() for g in topic_data["suggested_guests"]}
    if guest1.lower() not in suggested_lower or guest2.lower() not in suggested_lower:
        return None  # different speaker selection → live pipeline

    path = _cache_path(topic_data["id"], guest1, guest2)
    if not path.exists():
        return None  # not yet pre-generated → live pipeline

    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"[cache] Failed to load {path}: {e}")
        return None

    # Guard: the cache was generated with a specific guest order (who speaks first).
    # If the user swapped the order, the cached turn content (e.g. "responding to
    # Jeetu's opening…") would be presented in the wrong position.  Fall through to
    # the live pipeline instead so the order is naturally correct.
    if (data.get("guest1", "").lower() != guest1.lower() or
            data.get("guest2", "").lower() != guest2.lower()):
        return None  # swapped order → live pipeline

    return data


def save_pregenerated(topic_data: dict, guest1: str, guest2: str, turns: list):
    """Persist a generated debate to the cache directory."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    data = {
        "topic_id": topic_data["id"],
        "topic":    topic_data["title"],
        "guest1":   guest1,
        "guest2":   guest2,
        "turns":    turns,
    }
    path = _cache_path(topic_data["id"], guest1, guest2)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"[cache] Saved {len(turns)} turns → {path.name}")


# ─── TTS audio cache ──────────────────────────────────────────────────────────

def _tts_key(text: str, speaker: str) -> str:
    """MD5 hex digest used as the cache filename."""
    return hashlib.md5(f"{text}|{speaker}".encode("utf-8")).hexdigest()


def get_tts_cache(text: str, speaker: str) -> Optional[bytes]:
    """Return cached mp3 bytes if available, else None."""
    TTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = TTS_CACHE_DIR / f"{_tts_key(text, speaker)}.mp3"
    if cache_file.exists():
        return cache_file.read_bytes()
    return None


def set_tts_cache(text: str, speaker: str, audio_bytes: bytes) -> None:
    """Write mp3 bytes to the TTS cache (fire-and-forget; errors are silenced)."""
    try:
        TTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file = TTS_CACHE_DIR / f"{_tts_key(text, speaker)}.mp3"
        cache_file.write_bytes(audio_bytes)
    except Exception as e:
        print(f"[tts-cache] Write failed: {e}")
