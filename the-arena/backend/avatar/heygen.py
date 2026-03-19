"""
HeyGen avatar video generation integration.

Setup:
  1. Set HEYGEN_API_KEY in .env
  2. Run discover_heygen_avatars.py  → paste HEYGEN_MALE_AVATAR_ID / HEYGEN_FEMALE_AVATAR_ID
  3. Run discover_heygen_voices.py   → paste HEYGEN_MALE_VOICE_ID / HEYGEN_FEMALE_VOICE_ID
  4. Optionally add per-guest overrides in HEYGEN_AVATAR_MAP / HEYGEN_VOICE_MAP

Gender selection:
  Each guest has a known gender (see GUEST_GENDERS below).
  The lookup order for voice/avatar is:
    1. Per-guest override in HEYGEN_VOICE_MAP / HEYGEN_AVATAR_MAP  (highest priority)
    2. Gender-specific default: HEYGEN_MALE_VOICE_ID or HEYGEN_FEMALE_VOICE_ID
    3. Generic default: HEYGEN_DEFAULT_VOICE_ID / HEYGEN_DEFAULT_AVATAR_ID  (fallback)
"""

import os
import httpx
from typing import Optional, Dict


HEYGEN_API_BASE = "https://api.heygen.com/v2"


# ─── Guest gender registry ────────────────────────────────────────────────────
# Determines which male/female voice & avatar is used for each guest
# when no per-guest override is configured.
GUEST_GENDERS: dict[str, str] = {
    # ── Male guests ───────────────────────────────────────────────────────────
    "Lenny Rachitsky":                              "male",
    "Marc Andreessen":                              "male",
    "Ben Horowitz":                                 "male",
    "Jason M. Lemkin":                              "male",
    "Jason M Lemkin":                               "male",   # alias without period
    "Brian Halligan":                               "male",
    "Bret Taylor":                                  "male",
    "Andrew Wilkinson":                             "male",
    "Dan Shipper":                                  "male",
    "Boris Cherny":                                 "male",
    "Benjamin Mann":                                "male",
    "Edwin Chen":                                   "male",
    "Albert Cheng":                                 "male",
    "Howie Liu":                                    "male",
    "Jason Cohen":                                  "male",
    "Jason Droege":                                 "male",
    "Grant Lee":                                    "male",
    "Ethan Smith":                                  "male",
    "Garrett Lord":                                 "male",
    "Matt LeMay":                                   "male",
    "Matt Lemay":                                   "male",   # alias
    "Matt MacInnis":                                "male",
    "Chip Conley":                                  "male",
    "Eoghan McCabe":                                "male",
    "Brendan Foody":                                "male",
    "Lazar Jovanovic":                              "male",
    "Alexander Embiricos":                          "male",
    "Madhavan Ramanujam":                           "male",
    "Dhanji R. Prasanna":                           "male",
    "Jeetu Patel":                                  "male",
    "Aishwarya Naresh Reganti":                     "male",   # male guest
    "Kiriti Badam":                                 "male",
    "Hamel Husain":                                 "male",
    # ── Female guests ─────────────────────────────────────────────────────────
    "Dr. Becky Kennedy":                            "female",
    "Dr. Fei Fei Li":                               "female",
    "Chip Huyen":                                   "female",
    "Asha Sharma":                                  "female",
    "Elena Verna":                                  "female",
    "Elena Verna 4.0":                              "female",  # alias
    "Jeanne Grosser":                               "female",
    "Jen Abel":                                     "female",
    "Jenny Wen":                                    "female",
    "Shreya Shankar":                               "female",
}


def get_gender_for_guest(guest: str) -> str:
    """
    Return 'male' or 'female' for a guest.
    Checks exact name first, then tries a case-insensitive lookup.
    Defaults to 'male' if the guest is not in the registry.
    """
    if guest in GUEST_GENDERS:
        return GUEST_GENDERS[guest]
    # Case-insensitive fallback
    lower = guest.strip().lower()
    for name, gender in GUEST_GENDERS.items():
        if name.lower() == lower:
            return gender
    return "male"   # safe default — most podcast guests are male


