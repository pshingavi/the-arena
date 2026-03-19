#!/usr/bin/env python3
"""
Discover HeyGen TTS voices and auto-suggest gender-matched voices for Arena guests.

Run:
    cd backend
    python discover_heygen_voices.py

Output (paste directly into your .env):
  HEYGEN_MALE_VOICE_ID=...       ← best male voice found
  HEYGEN_FEMALE_VOICE_ID=...     ← best female voice found
  HEYGEN_VOICE_MAP=...           ← per-guest overrides (optional, for fine-tuning)
"""

import os
import httpx
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ.get("HEYGEN_API_KEY", "")
if not API_KEY:
    print("ERROR: HEYGEN_API_KEY not set in .env")
    exit(1)

# ─── Guest voice profiles ────────────────────────────────────────────────────
# gender: used to pick male vs female voice
# age:    hint for voice age filtering
# style:  keywords that may match voice display names
GUEST_PROFILES: dict[str, dict] = {
    # Male guests
    "Lenny Rachitsky":      {"gender": "male",   "age": "middle_aged", "style": "warm curious"},
    "Marc Andreessen":      {"gender": "male",   "age": "middle_aged", "style": "rapid intellectual"},
    "Ben Horowitz":         {"gender": "male",   "age": "middle_aged", "style": "deep authoritative"},
    "Jason M. Lemkin":      {"gender": "male",   "age": "middle_aged", "style": "energetic fast"},
    "Brian Halligan":       {"gender": "male",   "age": "middle_aged", "style": "warm humorous"},
    "Bret Taylor":          {"gender": "male",   "age": "middle_aged", "style": "clear executive"},
    "Andrew Wilkinson":     {"gender": "male",   "age": "young",       "style": "casual direct"},
    "Dan Shipper":          {"gender": "male",   "age": "young",       "style": "reflective conversational"},
    "Boris Cherny":         {"gender": "male",   "age": "young",       "style": "precise technical"},
    "Benjamin Mann":        {"gender": "male",   "age": "young",       "style": "calm technical"},
    "Edwin Chen":           {"gender": "male",   "age": "young",       "style": "analytical calm"},
    "Albert Cheng":         {"gender": "male",   "age": "middle_aged", "style": "analytical executive"},
    "Howie Liu":            {"gender": "male",   "age": "young",       "style": "calm thoughtful"},
    "Jason Cohen":          {"gender": "male",   "age": "middle_aged", "style": "witty direct"},
    "Jason Droege":         {"gender": "male",   "age": "young",       "style": "executive confident"},
    "Grant Lee":            {"gender": "male",   "age": "young",       "style": "casual technical"},
    "Ethan Smith":          {"gender": "male",   "age": "young",       "style": "casual direct"},
    "Garrett Lord":         {"gender": "male",   "age": "young",       "style": "technical startup"},
    "Matt LeMay":           {"gender": "male",   "age": "middle_aged", "style": "thoughtful deliberate"},
    "Matt MacInnis":        {"gender": "male",   "age": "middle_aged", "style": "executive warm"},
    "Chip Conley":          {"gender": "male",   "age": "older",       "style": "wise warm"},
    "Eoghan McCabe":        {"gender": "male",   "age": "middle_aged", "style": "direct energetic"},
    "Brendan Foody":        {"gender": "male",   "age": "young",       "style": "analytical direct"},
    "Lazar Jovanovic":      {"gender": "male",   "age": "young",       "style": "casual technical"},
    "Alexander Embiricos":  {"gender": "male",   "age": "young",       "style": "technical calm"},
    "Madhavan Ramanujam":   {"gender": "male",   "age": "middle_aged", "style": "measured authoritative"},
    "Dhanji R. Prasanna":   {"gender": "male",   "age": "middle_aged", "style": "technical precise"},
    "Jeetu Patel":          {"gender": "male",   "age": "middle_aged", "style": "measured executive"},
    # Female guests
    "Dr. Becky Kennedy":    {"gender": "female", "age": "middle_aged", "style": "warm confident"},
    "Dr. Fei Fei Li":       {"gender": "female", "age": "middle_aged", "style": "authoritative precise"},
    "Chip Huyen":           {"gender": "female", "age": "young",       "style": "clear technical"},
    "Asha Sharma":          {"gender": "female", "age": "young",       "style": "executive confident"},
    "Elena Verna":          {"gender": "female", "age": "middle_aged", "style": "direct bold"},
    "Jeanne Grosser":       {"gender": "female", "age": "middle_aged", "style": "executive warm"},
    "Jen Abel":             {"gender": "female", "age": "middle_aged", "style": "direct energetic"},
    "Jenny Wen":            {"gender": "female", "age": "young",       "style": "bright articulate"},
    "Shreya Shankar":       {"gender": "female", "age": "young",       "style": "technical precise"},
}

# ─── Fetch available voices ───────────────────────────────────────────────────
print("Fetching HeyGen voices...\n")

resp = httpx.get(
    "https://api.heygen.com/v2/voices",
    headers={"X-Api-Key": API_KEY},
    timeout=15
)

if resp.status_code != 200:
    print(f"Error {resp.status_code}: {resp.text}")
    exit(1)

all_voices: list[dict] = resp.json().get("data", {}).get("voices", [])
print(f"Found {len(all_voices)} total voices")

# Filter to English
en_voices = [v for v in all_voices if v.get("language", "").startswith("en")]
print(f"English voices: {len(en_voices)}\n")

