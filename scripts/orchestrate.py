#!/usr/bin/env python3
"""Apex OS — Industrial Multi-Model Orchestration Engine.

Orchestration Hub for Antigravity (Master Orchestrator) to delegate heavy
engineering, quantitative math, frontend ergonomics, and batch extraction
to mandated frontier worker models:
  - OpenAI / Codex (gpt-6.1-sol / gpt-6-astra): Deep backend & quantitative math
  - Anthropic / Claude (claude-sonnet-5.5 / claude-opus-5-5): Frontend terminal UX
  - DeepSeek (deepseek-v4.1-flash): Batch syllabus/rubric parsing & fuzzing
  - Orca Orchestration Runtime: Supervisor multi-tab worker lifecycle

Zero AI attribution. Strictly no diagrams.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# Workspace Root
REPO_ROOT = Path(__file__).resolve().parent.parent
QA_DIR = REPO_ROOT / ".qa" / "orchestration"
RUNS_DIR = QA_DIR / "runs"
LEDGER_FILE = QA_DIR / "token_ledger.json"

# Mandated Frontier Model Defaults
DEFAULT_CODEX_MODEL = "gpt-6.1-sol"
DEFAULT_CLAUDE_MODEL = "sonnet"  # Aliases to claude-sonnet-5.5
DEFAULT_DEEPSEEK_MODEL = "deepseek-chat"  # Maps to latest deepseek-flash

# Prohibited Legacy Tiers (Strict Rule Enforcer)
PROHIBITED_MODELS = {
    "claude-3-5",
    "claude-3.5",
    "claude-3-7",
    "claude-3.7",
    "gpt-4",
    "gpt-4o",
    "gpt-4-turbo",
    "gpt-3.5",
}


@dataclass
class TokenUsage:
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0


@dataclass
class TaskResult:
    run_id: str
    agent: str
    model: str
    task: str
    success: bool
    exit_code: int
    duration_s: float
    output: str
    tokens: TokenUsage = field(default_factory=TokenUsage)
    files_changed: list[str] = field(default_factory=list)
    verification_passed: bool | None = None
    verification_output: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())


def ensure_dirs() -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    if not LEDGER_FILE.exists():
        initial_ledger = {
            "version": "1.0",
            "last_updated": datetime.now(UTC).isoformat(),
            "totals_by_agent": {
                "codex": {
                    "runs": 0,
                    "input_tokens": 0,
                    "cached_tokens": 0,
                    "output_tokens": 0,
                    "reasoning_tokens": 0,
                    "total_tokens": 0,
                    "cost_usd": 0.0,
                },
                "claude": {
                    "runs": 0,
                    "input_tokens": 0,
                    "cached_tokens": 0,
                    "output_tokens": 0,
                    "reasoning_tokens": 0,
                    "total_tokens": 0,
                    "cost_usd": 0.0,
                },
                "deepseek": {
                    "runs": 0,
                    "input_tokens": 0,
                    "cached_tokens": 0,
                    "output_tokens": 0,
                    "reasoning_tokens": 0,
                    "total_tokens": 0,
                    "cost_usd": 0.0,
                },
            },
            "recent_runs": [],
        }
        with open(LEDGER_FILE, "w", encoding="utf-8") as f:
            json.dump(initial_ledger, f, indent=2)


def get_git_modified_files() -> list[str]:
    try:
        res = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(REPO_ROOT),
            check=False,
            capture_output=True,
            text=True,
        )
        files = []
        for line in res.stdout.splitlines():
            line = line.strip()
            if line:
                parts = line.split(maxsplit=1)
                if len(parts) == 2:
                    files.append(parts[1])
        return sorted(files)
    except (subprocess.SubprocessError, OSError):
        return []


def update_ledger(result: TaskResult) -> None:
    ensure_dirs()
    try:
        with open(LEDGER_FILE, encoding="utf-8") as f:
            ledger = json.load(f)

        agent_key = result.agent.lower()
        if agent_key not in ledger["totals_by_agent"]:
            ledger["totals_by_agent"][agent_key] = {
                "runs": 0,
                "input_tokens": 0,
                "cached_tokens": 0,
                "output_tokens": 0,
                "reasoning_tokens": 0,
                "total_tokens": 0,
                "cost_usd": 0.0,
            }

        stats = ledger["totals_by_agent"][agent_key]
        stats["runs"] += 1
        stats["input_tokens"] += result.tokens.input_tokens
        stats["cached_tokens"] += result.tokens.cached_tokens
        stats["output_tokens"] += result.tokens.output_tokens
        stats["reasoning_tokens"] += result.tokens.reasoning_tokens
        stats["total_tokens"] += result.tokens.total_tokens
        stats["cost_usd"] = round(stats["cost_usd"] + result.tokens.cost_usd, 6)

        ledger["last_updated"] = datetime.now(UTC).isoformat()
        ledger["recent_runs"].insert(
            0,
            {
                "run_id": result.run_id,
                "agent": result.agent,
                "model": result.model,
                "task": (
                    result.task[:120] + "..." if len(result.task) > 120 else result.task
                ),
                "success": result.success,
                "total_tokens": result.tokens.total_tokens,
                "duration_s": result.duration_s,
                "created_at": result.created_at,
            },
        )
        ledger["recent_runs"] = ledger["recent_runs"][:50]

        with open(LEDGER_FILE, "w", encoding="utf-8") as f:
            json.dump(ledger, f, indent=2)

        # Save individual run receipt
        run_file = (
            RUNS_DIR / f"{result.created_at[:10]}_{result.run_id}_{result.agent}.json"
        )
        with open(run_file, "w", encoding="utf-8") as f:
            json.dump(asdict(result), f, indent=2)
    except (OSError, json.JSONDecodeError, KeyError) as e:
        sys.stderr.write(f"Warning: Failed to update orchestration ledger: {e}\n")


def run_verification() -> tuple[bool, str]:
    """Run make check verification suite."""
    try:
        proc = subprocess.run(
            ["make", "check"],
            cwd=str(REPO_ROOT),
            check=False,
            capture_output=True,
            text=True,
            timeout=600,
        )
        return proc.returncode == 0, proc.stdout + proc.stderr
    except (subprocess.SubprocessError, OSError) as e:
        return False, str(e)


def validate_frontier_model(model_name: str) -> None:
    low = model_name.lower()
    for prohibited in PROHIBITED_MODELS:
        if prohibited in low:
            raise ValueError(
                f"Model '{model_name}' violates the strict frontier tier rule. "
                f"Prohibited tier: {prohibited}. "
                "Use only gpt-6.1-sol, claude-sonnet-5.5, or deepseek-v4.1-flash."
            )


# -----------------------------------------------------------------------------
# 1. Codex Worker Dispatcher (Backend Engineering & Financial Math)
# -----------------------------------------------------------------------------
def dispatch_codex(
    task: str,
    files: list[str] | None = None,
    model: str = DEFAULT_CODEX_MODEL,
    effort: str = "high",
    verify: bool = False,
    timeout_s: int = 600,
) -> TaskResult:
    """Dispatch a backend or quantitative task to Codex (gpt-6.1-sol)."""
    validate_frontier_model(model)
    run_id = f"codex_{int(time.time())}"
    start_time = time.time()

    codex_bin = shutil.which("codex") or str(Path.home() / ".local" / "bin" / "codex")
    if not Path(codex_bin).exists():
        raise FileNotFoundError(f"Codex executable not found at '{codex_bin}'")

    file_context = ""
    if files:
        file_context = "\nTarget Files:\n" + "\n".join(f"- {f}" for f in files) + "\n"

    full_prompt = (
        "You are the Apex OS Backend Engineer (Codex). Adhere strictly to CODEX.md.\n"
        "Strictly NO diagrams (no Mermaid, no ASCII box art). Strict Pydantic v2 & types.\n"
        f"{file_context}\n"
        f"TASK:\n{task}"
    )

    before_files = set(get_git_modified_files())

    cmd = [
        codex_bin,
        "exec",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "-m",
        model,
        "-C",
        str(REPO_ROOT),
        full_prompt,
    ]

    tokens = TokenUsage()
    output_lines: list[str] = []
    final_message: list[str] = []
    success = False
    exit_code = 1

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(REPO_ROOT),
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            line_str = line.strip()
            if not line_str:
                continue
            output_lines.append(line_str)
            try:
                event = json.loads(line_str)
                event_type = event.get("type")
                if event_type == "turn.completed":
                    usage = event.get("usage", {})
                    tokens.input_tokens = usage.get("input_tokens", 0)
                    tokens.cached_tokens = usage.get("cached_input_tokens", 0)
                    tokens.output_tokens = usage.get("output_tokens", 0)
                    tokens.reasoning_tokens = usage.get("reasoning_output_tokens", 0)
                    tokens.total_tokens = tokens.input_tokens + tokens.output_tokens
                elif event_type == "item.completed":
                    item = event.get("item", {})
                    if item.get("type") == "agent_message":
                        final_message.append(item.get("text", ""))
            except json.JSONDecodeError:
                pass

        proc.wait(timeout=timeout_s)
        exit_code = proc.returncode
        success = exit_code == 0
    except (subprocess.SubprocessError, OSError) as e:
        final_message.append(f"Execution failed: {e}")

    duration = round(time.time() - start_time, 2)
    after_files = set(get_git_modified_files())
    changed = sorted(after_files - before_files)

    ver_passed = None
    ver_out = None
    if verify and success:
        ver_passed, ver_out = run_verification()

    res = TaskResult(
        run_id=run_id,
        agent="codex",
        model=model,
        task=task,
        success=success,
        exit_code=exit_code,
        duration_s=duration,
        output="\n".join(final_message) or "\n".join(output_lines[-10:]),
        tokens=tokens,
        files_changed=changed,
        verification_passed=ver_passed,
        verification_output=ver_out,
    )
    update_ledger(res)
    return res


# -----------------------------------------------------------------------------
# 2. Claude Worker Dispatcher (Frontend Terminal Ergonomics)
# -----------------------------------------------------------------------------
def dispatch_claude(
    task: str,
    files: list[str] | None = None,
    model: str = DEFAULT_CLAUDE_MODEL,
    effort: str = "high",
    verify: bool = False,
    timeout_s: int = 600,
) -> TaskResult:
    """Dispatch a frontend or UX task to Claude (claude-sonnet-5.5 / claude-opus-5-5)."""
    validate_frontier_model(model)
    run_id = f"claude_{int(time.time())}"
    start_time = time.time()

    claude_bin = shutil.which("claude") or str(
        Path.home() / ".local" / "bin" / "claude"
    )
    if not Path(claude_bin).exists():
        raise FileNotFoundError(f"Claude executable not found at '{claude_bin}'")

    file_context = ""
    if files:
        file_context = "\nTarget Files:\n" + "\n".join(f"- {f}" for f in files) + "\n"

    full_prompt = (
        "You are the Apex OS Frontend Principal Terminal Architect (Claude).\n"
        "Adhere strictly to CLAUDE.md.\n"
        "Strictly NO diagrams (no Mermaid, no ASCII box art). Adhere to React 19 hook rules.\n"
        f"{file_context}\n"
        f"TASK:\n{task}"
    )

    before_files = set(get_git_modified_files())

    cmd = [
        claude_bin,
        "-p",
        full_prompt,
        "--dangerously-skip-permissions",
        "--output-format",
        "json",
        "--model",
        model,
    ]

    tokens = TokenUsage()
    output_text = ""
    actual_model = model
    success = False
    exit_code = 1

    try:
        proc = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            cwd=str(REPO_ROOT),
            timeout=timeout_s,
        )
        exit_code = proc.returncode
        if proc.stdout.strip():
            try:
                data = json.loads(proc.stdout)
                output_text = data.get("result", "")
                success = not data.get("is_error", False) and exit_code == 0
                tokens.cost_usd = float(data.get("total_cost_usd", 0.0))

                usage = data.get("usage", {})
                tokens.input_tokens = usage.get("input_tokens", 0)
                tokens.cached_tokens = usage.get(
                    "cache_read_input_tokens", 0
                ) + usage.get("cache_creation_input_tokens", 0)
                tokens.output_tokens = usage.get("output_tokens", 0)
                tokens.reasoning_tokens = usage.get("output_tokens_details", {}).get(
                    "thinking_tokens", 0
                )
                tokens.total_tokens = tokens.input_tokens + tokens.output_tokens

                model_usage = data.get("modelUsage", {})
                if model_usage:
                    actual_model = next(iter(model_usage.keys()))
            except json.JSONDecodeError:
                output_text = proc.stdout
                success = exit_code == 0
        else:
            output_text = proc.stderr
    except (subprocess.SubprocessError, OSError) as e:
        output_text = f"Execution failed: {e}"

    duration = round(time.time() - start_time, 2)
    after_files = set(get_git_modified_files())
    changed = sorted(after_files - before_files)

    ver_passed = None
    ver_out = None
    if verify and success:
        ver_passed, ver_out = run_verification()

    res = TaskResult(
        run_id=run_id,
        agent="claude",
        model=actual_model,
        task=task,
        success=success,
        exit_code=exit_code,
        duration_s=duration,
        output=output_text,
        tokens=tokens,
        files_changed=changed,
        verification_passed=ver_passed,
        verification_output=ver_out,
    )
    update_ledger(res)
    return res


# -----------------------------------------------------------------------------
# 3. DeepSeek Worker Dispatcher (Batch Extraction, Rubric Parsing & Fuzzing)
# -----------------------------------------------------------------------------
def dispatch_deepseek(
    prompt: str,
    system_prompt: str | None = None,
    json_mode: bool = False,
    model: str = DEFAULT_DEEPSEEK_MODEL,
    timeout_s: int = 60,
) -> TaskResult:
    """Dispatch a high-throughput extraction or audit pass to DeepSeek."""
    run_id = f"deepseek_{int(time.time())}"
    start_time = time.time()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise ValueError("DEEPSEEK_API_KEY environment variable is missing or empty.")

    if json_mode:
        default_sys = (
            "You are the Apex OS Extraction & Fuzzing Engine (DeepSeek). "
            "Output must be valid JSON format. Strictly NO diagrams. Zero AI attribution."
        )
    else:
        default_sys = (
            "You are the Apex OS Extraction & Fuzzing Engine (DeepSeek). "
            "Strictly NO diagrams. Zero AI attribution."
        )

    sys_text = system_prompt or default_sys

    messages = [
        {"role": "system", "content": sys_text},
        {"role": "user", "content": prompt},
    ]

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    tokens = TokenUsage()
    output_text = ""
    actual_model = model
    success = False
    exit_code = 1

    try:
        req = urllib.request.Request(
            "https://api.deepseek.com/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            actual_model = data.get("model", model)
            output_text = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            tokens.input_tokens = usage.get("prompt_tokens", 0)
            tokens.output_tokens = usage.get("completion_tokens", 0)
            tokens.total_tokens = usage.get("total_tokens", 0)
            tokens.cached_tokens = usage.get("prompt_tokens_details", {}).get(
                "cached_tokens", 0
            )
            # DeepSeek V3/Flash cost: ~$0.14 per 1M input, $0.28 per 1M output
            tokens.cost_usd = round(
                (tokens.input_tokens * 0.14 + tokens.output_tokens * 0.28) / 1_000_000,
                6,
            )
            success = True
            exit_code = 0
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8")
        except (OSError, UnicodeDecodeError):
            err_body = str(e)
        output_text = f"DeepSeek HTTP Error {e.code}: {err_body}"
    except (urllib.error.URLError, json.JSONDecodeError, KeyError) as e:
        output_text = f"DeepSeek request error: {e}"

    duration = round(time.time() - start_time, 2)
    res = TaskResult(
        run_id=run_id,
        agent="deepseek",
        model=actual_model,
        task=prompt[:200],
        success=success,
        exit_code=exit_code,
        duration_s=duration,
        output=output_text,
        tokens=tokens,
        files_changed=[],
    )
    update_ledger(res)
    return res


# -----------------------------------------------------------------------------
# 4. Orchestration Diagnostic Probe
# -----------------------------------------------------------------------------
def run_probe() -> dict[str, Any]:
    """Test access, versions, and latency to all mandated models and Orca."""
    probe_results: dict[str, Any] = {}

    print("================================================================")
    print(" APEX OS — MULTI-MODEL ORCHESTRATION DIAGNOSTIC PROBE")
    print("================================================================")

    # 1. Probe Codex (gpt-6.1-sol)
    print("\n[1/4] Probing OpenAI / Codex (gpt-6.1-sol)...")
    try:
        t0 = time.time()
        codex_res = dispatch_codex(
            task=(
                'Respond with exact JSON: {"status": "ok", "agent": "codex", "tier": "gpt-6.1-sol"}'
            ),
            model="gpt-6.1-sol",
            timeout_s=30,
        )
        latency = round(time.time() - t0, 2)
        probe_results["codex"] = {
            "status": "PASS" if codex_res.success else "FAIL",
            "model": codex_res.model,
            "latency_s": latency,
            "tokens": asdict(codex_res.tokens),
            "output_preview": codex_res.output[:120].strip(),
        }
        print(
            f"  ✓ Codex Online: model={codex_res.model}, "
            f"latency={latency}s, tokens={codex_res.tokens.total_tokens}"
        )
    except (subprocess.SubprocessError, OSError, ValueError) as e:
        probe_results["codex"] = {"status": "FAIL", "error": str(e)}
        print(f"  ✗ Codex Failed: {e}")

    # 2. Probe Claude (claude-sonnet-5.5)
    print("\n[2/4] Probing Anthropic / Claude (claude-sonnet-5.5)...")
    try:
        t0 = time.time()
        claude_res = dispatch_claude(
            task="Respond with exact text: Claude connection OK",
            model="sonnet",
            timeout_s=30,
        )
        latency = round(time.time() - t0, 2)
        probe_results["claude"] = {
            "status": "PASS" if claude_res.success else "FAIL",
            "model": claude_res.model,
            "latency_s": latency,
            "tokens": asdict(claude_res.tokens),
            "cost_usd": claude_res.tokens.cost_usd,
            "output_preview": claude_res.output[:120].strip(),
        }
        print(
            f"  ✓ Claude Online: model={claude_res.model}, "
            f"latency={latency}s, tokens={claude_res.tokens.total_tokens}, "
            f"cost=${claude_res.tokens.cost_usd:.4f}"
        )
    except (subprocess.SubprocessError, OSError, ValueError) as e:
        probe_results["claude"] = {"status": "FAIL", "error": str(e)}
        print(f"  ✗ Claude Failed: {e}")

    # 3. Probe DeepSeek (deepseek-v4.1-flash)
    print("\n[3/4] Probing DeepSeek (deepseek-v4.1-flash)...")
    try:
        t0 = time.time()
        deepseek_res = dispatch_deepseek(
            prompt='Respond in JSON: {"status": "ok", "agent": "deepseek", "tier": "flash"}',
            json_mode=True,
            timeout_s=15,
        )
        latency = round(time.time() - t0, 2)
        probe_results["deepseek"] = {
            "status": "PASS" if deepseek_res.success else "FAIL",
            "model": deepseek_res.model,
            "latency_s": latency,
            "tokens": asdict(deepseek_res.tokens),
            "output_preview": deepseek_res.output[:120].strip(),
        }
        print(
            f"  ✓ DeepSeek Online: model={deepseek_res.model}, "
            f"latency={latency}s, tokens={deepseek_res.tokens.total_tokens}"
        )
    except (urllib.error.URLError, ValueError) as e:
        probe_results["deepseek"] = {"status": "FAIL", "error": str(e)}
        print(f"  ✗ DeepSeek Failed: {e}")

    # 4. Probe Orca Orchestration Runtime
    print("\n[4/4] Probing Orca Orchestration Runtime...")
    try:
        proc = subprocess.run(
            ["orca", "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
        version_str = proc.stdout.strip()
        probe_results["orca"] = {
            "status": "PASS" if proc.returncode == 0 else "FAIL",
            "version": version_str,
        }
        print(f"  ✓ Orca Runtime: {version_str}")
    except (subprocess.SubprocessError, OSError) as e:
        probe_results["orca"] = {"status": "FAIL", "error": str(e)}
        print(f"  ✗ Orca Runtime Failed: {e}")

    print("\n================================================================")
    all_passed = all(v.get("status") == "PASS" for v in probe_results.values())
    if all_passed:
        print(" ALL MANDATED FRONTIER MODEL WORKERS READY FOR TASK DISPATCH")
    else:
        print(" WARNING: Some orchestration workers failed diagnostic check")
    print("================================================================\n")
    return probe_results


def print_stats() -> None:
    ensure_dirs()
    if not LEDGER_FILE.exists():
        print("No orchestration ledger found.")
        return

    with open(LEDGER_FILE, encoding="utf-8") as f:
        ledger = json.load(f)

    print("\n================================================================")
    print(" APEX OS — ORCHESTRATION TOKEN & WORKER LEDGER")
    print(f" Last Updated: {ledger.get('last_updated', 'N/A')}")
    print("================================================================")

    totals = ledger.get("totals_by_agent", {})
    for agent, stats in totals.items():
        print(f"\n[{agent.upper()} WORKER]")
        print(f"  Total Runs:        {stats.get('runs', 0)}")
        print(f"  Input Tokens:      {stats.get('input_tokens', 0):,}")
        print(f"  Cached Tokens:     {stats.get('cached_tokens', 0):,}")
        print(f"  Output Tokens:     {stats.get('output_tokens', 0):,}")
        print(f"  Reasoning Tokens:  {stats.get('reasoning_tokens', 0):,}")
        print(f"  Total Tokens:      {stats.get('total_tokens', 0):,}")
        if stats.get("cost_usd", 0) > 0:
            print(f"  Cumulative Cost:   ${stats.get('cost_usd', 0):.4f} USD")

    recent = ledger.get("recent_runs", [])
    if recent:
        print("\n----------------------------------------------------------------")
        print(f" RECENT DISPATCHES (Last {min(len(recent), 10)})")
        print("----------------------------------------------------------------")
        for r in recent[:10]:
            status_symbol = "✓" if r.get("success") else "✗"
            print(
                f" {status_symbol} [{r.get('agent', '').upper()}] {r.get('run_id')} | "
                f"tokens: {r.get('total_tokens', 0):,} | {r.get('duration_s', 0)}s | "
                f"{r.get('task', '')}"
            )
    print("================================================================\n")


# -----------------------------------------------------------------------------
# CLI Entry Point
# -----------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apex OS Multi-Model Orchestration Engine"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Probe command
    subparsers.add_parser("probe", help="Run end-to-end diagnostic probe")

    # Stats command
    subparsers.add_parser("stats", help="Show token ledger & orchestration stats")

    # Codex dispatch
    codex_p = subparsers.add_parser(
        "backend", help="Dispatch backend / math task to Codex (gpt-6.1-sol)"
    )
    codex_p.add_argument("--task", "-t", required=True, help="Task description")
    codex_p.add_argument("--files", "-f", nargs="*", default=None, help="Target files")
    codex_p.add_argument(
        "--model", "-m", default=DEFAULT_CODEX_MODEL, help="Model override"
    )
    codex_p.add_argument(
        "--verify", "-v", action="store_true", help="Run make check after task"
    )

    # Claude dispatch
    claude_p = subparsers.add_parser(
        "frontend",
        help="Dispatch frontend / UX task to Claude (claude-sonnet-5.5)",
    )
    claude_p.add_argument("--task", "-t", required=True, help="Task description")
    claude_p.add_argument("--files", "-f", nargs="*", default=None, help="Target files")
    claude_p.add_argument(
        "--model", "-m", default=DEFAULT_CLAUDE_MODEL, help="Model override"
    )
    claude_p.add_argument(
        "--verify", "-v", action="store_true", help="Run make check after task"
    )

    # DeepSeek dispatch
    ds_p = subparsers.add_parser(
        "extract",
        help="Dispatch extraction / audit task to DeepSeek (deepseek-flash)",
    )
    ds_p.add_argument("--prompt", "-p", required=True, help="Prompt text")
    ds_p.add_argument("--system", "-s", default=None, help="Optional system prompt")
    ds_p.add_argument(
        "--json", action="store_true", help="Require structured JSON output"
    )

    args = parser.parse_args()

    if args.command == "probe":
        run_probe()
    elif args.command == "stats":
        print_stats()
    elif args.command == "backend":
        res = dispatch_codex(
            task=args.task,
            files=args.files,
            model=args.model,
            verify=args.verify,
        )
        print(f"\n[Codex Result] Run: {res.run_id} | Success: {res.success}")
        print(
            f"Model: {res.model} | Tokens: {res.tokens.total_tokens:,} | "
            f"Time: {res.duration_s}s"
        )
        if res.files_changed:
            print(f"Files Modified: {', '.join(res.files_changed)}")
        if res.verification_passed is not None:
            ver_text = "PASSED" if res.verification_passed else "FAILED"
            print(f"make check: {ver_text}")
        print("\nWorker Output:\n", res.output)
    elif args.command == "frontend":
        res = dispatch_claude(
            task=args.task,
            files=args.files,
            model=args.model,
            verify=args.verify,
        )
        print(f"\n[Claude Result] Run: {res.run_id} | Success: {res.success}")
        print(
            f"Model: {res.model} | Tokens: {res.tokens.total_tokens:,} | "
            f"Cost: ${res.tokens.cost_usd:.4f} | Time: {res.duration_s}s"
        )
        if res.files_changed:
            print(f"Files Modified: {', '.join(res.files_changed)}")
        if res.verification_passed is not None:
            ver_text = "PASSED" if res.verification_passed else "FAILED"
            print(f"make check: {ver_text}")
        print("\nWorker Output:\n", res.output)
    elif args.command == "extract":
        res = dispatch_deepseek(
            prompt=args.prompt,
            system_prompt=args.system,
            json_mode=args.json,
        )
        print(f"\n[DeepSeek Result] Run: {res.run_id} | Success: {res.success}")
        print(
            f"Model: {res.model} | Tokens: {res.tokens.total_tokens:,} | "
            f"Time: {res.duration_s}s"
        )
        print("\nOutput:\n", res.output)


if __name__ == "__main__":
    main()