def _parse_map(map_str: str) -> dict[str, str]:
    """Parse 'Name:id,Name2:id2' env string into a dict."""
    result: dict[str, str] = {}
    for pair in map_str.split(","):
        pair = pair.strip()
        if ":" in pair:
            name, value = pair.split(":", 1)
            result[name.strip().lower()] = value.strip()
    return result


# ─── Avatar ID lookup ─────────────────────────────────────────────────────────

def get_avatar_id(guest: str) -> str:
    """
    Return the HeyGen avatar ID for a guest.

    Lookup order:
      1. HEYGEN_AVATAR_MAP  — per-guest override, format: "Guest Name:avatar_id,..."
      2. HEYGEN_MALE_AVATAR_ID or HEYGEN_FEMALE_AVATAR_ID  — gender-specific default
      3. HEYGEN_DEFAULT_AVATAR_ID  — catch-all fallback
    """
    # 1. Per-guest map
    avatar_map_str = os.environ.get("HEYGEN_AVATAR_MAP", "")
    if avatar_map_str:
        avatar_map = _parse_map(avatar_map_str)
        if guest.strip().lower() in avatar_map:
            return avatar_map[guest.strip().lower()]

    # 2. Gender-specific default
    gender = get_gender_for_guest(guest)
    if gender == "female":
        fid = os.environ.get("HEYGEN_FEMALE_AVATAR_ID", "")
        if fid:
            return fid
    else:
        mid = os.environ.get("HEYGEN_MALE_AVATAR_ID", "")
        if mid:
            return mid

    # 3. Generic default
    return os.environ.get("HEYGEN_DEFAULT_AVATAR_ID", "")


# ─── Voice ID lookup ──────────────────────────────────────────────────────────

def get_heygen_voice_id(guest: str) -> str:
    """
    Return the HeyGen TTS voice ID for a guest.
    HeyGen voices are account-scoped; run discover_heygen_voices.py to find IDs.

    Lookup order:
      1. HEYGEN_VOICE_MAP  — per-guest override, format: "Guest Name:voice_id,..."
      2. HEYGEN_MALE_VOICE_ID or HEYGEN_FEMALE_VOICE_ID  — gender-specific default
      3. HEYGEN_DEFAULT_VOICE_ID  — catch-all fallback
    """
    # 1. Per-guest map
    voice_map_str = os.environ.get("HEYGEN_VOICE_MAP", "")
    if voice_map_str:
        voice_map = _parse_map(voice_map_str)
        if guest.strip().lower() in voice_map:
            return voice_map[guest.strip().lower()]

    # 2. Gender-specific default
    gender = get_gender_for_guest(guest)
    if gender == "female":
        fv = os.environ.get("HEYGEN_FEMALE_VOICE_ID", "")
        if fv:
            return fv
    else:
        mv = os.environ.get("HEYGEN_MALE_VOICE_ID", "")
        if mv:
            return mv

    # 3. Generic default (backward compat)
    return os.environ.get("HEYGEN_DEFAULT_VOICE_ID", "")


# ─── Video generation ─────────────────────────────────────────────────────────