# Separate by gender
male_voices   = [v for v in en_voices if (v.get("gender") or "").lower() in ("male", "man")]
female_voices = [v for v in en_voices if (v.get("gender") or "").lower() in ("female", "woman", "girl")]

print(f"Male English voices:   {len(male_voices)}")
print(f"Female English voices: {len(female_voices)}\n")


# ─── Scoring helper ───────────────────────────────────────────────────────────
def score_voice(voice: dict, profile: dict) -> float:
    score = 0.0
    vgender = (voice.get("gender") or "").lower()
    vname   = (voice.get("display_name") or "").lower()
    vage    = (voice.get("age") or "").lower()

    # Gender must match — hard gate
    if profile["gender"] == "male"   and vgender not in ("male", "man"):     return -999.0
    if profile["gender"] == "female" and vgender not in ("female", "woman"): return -999.0

    score += 10.0  # gender match bonus

    # Age hint
    if profile["age"] == "middle_aged" and any(k in vage for k in ["middle", "adult", "mature"]):
        score += 3.0
    elif profile["age"] == "young" and any(k in vage for k in ["young", "teen"]):
        score += 3.0
    elif profile["age"] == "older" and any(k in vage for k in ["old", "senior", "elder"]):
        score += 3.0

    # Style keyword matches in voice name
    for word in profile.get("style", "").split():
        if len(word) > 3 and word in vname:
            score += 1.0

    return score


# ─── Find best male and female voices (for the gender defaults) ───────────────
def best_voice_for_profile(profile: dict) -> dict | None:
    candidates = male_voices if profile["gender"] == "male" else female_voices
    if not candidates:
        candidates = en_voices
    ranked = sorted(candidates, key=lambda v: score_voice(v, profile), reverse=True)
    return ranked[0] if ranked else None

# Representative profiles for each gender default
_lenny_profile  = GUEST_PROFILES["Lenny Rachitsky"]
_jenny_profile  = GUEST_PROFILES["Jenny Wen"]

best_male_voice   = best_voice_for_profile(_lenny_profile)
best_female_voice = best_voice_for_profile(_jenny_profile)


# ─── Per-guest suggestions ────────────────────────────────────────────────────
print("=" * 80)
print("SUGGESTED VOICE MATCHES PER GUEST")
print("=" * 80)

suggestions: dict[str, str] = {}
used_ids: set[str] = set()

for guest, profile in GUEST_PROFILES.items():
    pool = male_voices if profile["gender"] == "male" else female_voices
    if not pool:
        pool = en_voices

    # Prefer unused voices for variety; fall back to pool if all used
    candidates = [v for v in pool if v.get("voice_id") not in used_ids] or pool
    ranked = sorted(candidates, key=lambda v: score_voice(v, profile), reverse=True)
    top3 = ranked[:3]

    print(f"\n{guest}  [{profile['gender']}, {profile['age']}]")
    for i, v in enumerate(top3):
        marker = "→" if i == 0 else " "
        print(f"  {marker} [{i+1}] {v.get('voice_id','?'):42s}  {v.get('display_name','?'):28s}  {v.get('gender','?')} / {v.get('age','?')}")

    if top3:
        suggestions[guest] = top3[0]["voice_id"]
        used_ids.add(top3[0]["voice_id"])


# ─── Print ready-to-paste .env config ─────────────────────────────────────────
print("\n" + "=" * 80)
print("PASTE INTO backend/.env")
print("=" * 80)

mv_id = best_male_voice["voice_id"]   if best_male_voice   else ""
fv_id = best_female_voice["voice_id"] if best_female_voice else ""
mv_name = best_male_voice.get("display_name","?")   if best_male_voice   else "none found"
fv_name = best_female_voice.get("display_name","?") if best_female_voice else "none found"

print(f"\n# Gender-specific voice defaults (male guests → male voice, female → female voice)")
print(f"HEYGEN_MALE_VOICE_ID={mv_id}   # {mv_name}")
print(f"HEYGEN_FEMALE_VOICE_ID={fv_id}  # {fv_name}")

print(f"\n# Optional: per-guest overrides (only needed to fine-tune individual voices)")
voice_map_entries = [f"{g}:{vid}" for g, vid in suggestions.items()]
print(f"HEYGEN_VOICE_MAP={','.join(voice_map_entries)}")

print(f"\n# Backward-compat generic default (used only if no gender-specific ID is set)")
default_vid = suggestions.get("Lenny Rachitsky", mv_id)
print(f"HEYGEN_DEFAULT_VOICE_ID={default_vid}")


# ─── Full English voice table ─────────────────────────────────────────────────
print("\n" + "=" * 80)
print(f"ALL ENGLISH VOICES ({len(en_voices)} total)")
print("=" * 80)
print(f"\n{'MALE':}")
for v in sorted(male_voices, key=lambda v: v.get("display_name","")):
    print(f"  {v.get('voice_id','?'):42s}  {v.get('display_name','?'):28s}  age:{v.get('age','?')}")
print(f"\n{'FEMALE':}")
for v in sorted(female_voices, key=lambda v: v.get("display_name","")):
    print(f"  {v.get('voice_id','?'):42s}  {v.get('display_name','?'):28s}  age:{v.get('age','?')}")

print("\nTip: Preview voices at https://app.heygen.com/voices")
print("     Replace any voice_id in HEYGEN_VOICE_MAP to override a specific guest")
