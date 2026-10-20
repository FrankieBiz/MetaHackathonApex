# Apex OS academic backend

FastAPI service for Canvas course portfolios, assignment triage, nested task progress, and study recommendations. Python 3.12 is the tested runtime. Start from the **repository root**; the examples use `uv` and require no credentials for demo mode.

```bash
uv venv backend/.venv --python 3.12
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Interactive API docs: **http://127.0.0.1:8000/docs**. State: **http://127.0.0.1:8000/api/state**.

## Configuration

Settings come from process environment variables. The service does not read `.env` files. Keep credentials in your shell session or deployment secret manager.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CANVAS_API_URL` | `https://canvas.instructure.com` | HTTPS origin of your university's Canvas instance, without `/api/v1` |
| `CANVAS_API_TOKEN` | empty | Server-side Canvas personal access token |
| `DEMO_MODE` | inferred | Defaults to `true` when the Canvas token is absent; explicit `true` always uses the sandbox |
| `SUPABASE_URL` | empty | Optional Supabase project URL |
| `SUPABASE_KEY` | empty | Server-only service role key; both Supabase values are needed for persistence |
| `LLM_BASE_URL` | `http://localhost:11434/v1` | Ollama, vLLM, or another OpenAI-compatible endpoint |
| `LLM_API_KEY` | `ollama` | Endpoint key; Ollama accepts this placeholder value |
| `LLM_MODEL` | `llama3` | Exact model name served by the endpoint |
| `LLM_TIMEOUT_SECONDS` | `15` | Overall planning deadline; bounded to 120 seconds |
| `CANVAS_TIMEOUT_SECONDS` | `2.5` | Per-request Canvas deadline; a slower page switches the sync to the sandbox |
| `APEX_WORKSPACE_ID` | `default` | Snapshot namespace for this deployment |
| `CORS_ORIGINS` | empty | Comma-separated browser origins allowed in addition to the local dev origins, such as the deployed terminal's `https://apex-os.vercel.app`; each must be a bare `http(s)` origin |

Supabase is optional and does not determine demo mode. Explicit `DEMO_MODE=false` without a valid Canvas token still falls back to the sandbox if Canvas rejects the request. The response's `metrics.demo_mode` reports the source actually in use.

To configure a live Canvas session without echoing its token:

