"""
ElevenLabs TTS — per-guest voice synthesis with SSML preprocessing.
Model: eleven_turbo_v2_5 (low latency, high quality, SSML support)
"""

import os
import httpx
from typing import Optional
from .tts_preprocessor import prepare_for_elevenlabs


ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1"


def get_voice_id(guest: str) -> str:
    voice_map_str = os.environ.get("ELEVENLABS_VOICE_MAP", "")
    default_voice = os.environ.get("ELEVENLABS_DEFAULT_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    if not voice_map_str:
        return default_voice
    voice_map = {}
    for pair in voice_map_str.split(","):
        if ":" in pair:
            name, vid = pair.split(":", 1)
            voice_map[name.strip().lower()] = vid.strip()
    return voice_map.get(guest.lower(), default_voice)


async def synthesize_speech(
    text: str,
    guest: str,
    stability: float = 0.48,
    similarity_boost: float = 0.78,
    style: float = 0.12,
    api_key: Optional[str] = None,
) -> Optional[bytes]:
    """
    Synthesize speech for a guest turn.
    Pre-processes text through tts_preprocessor before sending to ElevenLabs.
    Returns audio bytes (mp3) or None if not configured.
    api_key: optional user-supplied key; falls back to ELEVENLABS_API_KEY env var.
    """
    api_key = api_key or os.environ.get("ELEVENLABS_API_KEY")
    if not api_key or api_key == "...":
        return None

    voice_id = get_voice_id(guest)

    # Clean and add speech modulation markup
    clean_text = prepare_for_elevenlabs(text, speaker=guest)

    # Truncate to ElevenLabs limit (5000 chars for turbo model)
    if len(clean_text) > 4800:
        clean_text = clean_text[:4800] + "..."

    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            f"{ELEVENLABS_API_BASE}/text-to-speech/{voice_id}",
            headers={
                "xi-api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg"
            },
            json={
                "text": clean_text,
                # eleven_turbo_v2_5: fast + high quality + SSML <break> support
                "model_id": "eleven_turbo_v2_5",
                "voice_settings": {
                    "stability": stability,
                    "similarity_boost": similarity_boost,
                    "style": style,
                    "use_speaker_boost": True
                }
            }
        )

        if response.status_code == 200:
            return response.content
        else:
            print(f"ElevenLabs error {response.status_code}: {response.text[:200]}")
            return None


def is_elevenlabs_configured() -> bool:
    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    return bool(api_key and api_key != "...")
