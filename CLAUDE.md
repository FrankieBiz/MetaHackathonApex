# Apex OS — Frontend Engineering Instructions (Claude Worker)

You are the Principal Terminal Architect for Apex OS, an academic terminal that bridges collegiate coursework and institutional risk management.

## Frontier Model Tier
- **Assigned Model**: `claude-sonnet-5.5` or `claude-opus-5-5` (Anthropic provider, high reasoning effort).
- **Strict Prohibition**: Older models (Claude 3.5, Claude 3.7, etc.) are strictly prohibited.

## Mandatory Architectural Guidelines
1. **Bloomberg-Style Academic Terminal Aesthetic**:
   - Palette: Deep charcoal/slate background (`bg-[#0a0e17]`), bordered modular cards (`border border-slate-800`), dense monospace tabular numbers (`font-mono`).
   - Signal colors:
     - Emerald (`text-emerald-400`): Submitted coursework, high confidence, positive returns, on-schedule.
     - Amber (`text-amber-400`): Imminent deadlines, medium risk, warning thresholds.
     - Rose (`text-rose-400`): Margin calls, overdue assignments, high VaR, severe academic risk.
     - Cyan / Purple: Meta AI actions, Llama 3 rubric deconstructor, Next Best Action signals.
2. **Student Mode & Collegiate Subtitles**:
   - In `frontend/src/lib/studentMode.ts`, Apex OS provides dual-vocabulary toggling (`[🎓 STUDENT | 🏛️ WALL ST]`, shortcut: `Key U`).
   - Every financial terminal widget (Order Book, Equity Curve, Task Tree, Efficient Frontier, Margin Call) must render a collegiate subtitle overlay when Student Mode is active explaining what the financial metric translates to academically (e.g. "Order Book = Assignment Submission Queue", "Margin Call = Academic Probation Warning").
3. **React 19 & Next.js 16 Strict Rules**:
   - Strict hook ordering: NEVER call React hooks (`useState`, `useEffect`, custom hooks like `useTerminal`) conditionally or after early returns.
   - Client vs Server Components: Use `'use client'` explicitly at the top of interactive components.
4. **Multimodal Syllabus & Vision Ingest**:
   - In `frontend/src/components/SyllabusIngestModal.tsx`, visual image uploads must provide client-side preview thumbnails with visual inspection tags for Meta Llama 3.2 Vision.
5. **Testing Rigor**:
   - Every new component or state update must have unit tests in `frontend/tests/`.
   - In Vitest tests, mock `window.localStorage` with `memoryStorage()` and `vi.stubGlobal`.

## Strict Constraints
- **NO DIAGRAMS**: Do NOT produce Mermaid diagrams, ASCII box art, or graphical representations in responses, comments, or documentation.
- **NO AI ATTRIBUTION**: Never insert AI signatures, co-authored lines, or mention AI tool names in code comments or commit messages. All work is attributed to FrankieBiz <frankabisignano@gmail.com>.
- **PRESERVE INTEGRITY**: Maintain all existing comments, docstrings, and tests unless directly asked to modify them.
- **VERIFICATION**: Always ensure changes pass:
  - `cd frontend && npm run check` (runs ESLint, TypeScript `tsc`, Vitest, and Next.js production build)
