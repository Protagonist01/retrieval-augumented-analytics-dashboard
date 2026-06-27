from pathlib import Path
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    llm_provider: Literal["openai", "ollama"] = "openai"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o"
    openai_max_tokens: int = 1024
    openrouter_api_key: str = ""
    openrouter_site_url: str = ""
    openrouter_app_name: str = "RAA Dashboard"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "sqlcoder:7b"

    duckdb_data_dir: Path = Path("./data/sample")
    max_result_rows: int = 10000
    query_timeout_seconds: int = 5

    redis_url: str = "redis://localhost:6379"
    schema_cache_ttl_seconds: int = 300
    query_cache_ttl_seconds: int = 60

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    log_level: str = "INFO"
    log_format: Literal["pretty", "json"] = "pretty"
    eval_model: str = "gpt-4o"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, v: str) -> str:
        if v not in ("openai", "ollama"):
            raise ValueError("llm_provider must be 'openai' or 'ollama'")
        return v

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @property
    def openai_compatible_api_key(self) -> str:
        return self.openrouter_api_key or self.openai_api_key

    @property
    def openai_compatible_headers(self) -> dict[str, str]:
        headers = {}
        if "openrouter.ai" in self.openai_base_url:
            if self.openrouter_site_url:
                headers["HTTP-Referer"] = self.openrouter_site_url
            if self.openrouter_app_name:
                headers["X-OpenRouter-Title"] = self.openrouter_app_name
        return headers


settings = Settings()
