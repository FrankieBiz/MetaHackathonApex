# Apex OS — Master Agent Handoff Document

> **Last Updated**: 2026-10-22T18:15:00-04:00  
> **Repository**: `APEX/crayfish`  
> **Production Branch**: `main` (synced to `origin` and `metahackathon`)  
> **Verification Status**: 100% Green (`make check` — 766 automated tests passing, 0 failures; Meta Hackathon Judge Scorecard: 100/100 Grade A)

---

## 1. System Architecture & Tech Stack

- **Backend (`backend/`)**:
  - FastAPI async microservice with strict Pydantic v2 schemas (`backend/models.py`).
  - Meta Model API (`Llama-3.3-70B-Instruct`) integration with prompt-injection defenses and deterministic local fallbacks (`backend/ai_engine.py`).
  - Canvas LMS REST API client with mock sandbox fallback (`backend/canvas_client.py`).
  - SQLite/PostgreSQL Supabase persistence mirror (`backend/persistence.py`).
  - RFC 5545 iCalendar generation engine (`backend/calendar_export.py`).
  - Markowitz Academic Efficient Frontier and Pareto Study Allocator (`backend/efficient_frontier.py`).
  - Test suite: `415 passed` pytest cases (`backend/tests/`).
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
    - **Academic Efficient Frontier Desk**: Convex diminishing returns Pareto study allocator, marginal GPA yield ($dGPA/dHr$), interactive 5h-40h weekly budget slider, and SVG frontier curve (`frontend/src/components/EfficientFrontierModal.tsx`).
  - Test suite: `344 passed` Vitest cases (`frontend/tests/`).
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
10. **Academic Efficient Frontier & Pareto Study Allocator**:
   - `GET /api/v1/portfolio/efficient-frontier` & `POST /api/v1/portfolio/efficient-frontier` (hotkey `E` or `[FRONTIER]` in TopBar).
   - Solves the Markowitz-analog study allocation problem using convex diminishing marginal returns: maximizes credit-weighted GPA under finite weekly time budgets (5h to 40h).
   - Provides three optimization strategies (Magna Cum Laude, Balanced, Drawdown Defense), computes marginal GPA yield ($dGPA/dHr$), Academic Sharpe Ratio, and renders interactive SVG frontier curves.
11. **Collegiate Subtitles, "Student Mode" & Interactive 60s Judge Demo Tour HUD**:
   - `frontend/src/lib/studentMode.ts` & `frontend/src/store/tourStore.ts` (hotkey `U` or `[🎓 STUDENT | WALL ST]` in TopBar).
   - Solves the cognitive overload issue for judges without sacrificing the high-density Bloomberg aesthetic: adds plain-English collegiate subtitles across Order Book, Equity Curve, Task Tree, Next Best Action, Margin Call, and Efficient Frontier.
   - Floating `[▶ 60s DEMO TOUR]` HUD (`JudgeTourHUD.tsx`) steps judges through 5 sequential acts (The Crisis, Meta Llama Triage, Atomic Task Fill, 1,000-Path Monte Carlo, and Markowitz Pareto Allocation) with prev/next controls and pulsing panel highlights.
   - Multimodal syllabus vision ingest image preview (`SyllabusIngestModal.tsx`) with thumbnail rendering and `[👁️ META LLAMA 3.2 VISION TARGET]` indicator.

---

## 3. Orchestration Framework & Strict Model Rules

The user has mandated an exact multi-model orchestration division and strictly prohibited older or lower-tier models. The incoming assistant MUST follow these specifications:

### 3.1 Response Format Requirement
- **Always State Models Used First**: The very first block of every single response to the user must explicitly list which models were called and their roles:
  ```markdown
  ### Models Used:
  - **OpenAI GPT-6.1** (`gpt-6.1-sol` via Codex): Backend engineering...
  - **Anthropic Claude** (`opus` with high-effort reasoning): Frontend engineering...
  - **DeepSeek** (`deepseek-v4.1-flash`): High-throughput extraction / fuzzing...
  ```

### 3.2 Mandated Model Tiers (Strict Prohibition on Older Tiers)
Detailed Orca orchestration runbook: [`docs/ORCA_ORCHESTRATION.md`](ORCA_ORCHESTRATION.md)
- **STRICTLY FORBIDDEN**: Never orchestrate with older or lower-tier models (no Claude 3.5, no Claude 3.7, no GPT-4o, no legacy tiers).
- **OpenAI / Codex Tier**: Use ONLY `gpt-6` or `gpt-6.1` (specifically `gpt-6.1-sol`, `gpt-6-astra`, high effort).
- **Anthropic / Claude Tier**: Use ONLY the highest frontier tier available (specifically Claude Sonnet 5.5 / Opus 5.5 with high reasoning).
- **DeepSeek Tier**: Permitted and encouraged to utilize `deepseek-v4.1-flash` (or DeepSeek V3/R1 flash via the user's active API credit pool `DEEPSEEK_API_KEY`) for rapid fuzzing, extraction, and auditor passes.

### 3.3 Functional Division of Labor
- **OpenAI GPT-6.1 (`gpt-6.1-sol`)**:
  - Assigned to **Deep Backend Engineering**: Pydantic v2 schemas (`backend/models.py`), FastAPI service logic (`backend/service.py`), Meta Model API integration (`backend/ai_engine.py`), strict type safety, algorithm verification, and backend test suites (`backend/tests/`).
- **Anthropic Claude (`opus` / high reasoning)**:
  - Assigned to **Frontend Terminal Ergonomics & UX**: React/Next.js 16 UI components (`frontend/src/components/`), Web Audio/Speech synthesis, terminal typography, keyboard navigation hotkeys, Vitest suites (`frontend/tests/`), and hackathon presentation/narrative.
- **DeepSeek (`deepseek-v4.1-flash`)**:
  - Assigned to **High-Throughput Extraction & Rapid Auditing**: Batch rubric extraction, fast fuzzing of test boundaries, rapid token scanning, and second-pass code auditing using the user's active $9 credit balance.
- **Antigravity (Coordinator)**:
  - Oversees the autonomous perfection loop: plans the feature DAG, partitions file boundaries to prevent merge conflicts, dispatches parallel workers via Orca orchestration (`orca orchestration worker-start` / `dispatch`), monitors progress reactively, executes verification gates (`make check`), and runs the zero-AI git finish protocol.

### 3.4 Autonomous Perfection Loop Protocol
- **Autonomous Execution**: When in loop mode, the coordinator plans what needs to be done, dispatches the frontier models to execute, reviews their outputs, validates the full test suite (`make check`), and pushes to main. Do not pause for routine confirmation—proceed autonomously while periodically grounding to ensure architectural alignment.
- **No Diagrams Rule**: Never generate Mermaid diagrams or ASCII/plaintext diagram boxes. All concepts, workflows, and architectures must be presented in markdown lists, tables, or clean prose.
- **Mandatory Git Finish Protocol**:
  - Author/Committer must strictly be `FrankieBiz <frankabisignano@gmail.com>`.
  - Zero AI names (Claude, ChatGPT, Gemini, Anthropic, OpenAI) and zero `Co-Authored-By` lines.
  - Push directly to both remotes:
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
