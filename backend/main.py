"""Run from the repository root: python -m uvicorn backend.main:app --port 8000."""

import json
from contextlib import asynccontextmanager, nullcontext

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from openai import AsyncOpenAI
from pydantic import AliasChoices, Field, SecretStr, field_validator

from .ai_engine import SyllabusExtractionUnavailable, generate_study_triage
from .canvas_client import CanvasClient
from .config import Settings, get_settings
from .models import (
    AgentReasoningStep,
    DecomposeRequest,
    DecomposeResponse,
    InferenceTelemetry,
    StrictModel,
    StudyInsertRequest,
    StudyTriagePlan,
    StudyTriageRequest,
    SubTaskNode,
    SubTaskUpdate,
    SyllabusIngestRequest,
    TerminalState,
)
from .persistence import SupabaseStore
from .service import MonteCarloRequest, MonteCarloResponse, TerminalService
from .syllabus_presets import SyllabusPresetDescriptor, list_presets


class _CanvasSyncBody(StrictModel):
    canvas_api_token: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("canvas_api_token", "token")
    )
    canvas_api_url: str | None = Field(
        default=None, validation_alias=AliasChoices("canvas_api_url", "base_url", "baseUrl")
    )

    @field_validator("canvas_api_token")
    @classmethod
    def nonempty_token(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None:
            token = value.get_secret_value().strip()
            if not token:
                raise ValueError("Provide a nonempty Canvas token")
            return SecretStr(token)
        return value

    @field_validator("canvas_api_url")
    @classmethod
    def canvas_origin(cls, value: str | None) -> str | None:
        return Settings.canvas_origin(value) if value is not None else None


def create_app(
    settings: Settings | None = None, *, service: TerminalService | None = None
) -> FastAPI:
    # Resolved up front because the CORS allowlist is fixed when the middleware is added.
    config = settings or (service.settings if service is not None else get_settings())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if service is not None:
            app.state.terminal = service
            yield
            return
        canvas = CanvasClient(config)
        store = SupabaseStore(config)
        async with (
            AsyncOpenAI(
                base_url=config.inference_base_url,
                api_key=config.inference_api_key.get_secret_value(),
                timeout=config.llm_timeout_seconds,
                max_retries=0,
            ) as llm,
            AsyncOpenAI(
                base_url=config.auditor_base_url,
                api_key=config.auditor_api_key.get_secret_value(),
                timeout=config.auditor_timeout_seconds,
                max_retries=0,
            )
            if config.auditor_enabled
            else nullcontext() as auditor,
        ):
            app.state.terminal = TerminalService(config, canvas, store, llm, auditor)
            try:
                yield
            finally:
                await canvas.close()
                await store.close()

    app = FastAPI(title="Apex OS Academic Backend", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            *config.cors_origins,
        ],
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def private_responses(request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(KeyError)
    async def missing_resource(request: Request, exc: KeyError) -> JSONResponse:
        return JSONResponse(
            status_code=404, content={"detail": "Course, assignment or subtask not found"}
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request: Request, exc: RequestValidationError) -> JSONResponse:
        if request.url.path in ("/api/v1/syllabus/ingest", "/api/v1/ingest/syllabus"):
            return JSONResponse(status_code=422, content={"detail": "Invalid syllabus input."})
        if request.url.path in ("/api/sync", "/api/canvas/sync"):
            # FastAPI's default validation detail includes the rejected input.
            return JSONResponse(status_code=422, content={"detail": "Invalid Canvas sync body."})
        if request.url.path in ("/decompose", "/api/decompose"):
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "Provide a valid assignment_id.",
                    "telemetry": InferenceTelemetry(model_used="none").model_dump(),
                },
            )
        return await request_validation_exception_handler(request, exc)

    @app.get("/api/state", response_model=TerminalState)
    async def state(request: Request) -> TerminalState:
        return await request.app.state.terminal.state()

    @app.get("/api/engine")
    async def engine() -> dict[str, str]:
        return {
            "provider": "meta" if config.meta_api_key.get_secret_value() else "llama",
            "model": config.inference_model,
            "auditor": config.auditor_model if config.auditor_enabled else "rubric-parser",
        }

    @app.post("/decompose", response_model=DecomposeResponse)
    @app.post("/api/decompose", response_model=DecomposeResponse)
    async def decompose(
        body: DecomposeRequest, request: Request
    ) -> DecomposeResponse | JSONResponse:
        telemetry = InferenceTelemetry(model_used="none")
        trace: list[AgentReasoningStep] = []
        try:
            nodes = await request.app.state.terminal.triage(
                body.assignment_id, telemetry=telemetry, trace=trace
            )
        except (KeyError, RuntimeError) as exc:
            status = 404 if isinstance(exc, KeyError) else 409
            return JSONResponse(
                status_code=status,
                content={
                    "detail": "Assignment unavailable; refresh and retry.",
                    "telemetry": telemetry.model_dump(),
                },
            )
        return DecomposeResponse(
            subtasks=nodes,
            telemetry=telemetry,
            source="local"
            if telemetry.model_used == "local-starter-plan"
            else "cached"
            if telemetry.model_used == "cached-plan"
            else "ai",
            agent_reasoning_trace=trace,
        )

    @app.post("/api/sync", response_model=TerminalState)
    @app.post("/api/canvas/sync", response_model=TerminalState)
    async def sync(request: Request, body: _CanvasSyncBody | None = None) -> TerminalState:
        terminal = request.app.state.terminal
        canvas_settings = None
        if body and body.canvas_api_token is not None:
            canvas_settings = terminal.canvas.settings.model_copy(
                update={
                    "canvas_api_token": body.canvas_api_token,
                    "canvas_api_url": body.canvas_api_url
                    or terminal.canvas.settings.canvas_api_url,
                    "demo_mode": False,
                }
            )
        return await terminal.state(force=True, canvas_settings=canvas_settings)

    @app.post("/api/v1/triage/study", response_model=StudyTriagePlan)
    async def study_triage(body: StudyTriageRequest, request: Request) -> StudyTriagePlan:
        return await generate_study_triage(
            body, settings=config, client=request.app.state.terminal.llm
        )

    @app.post("/api/v1/simulate/monte-carlo", response_model=MonteCarloResponse)
    async def monte_carlo(body: MonteCarloRequest, request: Request) -> MonteCarloResponse:
        try:
            return await request.app.state.terminal.monte_carlo(body)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.get("/api/v1/syllabus/presets", response_model=list[SyllabusPresetDescriptor])
    async def syllabus_presets() -> list[SyllabusPresetDescriptor]:
        return list_presets()

    @app.post("/api/v1/syllabus/presets/{preset_id}/load", response_model=TerminalState)
    async def load_syllabus_preset(preset_id: str, request: Request) -> TerminalState:
        try:
            return await request.app.state.terminal.load_syllabus_preset(preset_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Syllabus preset not found") from exc

    @app.post("/api/v1/syllabus/ingest", response_model=TerminalState)
    @app.post("/api/v1/ingest/syllabus", response_model=TerminalState)
    async def ingest_syllabus(body: SyllabusIngestRequest, request: Request) -> TerminalState:
        try:
            return await request.app.state.terminal.ingest_syllabus(body)
        except SyllabusExtractionUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/v1/triage/study/insert", response_model=TerminalState)
    async def insert_study(body: StudyInsertRequest, request: Request) -> TerminalState:
        return await request.app.state.terminal.insert_study(body)

    @app.post("/api/triage/{assignment_id}", response_model=list[SubTaskNode])
    async def triage(assignment_id: str, request: Request) -> list[SubTaskNode]:
        try:
            return await request.app.state.terminal.triage(assignment_id)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get(
        "/api/v1/triage/{assignment_id}/stream",
        response_class=StreamingResponse,
        responses={200: {"content": {"text/event-stream": {}}}},
    )
    async def triage_stream(assignment_id: str, request: Request) -> StreamingResponse:
        events = request.app.state.terminal.stream_triage(assignment_id)
        # Resolve missing assignments before response headers commit to HTTP 200.
        first = await anext(events)

        def encode(event: dict) -> str:
            return f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"

        async def body():
            try:
                yield encode(first)
                async for event in events:
                    yield encode(event)
            except RuntimeError:
                yield encode(
                    {
                        "event": "error",
                        "data": {
                            "detail": "Assignment changed during triage; refresh and retry.",
                            "status": 409,
                        },
                    }
                )
            finally:
                await events.aclose()

        return StreamingResponse(
            body(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
        )

    @app.patch("/api/v1/subtasks/{subtask_id}", response_model=TerminalState)
    @app.patch("/api/subtasks/{subtask_id}", response_model=TerminalState, deprecated=True)
    async def patch(subtask_id: str, update: SubTaskUpdate, request: Request) -> TerminalState:
        return await request.app.state.terminal.patch(subtask_id, update)

    return app


app = create_app()
