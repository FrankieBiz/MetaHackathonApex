# Apex OS — Master Multi-Model Orchestration Architecture & Execution Plan

## 1. Core Memory & Model Allocation Policy

Codified in `AGENTS.md`:
* **Prohibited**: Under no circumstances will older generation models (e.g., Claude 3.5, GPT-4o, legacy tiers) be orchestrated.
* **Frontier Only**:
  1. **OpenAI / Codex**: `gpt-6` / `gpt-6.1` (e.g., `gpt-6.1-sol`, `gpt-6-astra` with high reasoning effort).
  2. **Anthropic / Claude**: Highest available frontier release (Opus / Sonnet / Haiku at their absolute latest version, high reasoning).
  3. **DeepSeek**: `deepseek-v4.1-flash` (or DeepSeek V3/R1 flash via `DEEPSEEK_API_KEY`) for rapid extraction, fuzzing, and batch rubric parsing.
  4. **Antigravity (Coordinator)**: Orca orchestration supervisor, task graph DAG controller, disjoint worktree/file partitioner, verification gatekeeper (`make check`), and Git finish protocol executor.

---

## 2. Model Specialization Matrix

| Agent / Model | Primary Responsibilities | Scope Boundaries |
| :--- | :--- | :--- |
| **Codex / GPT-6.1** (`gpt-6.1-sol`) | Meta Model API (`https://api.meta.ai/v1`, `muse-spark-1.3`), Pydantic flat schema architecture (eliminating recursive `$ref`), strict criterion grounding, and tool-calling backend contracts. | `backend/ai_engine.py`, `backend/config.py`, `backend/canvas_client.py`, `backend/service.py`, `backend/tests/` |
| **Frontier Claude** (Highest Tier Opus / Sonnet) | Multimodal syllabus/rubric ingestion UI, terminal ergonomics, "Next Best Action" hero card, real-time SSE streaming visualization, and judging walkthrough narrative. | `frontend/src/components/`, `frontend/src/store/`, `frontend/src/lib/tour.ts`, `frontend/tests/` |
| **DeepSeek v4.1 Flash** (`sk-c7092...`) | High-throughput batch syllabus/rubric extraction, edge-case fuzz testing across 50+ university formats, and rapid semantic pre-filtering (credit-efficient). | `backend/fixtures/`, test corpora, batch deconstruction scripts |
| **Antigravity** (Coordinator) | Task DAG management, disjoint partition assignment, running `make check`, atomic git finish, and user synchronization. | Orchestration layer, Git commit/push |

---

## 3. The 5-Phase Product Transformation DAG

1. **Phase 1: Meta Model API Architecture (GPT-6.1)**:
   - Point backend defaults to `https://api.meta.ai/v1` and `muse-spark-1.3`.
   - Flatten `_PlanNode` schema into a non-recursive DAG to prevent HTTP 400 errors with Meta's strict JSON schema engine.
   - Fix Canvas point-based rubric normalization and introduce criterion grounding validation.
2. **Phase 2: Multimodal Syllabus Ingestion (Claude + DeepSeek)**:
   - Provide a drag-and-drop syllabus photo/PDF dropzone directly in the workstation.
   - Extract courses, weights, assignments, and rubric criteria via Meta Vision / multimodal parsing.
   - Completely remove the Canvas API token barrier for judges.
3. **Phase 3: Real Agentic Tool-Calling Loop (GPT-6.1 + Claude)**:
   - Implement genuine tool calls (`get_portfolio_state`, `calculate_grade_floor`, `simulate_risk`, `validate_rubric_coverage`).
   - Stream live tool execution traces via Server-Sent Events (SSE) with real model token throughput and stage timing.
4. **Phase 4: Next Best Action & Terminal Clarity (Claude)**:
   - Add a high-visibility "Next Best Action" directive card.
   - Demystify financial jargon with immediate plain-English explanations.
   - Optimize responsive layout density for laptop viewports (1280×720, 1440×900).
5. **Phase 5: Fuzzing, Calibration & Verification (All Models)**:
   - Run 50+ real-world syllabus stress tests using DeepSeek v4.1 Flash.
   - Calibrate Monte Carlo variance from historical coursework.
   - Verify green on `make check` and deploy to production.