```bash
export CANVAS_API_URL=https://your-school.instructure.com
read -rsp 'Canvas token: ' CANVAS_API_TOKEN
export CANVAS_API_TOKEN
export DEMO_MODE=false
backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

## Canvas sync and sandbox

The client reads active courses with grades and syllabi, published course assignments with submission status and rubrics, and upcoming events. It follows Canvas's [Link-header pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination), with page/item limits, four concurrent assignment requests, a 2.5-second deadline per Canvas request (`CANVAS_TIMEOUT_SECONDS`) inside a 25-second sync deadline, and origin checks before sending credentials to each page. Redirects are disabled.

The ten-minute in-memory TTL cache also caches failures, so frontend polling cannot repeatedly hit an unavailable Canvas instance. `POST /api/sync` bypasses the cache. Any Canvas answer other than HTTP 200 (authentication errors, rate limits), a request slower than the Canvas deadline, network failures, or malformed responses switch the entire snapshot to a clearly marked sandbox, so `/api/state` and `/api/sync` still answer 200. The next forced sync or expired-cache read retries live Canvas. A successful empty live course list stays empty.

The sandbox is the deterministic fixture set in `mock_data.py`, mirrored field for field by `frontend/src/lib/mockData.ts`, so the backend sandbox and the browser's local simulation desk render identically. It contains CS 3801 Distributed Systems, MATH 4102 Stochastic Modeling, ENG 2001 Technical Writing, and FIN 3100 Quantitative Analysis with ten weeks of `grade_history`. It has 12 assignments, weighted 10–30% and worth 50–200 points, due 4 hours to 8 days after the sync. Nine ship with nested task trees carrying estimates, logged minutes, and study flags (`is_study_recommendation`) on study-guide and large-PDF tasks. Three are left untriaged for live Llama-3 deconstruction. Dates refresh relative to the sync time; stable IDs preserve task progress. It does not download a PDF or fabricate attachment URLs.

Assignments carry `graded`: true once Canvas has scored or excused the submission, which means the score is already in `current_score`. A submitted assignment awaiting a grade is `completed` but not `graded`. Live grades unavailable from Canvas are `null`, as is their portfolio margin. Target grades default to 90. Assignment `weight` is its percentage of the course's fetched assignment points; it approximates importance and does not implement Canvas assignment-group grade weighting.

## Llama planning

For a local model, install Ollama separately, then run:

```bash
ollama pull llama3
ollama serve
```

If Ollama is already running as a service, only the pull is needed. The backend uses the [OpenAI Python SDK](https://developers.openai.com/api/reference/python) against [Ollama's compatible Chat Completions API](https://docs.ollama.com/api/openai-compatibility). Point `LLM_BASE_URL` and `LLM_MODEL` at your vLLM server to use that provider.

The planner includes the assignment description and rubric as task material, requests a strict JSON tree, and validates every estimate as an integer between 15 and 45 minutes. It enforces at most four levels and 60 nodes, then assigns task and parent IDs on the server. Unavailable models, timeouts, truncated responses, and invalid plans return a deterministic three-phase starter tree. No model server is required to try the API.

Courses with no active assignments receive a `Rapid Study Action`. Recommendations scan syllabus and past assignment text for study guide, exam, PDF, or review references, then use portfolio shortfall or lecture recall as fallbacks. These are standalone tasks with `assignment_id: null`; the service does not invent a Canvas assignment for them. Recommendations refresh during sync.

## API contract

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/state` | Full state; cached Canvas data and recalculated priorities/metrics |
| `POST` | `/api/sync` | Full state after a forced refresh and optional Supabase save |
| `POST` | `/api/triage/{assignment_id}` | JSON array of root `SubTaskNode` objects, with nested `children` |
| `PATCH` | `/api/v1/subtasks/{subtask_id}` | Full updated state, including recalculated metrics; mirrors the tree and appends a time log in Supabase |
| `PATCH` | `/api/subtasks/{subtask_id}` | Deprecated alias of the v1 route, kept for older terminals |

Full state contains `courses`, `assignments` sorted by descending priority, `study_recommendations`, `upcoming_events`, `metrics`, and `persistence_status` (`disabled`, `connected`, or `unavailable`). IDs are strings and timestamps use ISO 8601 with timezones. Unknown assignment/task IDs return 404. Invalid PATCH bodies return 422. A Canvas material/source change during an in-flight triage returns 409 for retry.

```bash
curl --fail-with-body http://127.0.0.1:8000/api/state
curl --fail-with-body -X POST http://127.0.0.1:8000/api/triage/demo-replication
# Copy a returned task ID into the URL below:
curl --fail-with-body -X PATCH http://127.0.0.1:8000/api/v1/subtasks/TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"is_completed": true, "actual_minutes": 25}'
curl --fail-with-body -X POST http://127.0.0.1:8000/api/sync
```

PATCH accepts `is_completed`, `actual_minutes`, or both. `actual_minutes` replaces the logged total for that node; it is not an increment. Empty bodies, nulls, coercible strings, negative minutes, non-integer minutes, and unknown fields are rejected. Completing a parent completes its descendants. Completing every sibling completes their parent, recursively. Reopening a descendant reopens its ancestors; reopening a parent reopens its descendants. Assignment status follows its task roots. A Canvas submission marked submitted/graded wins at the next sync.

Triage preserves a plan once any task has completion or logged work, including when progress arrives while the planner is running. Sync preserves plans and recorded work. Neither endpoint writes completion back to Canvas.

Metrics have explicit units:

- `completion_velocity`: percentage (0–100) of budgeted leaf-task minutes that are completed. This is a progress measure, not an hourly throughput rate.
- `assignment_volatility`: population standard deviation of active assignment priority scores.
- `total_budgeted_minutes`: leaf-task estimates, including study actions. Parent containers are excluded to avoid counting their children twice; untriaged assignments contribute no budget.
- `total_actual_minutes`: minutes logged directly on every node, counted once per node. Logging a total on a parent as well as the same time on its children represents additional time, so log each work session once.
- `last_synced_at`: timestamp of the last live or sandbox snapshot refresh, unchanged by task edits or cache hits.

