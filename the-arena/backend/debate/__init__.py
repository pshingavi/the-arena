# personas has no external deps — safe to import directly
from .personas import SUGGESTED_TOPICS, get_persona_system_prompt, get_host_prompt

# DebateEngine requires 'anthropic' (installed via uv pip install -r requirements.txt)
# Using lazy import to avoid hard failures if package not yet installed
def get_debate_engine(*args, **kwargs):
    from .engine import DebateEngine
    return DebateEngine(*args, **kwargs)
