# Apex OS Terminal (frontend)

Next.js 16 App Router terminal for Apex OS: a four-panel, drag-and-drop workstation over the FastAPI backend in `backend/`. TypeScript, Tailwind CSS 4, `react-grid-layout`, `recharts`, and Zustand.

## Run

```bash
cd frontend
npm ci
npm run dev        # http://localhost:3000
```

Open **http://localhost:3000**. The backend's CORS allowlist names `http://localhost:3000` and `http://127.0.0.1:3000` exactly, so serve the terminal on port 3000 when the backend is running, or add your origin to the backend's `CORS_ORIGINS`. The root `./start.sh` runs both and handles this for a custom `WEB_PORT`.

The terminal works with or without the backend:

| Backend | Badge | Data |
| --- | --- | --- |
| Running, Canvas token configured | `CANVAS API: CONNECTED` | Live Canvas data |
| Running, no token or Canvas failing | `[MODE: ISOLATED SIMULATION DESK] · API` | The backend's deterministic dataset |
| Slow (>2.5s), non-200, or not running | `[MODE: ISOLATED SIMULATION DESK] · LOCAL` | The same dataset, served by the browser and saved locally |
| Pinned with `Ctrl+Shift+D` | `[MODE: ISOLATED SIMULATION DESK] · PINNED` | Local dataset; the backend is not contacted |
| Dropped after data loaded | `BACKEND DETACHED · EDITS QUEUE` | Last backend data; edits replay on reconnect |

**Fallback interceptor.** `api.state()` and `api.sync()` in `src/lib/api.ts` never reject. When the feed is slower than 2.5 seconds, answers non-200, or cannot be reached, they return the deterministic dataset from `src/lib/mockData.ts`, flagged `simulated`. The boot screen therefore never waits more than 2.5 seconds. The fixtures mirror `backend/mock_data.py`, so switching sources keeps the same IDs and selection. A background poll never replaces backend data already on screen. It holds the last good data rather than switching datasets mid-demo.

**Simulation toggle.** `Ctrl+Shift+D` (Ctrl on every platform; also in the command palette) pins the simulation desk: polling stops, **Sync now** stays local, and the pin survives reloads in that tab. Press it again to return to live Canvas; it runs a sync, and if the backend still fails, the desk stays up and the 30-second probe keeps retrying.

On the simulation desk, every action (triage, checkboxes, time logging) runs locally and edits persist across reloads. The terminal probes for the backend every 30 seconds and switches over when it answers (unless pinned). **Sync now** retries immediately. **Reset simulation data** in the command palette restores the fixture dataset.

Point at a different backend with `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`). It is inlined at build time, so set it before `npm run build`. See `.env.example`; on Vercel, set it to the Render URL in the project's environment variables. The same value is the target of the `/api/v1/*` rewrite in `next.config.ts`, which proxies those paths on the terminal's own origin to the backend.

## Panels

- **Order book**: open assignments ranked by priority, `weight% × points / max(hours until due, 1)`. Rows show a live countdown. **Execute AI triage** calls `POST /api/decompose` with the selected assignment ID and updates the header with measured model telemetry. It asks for confirmation before replacing an existing tree. Arrow keys move the selection.
- **Equity curve**: the selected course's grade trajectory with a **what-if simulator**, then one small chart per course on a shared scale, against its target line. The simulator follows the execution deck's course; click a course tile to simulate another. Each weighted assignment Canvas hasn't graded gets a 0–100% slider and a score field. That includes submitted work and work whose tasks are all checked, until a score posts. Moving them redraws the dashed **projected trajectory** through each deadline and re-rates the **margin of safety** badge (`+4.2% BUFFER ABOVE 90.0% TARGET` ↔ `−1.8% MARGIN DEFICIT [ WARNING ]`). A break-even line gives the single score on open work that lands on target. The projection is `current + Σ weight × (score − current) / max(100, Σ open weight)`: graded and unpublished work is held at the current grade. Scores are session-only and never sent to the backend. Courses with no open assignments get a **Rapid Study Action** (§4.4), drawn from study keywords in recent coursework or the syllabus. A table view mirrors the charts and adds a what-if column.
- **Operational metrics**: completion velocity (§4.2, over completed tasks that have logged time), assignment volatility (σ/μ of the next 14 days' deadline load), open capacity, and estimated vs. actual minutes per course.
- **Execution deck**: the selected assignment's task tree. Checking a parent checks every task under it, and completing every child checks the parent (§4.3). Leaf tasks log time in 15-minute steps. Each change applies at once, then persists through `PATCH /api/v1/subtasks/{id}`.
- **Ticker tape**: each course's grade, margin, and completion velocity. The course in the execution deck is pinned at the left, and its velocity flashes when a checkbox or time log moves it.

Metrics are computed in the browser from the current tree, so the numbers react instantly and match the spec formulas whichever data source is active.

## Keys

- `⌘K` / `Ctrl+K`: command palette (sync, token, layout reset, simulation toggle, triage, jump to any assignment)
- `Ctrl+Shift+D`: toggle live Canvas mode and the deterministic simulation desk
- `↑` `↓` on the order book: move the selection
- Drag panel headers to rearrange; drag corners to resize. **Reset layout** restores the default arrangement.

## Canvas token

**Token config** keeps the token in memory for the current tab and sends it only with `POST /api/sync` to the backend. It is never written to storage. The current backend reads its token from `CANVAS_API_TOKEN` at startup. If it is still in demo mode after a sync, the status bar says so.

## Verify

```bash
npm run check      # lint, typecheck, unit tests, production build
```

Unit tests (`tests/`) cover the priority and velocity formulas, recursive tree propagation, the study fallback, the local triage planner, normalization of backend payloads, the feed interceptor (2.5s deadline, non-200, unreachable, unusable payloads), the simulation toggle and pin, and the fixture invariants.

## Source map

```text
src/app/page.tsx              Workstation grid, backend loop, hotkeys, status bar
src/components/TopBar.tsx     Clocks, ticker tape, connection badge, sync/token/palette
src/components/OrderBook.tsx  Priority execution queue
src/components/EquityCurve.tsx Grade trajectories, margins, study actions, what-if state
src/components/TrajectoryChart.tsx Selected course chart, what-if sliders, margin of safety
src/components/Velocity.tsx   Velocity, volatility, capacity, est vs act
src/components/TaskTree.tsx   Recursive work breakdown and time logger
src/store/terminal.ts         State, optimistic writes, offline fallback
src/lib/engine.ts             Formulas and tree rules (pure, tested)
src/lib/api.ts                FastAPI client, payload normalization, feed interceptor
src/lib/mockData.ts           Deterministic simulation fixtures (mirrors backend/mock_data.py)
src/lib/sandbox.ts            Re-anchors a saved simulation session to the current time
src/types/index.ts            Interfaces mirroring backend/models.py
```

The active Order Book assignment is highlighted and listed first in the what-if simulator. Move its 0–100% slider to update the projected trajectory and Margin of Safety immediately. Scores are hypothetical and do not modify Canvas grades.
