# Apex OS (legacy Vite workspace)

> This documents the original Vite + Express app, archived as a self-contained project in [`legacy_archive/`](../legacy_archive) with its own `package.json`, lockfile, and `vercel.json`. Run every command below from `legacy_archive/`; paths in this document are relative to it. CI no longer builds or tests it. The current Apex OS terminal is `backend/` + `frontend/`; see the [root README](../README.md).

A personal executive command center built with React 18, strict TypeScript, Vite, Tailwind CSS, Lucide, Framer Motion, react-grid-layout, and Zustand. Express provides same-origin integration routes locally and through Vercel Functions.

## Start using Apex OS

On your first visit, enter your name and open a clean workspace. You can also explore an editable demo or restore an existing backup. Start with a long-term goal, link a sprint, and add a few concrete checkpoints. Use Settings to import your calendar or connect Canvas.

Your data stays in this browser. In **Settings → Workspace & backups**, export a JSON backup regularly and before moving to another device or domain. Restoring a backup shows a summary and requires confirmation before replacing the current workspace. Access tokens, subscription URLs, and running timers are excluded from backups; restored timers start paused.

## Run

```bash
cd legacy_archive
npm ci
npm run dev
```

Open **http://localhost:5173**. The API runs on `127.0.0.1:3001`. Both processes are managed by the dev command.

```bash
npm run build
npm start
```

The production server serves the built application and API at **http://localhost:3001**. Use Node **24.x**, matching the Vercel runtime pinned in `package.json`. `HOST` and `PORT` configure the standalone listener.

## Deploy to Vercel

Import the repository into Vercel and set **Root Directory** to `legacy_archive`. The repository root's `vercel.json` deploys the Next.js terminal instead. The archived `vercel.json` supplies all build settings:

| Setting          | Value           |
| ---------------- | --------------- |
| Framework        | Vite            |
| Install command  | `npm ci`        |
| Build command    | `npm run build` |
| Output directory | `dist`          |
| Node.js          | 24.x            |

The dashboard is served from Vercel's CDN. `api/health.ts`, `api/calendar.ts`, `api/canvas.ts`, and `api/decompose.ts` export the shared Express app as Node functions; they do not start the standalone listener. API paths are excluded from the SPA fallback, so navigation reloads work without swallowing API requests. Hashed assets receive immutable caching; API responses are never cached. Functions have a 60-second execution budget.

