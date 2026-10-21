import ast
import json
import runpy
import sys
from pathlib import Path

import pytest
from scripts import judge

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def repository(tmp_path):
    (tmp_path / "backend").mkdir()
    (tmp_path / "frontend/src").mkdir(parents=True)
    (tmp_path / "frontend/tests").mkdir()
    (tmp_path / "backend/core.py").write_text("def execute():\n    return 1\n")
    return tmp_path


def command(name, status="passed"):
    return judge.CommandResult(
        name, ["test-tool"], "/test", status, 0 if status == "passed" else 1, 0.1, "1 passed"
    )


def test_real_repository_has_five_pillars_and_honest_unverified_checks():
    report = judge.build_report(ROOT)
    assert [v["maximum"] for v in report["categories"].values()] == [25, 25, 20, 15, 15]
    assert sum(c["maximum"] for c in report["criteria"]) == 100
    assert report["score"]["assessed_maximum"] == 94
    assert report["score"]["provisional"] is True
    assert report["commands"] == []
    assert "unverified" in report["live_meta_inference"]
    assert len(report["grill"]) == 10
    assert report["test_audit"]["backend_test_declarations"] > 100
    assert report["test_audit"]["frontend_test_files"] > 5
    assert sum(beat["end_seconds"] - beat["start_seconds"] for beat in report["pitch"]) == 180
    assert report["pitch"][0]["start_seconds"] == 0
    assert report["pitch"][-1]["end_seconds"] == 180
    assert "Source" not in report["configuration_audit"]["public_model_defaults"]


def test_every_static_criterion_and_score_budget_with_complete_evidence():
    sources = judge.Sources(ROOT)
    defaults = judge.configuration_audit(sources)["public_model_defaults"]
    sources.text["README.md"] = (
        "60-second start.sh tour=1\n"
        f"META_MODEL defaults to `{defaults['meta_model']}`\n"
        f"META_BASE_URL defaults to `{defaults['meta_base_url']}`"
    )
    criteria = judge.score(
        sources, judge.test_audit(sources), [command("backend_tests"), command("frontend_tests")]
    )
    assert {item.status for item in criteria} == {"passed"}
    assert sum(item.awarded for item in criteria) == 100
    assert {
        item.category: sum(c.maximum for c in criteria if c.category == item.category)
        for item in criteria
    } == judge.CATEGORY_MAXIMA


def test_empty_repository_cannot_earn_keyword_or_pass_credit(repository):
    report = judge.build_report(repository)
    assert report["score"]["earned"] == 3  # Only the valid Python syntax criterion.
    assert report["score"]["letter_grade"] == "F"
    assert all(item["evidence_status"] == "missing" for item in report["grill"])
    assert all("Evidence missing" in beat["action"] for beat in report["pitch"])


def test_scan_prunes_dependencies_archives_dotfiles_and_symlinks(repository, tmp_path):
    for folder in ("backend/.venv", "backend/node_modules", "backend/legacy_archive"):
        path = repository / folder
        path.mkdir()
        (path / "bad.py").write_text("invalid syntax !")
    (repository / "backend/.env.py").write_text("credential_fixture_marker")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "external.py").write_text("external_fixture_marker")
    (repository / "backend/link.py").symlink_to(outside / "external.py")
    (repository / "backend/linked").symlink_to(outside, target_is_directory=True)
    sources = judge.Sources(repository)
    sources.read(repository / "backend/linked/external.py")
    assert sources.errors == []
    assert set(sources.text) == {"backend/core.py"}
    assert not any("fixture_marker" in text for text in sources.text.values())


def test_scan_ignores_symlinked_source_root(repository, tmp_path):
    (repository / "frontend/src").rmdir()
    target = tmp_path / "external_source"
    target.mkdir()
    (target / "bad.ts").write_text("source outside repository")
    (repository / "frontend/src").symlink_to(target, target_is_directory=True)
    assert "frontend/src/bad.ts" not in judge.Sources(repository).text


def test_scan_rejects_paths_resolving_outside_repository(repository, tmp_path_factory):
    outside = tmp_path_factory.mktemp("judge-external")
    source = outside / "external.py"
    source.write_text("do not read external source")
    (repository / "backend/external").symlink_to(outside, target_is_directory=True)
    sources = judge.Sources(repository)
    sources.read(repository / "backend/external/external.py")
    assert set(sources.text) == {"backend/core.py"}


def test_scan_records_syntax_encoding_size_and_read_errors(repository, monkeypatch):
    (repository / "backend/syntax.py").write_text("def broken(:")
    (repository / "backend/encoding.py").write_bytes(b"\xff")
    (repository / "backend/huge.py").write_text(" " * 2_000_001)
    (repository / "backend/unreadable.py").write_text("pass")
    original = Path.read_text

    def read(path, *args, **kwargs):
        if path.name == "unreadable.py":
            raise PermissionError
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read)
    sources = judge.Sources(repository)
    assert len(sources.errors) == 4
    assert any("invalid Python syntax" in error for error in sources.errors)
    assert any("2 MB" in error for error in sources.errors)
    assert any("unreadable" in error for error in sources.errors)