async def generate_talking_avatar(
    text: str,
    guest: str,
) -> Optional[Dict]:
    """
    Submit a HeyGen talking avatar video generation job.

    Returns {"video_id": "...", "status": "pending"} immediately.
    The actual video takes 30-120 seconds to render in HeyGen's cloud.
    Poll get_video_status(video_id) until status == "completed".

    Uses HeyGen's built-in TTS — the voice audio comes from HeyGen,
    not ElevenLabs. ElevenLabs is NOT used when HeyGen is configured.
    """
    api_key = os.environ.get("HEYGEN_API_KEY")
    if not api_key or api_key == "...":
        return None

    avatar_id = get_avatar_id(guest)
    if not avatar_id:
        print(f"[HeyGen] No avatar_id for '{guest}' — set HEYGEN_AVATAR_MAP or HEYGEN_MALE/FEMALE_AVATAR_ID")
        return None

    voice_id = get_heygen_voice_id(guest)
    if not voice_id:
        print(f"[HeyGen] No voice_id for '{guest}' — set HEYGEN_VOICE_MAP or HEYGEN_MALE/FEMALE_VOICE_ID")
        return None

    gender = get_gender_for_guest(guest)

    # Truncate to HeyGen TTS limit (1500 chars)
    text_for_video = text[:1500] if len(text) > 1500 else text

    payload = {
        "video_inputs": [
            {
                "character": {
                    "type": "avatar",
                    "avatar_id": avatar_id,
                    "avatar_style": "normal"
                },
                "voice": {
                    "type": "text",
                    "input_text": text_for_video,
                    "voice_id": voice_id,
                },
                "background": {
                    "type": "color",
                    "value": "#0d0d18"   # dark studio background
                }
            }
        ],
        "dimension": {
            "width": 480,
            "height": 480
        },
        "aspect_ratio": "1:1"
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{HEYGEN_API_BASE}/video/generate",
                headers={
                    "X-Api-Key": api_key,
                    "Content-Type": "application/json"
                },
                json=payload
            )

            if response.status_code == 200:
                data = response.json()
                video_id = data.get("data", {}).get("video_id")
                if video_id:
                    print(f"[HeyGen] Job submitted: {guest} ({gender}) → {video_id}")
                    return {"video_id": video_id, "status": "pending"}
                else:
                    print(f"[HeyGen] Missing video_id in response: {data}")
                    return None
            else:
                print(f"[HeyGen] Error {response.status_code}: {response.text[:300]}")
                return None

    except Exception as e:
        print(f"[HeyGen] Request failed for '{guest}': {e}")
        return None


async def get_video_status(video_id: str) -> Optional[Dict]:
    """
    Poll HeyGen for video generation status.
    Statuses: 'pending' | 'processing' | 'completed' | 'failed'
    When completed, includes video_url.
    """
    api_key = os.environ.get("HEYGEN_API_KEY")
    if not api_key:
        return None

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{HEYGEN_API_BASE}/video/{video_id}",
                headers={"X-Api-Key": api_key}
            )

            if response.status_code == 200:
                data = response.json().get("data", {})
                return {
                    "video_id":      video_id,
                    "status":        data.get("status", "pending"),
                    "video_url":     data.get("video_url"),
                    "thumbnail_url": data.get("thumbnail_url"),
                    "duration":      data.get("duration"),
                }
            elif response.status_code == 404:
                return {"video_id": video_id, "status": "pending", "video_url": None}
            else:
                print(f"[HeyGen] Status error {response.status_code}: {response.text[:200]}")
                return None

    except Exception as e:
        print(f"[HeyGen] Status check failed: {e}")
        return None


def is_heygen_configured() -> bool:
    """
    Check if HeyGen is usable: needs API key + at least one avatar ID + one voice ID.
    Accepts either gender-specific or generic defaults.

    Set DISABLE_HEYGEN=true in .env to force ElevenLabs-only mode even if
    all HeyGen credentials are present (useful for MVP / production launches
    where you want predictable ElevenLabs behaviour without avatar render lag).
    """
    if os.environ.get("DISABLE_HEYGEN", "").lower() in ("1", "true", "yes"):
        return False

    api_key = os.environ.get("HEYGEN_API_KEY", "")
    if not api_key or api_key in ("...", ""):
        return False

    has_avatar = bool(
        os.environ.get("HEYGEN_MALE_AVATAR_ID")
        or os.environ.get("HEYGEN_FEMALE_AVATAR_ID")
        or os.environ.get("HEYGEN_DEFAULT_AVATAR_ID")
        or os.environ.get("HEYGEN_AVATAR_MAP")
    )
    has_voice = bool(
        os.environ.get("HEYGEN_MALE_VOICE_ID")
        or os.environ.get("HEYGEN_FEMALE_VOICE_ID")
        or os.environ.get("HEYGEN_DEFAULT_VOICE_ID")
        or os.environ.get("HEYGEN_VOICE_MAP")
    )

    return has_avatar and has_voice
