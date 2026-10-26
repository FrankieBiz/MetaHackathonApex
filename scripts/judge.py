#!/usr/bin/env python3
"""Generate evidence-based local engineering scorecards; not an official judging rubric.

Examples:
    python3 scripts/judge.py
    python3 scripts/judge.py --run-checks backend --format json
    python3 scripts/judge.py --run-checks all --fail-under 90

Only --run-checks executes project code. No API calls or credentials are needed.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import signal
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

EXCLUDED = {
    ".git",
    ".venv",
    "node_modules",
    ".next",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".qa",
    "coverage",
    "dist",
    "legacy_archive",
}
CATEGORY_MAXIMA = {
    "Meta AI Integration": 25,
    "Technical Rigor": 25,
    "Product Innovation": 20,
    "Real-World Impact": 15,
    "Demo Readiness": 15,
}
LIMITATIONS = [
    "This is a local engineering rubric, not an official hackathon score or quality guarantee.",
    "Static matches establish code evidence; they do not prove runtime behavior or model quality.",
    "Test declarations are inventory, not executed case counts or measured coverage.",
    "No live Meta, credential, browser UX or deployment checks are performed.",
    "Academic projections and financial-style metrics are not independently validated.",
]


@dataclass
class Criterion:
    id: str
    category: str
    description: str
    maximum: int
    awarded: int
    status: str
    evidence: list[str]
    note: str


@dataclass
class CommandResult:
    name: str
    argv: list[str]
    cwd: str
    status: str
    exit_code: int | None
    duration_seconds: float
    summary: str


class Sources:
    """Read allowlisted text only; never import inspected code or follow symlinks."""

    def __init__(self, root: Path):
        self.root = root
        self.text: dict[str, str] = {}
        self.trees: dict[str, ast.Module] = {}
        self.errors: list[str] = []
        for folder in ("backend", "frontend/src", "frontend/tests", "scripts"):
            base = root / folder
            if base.is_symlink():
                continue
            for directory, subdirs, files in os.walk(base, followlinks=False):
                subdirs[:] = sorted(
                    d for d in subdirs if d not in EXCLUDED and not d.startswith(".")
                )
                for filename in sorted(files):
                    path = Path(directory) / filename
                    if path.suffix in {".py", ".ts", ".tsx", ".js", ".mjs", ".toml"}:
                        self.read(path)
        for name in (
            "README.md",
            "Makefile",
            "start.sh",
            "render.yaml",
            "vercel.json",
            "frontend/package.json",
            "frontend/package-lock.json",
            "backend/requirements.txt",
            "backend/requirements-dev.txt",
            ".github/workflows/verify.yml",
        ):
            self.read(root / name)

    def read(self, path: Path) -> None:
        if path.is_symlink() or not path.is_file():
            return
        # A symlink in any ancestor can escape an otherwise allowlisted subtree.
        if not path.resolve().is_relative_to(self.root):
            return
        parts = path.relative_to(self.root).parts
        if any(
            self.root.joinpath(*parts[:i]).is_symlink() for i in range(1, len(parts))
        ):
            return
        relative = path.relative_to(self.root).as_posix()
        if any(part.startswith(".env") for part in path.relative_to(self.root).parts):
            return
        # Lockfiles establish existence without copying their large dependency graph.
        if path.name.endswith("lock.json"):
            self.text[relative] = ""
            return
        try:
            if path.stat().st_size > 2_000_000:
                self.errors.append(f"{relative}: file exceeds the 2 MB scan limit")
                return
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            self.errors.append(f"{relative}: unreadable UTF-8 source")
            return
        self.text[relative] = content
        if path.suffix == ".py":
            try:
                self.trees[relative] = ast.parse(content, filename=relative)
            except SyntaxError as exc:
                self.errors.append(f"{relative}:{exc.lineno}: invalid Python syntax")

    def matching(self, pattern: str, *, scope: str = "backend/") -> list[str]:
        result = []
        for path, content in sorted(self.text.items()):
            if not path.startswith(scope):
                continue
            if scope == "backend/" and "/tests/" in path:
                continue
            for match in re.finditer(pattern, content, re.MULTILINE):
                line = content.count("\n", 0, match.start()) + 1
                result.append(f"{path}:{line}")
        return result[:8]


def test_audit(sources: Sources) -> dict:
    python_tests = []
    vacuous = []
    for path, tree in sorted(sources.trees.items()):
        if not path.startswith("backend/tests/"):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not node.name.startswith("test_"):
                continue
            location = f"{path}:{node.lineno}"
            python_tests.append(location)
            body = list(node.body)
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
            ) and isinstance(body[0].value.value, str):
                body = body[1:]
            trivial = (
                isinstance(item, ast.Pass)
                or isinstance(item, ast.Return)
                and item.value is None
                or isinstance(item, ast.Expr)
                and isinstance(item.value, ast.Constant)
                or isinstance(item, ast.Assert)
                and isinstance(item.test, ast.Constant)
                and item.test.value is True
                for item in body
            )
            if all(trivial):
                vacuous.append(location)
    frontend_files = [
        path
        for path in sources.text
        if path.startswith("frontend/tests/")
        and re.search(r"\.(test|spec)\.[jt]sx?$", path)
    ]
    declarations = sum(
        len(
            re.findall(
                r"\b(?:it|test)(?:\.(?:each|only|skip|todo))?\s*\(", sources.text[path]
            )
        )
        for path in frontend_files
    )
    return {
        "backend_test_files": len(
            {location.split(":")[0] for location in python_tests}
        ),
        "backend_test_declarations": len(python_tests),
        "frontend_test_files": len(frontend_files),
        "frontend_test_declarations_approximate": declarations,
        "vacuous_backend_tests": vacuous,
        "note": "Parameterized declarations may execute many cases; no coverage is inferred.",
    }


def command_plan(root: Path, selection: str) -> list[tuple[str, list[str], Path]]:
    commands = []
    python = str(root / "backend/.venv/bin/python")
    if selection in {"backend", "all"}:
        commands.extend(
            [
                ("backend_tests", [python, "-m", "pytest", "backend", "-q"], root),
                (
                    "backend_lint",
                    [
                        python,
                        "-m",
                        "ruff",
                        "check",
                        "backend",
                        "scripts",
                    ],
                    root,
                ),
                (
                    "backend_format",
                    [
                        python,
                        "-m",
                        "ruff",
                        "format",
                        "--check",
                        "backend",
                        "scripts",
                    ],
                    root,
                ),
            ]
        )
    if selection in {"frontend", "all"}:
        commands.extend(
            (f"frontend_{name}", ["npm", "run", name], root / "frontend")
            for name in ("lint", "typecheck", "test", "build")
        )
    return commands


def configuration_audit(sources: Sources) -> dict:
    defaults = {}
    tree = sources.trees.get("backend/config.py", ast.Module(body=[], type_ignores=[]))
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id in {"meta_model", "meta_base_url", "llm_model"}
        ):
            if isinstance(node.value, ast.Constant) and isinstance(
                node.value.value, str
            ):
                defaults[node.target.id] = node.value.value
            elif isinstance(node.value, ast.Call):
                for kw in node.value.keywords:
                    if kw.arg == "default":
                        if isinstance(kw.value, ast.Constant) and isinstance(
                            kw.value.value, str
                        ):
                            defaults[node.target.id] = kw.value.value
                        elif (
                            isinstance(kw.value, ast.Call)
                            and kw.value.args
                            and isinstance(kw.value.args[0], ast.Constant)
                        ):
                            defaults[node.target.id] = str(kw.value.args[0].value)
                if node.target.id not in defaults and node.value.args:
                    arg0 = node.value.args[0]
                    if isinstance(arg0, ast.Constant) and isinstance(arg0.value, str):
                        defaults[node.target.id] = arg0.value
    drift = []
    readme = sources.text.get("README.md", "")
    for match in re.finditer(
        r"META_(MODEL|BASE_URL)`?\s+defaults?\s+to\s+`([^`]+)`", readme
    ):
        key = "meta_" + match[1].lower()
        if key in defaults and defaults[key] != match[2]:
            drift.append(
                f"README.md: META_{match[1]} default differs from backend/config.py"
            )
    return {
        "public_model_defaults": defaults,
        "documentation_drift": drift,
        "llama_3_2_vision": "Model IDs are configurable; live Vision inference is unverified.",
    }


def execute(name: str, argv: list[str], cwd: Path, timeout: float) -> CommandResult:
    started = time.monotonic()
    code = None
    try:
        with subprocess.Popen(
            argv,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            start_new_session=True,
        ) as process:
            try:
                output, _ = process.communicate(timeout=timeout)
                code = process.returncode
                status = "passed" if code == 0 else "failed"
                # Only extract numeric test summaries; raw output may contain private data.
                counts = re.findall(
                    r"\b\d+ (?:passed|failed|skipped|errors?)\b", output
                )
                summary = (
                    ", ".join(dict.fromkeys(counts))
                    if counts
                    else f"Exit status {code}"
                )
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate()
                status, summary = "timed_out", f"Exceeded {timeout:g} second deadline"
    except OSError:
        status, summary = "unavailable", "Executable or working directory unavailable"
    return CommandResult(
        name,
        argv,
        str(cwd),
        status,
        code,
        round(time.monotonic() - started, 3),
        summary,
    )


def score(
    sources: Sources, audit: dict, commands: list[CommandResult]
) -> list[Criterion]:
    results = []

    def add(identifier, category, description, maximum, passed, evidence, note=""):
        results.append(
            Criterion(
                identifier,
                category,
                description,
                maximum,
                maximum if passed else 0,
                "passed" if passed else "missing",
                evidence,
                note
                or (
                    "Static evidence found; runtime behavior is not established."
                    if passed
                    else "Required evidence was not found in the scanned files."
                ),
            )
        )

    def patterns(
        identifier, category, description, maximum, expressions, scope="backend/"
    ):
        hits = [sources.matching(expression, scope=scope) for expression in expressions]
        add(
            identifier,
            category,
            description,
            maximum,
            all(hits),
            list(dict.fromkeys(item for group in hits for item in group)),
        )

    technical = "Technical Rigor"
    add(
        "python_syntax",
        technical,
        "Python source parses without scan errors",
        3,
        bool(sources.trees) and not sources.errors,
        sources.errors or sorted(sources.trees)[:8],
    )
    for identifier, description, maximum, expressions, scope in (
        (
            "strict_models",
            "Strict domain validation",
            2,
            [r"class StrictModel", r"strict=True", r'extra="forbid"'],
            "backend/",
        ),
        (
            "python_lint_config",
            "Python lint rules configured",
            1,
            [r"\[tool\.ruff", r"\[tool\.ruff\.lint\]"],
            "backend/",
        ),
        (
            "frontend_checks",
            "Frontend lint and typecheck scripts",
            2,
            [r'"lint"\s*:', r'"typecheck"\s*:'],
            "frontend/package.json",
        ),
        (
            "ci_checks",
            "CI runs both test suites",
            1,
            [r"run: pytest", r"run: npm test"],
            ".github/workflows/",
        ),
        (
            "deterministic_math",
            "Reproducible simulation and weighted math",
            2,
            [r"Random\(", r"total_weight", r"marginal_impact"],
            "backend/",
        ),
    ):
        patterns(identifier, technical, description, maximum, expressions, scope)
    locks = ["frontend/package-lock.json", "backend/requirements.txt"]
    add(
        "dependency_locks",
        technical,
        "Reproducible dependency locks",
        2,
        all(path in sources.text for path in locks),
        [p for p in locks if p in sources.text],
    )
    add(
        "backend_inventory",
        technical,
        "Backend tests present",
        2,
        audit["backend_test_declarations"] > 0,
        ["backend/tests/"],
    )
    add(
        "frontend_inventory",
        technical,
        "Frontend tests present",
        2,
        audit["frontend_test_declarations_approximate"] > 0,
        ["frontend/tests/"],
    )
    add(
        "meaningful_bodies",
        technical,
        "No trivially vacuous Python tests",
        1,
        audit["backend_test_declarations"] > 0 and not audit["vacuous_backend_tests"],
        audit["vacuous_backend_tests"] or ["backend/tests/"],
        "AST audit catches empty bodies and assert True; it does not prove assertion quality.",
    )
    topics = (
        "test_canvas",
        "test_api",
        "test_telemetry",
        "test_monte_carlo",
        "test_portfolio_report",
    )
    found = [path for path in sources.trees if any(topic in path for topic in topics)]
    add(
        "workflow_tests",
        technical,
        "Core workflow regression test files",
        1,
        all(any(topic in path for path in found) for topic in topics),
        found,
    )
    for prefix, label in (("backend", "Backend"), ("frontend", "Frontend")):
        own = [command for command in commands if command.name.startswith(prefix + "_")]
        status = (
            "unverified"
            if not own
            else (
                "passed"
                if all(command.status == "passed" for command in own)
                else "failed"
            )
        )
        results.append(
            Criterion(
                f"{prefix}_verified",
                technical,
                f"{label} checks executed successfully",
                3,
                3 if status == "passed" else 0,
                status,
                [f"{c.name}: {c.status} ({c.summary})" for c in own],
                "Not executed; use --run-checks to assess."
                if not own
                else "Fresh command outcomes; static inventory does not earn these points.",
            )
        )

    meta = "Meta AI Integration"
    for identifier, description, maximum, expressions, scope in (
        (
            "meta_config",
            "Meta provider and model configuration",
            3,
            [
                r"meta_api_key\s*:",
                r"meta_base_url\s*:",
                r"meta_model\s*:",
                r"def inference_model",
                r"def inference_base_url",
            ],
            "backend/",
        ),
        (
            "provider_wiring",
            "Configured inference client wiring",
            3,
            [
                r"AsyncOpenAI\(",
                r"base_url=\w+\.inference_base_url",
                r"api_key=\w+\.inference_api_key",
            ],
            "backend/",
        ),
        (
            "validated_model_output",
            "Structured and validated model output",
            3,
            [r'response_format=\{"type": "json_object"\}', r"model_validate_json\("],
            "backend/",
        ),
        (
            "bounded_inference",
            "Inference has bounded deadlines",
            2,
            [r"asyncio\.timeout\(.*(?:llm|auditor)_timeout_seconds"],
            "backend/",
        ),
        (
            "measured_telemetry",
            "Measured latency and provider token usage",
            3,
            [r"perf_counter\(", r"response\.usage", r"completion_tokens / elapsed"],
            "backend/",
        ),
        (
            "fallback_disclosure",
            "Local model fallback is disclosed",
            2,
            [r'"local-starter-plan"', r"model_used", r"except \(APIError"],
            "backend/",
        ),
        (
            "meta_regression_tests",
            "Meta and fallback regression assertions",
            2,
            [r"meta_api_key", r'assert .*\["model"\]', r"local-starter-plan"],
            "backend/tests/",
        ),
        (
            "multimodal_ingest",
            "Image and document model ingest",
            2,
            [r"image_url", r"application/pdf", r"_syllabus_content"],
            "backend/",
        ),
        (
            "streaming",
            "Streaming inference and SSE delivery",
            1,
            [r"stream=True", r"text/event-stream"],
            "backend/",
        ),
    ):
        patterns(identifier, meta, description, maximum, expressions, scope)
    calls = [
        f"{path}:{node.lineno}"
        for path, tree in sources.trees.items()
        if path.startswith("backend/") and "/tests/" not in path
        for node in ast.walk(tree)
        if isinstance(node, ast.Await)
        and isinstance(node.value, ast.Call)
        and ast.unparse(node.value.func).endswith(".chat.completions.create")
    ]
    add(
        "awaited_inference",
        meta,
        "Awaited model completion calls",
        4,
        bool(calls),
        calls[:8],
    )

    innovation = "Product Innovation"
    for identifier, description, maximum, expressions, scope in (
        (
            "api_workflows",
            "Integrated academic execution workflows",
            5,
            [
                r'"/api/state"',
                r'"/api/decompose"',
                r'"/api/v1/simulate/monte-carlo"',
                r'"/api/v1/portfolio/report"',
            ],
            "backend/main.py",
        ),
        (
            "monte_carlo",
            "Bounded 1,000-path Monte Carlo with 90% VaR",
            6,
            [r"iterations.*= 1000", r"le=10_000", r"var_90", r"p10"],
            "backend/service.py",
        ),
        (
            "risk_ladder",
            "Computed portfolio risk stance ladder",
            4,
            [
                r"MAXIMAL_AGGRESSION",
                r"ACTIVE_PROTECTION",
                r"MAINTAIN_FLOOR",
                r"CRITICAL_INTERVENTION",
            ],
            "backend/service.py",
        ),
        (
            "grade_leverage",
            "Remaining-assignment marginal sensitivity",
            3,
            [r"sensitivity_matrix", r"marginal_impact", r"not a.graded"],
            "backend/service.py",
        ),
        (
            "terminal_visuals",
            "Interactive terminal chart and execution controls",
            2,
            [r"TrajectoryChart", r"OrderBook", r"TaskTree"],
            "frontend/src/",
        ),
    ):
        patterns(identifier, innovation, description, maximum, expressions, scope)

    impact = "Real-World Impact"
    for identifier, description, maximum, expressions, scope in (
        (
            "canvas_ingest",
            "Real Canvas LMS ingestion with fallback",
            5,
            [r"class CanvasClient", r"/api/v1/courses", r"get_mock_sandbox_data"],
            "backend/",
        ),
        (
            "syllabus_presets",
            "Named university syllabus preset workflows",
            5,
            [r"Stanford", r"MIT", r"Harvard", r"Columbia"],
            "backend/syllabus_presets.py",
        ),
        (
            "persisted_execution",
            "Persistent task progress and time logging",
            3,
            [r"record_subtask_patch", r"actual_minutes"],
            "backend/",
        ),
        (
            "unknown_grade_handling",
            "Unknown grades stay explicit in course state",
            2,
            [r"current_score:.*None", r"if self.current_score is None"],
            "backend/models.py",
        ),
    ):
        patterns(identifier, impact, description, maximum, expressions, scope)

    demo = "Demo Readiness"
    for identifier, description, expressions, scope in (
        (
            "local_start",
            "Documented local startup",
            [r"start.sh", r"60-second"],
            "README.md",
        ),
        (
            "sandbox",
            "Credential-free simulation dataset",
            [r"def get_mock_sandbox_data", r"demo_mode"],
            "backend/",
        ),
        (
            "offline_frontend",
            "Browser fallback and offline handling",
            [r"createMockState", r'simulated: true|source: "local"'],
            "frontend/src/",
        ),
    ):
        patterns(identifier, demo, description, 3, expressions, scope)
    manifests = ["render.yaml", "vercel.json"]
    add(
        "deployment_config",
        demo,
        "Backend and frontend deployment manifests",
        3,
        all(path in sources.text for path in manifests),
        [p for p in manifests if p in sources.text],
    )
    drift = configuration_audit(sources)["documentation_drift"]
    tour = sources.matching(r"RUN JUDGE DEMO TOUR|tour=1", scope="README.md")
    add(
        "demo_documentation",
        demo,
        "Demo tour and accurate model configuration docs",
        3,
        bool(tour) and not drift,
        drift or tour,
        "Compare README model defaults with backend/config.py; code is authoritative.",
    )

    return results


def build_report(root: Path, selection: str = "none", timeout: float = 300) -> dict:
    sources = Sources(root)
    audit = test_audit(sources)
    commands = [
        execute(name, argv, cwd, timeout)
        for name, argv, cwd in command_plan(root, selection)
    ]
    criteria = score(sources, audit, commands)
    categories = {
        name: {
            "earned": sum(c.awarded for c in criteria if c.category == name),
            "maximum": maximum,
        }
        for name, maximum in CATEGORY_MAXIMA.items()
    }
    failed = any(command.status != "passed" for command in commands)
    if failed:
        categories["Technical Rigor"]["raw_earned"] = categories["Technical Rigor"][
            "earned"
        ]
        categories["Technical Rigor"]["earned"] = min(
            10, categories["Technical Rigor"]["earned"]
        )
    total = sum(category["earned"] for category in categories.values())
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "repository": str(root),
        "rubric": "Requested Meta-focused hackathon rubric (official event provenance unverified)",
        "score": {
            "earned": total,
            "maximum": 100,
            "letter_grade": letter_grade(total),
            "assessed_maximum": sum(
                c.maximum for c in criteria if c.status != "unverified"
            ),
            "provisional": any(c.status == "unverified" for c in criteria),
        },
        "categories": categories,
        "criteria": [asdict(c) for c in criteria],
        "test_audit": audit,
        "scan": {
            "files": len(sources.text),
            "python_files": len(sources.trees),
            "errors": sources.errors,
        },
        "commands": [asdict(command) for command in commands],
        "live_meta_inference": "unverified; no live API call was attempted",
        "configuration_audit": configuration_audit(sources),
        "technical_cap": "Capped at 10/25 because an executed check failed or was unavailable."
        if failed
        else None,
        "next_steps": [
            f"{c.description}: {c.note}" for c in criteria if c.status != "passed"
        ],
        "limitations": LIMITATIONS,
    }
    report["grill"] = grill(report)
    report["pitch"] = pitch(report)
    return report


def letter_grade(points: float) -> str:
    return next(
        (
            grade
            for floor, grade in ((90, "A"), (80, "B"), (70, "C"), (60, "D"))
            if points >= floor
        ),
        "F",
    )


def grill(report: dict) -> list[dict]:
    criteria = {item["id"]: item for item in report["criteria"]}
    defaults = report["configuration_audit"]["public_model_defaults"]
    model = defaults.get("meta_model", "not established by configuration")
    topics = [
        (
            "awaited_inference",
            "What does Meta actually decide, rather than your deterministic code?",
            (
                "Model calls generate task plans and a portfolio memo where implemented. "
                "Ranking, grade math, simulations and risk aggregation are deterministic; "
                "static evidence is not proof of a live call."
            ),
        ),
        (
            "measured_telemetry",
            "Prove this demo actually used the Meta Model API.",
            (
                f"The configured Meta model is {model}. This audit made no live API call. "
                "Show a live model "
                "badge with actual usage and latency; a local fallback is not inference evidence."
            ),
        ),
        (
            "streaming",
            "Are those streamed stages autonomous model tool decisions?",
            (
                "SSE stages expose application orchestration and computed evidence. "
                "Do not describe deterministic stages as autonomous model reasoning; "
                "inspect the awaited streaming call separately."
            ),
        ),
        (
            "monte_carlo",
            "What validates your 90% VaR and 1,000-path projection?",
            (
                "Seeded paths and tests support reproducibility, not calibration. "
                "State the variance, independence and bounded-score assumptions; "
                "this scorecard does not independently validate predictive accuracy."
            ),
        ),
        (
            "canvas_ingest",
            "Are the grades real or a fabricated demo?",
            (
                "Distinguish live Canvas data from the labeled sandbox. "
                "Without a valid connection, show the "
                "deterministic fixtures and do not claim real student outcomes."
            ),
        ),
        (
            "syllabus_presets",
            "Do Stanford, MIT, Harvard and Columbia endorse these presets?",
            (
                "Named syllabus presets are ingestion/demo evidence, not endorsement. "
                "Demonstrate "
                "their actual source and dates before claiming real-world fidelity."
            ),
        ),
        (
            "offline_frontend",
            "What happens when the backend or model fails mid-demo?",
            (
                "Show the explicit local desk and fallback provenance, then reconnect. "
                "Source evidence exists only "
                "where cited below; this audit has not performed a browser outage rehearsal."
            ),
        ),
        (
            "grade_leverage",
            "Can a model invent a grade or guarantee an A?",
            (
                "Grade arithmetic and marginal sensitivity should come from state and weights. "
                "Unknown grades stay unknown, projections are scenarios, "
                "and an estimated GPA is not an official transcript."
            ),
        ),
        (
            "workflow_tests",
            "Which checks actually passed, and what is still untested?",
            "; ".join(
                f"{c['name']}: {c['status']} ({c['summary']})"
                for c in report["commands"]
            )
            or "No checks were executed; inventory cannot prove test success or coverage.",
        ),
        (
            "demo_documentation",
            "What is your weakest evidence gap before judging?",
            " | ".join(report["next_steps"][:3])
            or "Live inference, user impact and timed rehearsal remain outside this rubric.",
        ),
    ]
    return [
        {
            "question": question,
            "model_answer": answer,
            "evidence_status": criteria[key]["status"],
            "evidence": criteria[key]["evidence"],
            "deduction": criteria[key]["maximum"] - criteria[key]["awarded"],
        }
        for key, question, answer in topics
    ]


def pitch(report: dict) -> list[dict]:
    criteria = {item["id"]: item for item in report["criteria"]}
    beats = [
        (
            0,
            20,
            "Problem and stakes",
            "Show course targets and the grade buffer; describe the student's next decision.",
            "api_workflows",
        ),
        (
            20,
            45,
            "Ingest the work",
            "Load a named syllabus preset or sandbox; label the data source.",
            "syllabus_presets",
        ),
        (
            45,
            80,
            "Meta task decomposition",
            "Triage one assignment, show streamed stages, model provenance and measured latency.",
            "awaited_inference",
        ),
        (
            80,
            110,
            "Model the risk",
            "Move one score shock; explain final-grade percentiles, 90% VaR and marginal impact.",
            "monte_carlo",
        ),
        (
            110,
            135,
            "Execute a task",
            "Complete a leaf, log time and show persistent progress against the target.",
            "persisted_execution",
        ),
        (
            135,
            155,
            "Resilience",
            "Switch to the local desk and demonstrate the next action without the backend.",
            "offline_frontend",
        ),
        (
            155,
            180,
            "Evidence and close",
            "State test results, remaining assumptions and the next user validation.",
            "workflow_tests",
        ),
    ]
    return [
        {
            "start_seconds": start,
            "end_seconds": end,
            "title": title,
            "action": action
            if criteria[key]["status"] == "passed"
            else "Evidence missing: present this beat as planned work, not a verified capability.",
            "fallback": "Use the labeled local desk or source evidence; disclose failures.",
            "evidence": criteria[key]["evidence"],
        }
        for start, end, title, action, key in beats
    ]


def terminal(report: dict, *, color: bool = False) -> str:
    def paint(text, code):
        return f"\033[{code}m{text}\033[0m" if color else text

    scorecard = report["score"]
    lines = [
        paint("APEX / HACKATHON JUDGE", "1;36"),
        report["rubric"],
        "",
        paint(f"GRADE {scorecard['letter_grade']}   {scorecard['earned']}/100", "1;32"),
        "PROVISIONAL — unexecuted checks earn no pass credit."
        if scorecard["provisional"]
        else "All rubric criteria assessed; live inference and user impact remain unverified.",
        "",
    ]
    for name, category in report["categories"].items():
        filled = round(20 * category["earned"] / category["maximum"])
        bar = "█" * filled + "░" * (20 - filled)
        code = "32" if filled >= 16 else "33" if filled >= 12 else "31"
        lines.append(
            f"{name:22} {paint(bar, code)} {category['earned']:2}/{category['maximum']}"
        )
    if report["technical_cap"]:
        lines.extend(["", paint(report["technical_cap"], "31")])
    lines.extend(["", "NEXT EVIDENCE GAPS"])
    lines.extend(
        f"  • {item}"
        for item in report["next_steps"][:3] or ["No rubric evidence gaps found."]
    )
    lines.extend(
        [
            "",
            "Live Meta call: UNVERIFIED",
            "Use --markdown for evidence, --grill for Q&A, --pitch for the 180-second rehearsal.",
        ]
    )
    return "\n".join(lines) + "\n"


def markdown(report: dict) -> str:
    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ")

    scorecard = report["score"]
    lines = [
        "# Apex engineering judge scorecard",
        "",
        report["rubric"],
        "",
        f"Generated: {report['generated_at']}",
        "",
        (
            f"**Score: {scorecard['earned']}/{scorecard['maximum']}** "
            f"({'provisional' if scorecard['provisional'] else 'all rubric criteria assessed'}; "
            f"{scorecard['assessed_maximum']} points assessed)."
        ),
        "",
        "## Category scores",
        "",
        "| Category | Earned | Maximum |",
        "| --- | ---: | ---: |",
    ]
    lines.extend(
        f"| {name} | {value['earned']} | {value['maximum']} |"
        for name, value in report["categories"].items()
    )
    lines.extend(
        [
            "",
            "## Evidence",
            "",
            "| Criterion | Status | Points | Evidence |",
            "| --- | --- | ---: | --- |",
        ]
    )
    for criterion in report["criteria"]:
        evidence = "; ".join(criterion["evidence"]) or criterion["note"]
        lines.append(
            f"| {cell(criterion['description'])} | {criterion['status']} | "
            f"{criterion['awarded']}/{criterion['maximum']} | {cell(evidence)} |"
        )
    audit = report["test_audit"]
    lines.extend(
        [
            "",
            "## Test audit",
            "",
            (
                f"- Backend: {audit['backend_test_declarations']} test declarations "
                f"in {audit['backend_test_files']} files."
            ),
            (
                f"- Frontend: approximately {audit['frontend_test_declarations_approximate']} "
                f"declarations in {audit['frontend_test_files']} files."
            ),
            f"- Vacuous backend tests: {len(audit['vacuous_backend_tests'])}.",
            f"- {audit['note']}",
            "",
            "## Executed checks",
            "",
        ]
    )
    if not report["commands"]:
        lines.append("No checks executed. Test-pass points remain unverified.")
    for command in report["commands"]:
        lines.append(
            f"- **{command['name']}**: {command['status']} — {command['summary']} "
            f"({command['duration_seconds']}s); `{cell(' '.join(command['argv']))}`"
        )
    lines.extend(["", "## Next steps", ""])
    lines.extend(
        f"- {item}"
        for item in report["next_steps"] or ["No rubric evidence gaps found."]
    )
    lines.extend(["", "## Limits of this assessment", ""])
    lines.extend(f"- {item}" for item in report["limitations"])
    lines.append(f"- Live Meta inference: {report['live_meta_inference']}.")
    if report["technical_cap"]:
        lines.append(f"- Technical rigor: {report['technical_cap']}")
    lines.extend(["", "## Adversarial judge questions", ""])
    for index, item in enumerate(report["grill"], 1):
        lines.extend(
            [f"{index}. **{item['question']}**", "", f"   {item['model_answer']}", ""]
        )
    lines.extend(["## 180-second pitch choreography", ""])
    for beat in report["pitch"]:
        lines.extend(
            [
                (
                    f"- **{beat['start_seconds']}–{beat['end_seconds']}s: {beat['title']}**. "
                    f"{beat['action']} Fallback: {beat['fallback']}"
                )
            ]
        )
    return "\n".join(lines) + "\n"


def repository_root(script: Path) -> Path:
    return next(
        (
            parent
            for parent in script.resolve().parents
            if (parent / "backend").is_dir() and (parent / "frontend").is_dir()
        ),
        Path.cwd(),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--root", type=Path, default=repository_root(Path(__file__)))
    parser.add_argument("--output-dir", type=Path, default=Path(".qa/judge"))
    parser.add_argument(
        "--run-checks", choices=("none", "backend", "frontend", "all"), default="none"
    )
    parser.add_argument(
        "--timeout", type=float, default=300, help="Per-command deadline in seconds"
    )
    parser.add_argument(
        "--fail-under", type=float, default=0, help="Exit 1 below this score (0-100)"
    )
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument(
        "--format",
        choices=("text", "json", "markdown", "grill", "pitch"),
        default="text",
    )
    for mode in ("json", "markdown", "grill", "pitch"):
        modes.add_argument(f"--{mode}", dest="format", action="store_const", const=mode)
    parser.add_argument(
        "--no-color", action="store_true", help="Disable terminal ANSI colors"
    )
    args = parser.parse_args(argv)
    root = args.root.resolve()
    if not (root / "backend").is_dir() or not (root / "frontend").is_dir():
        parser.error("--root must contain backend/ and frontend/ directories")
    if not 0 < args.timeout <= 3600 or not 0 <= args.fail_under <= 100:
        parser.error("--timeout must be in (0, 3600] and --fail-under in [0, 100]")
    report = build_report(root, args.run_checks, args.timeout)
    output = (
        args.output_dir if args.output_dir.is_absolute() else root / args.output_dir
    )
    encoded = json.dumps(report, indent=2, allow_nan=False) + "\n"
    rendered = markdown(report)
    try:
        output.mkdir(parents=True, exist_ok=True)
        (output / "scorecard.json").write_text(encoded, encoding="utf-8")
        (output / "scorecard.md").write_text(rendered, encoding="utf-8")
    except OSError:
        parser.error("Cannot write scorecard output directory")
    if args.format == "json":
        print(encoded, end="")
    elif args.format == "markdown":
        print(rendered, end="")
    elif args.format == "grill":
        print("# Top 10 adversarial judge questions\n")
        for index, item in enumerate(report["grill"], 1):
            print(
                f"{index}. {item['question']}\n   Answer: {item['model_answer']}\n"
                f"   Evidence: {item['evidence_status']} — "
                f"{' ; '.join(item['evidence']) or 'unverified'}\n"
            )
    elif args.format == "pitch":
        print("# 180-second pitch choreography\n")
        for beat in report["pitch"]:
            print(
                f"{beat['start_seconds']:3}–{beat['end_seconds']:3}s / {beat['title']}\n"
                f"  {beat['action']}\n  Fallback: {beat['fallback']}\n"
            )
    else:
        print(
            terminal(
                report,
                color=not args.no_color
                and sys.stdout.isatty()
                and "NO_COLOR" not in os.environ,
            ),
            end="",
        )
        print(f"Markdown: {output / 'scorecard.md'}")
        print(f"JSON: {output / 'scorecard.json'}")
    failed_checks = any(command["status"] != "passed" for command in report["commands"])
    return int(failed_checks or report["score"]["earned"] < args.fail_under)


if __name__ == "__main__":
    sys.exit(main())
