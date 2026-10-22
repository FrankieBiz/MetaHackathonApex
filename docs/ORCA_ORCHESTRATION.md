# Orca Multi-Model Orchestration Framework

## Core Philosophy: Orchestrator vs. Heavy Lifters

Antigravity operates as the **Master Orchestrator**, not a monolithic heavy lifter. The orchestrator's job is project coordination, contract definition, task decomposition, quality gatekeeping, test verification, and production release. The heavy engineering lifting is delegated to specialized, newest-generation frontier models via the local Orca runtime.

---

## Model Specialization Matrix (Newest Frontier Generation Only)

Older-generation models (e.g. Claude 3.5, GPT-4o, legacy tiers) are strictly prohibited. Every model in the orchestration pool is selected for its distinct frontier strengths:

| Model Tier | Orca Agent / Model ID | Primary Specialization & Strengths | Best Used For |
| :--- | :--- | :--- | :--- |
| **OpenAI / Codex** | `agent: codex`<br>`model: gpt-6-astra` or `gpt-6.1-sol`<br>`effort: high` | **Deep Backend Engineering & Mathematical Rigor**<br>Flawless algorithmic reasoning, strict Pydantic v2 schemas, type safety, database transactions, and deterministic calculations. | - Markowitz Efficient Frontier diminishing returns solver<br>- 1,000-path Monte Carlo covariance matrices & 90% VaR<br>- FastAPI routing, SSE streaming pipelines, and Pydantic models<br>- Canvas LMS REST client & Supabase sync layer |
| **Anthropic / Claude** | `agent: claude`<br>`model: claude-3-7-sonnet-latest` / `sonnet-5.5` / `opus-5.5`<br>`reasoning: high` | **Frontend Ergonomics, Multimodal Vision & UX Narrative**<br>High-density Bloomberg terminal UI, React 19 / Next.js 16 architectures, visual hierarchy, multimodal image/PDF ingest, and hackathon presentation. | - Bloomberg-style terminal components & widget layout<br>- Interactive Judge Tour HUD & Student Mode subtitles<br>- Multimodal syllabus vision ingest (Llama 3.2 vision tokens)<br>- Pitch narrative choreography & adversarial judge defense |
| **DeepSeek** | `agent: dsh`<br>`model: deepseek-v4.1-flash` (or V3/R1 flash via API) | **High-Throughput Extraction & Rapid Test Fuzzing**<br>Extreme speed and low latency for repetitive, high-volume structured parsing and boundary testing. | - Batch parsing of syllabi into JSON grading matrices<br>- Fast lint and formatting pre-checks<br>- Edge-case test generation and payload fuzzing |
| **Antigravity** | `agent: antigravity`<br>`orchestrator` | **Master Conductor, System Integrator & Release Authority**<br>Coordinates Orca runs, defines task contracts, resolves integration conflicts, executes tests (`make check`), and drives git finish protocol. | - Task decomposition & specification<br>- Orca worker supervision & dispatch<br>- Test suite execution (`make check`) & judge audit (`judge.py`)<br>- Production dual-remote git push (`origin` + `metahackathon`) |

---

## Supervised Orchestration Workflow

When delegating heavy lifting to worker models, follow this structured pattern:

### Step 1: Create or Bind an Orchestration Run
```bash
orca orchestration run-create --name "<feature-or-loop-name>" --json
```

### Step 2: Formulate the Task Specification Contract
Every delegated task must define:
- **Target**: The exact files or subsystem in scope (e.g., `backend/calendar_export.py` or `frontend/src/components/JudgeTourHUD.tsx`).
- **Change**: Concrete implementation requirements and expected output.
- **Constraints**: Invariants, backward compatibility, strict Pydantic typing, zero diagram rules, and no breaking existing tests.
- **Ownership**: Boundaries the worker is permitted to edit.
- **Acceptance Criteria**: The exact automated test (`pytest`, `npm test`, or `make check`) that proves completion.

### Step 3: Dispatch Work to the Specialist Agent

#### For Backend Heavy Lifting (Codex GPT-6.1):
```bash
orca orchestration worker-start \
  --task-title "<Task Title>" \
  --spec "<Self-contained backend specification>" \
  --agent codex \
  --model gpt-6-astra \
  --effort high \
  --worktree current \
  --json
```

#### For Frontend & Multimodal Heavy Lifting (Frontier Claude):
```bash
orca orchestration worker-start \
  --task-title "<Task Title>" \
  --spec "<Self-contained frontend specification>" \
  --agent claude \
  --model claude-3-7-sonnet-latest \
  --worktree current \
  --json
```

Alternatively, for direct prompt-driven launches in the current worktree:
```bash
orca agent launch --agent codex --model gpt-6-astra --effort high --worktree current --prompt "<Task Brief>" --json
orca agent launch --agent claude --worktree current --prompt "<Task Brief>" --json
```

### Step 4: Monitor Settlement & Read Output
```bash
orca orchestration check --wait --json
orca orchestration worker-read --source auto --json
```

### Step 5: Verification & Quality Gate
Before any feature is accepted:
```bash
make check
python3 scripts/judge.py --run-checks all --fail-under 90
```

### Step 6: Mandatory Production Release
```bash
agent-finish "<imperative commit message>"
```
Or manually:
```bash
git add -A
git commit -m "<imperative commit message>"
git push origin HEAD:main
git push metahackathon HEAD:main
```
Attributed strictly to `FrankieBiz <frankabisignano@gmail.com>` with zero AI markers or co-author tags.
