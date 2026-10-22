# Apex OS — Master Agent Handoff Document

> **Last Updated**: 2026-10-22T07:00:00-04:00  
> **Repository**: `APEX/crayfish`  
> **Production Branch**: `main` (synced to `origin` and `metahackathon`)  
> **Verification Status**: 100% Green (`make check` — 749 automated tests passing, 0 failures; Meta Hackathon Judge Scorecard: 100/100 Grade A)

---

## 1. System Architecture & Tech Stack

- **Backend (`backend/`)**:
  - FastAPI async microservice with strict Pydantic v2 schemas (`backend/models.py`).
  - Meta Model API (`Llama-3.3-70B-Instruct`) integration with prompt-injection defenses and deterministic local fallbacks (`backend/ai_engine.py`).
  - Canvas LMS REST API client with mock sandbox fallback (`backend/canvas_client.py`).
  - SQLite/PostgreSQL Supabase persistence mirror (`backend/persistence.py`).
  - RFC 5545 iCalendar generation engine (`backend/calendar_export.py`).
  - Test suite: `409 passed` pytest cases (`backend/tests/`).
- **Frontend (`frontend/`)**:
  - Next.js 16.4.2 (Turbopack) Bloomberg-style academic financial terminal (`frontend/src/app/page.tsx`).
  - Real-time components:
    - **Order Book**: Priority queue of active deliverables with halted and protected badges (`frontend/src/components/OrderBook.tsx`).
    - **Equity Curve**: Projected GPA trajectory with risk corridors (`frontend/src/components/EquityCurve.tsx`).
    - **Task Tree & Defense Council**: Rubric decomposition tree with consensus subtasks, study budgets, and tri-agent argument deck (`frontend/src/components/TaskTree.tsx`).
    - **Monte Carlo Simulator**: 10,000-path stochastic outcome simulator with midterm deadline congestion covariance (`frontend/src/components/MonteCarloModal.tsx`).
    - **Margin Call Desk**: Emergency WhatsApp academic liquidation preview (`frontend/src/components/MarginCallModal.tsx`).
    - **Academic Circuit Breaker Banner**: Real-time NYSE Rule 80B visual indicator and workload reallocation (`frontend/src/components/CircuitBreaker.tsx`).
    - **Office Hours Negotiator Modal**: Syllabus-grounded email petition and 60-second talking points generator (`frontend/src/components/NegotiationModal.tsx`).
    - **Morning Bell Dispatch**: Web Audio tubular bell chime + Web Speech API vocal academic briefing (`frontend/src/components/MorningBell.tsx`).
    - **Academic Calendar Dispatch Modal**: RFC 5545 `.ics` downloader, live `webcal://` subscription feed URL, and single-click Google Calendar sync (`frontend/src/components/CalendarExportModal.tsx`).
  - Test suite: `340 passed` Vitest cases (`frontend/tests/`).
- **DevOps & Cloud Deployment**:
  - Render (`render.yaml`) for FastAPI backend.
  - Vercel (`vercel.json`) building `frontend/` as a static/edge service proxying `/api/v1/*` to backend.

---

## 2. Complete Feature Inventory (Built & Verified)

1. **Meta Model API Rubric Deconstructor**:
   - Decomposes dense PDF/text syllabi into weighted atomic study subtasks with time estimates and target scores.
   - Grounded extraction with deterministic fallback trees.
2. **Tri-Agent Defense Council**:
   - `POST /api/v1/triage/{id}/council` & Server-Sent Events (`council_turn`).
   - Three distinct agent personas (Professor, Student, Arbitrator) debate academic workload vs. academic rigor to reach consensus subtasks.
3. **Midterm Deadline Congestion & Fatigue Covariance**:
   - Detects 72-hour temporal clusters across disparate courses.
   - Automatically inflates score variance in the Monte Carlo engine to reflect student cognitive fatigue.
4. **Academic Margin Call Desk & WhatsApp Preview**:
   - `POST /api/v1/portfolio/margin-call` (hotkey `M`).
   - Generates emergency recovery dossiers with copyable text and WhatsApp click-to-chat links (`wa.me`).
5. **Academic Circuit Breaker Protocol (NYSE Rule 80B Analog)**:
   - `POST /api/v1/portfolio/circuit-breaker` + client-side evaluator.
   - Three-tier drawdown thresholds (Level 1 Caution: >5% deficit; Level 2 Restriction: 2+ courses deficit or <65%; Level 3 Halt: <55% or portfolio deficit >=20%).
   - Reallocates study minutes from healthy elective courses to vulnerable critical-path courses without mutating saved plans.
