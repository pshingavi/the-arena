"""
HeyGen Avatar Discovery & Auto-Mapping Script
============================================
Run to find all avatars in your HeyGen account and generate the correct
HEYGEN_MALE_AVATAR_ID / HEYGEN_FEMALE_AVATAR_ID env values.

Usage:
  cd backend
  python3 discover_heygen_avatars.py

Requirements:
  pip install requests python-dotenv  (or: uv run python3 discover_heygen_avatars.py)
"""

import os
import sys
import requests
from dotenv import load_dotenv

load_dotenv()

HEYGEN_API_KEY  = os.environ.get("HEYGEN_API_KEY", "")
HEYGEN_API_BASE = "https://api.heygen.com/v2"

# ─── Guest profiles ────────────────────────────────────────────────────────────
# gender: determines which avatar pool to draw from (male vs female)
# ethnicity: used to score appearance-match (best-effort — avatar metadata varies)
GUEST_PROFILES: dict[str, dict] = {
    # ── Male ──────────────────────────────────────────────────────────────────
    "Lenny Rachitsky":      {"gender": "male",   "ethnicity": "white",       "age": "middle_aged"},
    "Marc Andreessen":      {"gender": "male",   "ethnicity": "white",       "age": "middle_aged"},
    "Ben Horowitz":         {"gender": "male",   "ethnicity": "white",       "age": "middle_aged"},
    "Jason M. Lemkin":      {"gender": "male",   "ethnicity": "white",       "age": "middle_aged"},
    "Brian Halligan":       {"gender": "male",   "ethnicity": "white",       "age": "middle_aged"},
    "Bret Taylor":          {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Andrew Wilkinson":     {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Dan Shipper":          {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Boris Cherny":         {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Benjamin Mann":        {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Edwin Chen":           {"gender": "male",   "ethnicity": "east_asian",  "age": "young_adult"},
    "Albert Cheng":         {"gender": "male",   "ethnicity": "east_asian",  "age": "middle_aged"},
    "Howie Liu":            {"gender": "male",   "ethnicity": "east_asian",  "age": "young_adult"},
    "Jason Cohen":          {"gender": "male",   "ethnicity": "white",       "age": "middle_aged"},
    "Jason Droege":         {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Grant Lee":            {"gender": "male",   "ethnicity": "east_asian",  "age": "young_adult"},
    "Ethan Smith":          {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Garrett Lord":         {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Matt LeMay":           {"gender": "male",   "ethnicity": "white",       "age": "middle_aged"},
    "Matt MacInnis":        {"gender": "male",   "ethnicity": "white",       "age": "middle_aged"},
    "Chip Conley":          {"gender": "male",   "ethnicity": "white",       "age": "older"},
    "Eoghan McCabe":        {"gender": "male",   "ethnicity": "white",       "age": "middle_aged"},
    "Brendan Foody":        {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Lazar Jovanovic":      {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Alexander Embiricos":  {"gender": "male",   "ethnicity": "white",       "age": "young_adult"},
    "Madhavan Ramanujam":   {"gender": "male",   "ethnicity": "south_asian", "age": "middle_aged"},
    "Dhanji R. Prasanna":   {"gender": "male",   "ethnicity": "south_asian", "age": "middle_aged"},
    "Jeetu Patel":          {"gender": "male",   "ethnicity": "south_asian", "age": "middle_aged"},
    # ── Female ────────────────────────────────────────────────────────────────
    "Dr. Becky Kennedy":    {"gender": "female", "ethnicity": "white",       "age": "middle_aged"},
    "Dr. Fei Fei Li":       {"gender": "female", "ethnicity": "east_asian",  "age": "middle_aged"},
    "Chip Huyen":           {"gender": "female", "ethnicity": "east_asian",  "age": "young_adult"},
    "Asha Sharma":          {"gender": "female", "ethnicity": "south_asian", "age": "young_adult"},
    "Elena Verna":          {"gender": "female", "ethnicity": "white",       "age": "middle_aged"},
    "Jeanne Grosser":       {"gender": "female", "ethnicity": "white",       "age": "middle_aged"},
    "Jen Abel":             {"gender": "female", "ethnicity": "white",       "age": "middle_aged"},
    "Jenny Wen":            {"gender": "female", "ethnicity": "east_asian",  "age": "young_adult"},
    "Shreya Shankar":       {"gender": "female", "ethnicity": "south_asian", "age": "young_adult"},
}


def fetch_avatars() -> list[dict]:
    """Fetch all available avatars from HeyGen."""
    print("Fetching avatars from HeyGen API...\n")
    headers = {"X-Api-Key": HEYGEN_API_KEY, "Accept": "application/json"}
    resp = requests.get(f"{HEYGEN_API_BASE}/avatars", headers=headers, timeout=15)
    if resp.status_code != 200:
        print(f"HeyGen API error {resp.status_code}: {resp.text[:300]}")
        return []
    data     = resp.json()
    avatars  = data.get("data", {}).get("avatars", data.get("avatars", []))
    print(f"Found {len(avatars)} avatars\n")
    return avatars


def detect_gender(avatar: dict) -> str | None:
    """
    Try to determine an avatar's gender from its metadata.
    Returns 'male', 'female', or None (unknown).
    """
    # HeyGen sometimes returns a 'gender' field
    g = (avatar.get("gender") or "").lower().strip()
    if g in ("male", "man"):
        return "male"
    if g in ("female", "woman", "girl"):
        return "female"

    # Fall back to name-based heuristics
    name = (
        avatar.get("avatar_name") or
        avatar.get("name") or
        avatar.get("avatar_id") or ""
    ).lower()

    female_keywords = [
        "abigail", "adriana", "amanda", "aiko", "alice", "anna", "ashley",
        "bella", "claire", "diana", "elena", "emily", "emma", "grace",
        "hana", "isabella", "janet", "jessica", "julia", "kate", "karen",
        "laura", "leila", "lily", "lisa", "lucy", "mia", "natalie",
        "olivia", "sarah", "sophia", "victoria", "wendy", "yuna",
        "female", "woman", "girl", "lady", "ms.", "mrs.",
    ]
    male_keywords = [
        "aditya", "adrian", "albert", "alex", "andrew", "austin",
        "ben", "bob", "brad", "brian", "carlos", "chris", "daniel",
        "david", "derek", "dylan", "eric", "evan", "frank", "george",
        "henry", "jack", "jake", "james", "jason", "john", "jordan",
        "kevin", "kyle", "leo", "liam", "luke", "mark", "matthew",
        "michael", "mike", "nathan", "nicholas", "noah", "oliver",
        "patrick", "paul", "peter", "ryan", "sam", "scott", "stephen",
        "thomas", "tim", "tyler", "william",
        "male", "man", "guy", "mr.", "dr.",
    ]
    for kw in female_keywords:
        if kw in name:
            return "female"
    for kw in male_keywords:
        if kw in name:
            return "male"

    return None  # unknown — will go into ungendered pool


def score_avatar(avatar: dict, profile: dict) -> int:
    """
    Score an avatar's fit for a guest profile (higher = better).
    Gender must already match the pool — this refines within-gender ranking.
    """
    score = 0
    name      = (avatar.get("avatar_name") or avatar.get("name") or "").lower()
    tags      = (avatar.get("tags") or avatar.get("style") or "").lower()
    age_field = (avatar.get("age") or "").lower()
    combined  = name + " " + tags

    # Ethnicity approximation from avatar name/tags
    eth = profile.get("ethnicity", "")
    eth_map = {
        "east_asian":  ["asian", "chinese", "korean", "japanese", "aiko", "yuna", "hana"],
        "south_asian": ["indian", "south asian", "aditya", "asha", "priya", "raj"],
        "white":       ["caucasian", "european", "western"],
        "black":       ["african", "black"],
        "hispanic":    ["latin", "hispanic", "spanish"],
    }
    for kw in eth_map.get(eth, []):
        if kw in combined:
            score += 3

    # Age approximation
    age = profile.get("age", "")
    if age == "young_adult" and any(k in age_field for k in ["young", "20", "30"]):
        score += 2
    elif age == "middle_aged" and any(k in age_field for k in ["middle", "40", "50"]):
        score += 2
    elif age == "older" and any(k in age_field for k in ["old", "senior", "60", "70"]):
        score += 2

    return score


def build_avatar_map(avatars: list[dict]) -> dict[str, str]:
    """
    Assign the best-matching avatar to each guest.
    Strict gender separation: male guests ONLY get male avatars, female ONLY female.
    """
    # Bucket avatars by detected gender
    male_pool:    list[dict] = []
    female_pool:  list[dict] = []
    unknown_pool: list[dict] = []

    for av in avatars:
        g = detect_gender(av)
        if g == "male":
            male_pool.append(av)
        elif g == "female":
            female_pool.append(av)
        else:
            unknown_pool.append(av)

    print(f"Avatar gender breakdown:")
    print(f"  Male:    {len(male_pool)}")
    print(f"  Female:  {len(female_pool)}")
    print(f"  Unknown: {len(unknown_pool)}\n")

    # If gender detection mostly failed, fall back to all avatars
    if len(male_pool) < 3 and len(female_pool) < 3:
        print("Warning: gender detection failed for most avatars — using all avatars for both genders")
        male_pool   = avatars
        female_pool = avatars

    # Augment small pools with unknown-gender avatars
    if len(male_pool) < 5:
        male_pool   = male_pool   + unknown_pool
    if len(female_pool) < 5:
        female_pool = female_pool + unknown_pool

    assignment: dict[str, str] = {}
    usage: dict[str, int] = {}  # track how often each avatar is used

    for guest, profile in GUEST_PROFILES.items():
        pool = male_pool if profile["gender"] == "male" else female_pool

        # Score and sort; prefer less-used avatars at equal score for variety
        ranked = sorted(
            pool,
            key=lambda av: (
                score_avatar(av, profile),
                -usage.get(av.get("avatar_id") or av.get("id", ""), 0)
            ),
            reverse=True
        )

        if ranked:
            best = ranked[0]
            aid  = best.get("avatar_id") or best.get("id", "")
            assignment[guest] = aid
            usage[aid] = usage.get(aid, 0) + 1

    return assignment


def main() -> None:
    if not HEYGEN_API_KEY:
        print("HEYGEN_API_KEY not set in .env")
        sys.exit(1)

    print("=" * 70)
    print("  HeyGen Avatar Discovery for The Arena")
    print("=" * 70 + "\n")

    avatars = fetch_avatars()

    if not avatars:
        print("No avatars found. Check your HeyGen API key and account.")
        print()
        print("To set up avatars:")
        print("  1. Go to app.heygen.com → Avatars")
        print("  2. Choose Instant Avatars or Studio Avatars")
        print("  3. Create/upload avatars for your guests")
        print("  4. Re-run this script")
        return

    # ─── Print all available avatars, grouped by detected gender ──────────────
    print("Available Avatars (grouped by detected gender):")
    print("-" * 70)

    male_avs    = [a for a in avatars if detect_gender(a) == "male"]
    female_avs  = [a for a in avatars if detect_gender(a) == "female"]
    unknown_avs = [a for a in avatars if detect_gender(a) is None]

    def print_avatar(a: dict) -> None:
        aid     = (a.get("avatar_id") or a.get("id", "???"))[:28]
        name    = (a.get("avatar_name") or a.get("name", "Unnamed"))[:30]
        gender  = a.get("gender", detect_gender(a) or "unknown")
        print(f"  [{aid:28s}]  {name:30s}  {gender}")

    print("\nMALE:")
    for a in sorted(male_avs, key=lambda x: x.get("avatar_name") or ""):
        print_avatar(a)

    print("\nFEMALE:")
    for a in sorted(female_avs, key=lambda x: x.get("avatar_name") or ""):
        print_avatar(a)

    if unknown_avs:
        print(f"\nUNKNOWN GENDER ({len(unknown_avs)} avatars — check manually):")
        for a in unknown_avs[:10]:
            print_avatar(a)
        if len(unknown_avs) > 10:
            print(f"  ...and {len(unknown_avs)-10} more")

    # ─── Auto-assign ──────────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("Auto-assigning avatars to guests (strict gender separation)")
    print("=" * 70 + "\n")

    assignment = build_avatar_map(avatars)

    print(f"{'Guest':50s}  {'Avatar ID':30s}  {'Gender':7s}")
    print("-" * 95)
    for guest, aid in assignment.items():
        av     = next((a for a in avatars if (a.get("avatar_id") or a.get("id")) == aid), {})
        aname  = (av.get("avatar_name") or av.get("name", "Unknown"))[:30]
        ag     = detect_gender(av) or av.get("gender", "?")
        g_req  = GUEST_PROFILES[guest]["gender"]
        match  = "✓" if ag == g_req else "⚠ GENDER MISMATCH"
        print(f"  {guest:48s}  {aname:30s}  [{ag}] {match}")

    # ─── Gender defaults: pick one good male and one good female avatar ────────
    # Best male default = most professional-looking, middle-aged white male
    # (Lenny's profile is a good proxy)
    lenny_profile  = GUEST_PROFILES["Lenny Rachitsky"]
    jenny_profile  = GUEST_PROFILES["Jenny Wen"]

    best_male_av   = sorted(
        male_avs or avatars, key=lambda a: score_avatar(a, lenny_profile), reverse=True
    )[0] if avatars else None
    best_female_av = sorted(
        female_avs or avatars, key=lambda a: score_avatar(a, jenny_profile), reverse=True
    )[0] if avatars else None

    default_male_id   = (best_male_av.get("avatar_id") or best_male_av.get("id","")) if best_male_av else ""
    default_female_id = (best_female_av.get("avatar_id") or best_female_av.get("id","")) if best_female_av else ""

    # ─── Print ready-to-paste .env output ─────────────────────────────────────
    env_pairs = [f"{g}:{aid}" for g, aid in assignment.items()]

    print("\n" + "=" * 70)
    print("PASTE INTO backend/.env")
    print("=" * 70)

    print(f"\n# Gender-specific avatar defaults (male guests → male avatar, female → female)")
    print(f"HEYGEN_MALE_AVATAR_ID={default_male_id}")
    print(f"HEYGEN_FEMALE_AVATAR_ID={default_female_id}")

    print(f"\n# Per-guest avatar overrides (optional — comment out to use defaults)")
    print(f"HEYGEN_AVATAR_MAP={','.join(env_pairs)}")

    print(f"\n# Backward-compat single default (used only if no gender-specific IDs are set)")
    print(f"HEYGEN_DEFAULT_AVATAR_ID={default_male_id}")

    print("\nTip: manually replace any avatar_id in HEYGEN_AVATAR_MAP to customize individual guests")
    print("     Preview avatars at https://app.heygen.com/avatars")


if __name__ == "__main__":
    main()
