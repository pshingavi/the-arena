#!/bin/bash
# ============================================================
# The Arena — Start Script (uses uv for dependency management)
# Launches backend (:8002) and frontend (:3001)
# Ports avoided: 3000 (LMS), 8000 (Chat), 8001 (API)
# ============================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "🎙️  THE ARENA — Starting up..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ---- Check uv ----
if ! command -v uv &>/dev/null; then
  echo "📦 Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
echo "✅ uv $(uv --version)"

# ---- Check .env files ----
if [ ! -f "$SCRIPT_DIR/backend/.env" ]; then
  echo "⚠️  backend/.env not found — copying from .env.example"
  cp "$SCRIPT_DIR/backend/.env.example" "$SCRIPT_DIR/backend/.env"
  echo "   👉 Add your ANTHROPIC_API_KEY to backend/.env"
fi
if [ ! -f "$SCRIPT_DIR/frontend/.env.local" ]; then
  cp "$SCRIPT_DIR/frontend/.env.local.example" "$SCRIPT_DIR/frontend/.env.local"
fi

# ---- Backend ----
echo ""
echo "📦 Setting up Python backend (uv)..."
cd "$SCRIPT_DIR/backend"

# Create venv if it doesn't exist
if [ ! -d ".venv" ]; then
  echo "   Creating virtual environment..."
  uv venv .venv
fi

# Install dependencies into the venv using uv
echo "   Installing dependencies via uv..."
uv pip install -r requirements.txt

echo ""
echo "🚀 Starting FastAPI backend on :8002..."
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8002 --reload &
BACKEND_PID=$!

# ---- Frontend ----
echo ""
echo "📦 Setting up Next.js frontend..."
cd "$SCRIPT_DIR/frontend"

if [ ! -d "node_modules" ]; then
  echo "   Installing npm dependencies..."
  npm install
fi

echo ""
echo "🚀 Starting Next.js frontend on :3001..."
npm run dev &
FRONTEND_PID=$!

# ---- Ready ----
sleep 3
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ The Arena is running!"
echo ""
echo "   🌐 Frontend:  http://localhost:3001"
echo "   ⚙️  Backend:   http://localhost:8002"
echo "   📚 API Docs:  http://localhost:8002/docs"
echo ""
echo "   Ports in use:    3001 (frontend), 8002 (backend)"
echo "   Ports avoided:   3000 (LMS), 8000 (Chat), 8001 (API)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo ''; echo '👋 Stopped.'; exit" INT TERM
wait