def test_lockfile_is_not_loaded_and_match_locations_are_bounded(repository):
    (repository / "frontend/package-lock.json").write_text("do not copy dependency graph")
    (repository / "backend/core.py").write_text("# match\n" * 20)
    sources = judge.Sources(repository)
    assert sources.text["frontend/package-lock.json"] == ""
    assert sources.matching("match") == [f"backend/core.py:{i}" for i in range(1, 9)]


def test_audit_finds_vacuous_bodies_and_keeps_parametrization_distinct(repository):
    tests = repository / "backend/tests"
    tests.mkdir()
    (tests / "test_example.py").write_text('''
def helper():
    pass
def test_empty():
    """No assertion."""
    pass
def test_ellipsis():
    ...
def test_return():
    return
def test_true():
    assert True
async def test_valid():
    assert sum([1, 2]) == 3
''')
    (repository / "frontend/tests/example.test.ts").write_text(
        "it('checks', () => expect(1).toBe(1)); test.each([1, 2])('case', () => {});"
    )
    sources = judge.Sources(repository)
    audit = judge.test_audit(sources)
    assert audit["backend_test_declarations"] == 5
    assert len(audit["vacuous_backend_tests"]) == 4
    assert audit["frontend_test_declarations_approximate"] == 2


def test_meta_points_require_production_calls_not_test_or_documentation_keywords(repository):
    tests = repository / "backend/tests"
    tests.mkdir()
    (tests / "test_fake.py").write_text(
        "async def test_fake():\n    await client.chat.completions.create()"
    )
    (repository / "README.md").write_text("await client.chat.completions.create()")
    report = judge.build_report(repository)
    inference = next(c for c in report["criteria"] if c["id"] == "awaited_inference")
    assert inference["awarded"] == 0
    assert report["categories"]["Meta AI Integration"]["earned"] == 0


def test_configuration_drift_uses_only_public_settings(repository):
    (repository / "backend/config.py").write_text(
        "class Settings:\n    meta_model: str = 'current-model'\n"
        "    meta_base_url: str = 'https://example.test/v1'\n"
        "    llm_model: str = 'llama3'\n    unrelated: str = 'ignore'\n"
    )
    (repository / "README.md").write_text(
        "META_MODEL defaults to `old-model`\nMETA_BASE_URL defaults to `https://example.test/v1`"
    )
    result = judge.configuration_audit(judge.Sources(repository))
    assert set(result["public_model_defaults"]) == {"meta_model", "meta_base_url", "llm_model"}
    assert result["documentation_drift"] == [
        "README.md: META_MODEL default differs from backend/config.py"
    ]


@pytest.mark.parametrize(
    "selection,count", [("none", 0), ("backend", 3), ("frontend", 4), ("all", 7)]
)
def test_command_selection_is_allowlisted_and_shell_free(repository, selection, count):
    plan = judge.command_plan(repository, selection)
    assert len(plan) == count
    assert all(isinstance(argv, list) and cwd.is_relative_to(repository) for _, argv, cwd in plan)


@pytest.mark.parametrize("exit_code,status", [(0, "passed"), (7, "failed")])
def test_executor_reports_exit_and_numeric_summary_without_raw_output(
    repository, exit_code, status
):
    script = repository / "emit.py"
    script.write_text(
        "print('fixture-private-output')\nprint('3 passed, 1 skipped')\n"
        f"raise SystemExit({exit_code})\n"
    )
    result = judge.execute(
        "fixture",
        [sys.executable, str(script)],
        repository,
        10,
    )
    assert result.status == status
    assert result.exit_code == exit_code
    assert result.summary == "3 passed, 1 skipped"
    assert "fixture-private-output" not in str(result)


def test_executor_handles_plain_output_missing_executable_and_deadline(repository):
    plain = judge.execute("plain", [sys.executable, "-c", "print('ok')"], repository, 10)
    assert plain.summary == "Exit status 0"
    missing = judge.execute("missing", ["/nonexistent/judge-command"], repository, 1)
    assert missing.status == "unavailable"
    assert missing.exit_code is None
    timeout = judge.execute(
        "timeout", [sys.executable, "-c", "import time; time.sleep(5)"], repository, 0.01
    )
    assert timeout.status == "timed_out"
    assert timeout.duration_seconds < 2


def test_executed_failure_caps_technical_rigor_and_is_not_hidden(monkeypatch):
    def execute(name, argv, cwd, timeout):
        return command(name, "failed" if name == "frontend_build" else "passed")

    monkeypatch.setattr(judge, "execute", execute)
    report = judge.build_report(ROOT, "all")
    assert report["categories"]["Technical Rigor"]["earned"] == 10
    assert report["categories"]["Technical Rigor"]["raw_earned"] > 10
    assert report["technical_cap"] is not None
    assert report["score"]["earned"] == sum(c["earned"] for c in report["categories"].values())
    assert "failed" in report["grill"][8]["model_answer"]
    assert "Capped" in judge.terminal(report)
    assert "Capped" in judge.markdown(report)


