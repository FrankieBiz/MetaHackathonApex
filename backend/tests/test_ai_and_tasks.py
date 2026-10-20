import asyncio
import json

import httpx
import pytest
from openai import AsyncOpenAI

from backend.ai_engine import deconstruct_assignment, fallback_tree, generate_study_recommendation
from backend.canvas_client import get_mock_sandbox_data
from backend.models import CourseModel, SubTaskNode, SubTaskUpdate
from backend.tasks import patch_tree, walk

from .conftest import settings


def completion(content, reason="stop"):
    return httpx.Response(
        200,
        json={
            "id": "test",
            "object": "chat.completion",
            "created": 1,
            "model": "llama3",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": reason,
                }
            ],
        },
    )


async def test_llama_valid_json_gets_server_owned_identifiers_and_hierarchy():
    assignment = get_mock_sandbox_data().assignments[0]

    def handler(request):
        body = json.loads(request.content)
        assert body["model"] == "llama3"
        assert body["response_format"] == {"type": "json_object"}
        assert "institutional academic triage agent" in body["messages"][0]["content"]
        assert "Rubric" in body["messages"][1]["content"]
        return completion(
            json.dumps(
                {
                    "subtasks": [
                        {
                            "title": "Implement leader election",
                            "estimated_minutes": 30,
                            "children": [
                                {
                                    "title": "Test a split vote",
                                    "estimated_minutes": 20,
                                    "children": [],
                                }
                            ],
                        }
                    ]
                }
            )
        )

    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http,
        AsyncOpenAI(api_key="test", base_url="http://local/v1", http_client=http) as client,
    ):
        nodes = await deconstruct_assignment(assignment, settings=settings(), client=client)
    assert nodes[0].title == "Implement leader election"
    assert nodes[0].children[0].parent_id == nodes[0].id
    assert all(node.assignment_id == assignment.id for node in walk(nodes))
    assert all(node.actual_minutes == 0 and not node.is_completed for node in walk(nodes))


@pytest.mark.parametrize(
    "content,reason",
    [
        ("not JSON", "stop"),
        ('{"subtasks":[]}', "stop"),
        ("{}", "stop"),
        ('{"subtasks":[{"title":"Bad","estimated_minutes":5,"children":[]}]}', "stop"),
        ('{"subtasks":[{"title":"Bad","estimated_minutes":"30","children":[]}]}', "stop"),
        ('{"subtasks":[{"title":" ","estimated_minutes":30,"children":[]}]}', "stop"),
        ('{"subtasks":[{"title":"Bad","estimated_minutes":30,"children":[],"id":"x"}]}', "stop"),
        ('{"subtasks":[{"title":"Valid","estimated_minutes":30,"children":[]}]}', "length"),
        (None, "stop"),
    ],
)
async def test_invalid_llm_output_returns_deterministic_plan(content, reason):
    assignment = get_mock_sandbox_data().assignments[0]
    async with (
        httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: completion(content, reason))
        ) as http,
        AsyncOpenAI(api_key="test", base_url="http://local/v1", http_client=http) as client,
    ):
        result = await deconstruct_assignment(assignment, settings=settings(), client=client)
    assert result == fallback_tree(assignment)
    assert all(15 <= node.estimated_minutes <= 45 for node in walk(result))


async def test_llm_network_error_has_no_retries():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("offline", request=request)

    assignment = get_mock_sandbox_data().assignments[0]
    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http,
        AsyncOpenAI(
            api_key="test",
            base_url="http://local/v1",
            http_client=http,
            max_retries=0,
        ) as client,
    ):
        assert await deconstruct_assignment(assignment, client=client) == fallback_tree(assignment)
    assert calls == 1


async def test_llm_overall_deadline_returns_plan():
    async def handler(request):
        await asyncio.Event().wait()

    assignment = get_mock_sandbox_data().assignments[0]
    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http,
        AsyncOpenAI(api_key="test", base_url="http://local/v1", http_client=http) as client,
    ):
        result = await deconstruct_assignment(
            assignment,
            settings=settings(llm_timeout_seconds=0.01),
            client=client,
        )
    assert result == fallback_tree(assignment)


@pytest.mark.parametrize("choices", [[], [None], [{"message": None}], None])
async def test_malformed_completion_envelope_uses_fallback(choices):
    async with (
        httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"choices": choices})
            )
        ) as http,
        AsyncOpenAI(api_key="test", base_url="http://local/v1", http_client=http) as client,
    ):
        assignment = get_mock_sandbox_data().assignments[0]
        assert await deconstruct_assignment(assignment, client=client) == fallback_tree(assignment)


async def test_deep_llm_tree_is_rejected():
    node = {"title": "Leaf", "estimated_minutes": 30, "children": []}
    for depth in range(5):
        node = {"title": f"Level {depth}", "estimated_minutes": 30, "children": [node]}
    async with (
        httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: completion(json.dumps({"subtasks": [node]}))
            )
        ) as http,
        AsyncOpenAI(api_key="test", base_url="http://local/v1", http_client=http) as client,
    ):
        assignment = get_mock_sandbox_data().assignments[0]
        assert await deconstruct_assignment(assignment, client=client) == fallback_tree(assignment)


def test_tree_propagation_at_arbitrary_depth():
    leaf1 = SubTaskNode(
        id="leaf1", assignment_id="a", parent_id="branch", title="First", estimated_minutes=15
    )
    leaf2 = SubTaskNode(
        id="leaf2", assignment_id="a", parent_id="branch", title="Second", estimated_minutes=15
    )
    branch = SubTaskNode(
        id="branch",
        assignment_id="a",
        parent_id="root",
        title="Branch",
        estimated_minutes=30,
        children=[leaf1, leaf2],
    )
    root = SubTaskNode(
        id="root", assignment_id="a", title="Root", estimated_minutes=30, children=[branch]
    )
    assert patch_tree([root], "leaf1", SubTaskUpdate(is_completed=True))
    assert not root.is_completed
    assert patch_tree([root], "leaf2", SubTaskUpdate(is_completed=True))
    assert root.is_completed and branch.is_completed
    patch_tree([root], "leaf1", SubTaskUpdate(is_completed=False))
    assert not root.is_completed and not branch.is_completed and leaf2.is_completed
    patch_tree([root], "root", SubTaskUpdate(is_completed=True))
    assert all(node.is_completed for node in walk([root]))
    patch_tree([root], "root", SubTaskUpdate(is_completed=False))
    assert all(not node.is_completed for node in walk([root]))


def test_targeted_recommendation_uses_syllabus_and_margin():
    snapshot = get_mock_sandbox_data()
    course = snapshot.courses[0]
    node = generate_study_recommendation(course, snapshot.assignments)
    assert "Study Guide PDF" in node.title
    assert node.assignment_id is None and node.is_study_recommendation
    course = CourseModel(
        id="weak", name="Statistics", course_code="STAT-101", current_score=70.0, target_score=90.0
    )
    assert "missed problems" in generate_study_recommendation(course, []).title


def test_defaults_do_not_share_child_lists():
    first = SubTaskNode(id="1", assignment_id="a", title="First", estimated_minutes=15)
    second = SubTaskNode(id="2", assignment_id="a", title="Second", estimated_minutes=15)
    first.children.append(second)
    assert second.children == []
