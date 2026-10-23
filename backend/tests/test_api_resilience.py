import logging
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import httpx
import pytest

from backend.main import create_app
from backend.service import TerminalService


@pytest.fixture
async def api(terminal: TerminalService) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(service=terminal)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        ) as client,
    ):
        yield client


@pytest.mark.parametrize("error_type", [RuntimeError, ValueError])
async def test_uncaught_exception_returns_generic_json_and_logs_details(
    api: httpx.AsyncClient,
    terminal: TerminalService,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    error_type: type[Exception],
) -> None:
    exc = error_type("Private telemetry failure details")
    monkeypatch.setattr(terminal, "state", AsyncMock(side_effect=exc))

    with caplog.at_level(logging.ERROR, logger="backend.main"):
        response = await api.get("/api/state")

    assert response.status_code == 500
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {
        "detail": "Internal server error occurred while processing terminal telemetry."
    }
    records = [record for record in caplog.records if record.name == "backend.main"]
    assert len(records) == 1
    assert records[0].levelno == logging.ERROR
    assert records[0].getMessage() == f"Unhandled exception on /api/state: {exc}"
    assert records[0].exc_info is not None
    assert records[0].exc_info[1] is exc
    assert records[0].exc_info[2] is not None


@pytest.mark.parametrize("path", ["/api/unknown", "/api/v1/unknown"])
async def test_invalid_endpoint_returns_json(api: httpx.AsyncClient, path: str) -> None:
    response = await api.get(path)

    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"detail": "Not Found"}


@pytest.mark.parametrize("path", ["/api/decompose", "/api/v1/triage/study"])
async def test_validation_error_returns_json(api: httpx.AsyncClient, path: str) -> None:
    response = await api.post(path, json={})

    assert response.status_code == 422
    assert response.headers["content-type"] == "application/json"
    assert response.json()["detail"]