def test_successful_executed_checks_earn_only_fresh_pass_credit(monkeypatch):
    monkeypatch.setattr(judge, "execute", lambda name, argv, cwd, timeout: command(name))
    report = judge.build_report(ROOT, "all")
    assert report["score"]["provisional"] is False
    assert report["technical_cap"] is None
    assert report["categories"]["Technical Rigor"]["earned"] == 25
    assert "All rubric criteria assessed" in judge.terminal(report)
    report["next_steps"] = []
    assert "No rubric evidence gaps" in judge.terminal(report)
    assert "No rubric evidence gaps" in judge.markdown(report)
    assert "outside this rubric" in judge.grill(report)[-1]["model_answer"]


@pytest.mark.parametrize(
    "points,grade", [(100, "A"), (90, "A"), (80, "B"), (70, "C"), (60, "D"), (0, "F")]
)
def test_grade_boundaries(points, grade):
    assert judge.letter_grade(points) == grade


@pytest.mark.parametrize(
    "flag,expected",
    [
        ("--json", '"schema_version": 1'),
        ("--markdown", "# Apex engineering judge scorecard"),
        ("--grill", "# Top 10 adversarial judge questions"),
        ("--pitch", "# 180-second pitch choreography"),
        ("--no-color", "GRADE F"),
    ],
)
def test_cli_modes_write_complete_artifacts(repository, capsys, flag, expected):
    assert judge.main(["--root", str(repository), flag]) == 0
    output = capsys.readouterr().out
    assert expected in output
    assert "\033[" not in output
    report = json.loads((repository / ".qa/judge/scorecard.json").read_text())
    assert report["score"]["maximum"] == 100
    assert len(report["grill"]) == 10
    markdown = (repository / ".qa/judge/scorecard.md").read_text()
    assert "## Evidence" in markdown
    assert "180-second pitch" in markdown


def test_cli_json_is_parseable_and_legacy_format_flag_works(repository, capsys):
    assert judge.main(["--root", str(repository), "--format", "json"]) == 0
    assert json.loads(capsys.readouterr().out)["score"]["letter_grade"] == "F"


def test_cli_threshold_and_failed_commands_return_failure(repository, monkeypatch, capsys):
    assert judge.main(["--root", str(repository), "--fail-under", "100"]) == 1
    monkeypatch.setattr(judge, "execute", lambda name, argv, cwd, timeout: command(name, "failed"))
    assert judge.main(["--root", str(repository), "--run-checks", "backend"]) == 1
    assert "Capped" in capsys.readouterr().out


@pytest.mark.parametrize(
    "args",
    [
        ["--timeout", "0"],
        ["--timeout", "nan"],
        ["--timeout", "3601"],
        ["--fail-under", "-1"],
        ["--fail-under", "101"],
        ["--json", "--pitch"],
    ],
)
def test_cli_invalid_options_fail_clearly(repository, args):
    with pytest.raises(SystemExit, match="2"):
        judge.main(["--root", str(repository), *args])


def test_cli_invalid_root_and_unwritable_destination(repository, tmp_path):
    with pytest.raises(SystemExit, match="2"):
        judge.main(["--root", str(tmp_path / "missing")])
    destination = repository / "not-a-directory"
    destination.write_text("occupied")
    with pytest.raises(SystemExit, match="2"):
        judge.main(["--root", str(repository), "--output-dir", str(destination)])


def test_terminal_color_is_opt_in_and_respects_no_color(repository, capsys, monkeypatch):
    report = judge.build_report(repository)
    assert "\033[" in judge.terminal(report, color=True)
    assert "\033[" not in judge.terminal(report)
    monkeypatch.setattr(sys.stdout, "isatty", lambda: True)
    monkeypatch.setenv("NO_COLOR", "1")
    assert judge.main(["--root", str(repository)]) == 0
    assert "\033[" not in capsys.readouterr().out


def test_root_discovery_supports_bundled_skill_and_fallback(repository, monkeypatch):
    script = repository / ".agents/skills/hackathon-judge/scripts/judge.py"
    assert judge.repository_root(script) == repository
    monkeypatch.chdir(repository)
    assert judge.repository_root(Path("/nonexistent/nested/judge.py")) == repository


def test_self_contained_entrypoint(repository, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["judge.py", "--root", str(repository), "--json"])
    with pytest.raises(SystemExit, match="0"):
        runpy.run_path(str(ROOT / "scripts/judge.py"), run_name="__main__")
    assert json.loads(capsys.readouterr().out)["schema_version"] == 1


def test_bad_python_parse_does_not_execute_source(repository):
    (repository / "backend/core.py").write_text("raise RuntimeError('never execute source')")
    sources = judge.Sources(repository)
    assert isinstance(sources.trees["backend/core.py"], ast.Module)
    assert sources.errors == []
