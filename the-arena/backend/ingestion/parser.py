"""
Parse Lenny's markdown transcripts into structured speaker-turn chunks
for per-guest RAG retrieval.
"""

import os
import re
import json
from pathlib import Path
from typing import List, Dict, Optional


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Extract YAML frontmatter and body from markdown."""
    if not content.startswith("---"):
        return {}, content

    end = content.find("---", 3)
    if end == -1:
        return {}, content

    frontmatter_str = content[3:end].strip()
    body = content[end + 3:].strip()

    meta = {}
    for line in frontmatter_str.split("\n"):
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip().strip('"')
            if value.startswith("[") and value.endswith("]"):
                # Parse simple arrays
                value = [v.strip().strip('"') for v in value[1:-1].split(",") if v.strip()]
            meta[key] = value

    return meta, body


def parse_speaker_turns(body: str, primary_guest: str) -> List[Dict]:
    """
    Parse transcript body into speaker turns.
    Returns chunks with speaker, text, and metadata.
    """
    # Pattern: **Speaker Name** (timestamp): text
    # or **Speaker Name** (timestamp):\n text
    pattern = r'\*\*([^*]+)\*\*\s*\([^)]*\):\s*'

    parts = re.split(pattern, body)

    turns = []
    i = 0

    # parts alternates: [pre_text, speaker1, text1, speaker2, text2, ...]
    if len(parts) > 1:
        i = 1  # skip pre-text
        while i < len(parts) - 1:
            speaker = parts[i].strip()
            text = parts[i + 1].strip() if i + 1 < len(parts) else ""

            # Clean up text
            text = re.sub(r'\([0-9:]+\)\s*', '', text)  # Remove timestamps
            text = re.sub(r'\s+', ' ', text).strip()

            if text and len(text) > 50:  # Only meaningful turns
                turns.append({
                    "speaker": speaker,
                    "text": text,
                    "is_guest": speaker.lower() != "lenny rachitsky",
                    "is_host": speaker.lower() == "lenny rachitsky"
                })

            i += 2

    return turns


def chunk_turns(turns: List[Dict], chunk_size: int = 3) -> List[Dict]:
    """
    Group consecutive turns into overlapping chunks for better context.
    Guest turns get individual chunks + grouped chunks.
    """
    chunks = []

    # Individual guest turns (for precise retrieval)
    for i, turn in enumerate(turns):
        if turn["is_guest"] and len(turn["text"]) > 100:
            chunks.append({
                "text": turn["text"],
                "speaker": turn["speaker"],
                "chunk_type": "individual",
                "turn_index": i
            })

    # Sliding window chunks (groups of turns for context)
    for i in range(0, len(turns) - chunk_size + 1, 2):
        window = turns[i:i + chunk_size]
        combined_text = "\n\n".join(
            f"{t['speaker']}: {t['text']}" for t in window
        )
        # Only include windows where guest is the primary speaker
        guest_turns = [t for t in window if t["is_guest"]]
        if guest_turns and len(combined_text) > 200:
            chunks.append({
                "text": combined_text,
                "speaker": guest_turns[0]["speaker"],
                "chunk_type": "contextual",
                "turn_index": i
            })

    return chunks


def load_podcast(filepath: str) -> Optional[Dict]:
    """Load and parse a single podcast transcript file."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        meta, body = parse_frontmatter(content)

        if not meta.get("guest"):
            return None

        turns = parse_speaker_turns(body, meta.get("guest", ""))
        chunks = chunk_turns(turns)

        return {
            "guest": meta.get("guest", "Unknown"),
            "title": meta.get("title", ""),
            "date": meta.get("date", ""),
            "tags": meta.get("tags", []),
            "description": meta.get("description", ""),
            "youtube_url": meta.get("youtube_url", ""),
            "video_id": meta.get("video_id", ""),
            "filepath": filepath,
            "turns": turns,
            "chunks": chunks,
            "word_count": meta.get("word_count", 0)
        }
    except Exception as e:
        print(f"Error parsing {filepath}: {e}")
        return None


def load_newsletter(filepath: str) -> Optional[Dict]:
    """Load and parse a newsletter post."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        meta, body = parse_frontmatter(content)

        # Clean markdown for cleaner text
        clean_text = re.sub(r'#{1,6}\s+', '', body)
        clean_text = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', clean_text)
        clean_text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', clean_text)
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()

        # Chunk newsletter into paragraphs
        paragraphs = [p.strip() for p in body.split("\n\n") if len(p.strip()) > 150]

        chunks = [{"text": p, "speaker": "Lenny Rachitsky", "chunk_type": "newsletter", "turn_index": i}
                  for i, p in enumerate(paragraphs)]

        return {
            "guest": "Lenny Rachitsky",
            "title": meta.get("title", ""),
            "date": meta.get("date", ""),
            "tags": meta.get("tags", []),
            "description": meta.get("description", ""),
            "filepath": filepath,
            "chunks": chunks,
            "word_count": meta.get("word_count", 0),
            "type": "newsletter"
        }
    except Exception as e:
        print(f"Error parsing newsletter {filepath}: {e}")
        return None


def load_all_data(data_dir: str) -> Dict:
    """Load all podcasts and newsletters from data directory."""
    podcasts_dir = os.path.join(data_dir, "03-podcasts")
    newsletters_dir = os.path.join(data_dir, "02-newsletters")

    podcasts = []
    newsletters = []

    # Load podcasts
    if os.path.exists(podcasts_dir):
        for filename in sorted(os.listdir(podcasts_dir)):
            if filename.endswith(".md"):
                filepath = os.path.join(podcasts_dir, filename)
                podcast = load_podcast(filepath)
                if podcast:
                    podcasts.append(podcast)

    # Load newsletters
    if os.path.exists(newsletters_dir):
        for filename in sorted(os.listdir(newsletters_dir)):
            if filename.endswith(".md"):
                filepath = os.path.join(newsletters_dir, filename)
                newsletter = load_newsletter(filepath)
                if newsletter:
                    newsletters.append(newsletter)

    print(f"✅ Loaded {len(podcasts)} podcasts, {len(newsletters)} newsletters")
    return {"podcasts": podcasts, "newsletters": newsletters}