No environment variables are required for goals, layouts, notes, focus, calendar sync, Canvas sync, or the local task planner. For optional AI planning, add `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in **Vercel → Project Settings → Environment Variables**, then redeploy. These are server variables; never prefix either with `VITE_`.

After deployment, open `/api/health` to confirm `status: "ok"`, then import a calendar in Settings. The `ai` field reports whether the server has an AI key. Live Canvas and AI validation require your own credentials.

For a personal deployment with a paid AI key, use Vercel Deployment Protection to control access. The app has no account authentication; its in-memory rate limits apply per function instance and are not a distributed spending limit. Workspace data stays in the current browser and does not synchronize between devices or deployment domains. When hosting the standalone server, use HTTPS and private access control.

See [Vercel's Vite guide](https://vercel.com/docs/frameworks/frontend/vite) and [Node Functions documentation](https://vercel.com/docs/functions/runtimes/node-js). Deploying or linking a Vercel project is a separate action; no project is created by the local build.

## Workspace

- **Goals:** Date-anchored macro goals with editable milestones, linked seven-day sprints, nested micro checkpoints, and progress calculated from completion. Select a goal to edit checkpoint text, estimates, and dates. Archive past sprints to keep the current productivity score relevant; archived checkpoints still contribute to their parent goal. Restore archived goals or delete them with confirmation. Deleting a macro preserves and unlinks its child sprints.
- **Layout:** Unlock to drag panel headers and resize corners. Hide or collapse individual modules, restore modules in Customize, and choose Overview, Sprint execution, or Deep work presets. Small screens automatically stack panels.
- **Canvas:** Settings accepts an iCal subscription or `.ics` upload. The parser supports line folding, all-day events, embedded timezones, recurrence, exceptions, and exclusion dates. Recurring events are bounded to a rolling 90-day horizon. Live feeds refresh every 15 minutes while the current browser session stays open. Subscription URLs stay in memory; reconnect after a page reload. Imported calendar data persists.
- **Canvas API:** Supply your `school.instructure.com` domain and personal access token. The server reads active courses, paginated course assignments (including your submission status and rubric), and upcoming events. Tokens are sent over the same-origin API, used for that request, and never stored. API sync is manual; the token is cleared after a successful sync. Custom Canvas domains require an explicit server-side allowlist change.
- **Assignment queue:** Filter overdue, next 24 hours, this week, upcoming beyond seven days, or completed. Inspect descriptions, rubrics, and attachment links; mark an assignment complete or convert it into a sprint with three starter tasks. Conversion is idempotent.
- **Schedule:** Daily focus flow, seven-day calendar, and horizontal timeline merge assignments, commitments, and linked goal sessions. Add, edit, or delete your own time blocks, or start focus from a scheduled session. Imported calendar events stay tied to their source.
- **Focus:** Live 15/25/45/60-minute sessions persist across page reloads. Completion records elapsed minutes and feeds productivity metrics and activity. Closing the dialog keeps the timer running.
- **Scratchpad:** Markdown editing and preview with immediate local persistence.
- **Commands:** Cmd/Ctrl+K searches goals and assignments and opens common actions. N creates a sprint; Enter adds a checkpoint; Cmd/Ctrl+Enter toggles a focused checkpoint or generates a task breakdown; ? shows shortcuts; Esc closes dialogs.

Demo data is optional and anchored to your first visit. Connecting Canvas replaces demo assignments. You can clear the entire workspace in Settings after exporting a backup.

## Optional AI

Set **`OPENAI_API_KEY`** in the server’s environment (never in a `VITE_` variable). Optionally set **`OPENAI_MODEL`**, which defaults to `gpt-4.1-mini`. Do not put credentials in source control. The server uses the [OpenAI Responses API with structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) and `store: false`. Prompts are sent only when the user requests a breakdown. With no key, the deconstructor produces a clearly labeled local starter plan; network failures fall back to this plan. Each of the three steps is editable before adding it to a sprint.

## Source map

```text
src/App.tsx                  Shell, navigation, command palette, grid
src/types.ts                 Goal, SubGoal, CanvasAssignment, WidgetLayout, WorkspacePreset
src/store.ts                 Persistent domain state and actions
src/data/presets.ts           Snap-to-grid layout configurations
src/data/seed.ts              Sample data anchored to first visit
src/components/Goals.tsx      Macro goals, weekly sprints, goal editor
src/components/CanvasFeed.tsx Assignment queue and inspector
src/components/Timeline.tsx   Three schedule views and time blocks
src/components/Focus.tsx      Live focus timer and focus room
src/components/Scratchpad.tsx Markdown notes and task deconstructor
src/components/Settings.tsx   Calendar, Canvas, personalization, backups
src/components/Onboarding.tsx First-run setup and backup restoration
src/lib/workspace.ts         Runtime schemas and versioned backups
src/lib/calendar.ts          Shared iCalendar parser
src/lib/persistence.ts       Mirrored browser storage with recovery
api/*.ts                     Vercel Function entrypoints
vercel.json                  Build, routing, caching, and deployment headers
server/app.ts                Shared integration routes without a port listener
server/index.ts              Standalone development/production listener
server/network.ts            Public HTTPS requests with pinned DNS and response limits
server/canvas.ts             Canvas pagination and assignment normalization
server/ai.ts                 Optional structured AI breakdown
tests/                      Domain and integration-boundary tests
```

## Persistence and backend synchronization

Zustand persists versioned state under `apex-os-workspace-v1`. Every write is mirrored to LocalStorage and IndexedDB. Timestamped snapshots recover the newest available copy when one store is full or unavailable. Writes are serialized to preserve rapid edits. The interface reports saving, saved, and storage failure states. Existing version-one workspaces are preserved, and unreadable data is retained as a downloadable recovery file. Stable IDs, ISO timestamps, strict schemas, and centralized actions allow a Supabase/PostgreSQL adapter to replace or subscribe to this persistence boundary. Authentication and remote synchronization are not configured. Data is local to the current browser profile; it is not shared between devices.

Server requests are rate-limited, size-limited, timed out, and restricted to public HTTPS addresses. DNS results are checked and pinned to prevent rebinding; token-bearing redirects are restricted to the original Canvas origin. HTML descriptions are converted to plain text. Markdown does not execute raw HTML. Secrets and subscription URLs are excluded from persistence. Integration errors are shown without logging credentials.

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run build
# Or run the complete verification suite:
npm run check
```

GitHub Actions no longer runs these checks; it covers `backend/` and `frontend/` only. Tests cover parent/child progress, archiving and deletion, backup validation, storage recovery and write ordering, focus restoration, calendar recurrence, Canvas attachment normalization, local and AI task plans, integration URL boundaries, and HTTP behavior of the Vercel API handlers. Live Canvas and AI require your own credentials and are not contacted by the test suite.