Priority is capped at 100: `urgency + 0.3 × weight + max(0, -portfolio_margin)`. Urgency is 50 for overdue assignments, `40 / (1 + days_until_due)` for future work, or 5 when undated. Completed assignments have priority zero. Portfolio margin is `current_score - target_score`.

## Optional Supabase persistence

Apply [sql/schema.sql](sql/schema.sql) in your project's SQL editor, then configure `SUPABASE_URL` and `SUPABASE_KEY` through your environment or secret manager. The table has row level security enabled and no browser-role access; the backend requires the service role key. The adapter uses Supabase's [upsert API](https://supabase.com/docs/reference/python/upsert) to store a snapshot after sync, triage, and PATCH. Initial sync restores saved plans and progress before merging current Canvas data.

Each PATCH that changes any task in the tree (a cascade counts) also calls the `apex_record_subtask_patch` function over RPC. In one transaction it upserts the course, the assignment, and that assignment's whole task tree into the relational `courses`, `assignments`, and `subtasks` tables (a checkbox can cascade through every level). It removes tasks that are no longer in the tree and inserts one `time_logs` row: the signed `minutes_delta` (a −15m correction is logged, not erased), the new `actual_minutes` total, and `is_completed`. A replayed PATCH that changes nothing logs nothing. The snapshot remains the restore source. Study actions have no assignment row, so only the snapshot keeps them. A failed relational write, including a schema that was never applied, reports `persistence_status: "unavailable"` and leaves the response intact. The snapshot save and this call run concurrently, so a slow Supabase costs one request timeout, not two. The script revokes Supabase's default `ALL` grants, `service_role` included, before granting back only what is used: `time_logs` is select/insert only. Sandbox and live rows share these tables; fixture IDs (`cs3801-raft-1.2`) never collide with Canvas IDs.

Sandbox snapshots and live snapshots use separate keys under `APEX_WORKSPACE_ID`; an outage cannot overwrite live progress with demo data. A failed restore blocks writes until a later forced sync or TTL refresh restores successfully. During recovery, locally modified assignments and study actions take precedence; other saved progress is restored. Storage failures keep the API available with `persistence_status: "unavailable"`; work remains in process memory until a successful save. Without Supabase, progress lasts until process restart.

## Integration and deployment scope

This backend is a separate service on port 8000. The Next.js terminal in `frontend/` calls it directly from the allowed origins `http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:5173`, and `http://127.0.0.1:5173`, plus any listed in `CORS_ORIGINS`. It also proxies `/api/v1/*` on its own origin to this service, so those requests need no CORS. The root `render.yaml` deploys this service to Render; see the root README. The archived Vite app in `legacy_archive/` uses its own Express routes and does not call this backend.

Run **one Uvicorn worker**: the cache, locks, and working state belong to one process. Supabase provides restart recovery, not coordination between workers. This is a single-user service without an authentication layer. For a hosted deployment, place it behind authenticated private access and HTTPS. Multi-user or multi-worker hosting needs identity-scoped storage and shared transactional state before scaling.

## Verification

```bash
uv pip install --python backend/.venv/bin/python -r backend/requirements-dev.txt
backend/.venv/bin/ruff check backend
backend/.venv/bin/ruff format --check backend
backend/.venv/bin/python -m pytest backend -q
uv pip check --python backend/.venv/bin/python
```

Tests use HTTPX mock transports for Canvas, the Llama endpoint, and Supabase. They never contact a real account or require credentials. `make check` at the repository root runs these checks with the frontend suite. GitHub Actions (`.github/workflows/verify.yml`) runs `ruff check`, `ruff format --check`, and `pytest` inside `backend/` on every push and pull request. Real Canvas account access, local model inference, and a deployed Supabase schema require a configured environment for live validation.

Runtime and development dependencies are pinned in their respective `requirements*.txt` files. To update them deliberately from the `.in` sources:

```bash
uv pip compile backend/requirements.in --python backend/.venv/bin/python --output-file backend/requirements.txt
uv pip compile backend/requirements-dev.in --python backend/.venv/bin/python --constraint backend/requirements.txt --output-file backend/requirements-dev.txt
```