6. **AI Office Hours Negotiator & Policy Petition Builder**:
   - `POST /api/v1/triage/{id}/negotiate` (hotkey `O` or `[☎ NEGOTIATE]` in TaskTree).
   - Generates Extension Requests, Regrade Petitions, and 60s Office Hours Talking Points.
   - Enforces strict anti-hallucination validation: cited syllabus clauses must exist in the syllabus text.
7. **Audio Morning Bell Voice Briefing Dispatch**:
   - Web Audio bell chime + Web Speech API synthesis (`speechSynthesis`) on hotkey `B` or `[BELL]` button in TopBar.
   - Summarizes daily academic health, impending deadlines, and active circuit breakers with an interactive transcript modal.
8. **Hackathon Judge Evaluation Skill**:
   - `scripts/judge.py`: 100-point rubric evaluator, hostile judge Q&A griller, and 180-second pitch runbook.
9. **Academic Calendar Sync Engine (RFC 5545 .ICS Export & Live Webcal Subscription Feed)**:
   - `GET /api/v1/portfolio/calendar.ics` & `POST /api/v1/portfolio/calendar.ics` (hotkey `C` or `[CAL // .ICS]` in TopBar).
   - Generates compliant RFC 5545 iCalendar data with 24h/2h deadline alarms (`VALARM`), intelligent pre-deadline focus work study blocks, upcoming academic events, and copyable `webcal://` live subscription feed link.
   - Deep-linked `+GCAL` and `+CAL OFFICE HOURS` actions directly within `TaskTree.tsx` and `NegotiationModal.tsx`.

---

## 3. Strict Operating Rules & Constraints

The incoming agent must adhere to the following non-negotiable rules:

1. **Report Models Used at the Top of Every Response**:
   - Always state the models used at the very beginning of every user turn.
2. **Mandated Frontier Models Only**:
   - **OpenAI Codex**: Use only `gpt-6` or `gpt-6.1` (`gpt-6.1-sol`, high effort).
   - **Anthropic Claude**: Use only latest frontier tier (`opus`, high reasoning).
   - **DeepSeek**: Permitted to use `deepseek-v4.1-flash` via active API credit pool for fast extraction/fuzzing.
   - **Strict Prohibition on Older Models**: Never use Claude 3.5, GPT-4o, or lower-tier models.
3. **NO DIAGRAMS**:
   - Never generate Mermaid diagrams or ASCII text-box art blocks. Use markdown lists, tables, or plain prose instead.
4. **Mandatory Finish Protocol**:
   - Verify: `make check`.
   - Commit author/committer must be strictly: `FrankieBiz <frankabisignano@gmail.com>`.
   - NEVER include AI names (Claude, ChatGPT, Gemini, Anthropic, OpenAI) or `Co-Authored-By` lines.
   - Push to both remotes:
     ```bash
     git add -A
     git commit -m "<imperative commit message>"
     git push origin HEAD:main
     git push metahackathon HEAD:main
     ```

---

## 4. Verification & Testing Commands

To run all checks across the entire repo:
```bash
make check
```

Or individually:
```bash
# Backend lint, format, and unit tests (399 tests)
backend/.venv/bin/ruff check backend
backend/.venv/bin/ruff format --check backend
backend/.venv/bin/pytest backend -q

# Frontend lint, typecheck, unit tests (330 tests), and Next.js build
cd frontend && npm run check

# Hackathon Judge scorecard (must score 100/100 Grade A)
python3 scripts/judge.py --run-checks all --fail-under 90
```

---

## 5. Next Strategic Directions (Ideas for Next Loops)

When resuming in a new chat session, candidate high-impact features to build include:
1. **Syllabus PDF Multimodal Vision Ingest**:
   - Multimodal drag-and-drop syllabus parser accepting PDF/scanned images directly in the frontend and extracting grading tables via vision tokens.
2. **Calendar Export (.ics / Google Calendar Sync)**:
   - Export generated study blocks, leaf task focus sessions, and office hours appointments to `.ics` or direct Google Calendar integration.
3. **Canvas LMS OAuth Flow Live Setup**:
   - Live Canvas developer key OAuth flow and webhook listener to auto-sync grade changes and assignment postings in real-time.
