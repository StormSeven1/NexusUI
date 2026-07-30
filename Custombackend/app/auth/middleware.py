"""HTTP middleware: Bearer JWT when AUTH_ENABLED; OPTIONS and public paths skipped."""
from __future__ import annotations

from typing import Callable, Set

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from auth.config import get_auth_settings
from auth.jwt_validator import extract_bearer_token, verify_access_token

# Paths that remain public when auth is enabled (prefix or exact).
PUBLIC_EXACT: Set[str] = {
    "/api/health",
    "/api/v1/auth/config",
    "/docs",
    "/openapi.json",
    "/redoc",
}

PUBLIC_PREFIXES = (
    "/docs",
    "/redoc",
)


def _is_public_path(path: str) -> bool:
    if path in PUBLIC_EXACT:
        return True
    for prefix in PUBLIC_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return True
    return False


class KeycloakAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # CORS preflight must pass without Authorization
        if request.method == "OPTIONS":
            return await call_next(request)

        settings = get_auth_settings()
        if not settings.AUTH_ENABLED:
            return await call_next(request)

        path = request.url.path
        if _is_public_path(path):
            return await call_next(request)

        # Only protect /api/* business routes (leave non-API alone)
        if not path.startswith("/api"):
            return await call_next(request)

        token = extract_bearer_token(request.headers.get("authorization"))
        if not token:
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing or invalid Authorization Bearer token"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        try:
            claims = verify_access_token(token)
            request.state.user = claims
        except Exception:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired token"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        return await call_next(request)
