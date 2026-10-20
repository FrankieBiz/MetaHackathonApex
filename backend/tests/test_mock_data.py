from datetime import UTC, datetime, timedelta

from backend.config import Settings
from backend.mock_data import build_mock_dataset
from backend.tasks import walk

NOW = datetime(2026, 10, 19, 22, 0, tzinfo=UTC)


def test_fixture_shape_matches_the_demo_brief():
    courses, assignments, events = build_mock_dataset(NOW)
    assert [(c.course_code, c.name) for c in courses] == [
        ("CS 3801", "Distributed Systems"),
        ("MATH 4102", "Stochastic Modeling"),
        ("ENG 2001", "Technical Writing"),
        ("FIN 3100", "Quantitative Analysis"),
    ]
    assert len(assignments) == 12
    assert len({a.id for a in assignments}) == 12
    for assignment in assignments:
        assert 10 <= assignment.weight <= 30
        assert 50 <= assignment.points_possible <= 200
        assert timedelta(hours=4) <= assignment.due_at - NOW <= timedelta(days=8)
    assert min(a.due_at for a in assignments) - NOW == timedelta(hours=4)
    assert {e.course_id for e in events} <= {c.id for c in courses}
    for course in courses:
        assert course.grade_history[-1].score == course.current_score
        assert course.grade_history[-1].at == NOW


def test_task_trees_are_populated_and_rolled_up():
    _, assignments, _ = build_mock_dataset(NOW)
    triaged = [a for a in assignments if a.subtasks]
    assert len(triaged) == 9
    nodes = list(walk([node for a in triaged for node in a.subtasks]))
    assert any(node.children and any(c.children for c in node.children) for node in nodes)
    assert sum(node.actual_minutes for node in nodes) > 0
    study = [node for node in nodes if node.is_study_recommendation]
    assert any("Study Guide" in node.title for node in study)
    assert any("MB" in node.title for node in study)
    for node in nodes:
        assert node.estimated_minutes > 0
        if node.children:
            assert node.estimated_minutes == sum(c.estimated_minutes for c in node.children)
            assert node.is_completed == all(c.is_completed for c in node.children)
            assert all(c.parent_id == node.id for c in node.children)
    for assignment in triaged:
        started = any(n.is_completed or n.actual_minutes for n in walk(assignment.subtasks))
        assert assignment.status == ("in_progress" if started else "pending")


def test_dataset_is_deterministic_and_ids_survive_reanchoring():
    first = build_mock_dataset(NOW)
    assert first == build_mock_dataset(NOW)
    later = build_mock_dataset(NOW + timedelta(hours=3))
    ids = [[n.id for n in walk(a.subtasks)] for a in first[1]]
    assert ids == [[n.id for n in walk(a.subtasks)] for a in later[1]]
    assert later[1][0].due_at - first[1][0].due_at == timedelta(hours=3)


def test_canvas_deadline_defaults_to_two_and_a_half_seconds():
    assert Settings(canvas_api_token="").canvas_timeout_seconds == 2.5
