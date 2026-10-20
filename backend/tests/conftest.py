from contextlib import asynccontextmanager

import httpx
import pytest
from openai import AsyncOpenAI

from backend.canvas_client import CanvasClient
from backend.config import Settings
from backend.models import AssignmentModel, CourseModel, SubTaskNode, TerminalState
from backend.persistence import subtask_patch_params
from backend.service import TerminalService


def settings(**overrides) -> Settings:
    values = dict(
        demo_mode=True,
        canvas_api_token="",
        supabase_url="",
        supabase_key="",
        llm_base_url="http://localhost:11434/v1",
        llm_api_key="ollama",
        llm_model="llama3",
    )
    values.update(overrides)
    return Settings(**values)


class MemoryStore:
    enabled = True

    def __init__(self) -> None:
        self.states: dict[bool, TerminalState] = {}
        self.saves = 0
        self.records: list[dict] = []
        self.record_ok = True

    async def load(self, demo_mode: bool) -> TerminalState | None:
        state = self.states.get(demo_mode)
        return state.model_copy(deep=True) if state else None

    async def save(self, state: TerminalState) -> bool:
        self.states[state.metrics.demo_mode] = TerminalState.model_validate_json(
            state.model_dump_json(round_trip=True)
        )
        self.saves += 1
        return True

    async def record_subtask_patch(
        self,
        course: CourseModel,
        assignment: AssignmentModel,
        node: SubTaskNode,
        minutes_delta: int,
    ) -> bool:
        self.records.append(subtask_patch_params(course, assignment, node, minutes_delta))
        return self.record_ok


@asynccontextmanager
async def service_context(config=None, canvas_handler=None, llm_handler=None, store=None):
    config = config or settings()
    async with (
        httpx.AsyncClient(
            transport=httpx.MockTransport(canvas_handler or (lambda request: httpx.Response(503)))
        ) as canvas_http,
        httpx.AsyncClient(
            transport=httpx.MockTransport(llm_handler or (lambda request: httpx.Response(503)))
        ) as llm_http,
        AsyncOpenAI(
            api_key="test",
            base_url="http://localhost:11434/v1",
            max_retries=0,
            http_client=llm_http,
        ) as llm,
    ):
        yield TerminalService(
            config,
            CanvasClient(config, canvas_http),
            store or MemoryStore(),
            llm,
        )


@pytest.fixture
async def terminal():
    async with service_context() as service:
        yield service
