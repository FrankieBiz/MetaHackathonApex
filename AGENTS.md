# Apex OS — Agent Guidelines & Finish Protocol

## Architecture
- **Backend (`backend/`)**: FastAPI service with Canvas LMS integration, Meta Llama-3 rubric deconstructor, simulation mock data fallback, and Supabase PostgreSQL persistence mirror.
- **Frontend (`frontend/`)**: Next.js 16 Bloomberg-style academic terminal with Order Book, Equity Curve, What-If Simulator, and Task Tree.
- **Cloud Deployment**: Render (`render.yaml`) for API, Vercel (root `vercel.json` builds `frontend/` as a service; `frontend/next.config.ts` proxies `/api/v1/*` to `NEXT_PUBLIC_API_URL`) for frontend terminal.
- **Legacy (`legacy_archive/`)**: The original Vite + Express app, archived and excluded from CI (`docs/legacy-vite-app.md`).

## Verification Commands
Before finishing any task, run:
```bash
make check
```
Or separately:
- Backend: `backend/.venv/bin/pytest backend -q` and `backend/.venv/bin/ruff check backend`
- Frontend: `cd frontend && npm run check`

## Orchestration Model Rules & Memory
- **Strict Prohibition on Older Models**: Never orchestrate with older or lower-tier models (e.g. no Claude 3.5, no GPT-4o, no legacy tiers).
- **Mandated Frontier Model Tiers**:
  1. **OpenAI / Codex**: Use only `gpt-6` or `gpt-6.1` (e.g., `gpt-6.1-sol`, `gpt-6-astra`, high effort).
  2. **Anthropic / Claude**: Use only the highest available frontier tier (e.g., Claude Opus / Sonnet / Haiku at their absolute latest/highest version, high reasoning).
  3. **DeepSeek**: Permitted to utilize `deepseek-v4.1-flash` (or DeepSeek V3/R1 flash via the user's active API credit pool `DEEPSEEK_API_KEY`) for high-throughput extraction, batch rubric parsing, and rapid fuzzing.
- **Model Role Division**:
  - `gpt-6.1`: Deep backend engineering, Pydantic schemas, Meta Model API integration, strict type safety, algorithm verification.
  - Frontier Claude: Frontend terminal ergonomics, multimodal vision ingest (syllabi & rubrics), UX polish, and hackathon presentation/narrative.
  - `deepseek-v4.1-flash`: Fast extraction, low-latency auditor passes, and test fuzzing.
  - Antigravity: Multi-worker orchestration, file boundary partitioning, test validation (`make check`), and zero-AI git finishes.

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
