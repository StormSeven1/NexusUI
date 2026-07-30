"""Keycloak auth settings (backend env only; frontend reads via /api/v1/auth/config)."""
from functools import lru_cache
from typing import Any, Dict

from pydantic_settings import BaseSettings, SettingsConfigDict


class AuthSettings(BaseSettings):
    """AUTH_* / KEYCLOAK_* from environment or Custombackend/app/.env."""

    AUTH_ENABLED: bool = False
    KEYCLOAK_URL: str = "http://192.168.18.141:1080"
    KEYCLOAK_REALM: str = "airia-dev"
    KEYCLOAK_CLIENT_ID: str = "battle_management"
    # Optional client role under resource_access[client_id].roles
    KEYCLOAK_REQUIRED_CLIENT_ROLE: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @property
    def issuer(self) -> str:
        base = self.KEYCLOAK_URL.rstrip("/")
        return f"{base}/realms/{self.KEYCLOAK_REALM}"

    @property
    def jwks_url(self) -> str:
        return f"{self.issuer}/protocol/openid-connect/certs"


@lru_cache
def get_auth_settings() -> AuthSettings:
    return AuthSettings()


def auth_public_config() -> Dict[str, Any]:
    """Safe subset for the browser (no secrets)."""
    s = get_auth_settings()
    return {
        "enabled": bool(s.AUTH_ENABLED),
        "url": s.KEYCLOAK_URL.rstrip("/"),
        "realm": s.KEYCLOAK_REALM,
        "clientId": s.KEYCLOAK_CLIENT_ID,
    }
