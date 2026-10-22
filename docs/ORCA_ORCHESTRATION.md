# Orca Multi-Model Orchestration Framework

## Core Philosophy: Orchestrator vs. Heavy Lifters

Antigravity operates as the **Master Orchestrator**, not a monolithic heavy lifter. The orchestrator's job is project coordination, contract definition, task decomposition, quality gatekeeping, test verification, and production release. The heavy engineering lifting is delegated to specialized, newest-generation frontier models via the unified orchestration hub (`scripts/orchestrate.py`) and local Orca runtime.

---

## Model Specialization Matrix (Newest Frontier Generation Only)

Older-generation models (e.g. Claude 3.5, Claude 3.7, GPT-4o, legacy tiers) are strictly prohibited. Every model in the orchestration pool is selected for its distinct frontier strengths:

| Model Tier | Orchestration Worker / Model ID | Primary Specialization & Strengths | Best Used For |
| :--- | :--- | :--- | :--- |
| **OpenAI / Codex** | Worker: `codex`<br>Model: `gpt-6.1-sol` or `gpt-6-astra`<br>Effort: `high` / `xhigh` | **Deep Backend Engineering & Mathematical Rigor**<br>Flawless algorithmic reasoning, strict Pydantic v2 schemas (`extra='forbid'`), type safety, database transactions, and deterministic calculations. Guided by `CODEX.md`. | - Markowitz Efficient Frontier diminishing returns solver<br>- 1,000-path Monte Carlo covariance matrices & 90% VaR<br>- FastAPI routing, SSE streaming pipelines, and Pydantic models<br>- Canvas LMS REST client & Supabase sync layer |
| **Anthropic / Claude** | Worker: `claude`<br>Model: `claude-sonnet-5.5` / `claude-opus-5-5`<br>Effort: `high` | **Frontend Ergonomics, Multimodal Vision & UX Narrative**<br>High-density Bloomberg terminal UI, React 19 / Next.js 16 architectures, visual hierarchy, multimodal image/PDF ingest, and hackathon presentation. Guided by `CLAUDE.md`. | - Bloomberg-style terminal components & widget layout<br>- Interactive Judge Tour HUD & Student Mode subtitles<br>- Multimodal syllabus vision ingest (Llama 3.2 vision tokens)<br>- Pitch narrative choreography & adversarial judge defense |
| **DeepSeek** | Worker: `deepseek`<br>Model: `deepseek-v4.1-flash` (or API flash endpoint)<br>Speed: Sub-second | **High-Throughput Extraction & Rapid Test Fuzzing**<br>Extreme speed and low latency for repetitive, high-volume structured parsing and boundary testing. Guided by `DEEPSEEK.md`. | - Batch parsing of syllabi into JSON grading matrices<br>- Fast schema validation and JSON pre-checks<br>- Edge-case test generation and payload fuzzing |
| **Antigravity** | Role: `orchestrator`<br>Authority: Master Conductor | **Master Conductor, System Integrator & Release Authority**<br>Coordinates multi-model workers, defines task contracts, resolves integration conflicts, executes tests (`make check`), and drives git finish protocol. | - Task decomposition & specification<br>- Multi-model worker dispatch & telemetry tracking<br>- Test suite execution (`make check`) & judge audit (`judge.py`)<br>- Production dual-remote git push (`origin` + `metahackathon`) |

---

## Unified Programmatic & CLI Orchestration Hub

The repository includes a battle-tested orchestration CLI and Python module at `scripts/orchestrate.py`:

### Diagnostic Probe
Verify connectivity, models, latency, and tokens across all three frontier workers:
```bash
make orchestrate-probe
# Or directly:
python3 scripts/orchestrate.py probe
```

### Worker Dispatches

#### 1. Backend Engineering (Codex `gpt-6.1-sol`)
```bash
python3 scripts/orchestrate.py backend \
  --task "Implement 1,000-path Monte Carlo VaR computation with Cholesky decomposition" \
  --files backend/services/monte_carlo.py \
  --verify
```
Automatically enforces `CODEX.md` instructions, strict Pydantic v2 typing, and zero diagrams. `--verify` triggers `make check` upon completion.

#### 2. Frontend Ergonomics (Claude `claude-sonnet-5.5`)
```bash
python3 scripts/orchestrate.py frontend \
  --task "Add Bloomberg-style yield curve metrics with collegiate subtitles" \
  --files frontend/src/components/EquityCurve.tsx \
  --verify
```
Automatically enforces `CLAUDE.md` instructions, React 19 hook ordering rules, dark palette invariants, and zero diagrams.

#### 3. Batch Extraction & Fuzzing (DeepSeek `deepseek-v4.1-flash`)
```bash
python3 scripts/orchestrate.py extract \
  --prompt "Parse this syllabus text into structured grading matrix JSON" \
  --json
```

### Telemetry & Token Ledger
Every worker dispatch is recorded in `.qa/orchestration/token_ledger.json` and saved as an individual receipt in `.qa/orchestration/runs/`:
```bash
make orchestrate-stats
# Or directly:
python3 scripts/orchestrate.py stats
```
Displays cumulative input tokens, cached tokens, output tokens, reasoning tokens, and dollar costs per model tier.

---

## Supervised Orca Multi-Tab Workflow

When running multi-agent tasks in parallel supervised worktrees:

### Step 1: Create or Bind an Orchestration Run
```bash
orca orchestration run-create --objective "<feature-or-loop-name>" --json
```

### Step 2: Formulate the Task Specification Contract
Every delegated task must define:
- **Target**: The exact files or subsystem in scope.
- **Change**: Concrete implementation requirements and expected output.
- **Constraints**: Invariants, backward compatibility, strict Pydantic typing, zero diagram rules, and no breaking existing tests.
- **Ownership**: Boundaries the worker is permitted to edit.
- **Acceptance Criteria**: The exact automated test (`pytest`, `npm test`, or `make check`) that proves completion.

### Step 3: Dispatch Work to the Specialist Agent
```bash
orca orchestration worker-start \
  --task-title "<Task Title>" \
  --spec "<Self-contained backend specification>" \
  --agent codex \
  --model gpt-6.1-sol \
  --effort high \
  --worktree current \
  --json
```

### Step 4: Verification & Quality Gate
Before any feature is accepted:
```bash
make check
python3 scripts/judge.py --run-checks all --fail-under 90
```

### Step 5: Mandatory Production Release
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
