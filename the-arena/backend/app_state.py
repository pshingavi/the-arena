"""
Global application state — shared singletons for vector store and debate engine.
Populated at startup in main.py via asyncio.to_thread() so startup never blocks.
"""

from typing import Optional

# Lazy imports to avoid import-time model loading
vector_store = None   # ArenaVectorStore — set after background init
debate_engine = None  # DebateEngine     — set after background init

# True while background init is running; False once ready (or failed)
initialising: bool = True
