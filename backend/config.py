"""Environment-only configuration; credentials never enter API state or logs."""

from functools import lru_cache
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    canvas_api_url: str = "https://canvas.instructure.com"
    canvas_api_token: SecretStr = SecretStr("")
    supabase_url: str = ""
    supabase_key: SecretStr = SecretStr("")
    llm_base_url: str = "http://localhost:11434/v1"
    llm_api_key: SecretStr = SecretStr("ollama")
    llm_model: str = "llama3"
    meta_api_key: SecretStr = SecretStr("")
    meta_base_url: str = "https://api.llama.com/compat/v1"
    meta_model: str = "Llama-3.3-70B-Instruct"
    # Optional fast pre-filter that audits rubric constraints before the primary plan.
    auditor_api_key: SecretStr = SecretStr("")
    auditor_base_url: str = "https://api.deepseek.com/v1"
    auditor_model: str = "deepseek-flash"
    auditor_timeout_seconds: float = Field(default=6, gt=0, le=60)
    demo_mode: bool | None = None
    llm_timeout_seconds: float = Field(default=15, gt=0, le=120)
    # Any single Canvas request slower than this switches the sync to the simulation desk.
    canvas_timeout_seconds: float = Field(default=2.5, gt=0, le=60)
    apex_workspace_id: str = Field(default="default", min_length=1, max_length=100)
    # Deployed frontends (e.g. the Vercel URL) allowed by CORS on top of the local dev origins.
    cors_origins: Annotated[tuple[str, ...], NoDecode] = ()

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        return value.split(",") if isinstance(value, str) else value

    @field_validator("cors_origins")
    @classmethod
    def browser_origins(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        origins = []
        for raw in value:
            # Browsers send the origin without a trailing slash; a pasted URL often has one.
            origin = raw.strip().rstrip("/")
            if not origin:
                continue
            parts = urlsplit(origin)
            # Starlette compares origins literally, so a wildcard would never match.
            if (
                parts.scheme not in ("http", "https")
                or not parts.hostname
                or "*" in parts.netloc
                or parts.username
                or parts.password
                or parts.path
                or parts.query
                or parts.fragment
            ):
                raise ValueError(
                    "CORS_ORIGINS must be comma-separated origins such as https://apex.vercel.app"
                )
            # Browsers send the host in lowercase.
            origins.append(f"{parts.scheme}://{parts.netloc.lower()}")
        return tuple(origins)

    @field_validator("canvas_api_url")
    @classmethod
    def canvas_origin(cls, value: str) -> str:
        parts = urlsplit(value)
        if (
            parts.scheme != "https"
            or not parts.hostname
            or parts.username
            or parts.password
            or parts.path not in ("", "/")
            or parts.query
            or parts.fragment
        ):
            raise ValueError("CANVAS_API_URL must be an HTTPS origin without credentials")
        return value.rstrip("/")

    @field_validator("llm_base_url", "meta_base_url", "auditor_base_url", "supabase_url")
    @classmethod
    def service_url(cls, value: str) -> str:
        if not value:
            return value
        parts = urlsplit(value)
        if (
            parts.scheme not in ("http", "https")
            or not parts.hostname
            or parts.username
            or parts.password
            or parts.query
            or parts.fragment
        ):
            raise ValueError("Service URL must be an HTTP(S) URL without credentials")
        return value.rstrip("/")

    @model_validator(mode="after")
    def infer_demo_mode(self) -> "Settings":
        if self.demo_mode is None:
            self.demo_mode = not bool(self.canvas_api_token.get_secret_value().strip())
        return self

    @property
    def inference_base_url(self) -> str:
        return self.meta_base_url if self.meta_api_key.get_secret_value() else self.llm_base_url

    @property
    def inference_api_key(self) -> SecretStr:
        return self.meta_api_key if self.meta_api_key.get_secret_value() else self.llm_api_key

    @property
    def inference_model(self) -> str:
        return self.meta_model if self.meta_api_key.get_secret_value() else self.llm_model

    @property
    def auditor_enabled(self) -> bool:
        return bool(self.auditor_api_key.get_secret_value() and self.auditor_model.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
