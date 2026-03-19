# Deploying The Arena

**Stack:** Railway (Python/FastAPI backend) + Vercel (Next.js frontend)

---

## Prerequisites

- [Railway account](https://railway.app) (free tier works for low traffic)
- [Vercel account](https://vercel.com) (free tier works)
- Your `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`
- Git repo with the project pushed to GitHub

---

## 1. Before You Deploy

### 1a. Install frontend npm packages

From `the-arena/frontend/`:

```bash
npm install @vercel/kv
```

This adds the Vercel KV client used to store user emails. Commit `package.json` and `package-lock.json`.

### 1b. Commit the debate cache JSON files

Pre-generated debate scripts must be committed so Railway has them on first boot:

```bash
# from repo root
git add the-arena/backend/debate_cache/*.json
git commit -m "Add pre-generated debate cache"
```

The TTS audio cache (`debate_cache/tts/*.mp3`) is large — do NOT commit it. Add to `.gitignore`:

```
the-arena/backend/debate_cache/tts/
```

It will be persisted on a Railway volume (step 3c below).

### 1c. Generate a session secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save the output — it becomes `SESSION_SECRET`.

### 1d. Choose an owner code

Pick a secret passphrase, e.g. `arena-preetam-2024`. Anyone who enters it at `/auth` gets owner access (bypasses API key requirements). Don't commit this to source control.

---

## 2. Deploy the Backend to Railway

### 2a. Create a Railway project

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub Repo**
2. Select your repo → set **Root Directory** to `the-arena/backend`
3. Railway auto-detects Python. If it doesn't, set the **Start Command** to:
   ```
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```

### 2b. Set environment variables

In Railway → your project → **Variables** tab:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `ELEVENLABS_API_KEY` | `sk_...` |
| `ELEVENLABS_DEFAULT_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM` (Rachel — default) |
| `ELEVENLABS_VOICE_MAP` | (optional, see Voice Mapping section) |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` |

Railway sets `PORT` automatically.

### 2c. Add a persistent volume for TTS cache

Without a volume, the TTS audio cache (`debate_cache/tts/*.mp3`) is wiped on every deploy.

1. Railway project → your service → **Volumes** → **Add Volume**
2. Mount path: `/app/debate_cache/tts`
3. Recommended size: 2–5 GB (each sentence mp3 is 30–100 KB; 1,000 cached = ~50 MB)

> Hot-topic debates still work without the volume (JSON scripts are in git), but every deploy re-synthesizes audio on first playback.

### 2d. Note your Railway URL

After deploy it will look like: `https://your-service-name.up.railway.app`

---

## 3. Deploy the Frontend to Vercel

### 3a. Create a Vercel project

1. [vercel.com](https://vercel.com) → **Add New Project** → import your GitHub repo
2. Set **Root Directory** to `the-arena/frontend`
3. Framework: **Next.js** (auto-detected)
4. Click **Deploy** — first deploy may fail until env vars are set. That's expected.

### 3b. Create a Vercel KV database

1. Vercel project → **Storage** tab → **Create Database** → **KV**
2. Name it (e.g. `arena-users`)
3. Vercel automatically adds `KV_REST_API_URL`, `KV_REST_API_TOKEN`, and `KV_URL` to your project's env vars

### 3c. Set environment variables in Vercel

Vercel project → **Settings** → **Environment Variables**:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://your-service-name.up.railway.app` |
| `SESSION_SECRET` | (the hex string from step 1c) |
| `ARENA_OWNER_CODE` | (your secret passphrase from step 1d) |

> `KV_REST_API_URL` and `KV_REST_API_TOKEN` were added automatically in step 3b.

### 3d. Redeploy

After setting env vars, trigger a redeploy:
Vercel → **Deployments** → latest → **Redeploy**

---

## 4. Configure CORS on the Backend

The backend must allow your Vercel domain. Open `the-arena/backend/main.py` and find the `CORSMiddleware` block. Update it to read from the env var:

```python
import os

origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3001").split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

You set `ALLOWED_ORIGINS` in step 2b. If you add a custom domain later, append it (comma-separated):

```
https://your-app.vercel.app,https://thearena.yoursite.com
```

---

## 5. How Auth + Gating Works

### Sign-up / Login
- Visitors who hit `/arena` are redirected to `/auth`
- Enter email → account stored in Vercel KV → signed session cookie set
- Session is verified at the edge via HMAC signature — no DB call per request

### Hot topics — free
Pre-generated debates using the suggested guest pairings require no API keys. The backend streams from the JSON cache; ElevenLabs TTS is served from the mp3 cache (or synthesized on first use with the server's key).

### Custom topics / different guests — requires API keys
When a user starts a debate that isn't a cached hot topic:
1. An API key modal appears
2. User enters their Anthropic key (required) and ElevenLabs key (optional)
3. Keys are POSTed to `/debate/keys/register`, stored in Railway memory with a 1-hour TTL, and never logged or persisted
4. A short-lived token is returned and passed as a query param on SSE calls
5. After the session, recommend invalidating keys at console.anthropic.com and elevenlabs.io

### Owner access
- Go to `/auth`, enter your email + `ARENA_OWNER_CODE`
- Session gets `role: 'owner'`
- All debates use server API keys — no modal ever appears
- Share this code with trusted collaborators

---

## 6. ElevenLabs Voice Mapping (Optional)

To assign specific voices per guest, set in Railway:

```
ELEVENLABS_VOICE_MAP=Lenny Rachitsky:voice_id_here,Jeetu Patel:another_id,Jason M Lemkin:another_id
```

Format: `Guest Name:voice_id` pairs separated by commas. Name matching is case-insensitive.

Find voice IDs at [elevenlabs.io/voice-library](https://elevenlabs.io/voice-library).

---

## 7. Refreshing the Debate Cache

If you add new topics or want to update pre-generated debates, run locally:

```bash
cd the-arena/backend
python scripts/pregenerate.py --warmup-tts          # all topics
python scripts/pregenerate.py --topic ai-replacing-pms --warmup-tts  # one topic
```

Then commit only the JSON files (not the mp3s):

```bash
git add debate_cache/*.json
git commit -m "Refresh debate cache"
git push
```

Railway auto-deploys on push. TTS audio on the Railway volume persists across deploys.

---

## 8. Custom Domain (Optional)

### Frontend (Vercel)
Vercel → **Settings** → **Domains** → add your domain → follow DNS instructions.

### Backend (Railway)
Railway → service → **Settings** → **Networking** → **Custom Domain**.

After adding a custom domain to either, update the corresponding env var:
- New Vercel domain → update `ALLOWED_ORIGINS` in Railway
- New Railway domain → update `NEXT_PUBLIC_API_URL` in Vercel

---

## 9. Testing After Deployment

1. Visit `https://your-app.vercel.app/auth` → sign up with your email
2. Go to `/arena` → pick **"Will AI replace Product Managers?"** with suggested guests → click **Enter The Arena**
   - Should show **"✓ Free — no API keys needed"** and start immediately
3. Try a custom topic → API key modal should appear
4. Go back to `/auth` → enter your email + owner code → sign in again
   - Should show **"Owner"** badge; all debates start without API modal

---

## 10. Monitoring

- **Railway logs**: Railway → your service → **Deployments** → **View Logs**
- **Vercel logs**: Vercel → **Deployments** → click deployment → **Functions**
- **Health check**: `curl https://your-service.up.railway.app/health`

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| CORS errors in browser console | Check `ALLOWED_ORIGINS` in Railway matches your Vercel URL exactly |
| `/api/auth/me` returns 500 | Ensure `SESSION_SECRET` is set in Vercel |
| User not saved after signup | Verify Vercel KV is linked (check `KV_REST_API_URL` in Vercel env) |
| TTS audio re-synthesizes every deploy | Add Railway volume at `/app/debate_cache/tts` |
| Hot topics start with LLM (no cache) | Commit `debate_cache/*.json` to git and redeploy |
| Backend 404 on all routes | Check `NEXT_PUBLIC_API_URL` in Vercel — no trailing slash, must be HTTPS |
| Owner code doesn't work | Check `ARENA_OWNER_CODE` in Vercel — copy-paste exactly, no extra spaces |
| "ElevenLabs not configured" for hot topics | Set `ELEVENLABS_API_KEY` in Railway |
