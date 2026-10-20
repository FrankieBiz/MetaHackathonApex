# Apex OS — Agent Guidelines & Finish Protocol

## Architecture
- **Backend (`backend/`)**: FastAPI service with Canvas LMS integration, Meta Llama-3 rubric deconstructor, simulation mock data fallback, and Supabase PostgreSQL persistence mirror.
- **Frontend (`frontend/`)**: Next.js 16 Bloomberg-style academic terminal with Order Book, Equity Curve, What-If Simulator, and Task Tree.
- **Cloud Deployment**: Render (`render.yaml`) for API, Vercel (`frontend/vercel.json`) for frontend terminal.

## Verification Commands
Before finishing any task, run:
```bash
make check
```
Or separately:
- Backend: `backend/.venv/bin/pytest backend -q` and `backend/.venv/bin/ruff check backend`
- Frontend: `cd frontend && npm run check`

## Mandatory Finish Protocol (Push to Main Production)
Every single time you finish a task, feature, or fix:
1. Verify all tests pass (`make check`).
2. Run `agent-finish "<imperative commit message>"` or `git finish "<message>"`.
   Alternatively, manually:
   - `git add -A`
   - `git commit -m "<message>"` (Author/Committer: FrankieBiz <frankabisignano@gmail.com>)
   - `git push origin HEAD:main`
   - `git push metahackathon HEAD:main`
3. NEVER commit with AI names (Claude, ChatGPT, Gemini, Anthropic, OpenAI) or `Co-Authored-By` lines. All commits must be attributed to `FrankieBiz <frankabisignano@gmail.com>`.
4. Remote production `main` must always be updated and green.
