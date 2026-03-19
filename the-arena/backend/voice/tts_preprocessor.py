"""
TTS Text Preprocessor — converts debate text to natural speech for ElevenLabs.

ElevenLabs supports a subset of SSML:
  <break time="0.5s" />  — timed pause
  <break strength="weak|medium|strong|x-strong" />  — relative pause

The debate engine outputs markdown (bold, bullets, headers, citations).
Before sending to ElevenLabs, this module:
  1. Strips ALL markdown formatting
  2. Converts structural elements (bullets, headers) to natural speech phrases
  3. Injects <break> pauses at natural boundaries (em-dashes, paragraph breaks,
     dramatic question marks)
  4. Adds speaker-specific rhythm cues (Ben Horowitz speaks deliberately;
     Jason Lemkin is rapid-fire; Lenny is warm and measured)
  5. Removes internal citation footnotes not meant to be spoken aloud
"""

import re


# ── 1. Strip markdown ─────────────────────────────────────────────────────────

def clean_markdown(text: str) -> str:
    # Bold/italic/underline
    text = re.sub(r'\*\*\*(.*?)\*\*\*', r'\1', text)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'\*(.*?)\*', r'\1', text)
    text = re.sub(r'___(.*?)___', r'\1', text)
    text = re.sub(r'__(.*?)__', r'\1', text)
    text = re.sub(r'_(.*?)_', r'\1', text)

    # Headers
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)

    # Fenced code blocks
    text = re.sub(r'```[\s\S]*?```', '', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)

    # Hyperlinks: keep display text, drop URL
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)

    # Blockquotes
    text = re.sub(r'^>\s+', '', text, flags=re.MULTILINE)

    # Citation footnotes added by the safety module
    text = re.sub(r'\*\(This perspective is grounded in[^)]+\)\*', '', text)
    text = re.sub(r'\(This perspective is grounded in[^)]+\)', '', text)
    text = re.sub(r'[\[\(]Source[^\]\)]*[\]\)]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[\d+\]', '', text)

    return text


# ── 2. Convert list structures to speech ──────────────────────────────────────

def convert_lists_to_speech(text: str) -> str:
    """Replace bullet/numbered lists with natural spoken connectors."""
    _connectors = iter(["First, ", "Second, ", "Third, ", "And finally, ", "Also, "])

    def _replace(m):
        return "\n" + next(_connectors, "And, ")

    # Numbered list items
    text = re.sub(r'^\s*\d+\.\s+', _replace, text, flags=re.MULTILINE)
    # Bullet list items
    text = re.sub(r'^\s*[-•*]\s+', _replace, text, flags=re.MULTILINE)
    return text


# ── 3. Add ElevenLabs SSML pauses ────────────────────────────────────────────

def add_speech_pauses(text: str) -> str:
    """Inject <break> tags for natural spoken rhythm."""

    # Em-dash: conversational pause
    text = re.sub(r'\s*—\s*', '<break time="0.35s"/>', text)

    # Parenthetical aside: wrap with slight pauses
    text = re.sub(r'\s*\(([^)]+)\)\s*', r'<break time="0.2s"/> \1 <break time="0.2s"/>', text)

    # Dramatic question or exclamation followed by a new sentence: longer beat
    text = re.sub(r'([?!])\s+([A-Z])', r'\1 <break time="0.45s"/> \2', text)

    # Paragraph break: full breath
    text = re.sub(r'\n\n+', ' <break time="0.7s"/> ', text)

    # Single newline: brief pause
    text = re.sub(r'\n', ' ', text)

    return text


# ── 4. Speaker-specific rhythm ────────────────────────────────────────────────

_SPEAKER_STYLES = {
    # Deliberate, emphatic — add extra beats between sentences
    'horowitz': lambda t: re.sub(r'\. ([A-Z])', r'. <break time="0.4s"/> \1', t),
    'ben h': lambda t: re.sub(r'\. ([A-Z])', r'. <break time="0.4s"/> \1', t),

    # Rapid-fire, urgent — remove most pauses to quicken pace
    'lemkin': lambda t: re.sub(r'<break time="0\.[2-5]s"/>', '', t),

    # Warm, measured, thoughtful — Lenny often starts with "So..."
    'rachitsky': lambda t: re.sub(r'^(So |Well |Now |Look, )', r'\1<break time="0.25s"/>', t),
    'lenny': lambda t: re.sub(r'^(So |Well |Now |Look, )', r'\1<break time="0.25s"/>', t),

    # Chip Conley: philosophical, slow
    'conley': lambda t: re.sub(r'\. ([A-Z])', r'. <break time="0.5s"/> \1', t),

    # Marc Andreessen: fast, assertive
    'andreessen': lambda t: re.sub(r'<break time="0\.[3-7]s"/>', '', t),
}

def add_speaker_style(text: str, speaker: str) -> str:
    speaker_lower = speaker.lower()
    for key, transform in _SPEAKER_STYLES.items():
        if key in speaker_lower:
            return transform(text)
    return text


# ── 5. Normalize ─────────────────────────────────────────────────────────────

def normalize_speech(text: str) -> str:
    # Collapse multiple spaces (but preserve <break> tags)
    text = re.sub(r'[ \t]+', ' ', text)
    # Collapse multiple breaks
    text = re.sub(r'(<break[^/]*/>\s*){3,}', '<break time="1.0s"/> ', text)
    # Clean up trailing punctuation before a break
    text = re.sub(r',\s*<break', '<break', text)
    # Reduce "..." sequences
    text = re.sub(r'\.{4,}', '...', text)
    return text.strip()


# ── 6. Public API ─────────────────────────────────────────────────────────────

def prepare_for_elevenlabs(text: str, speaker: str = "") -> str:
    """
    Full pipeline: clean markdown → list-to-speech → SSML pauses →
    speaker rhythm → normalize.

    Returns text ready for ElevenLabs TTS API with <break> SSML tags.
    Use with model: eleven_turbo_v2_5 or eleven_multilingual_v2
    """
    text = clean_markdown(text)
    text = convert_lists_to_speech(text)
    text = add_speech_pauses(text)
    if speaker:
        text = add_speaker_style(text, speaker)
    text = normalize_speech(text)
    return text
