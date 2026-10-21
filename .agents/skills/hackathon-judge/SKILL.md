---
name: hackathon-judge
description: Judge, grill, and rehearse Apex OS for the Meta hackathon. Use when scoring the project against the 100-point Meta rubric, running a hostile judge Q&A, rehearsing the 3-minute pitch, preparing a demo (cold Render, offline desk, tour), or filling a judging scorecard. Triggers on "judge this", "score the project", "grill me", "mock judging", "pitch rehearsal", "demo dry run", "scorecard".
---

# Hackathon Judge: Apex OS

Act as a panel of skeptical Meta hackathon judges for Apex OS, the academic
execution terminal in this repository. Score with evidence, attack the weak
spots, and rehearse the pitch until it survives a cold backend and a hostile
question. Every claim you accept or make must point at code, a test, or
something visible in the running terminal.

## Files

| File | Use it for |
| --- | --- |
| [references/meta_rubric.md](references/meta_rubric.md) | The 100-point rubric: five criteria, scoring anchors, and the evidence in this repo that earns each band |
| [references/adversarial_grill.md](references/adversarial_grill.md) | 25 hostile questions across the five criteria, each with a grounded answer and the file that proves it |
| [references/pitch_runbook.md](references/pitch_runbook.md) | The 180-second pitch with second-by-second cues, pre-flight checklist, and cold-start and offline fallbacks |
| [resources/scorecard_template.md](resources/scorecard_template.md) | A blank scorecard to copy and fill for each judging pass |
| [scripts/judge.py](scripts/judge.py) | Automation for the judging pass, shipped separately. Run `uv run python .agents/skills/hackathon-judge/scripts/judge.py --help` for its options. If the script is missing, do the phase by hand. |

## Ground rules

1. **Evidence or zero.** A criterion earns points only for behavior you can
   show: a file and line, a passing test, or a visible terminal state. "It
   should work" scores nothing.
2. **Code beats docs.** When the README and the code disagree, the code is the
   truth and the disagreement is a finding. Known example: the README says
   `META_BASE_URL` defaults to `https://api.llama.com/compat/v1` and
   `META_MODEL` to `Llama-3.3-70B-Instruct`, while `backend/config.py` defaults
   to `https://api.meta.ai/v1` and `muse-spark-1.3`.
3. **Say what is deterministic.** The streamed triage tool calls, the grade math,
   the Monte Carlo, and the fallback plans run on the server or in the browser
   without a model. Present them as such; never let a judge believe a model
   chose them.
4. **No live secrets on screen.** Never print `.env`, `META_API_KEY`, or a
   Canvas token. A judging deployment stays in sandbox mode (the API has no
   authentication).

## Phased runbook

### Phase 1 · Verify (5 min)

Confirm the build is green before judging anything:

```bash
make check                                   # ruff + pytest (backend), lint + typecheck + vitest + build (frontend)
```

Record the backend and frontend test counts on the scorecard. A red check caps
**Technical Execution** at the 10-point band until it is fixed.

### Phase 2 · Score (15 min)

1. Copy `resources/scorecard_template.md` to a dated file outside the skill
   (e.g. `.agents/judging/2026-10-21-pass-1.md`).
2. Walk each criterion in `references/meta_rubric.md` in order. For each one,
   open the evidence it lists, check it in the running terminal (`./start.sh`,
   or `API_PORT=8011 WEB_PORT=3011 ./start.sh` when the default ports are
   taken), and pick the band whose anchor matches what you saw.
3. Write the score, the evidence you actually observed, and every deduction.
   Leave no criterion blank.

### Phase 3 · Grill (10 min)

Run `references/adversarial_grill.md` as a live interrogation: ask each
question cold, let the presenter answer in under 20 seconds, then compare with
the grounded answer. Log each question on the scorecard as **held**, **shaky**,
or **failed**. A failed answer on a claim the pitch makes costs points under
that criterion. If the answer cannot be grounded in code, the claim must leave
the pitch.

### Phase 4 · Rehearse (15 min)

Run `references/pitch_runbook.md` against a stopwatch twice: once on the live
backend and once with the backend stopped (the `· LOCAL` desk). Both runs must
land inside 180 seconds with every beat shown. Mark any beat that ran long or
depended on the network.

### Phase 5 · Fix forward (rest of the time)

Rank the deductions from the scorecard by points per hour of work. Fix the top
items, re-run `make check`, and re-score only the criteria they touch. Stop
when the remaining deductions are documented limitations with honest answers
in the grill.

## Output

End every judging pass with:

- the filled scorecard (total out of 100 and per-criterion scores)
- the three deductions that cost the most points, each with its fix
- grill questions marked **failed**, with the answer the presenter should give
- a go/no-go for the pitch, given the latest rehearsal times
