import json

import httpx
from openai import AsyncOpenAI

from backend.ai_engine import deconstruct_assignment
from backend.canvas_client import get_mock_sandbox_data
from backend.config import Settings
from backend.models import InferenceTelemetry

from .conftest import settings


async def test_meta_defaults_custom_endpoint_and_measured_usage(monkeypatch):
    config = Settings(meta_api_key="test-fixture", meta_base_url="https://meta.example/v1")
    assert config.inference_base_url == "https://meta.example/v1"
    assert config.inference_model == "muse-spark-1.3"
    assert Settings(meta_api_key="fixture", meta_model="Llama-3.1-8B-Instruct").inference_model == (
        "Llama-3.1-8B-Instruct"
    )
    assert Settings(meta_api_key="fixture").inference_base_url == "https://api.meta.ai/v1"

    def handler(request):
        assert json.loads(request.content)["model"] == "muse-spark-1.3"
        return httpx.Response(
            200,
            json={
                "id": "fixture",
                "object": "chat.completion",
                "created": 1,
                "model": "muse-spark-1.3",
                "usage": {"prompt_tokens": 240, "completion_tokens": 100, "total_tokens": 340},
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {
                            "role": "assistant",
                            "content": json.dumps(
                                {
                                    "subtasks": [
                                        {
                                            "title": "Implement component",
                                            "estimated_minutes": 30,
                                            "children": [],
                                        }
                                    ]
                                }
                            ),
                        },
                    }
                ],
            },
        )

    telemetry = InferenceTelemetry()
    ticks = iter([1.0, 1.5])
    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http,
        AsyncOpenAI(
            api_key="fixture", base_url=config.inference_base_url, http_client=http
        ) as client,
    ):
        monkeypatch.setattr("backend.ai_engine.perf_counter", lambda: next(ticks))
        nodes = await deconstruct_assignment(
            get_mock_sandbox_data().assignments[0],
            settings=config,
            client=client,
            telemetry=telemetry,
        )
    assert nodes[0].title == "Implement component"
    assert telemetry.model_dump() == {
        "model_used": "muse-spark-1.3",
        "latency_ms": 500,
        "prompt_tokens": 240,
        "completion_tokens": 100,
        "tokens_per_sec": 200.0,
    }


async def test_failed_inference_is_explicitly_local_without_fabricated_usage():
    telemetry = InferenceTelemetry()
    async with (
        httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(503))
        ) as http,
        AsyncOpenAI(
            api_key="fixture", base_url="http://local/v1", http_client=http, max_retries=0
        ) as client,
    ):
        nodes = await deconstruct_assignment(
            get_mock_sandbox_data().assignments[0],
            settings=settings(),
            client=client,
            telemetry=telemetry,
        )
    assert nodes
    assert telemetry.model_used == "local-starter-plan"
    assert telemetry.latency_ms >= 0
    assert telemetry.prompt_tokens is None
    assert telemetry.completion_tokens is None
    assert telemetry.tokens_per_sec is None
