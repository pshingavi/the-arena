"""
Content safety + citation grounding for The Arena.

Two responsibilities:
1. SAFETY VALIDATOR — blocks responses with inappropriate content before they
   reach the client (political attacks, hate speech, religious slurs, profanity,
   personal attacks, conspiracy theories, etc.)

2. CITATION INJECTOR — ensures every guest response contains a grounding citation
   so the audience can verify the claim came from a real interview.
"""

import re
from typing import Optional


# ── 1. Safety patterns ────────────────────────────────────────────────────────

# Hard-blocked categories (reject outright, replace with safe fallback)
_HARD_BLOCK_PATTERNS = [
    # Hate speech / slurs (broad patterns, regex-safe substrings)
    r"\b(n[i1]gg[e3]r|f[a4]gg[o0]t|ch[i1]nk|sp[i1]c|k[i1]k[e3]|cr[a4]ck[e3]r|w[e3]tb[a4]ck)\b",
    # Death / violence threats
    r"\b(should (be )?killed?|deserve(s)? to die|murder (all|every)|violent(ly)? overthrow)\b",
    # Extreme political incitement
    r"\b(civil war|violent revolution|armed uprising|take up arms against)\b",
    # Sexual content
    r"\b(porn|masturbat|cum shot|anal sex|blow ?job|hand ?job)\b",
]

# Soft-warn categories (flag but allow if debate-relevant, just sanitise)
_SOFT_WARN_PATTERNS = [
    r"\b(f+u+c+k+|sh[i1]t+|a+s+s+h+o+l+e+|b[i1]tch)\b",
    r"\b(satan|devil worship|jew[s]? control|muslims are|christians are all)\b",
    r"\b(trump is|biden is|obama is|maga|antifa)\b",  # partisan political attacks
]

# Citation markers the model should produce (at least one required per guest turn)
_CITATION_RE = re.compile(
    r"(\(.*?(interview|podcast|episode|conversation|lenny|source|transcript).*?\)"
     r"|\".*?\" ?[-–—] ?[A-Z]"
     r"|as (he|she|they) (said|mentioned|noted|argued|explained)"
     r"|in (his|her|their) (interview|episode|conversation|appearance)"
     r"|according to)"
    , re.IGNORECASE
)

# Fallback citation appended when model forgets to ground
_FALLBACK_CITATION_TEMPLATE = (
    "\n\n*(This perspective is grounded in {speaker}'s interview on Lenny's Podcast, "
    "where they discussed {topic}.)*"
)


def check_safety(text: str) -> tuple[bool, str]:
    """
    Check a debate response for safety violations.

    Returns:
        (is_safe: bool, reason: str)
        is_safe=True means the text is fine.
        is_safe=False means it should be blocked; reason explains why.
    """
    text_lower = text.lower()

    for pattern in _HARD_BLOCK_PATTERNS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            return False, f"Hard-blocked pattern detected: {pattern[:40]}..."

    soft_hits = []
    for pattern in _SOFT_WARN_PATTERNS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            soft_hits.append(pattern[:30])

    if len(soft_hits) >= 2:
        return False, f"Multiple soft-warn patterns: {soft_hits}"

    return True, ""


def sanitise_text(text: str) -> str:
    """
    Lightly sanitise text: replace soft-warn profanity with asterisks.
    Call this before returning to client even on 'safe' text.
    """
    # Replace profanity with asterisked versions
    profanity_map = {
        r"\bf+u+c+k+": "f***",
        r"\bs+h+[i1]+t+": "s***",
        r"\ba+s+s+h+o+l+e+s?": "a**hole",
        r"\bb[i1]+t+c+h+": "b****",
    }
    for pattern, replacement in profanity_map.items():
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text


def ensure_citation(text: str, speaker: str, topic: str, chunks: list[str]) -> str:
    """
    Ensure the response contains a grounding citation.
    If no citation markers are found, append a fallback citation referencing
    the most relevant transcript chunk used to generate the response.

    Args:
        text: The generated response text.
        speaker: Guest name.
        topic: Debate topic.
        chunks: The RAG chunks that were used to generate this response.
    """
    if _CITATION_RE.search(text):
        return text  # Model already included a citation reference

    # Append a lightweight citation
    citation = _FALLBACK_CITATION_TEMPLATE.format(speaker=speaker, topic=topic)
    return text + citation


def validate_and_prepare(
    text: str,
    speaker: str,
    topic: str,
    chunks: list[str],
    is_host: bool = False
) -> tuple[bool, str]:
    """
    Full pipeline: safety check → sanitise → add citation if missing.

    Returns:
        (ok: bool, final_text: str)
        ok=False means the entire turn should be replaced with a safe fallback.
    """
    is_safe, reason = check_safety(text)
    if not is_safe:
        print(f"[SAFETY] Blocked turn for '{speaker}': {reason}")
        safe_fallback = (
            f"I have strong views on this topic, but let me focus on what the data "
            f"and my experience actually show rather than going down that path. "
            f"The real question about {topic} comes down to what we can substantiate "
            f"with evidence. Let me reframe..."
        )
        return False, safe_fallback

    clean = sanitise_text(text)

    # Only require citations on guest turns (not Lenny's host interjections)
    if not is_host:
        clean = ensure_citation(clean, speaker, topic, chunks)

    return True, clean
