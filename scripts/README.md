# Hackathon judge

Run the dependency-free judging CLI from any directory:

```bash
python3 scripts/judge.py
python3 scripts/judge.py --json
python3 scripts/judge.py --markdown
python3 scripts/judge.py --grill
python3 scripts/judge.py --pitch
```

The terminal scorecard includes a letter grade, five pillar scores, and the
largest evidence gaps. Colors appear in an interactive terminal; `--no-color`
and `NO_COLOR` disable them. Every mode also writes complete JSON and Markdown
scorecards to `.qa/judge/`, including evidence, test inventory, command outcomes,
ten adversarial questions with suggested answers, and a 180-second pitch.

The requested 100-point rubric weights Meta AI Integration (25), Technical
Rigor (25), Product Innovation (20), Real-World Impact (15), and Demo Readiness
(15). Its official event provenance has not been independently established.
Scores measure the listed engineering evidence; they are not a prediction of
judges' decisions, user adoption, competitive novelty, or live model quality.

Static scans do not execute repository code or contact any API. They parse
Python, inventory pytest and Vitest declarations, inspect configured model calls,
multimodal and streaming paths, check simulation/risk workflows, and flag model
configuration documentation drift. Credentials, dependencies, symlinks, build
output, and archived code are excluded. Raw command output is not included in
reports; only exit status and numeric test summaries are retained.

Run the actual project checks when ready:

```bash
python3 scripts/judge.py --run-checks backend
python3 scripts/judge.py --run-checks frontend
python3 scripts/judge.py --run-checks all --fail-under 90
```

Backend checks use `backend/.venv/bin/python` for pytest and Ruff, including
the script itself. Frontend checks run lint, typecheck, Vitest, and the production
build. Install the existing project dependencies first. Commands have a
300-second deadline each; `--timeout` changes it. A failed, missing, or timed-out
check returns exit code 1 and caps Technical Rigor at 10/25. Unexecuted checks
earn no test-pass points and keep the score provisional. Test declarations are
not executed case counts or measured coverage. Live Meta inference, predictive
calibration, user outcomes, browser polish, and deployed availability remain
unverified even when every local check passes.

Use `--root PATH` to inspect a checkout containing `backend/` and `frontend/`,
and `--output-dir PATH` to change artifact placement. Relative output paths are
resolved against the inspected checkout. `--fail-under` returns exit code 1
below the selected score. Invalid arguments or unwritable output return 2.

The skill's bundled script at
`.agents/skills/hackathon-judge/scripts/judge.py` is a standalone copy; it finds
the enclosing checkout automatically. Update that copy when changing the root
script. Tests live in `backend/tests/test_judge_script.py`.
