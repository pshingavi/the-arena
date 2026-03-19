"""
The Arena — FastAPI Backend
Runs on port 8002 to avoid conflicts with existing services.
"""

import os
import warnings
import asyncio

# Suppress third-party library noise before any imports trigger them
warnings.filterwarnings("ignore", category=SyntaxWarning, module="sentence_transformers")
warnings.filterwarnings("ignore", category=DeprecationWarning, module="chromadb")

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

import app_state
from routers import guests as guests_router, debate as debate_router


def _blocking_startup(data_dir: str, chroma_dir: str) -> dict:
    """
    All the heavy, blocking I/O and model-loading work lives here.
    This runs in a thread via asyncio.to_thread() so it never blocks
    uvicorn's event loop — HTTP requests can be served immediately while
    the backend initialises in the background.
    """
    import warnings
    warnings.filterwarnings("ignore", category=SyntaxWarning, module="sentence_transformers")
    warnings.filterwarnings("ignore", category=DeprecationWarning, module="chromadb")

    from ingestion.parser import load_all_data
    from rag.vectorstore import ArenaVectorStore
    from debate.engine import DebateEngine
    from routers.guests import register_guests

    # 1. Load transcript / newsletter markdown
    print("📚 Loading Lenny's data...")
    data = load_all_data(data_dir)
    podcasts = data["podcasts"]
    newsletters = data["newsletters"]

    # 2. Init vector store (loads SentenceTransformer + ChromaDB — slow first run)
    print("🔍 Initializing vector store...")
    vector_store = ArenaVectorStore(persist_dir=chroma_dir)

    # 3. Index guests
    print("📥 Indexing guests...")
    total_chunks = 0
    for podcast in podcasts:
        n = vector_store.index_guest(podcast)
        total_chunks += n
        if n > 0:
            print(f"   ✓ {podcast['guest']} — {n} chunks")

    # Lenny's newsletters
    lenny_data = {
        "guest": "Lenny Rachitsky",
        "title": "Lenny's Newsletter",
        "date": "",
        "tags": ["product-management", "startups", "growth"],
        "chunks": []
    }
    for newsletter in newsletters:
        lenny_data["chunks"].extend(newsletter.get("chunks", []))

    if lenny_data["chunks"]:
        n = vector_store.index_guest(lenny_data)
        print(f"   ✓ Lenny Rachitsky (newsletters) — {n} chunks")
        total_chunks += n

    print(f"\n✅ Indexed {total_chunks} total chunks across {len(podcasts)} guests\n")

    # 4. Register guest metadata (writes to routers.guests._guest_registry)
    register_guests(podcasts)

    # 5. Debate engine
    print("🤖 Initializing debate engine...")
    debate_engine = DebateEngine(
        vector_store=vector_store,
        model="claude-sonnet-4-6"
    )

    return {
        "vector_store": vector_store,
        "debate_engine": debate_engine,
        "total_chunks": total_chunks,
        "num_guests": len(podcasts),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup: kick off heavy initialisation in a background thread so
    uvicorn keeps accepting HTTP requests immediately.

    The /health endpoint returns  initialising: true  until ready.
    The /guests and /topics endpoints return empty lists until ready.
    That way the frontend shows a graceful loading state instead of hanging.
    """
    print("\n🎙️  THE ARENA — Starting up...\n")

    data_dir = os.environ.get("DATA_DIR", "./data")
    chroma_dir = os.environ.get("CHROMA_PERSIST_DIR", "./chroma_db")

    app_state.initialising = True

    async def _init():
        try:
            result = await asyncio.to_thread(_blocking_startup, data_dir, chroma_dir)
            app_state.vector_store = result["vector_store"]
            app_state.debate_engine = result["debate_engine"]
            app_state.initialising = False

            port = os.environ.get("PORT", "8002")
            print(f"\n🚀 The Arena is LIVE on port {port}\n")
            print(f"   Guests indexed : {result['num_guests']}")
            print(f"   Total chunks   : {result['total_chunks']}")
            print("   ElevenLabs     :", "✅" if os.environ.get("ELEVENLABS_API_KEY") else "⚠️  not set")
            print("   HeyGen         :", "✅" if os.environ.get("HEYGEN_API_KEY") else "—  not configured (ElevenLabs mode)")
            print()
        except Exception as e:
            import traceback
            traceback.print_exc()
            app_state.initialising = False
            print(f"\n❌ Startup error: {e}\n")

    asyncio.create_task(_init())

    yield

    # Shutdown
    print("👋 The Arena shutting down...")


app = FastAPI(
    title="The Arena API",
    description="AI-powered debate platform grounded in Lenny's podcast & newsletter data",
    version="1.0.0",
    lifespan=lifespan
)

# CORS — allow Next.js dev server + deployed frontend.
# CORS_ORIGINS accepts comma-separated URLs.
# Use "*" to allow all origins (useful during development; restrict in prod).
cors_origins_raw = os.environ.get("CORS_ORIGINS", "http://localhost:3001,http://localhost:3000")
cors_origins = [o.strip() for o in cors_origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(guests_router.router)
app.include_router(debate_router.router)


@app.get("/")
async def root():
    return {
        "name": "The Arena API",
        "version": "1.0.0",
        "status": "initialising" if getattr(app_state, "initialising", False) else "live",
        "docs": "/docs"
    }


@app.get("/health")
async def health():
    initialising = getattr(app_state, "initialising", True)
    stats = {}
    if app_state.vector_store and not initialising:
        try:
            stats = app_state.vector_store.get_collection_stats()
        except Exception:
            pass

    return {
        "status": "initialising" if initialising else "healthy",
        "initialising": initialising,
        "guests_indexed": len(stats),
        "total_chunks": sum(stats.values()),
        "elevenlabs_ready": bool(os.environ.get("ELEVENLABS_API_KEY")),
        "heygen_ready": bool(os.environ.get("HEYGEN_API_KEY")),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
