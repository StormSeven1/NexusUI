from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "NexusUI Backend"
    api_prefix: str = "/api"
    openai_base_url: str = "https://openrouter.ai/api/v1"
    openai_api_key: str = ""
    openai_model: str = "openai/gpt-oss-120b:free"
    disable_tools: bool = False
    database_url: str = "sqlite+aiosqlite:///./data/nexus.db"
    cors_allow_origins: list[str] = ["*"]
    cors_allow_methods: list[str] = ["*"]
    cors_allow_headers: list[str] = ["*"]


settings = Settings()
