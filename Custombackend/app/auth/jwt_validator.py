"""Validate Keycloak access tokens via JWKS."""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, Optional

import jwt
from jwt import PyJWKClient
from loguru import logger

from auth.config import get_auth_settings


@lru_cache
def _jwks_client() -> PyJWKClient:
    s = get_auth_settings()
    return PyJWKClient(s.jwks_url, cache_keys=True, lifespan=3600)


def extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def verify_access_token(token: str) -> Dict[str, Any]:
    """
    Verify JWT signature (JWKS) and issuer.
    Audience is not strictly enforced (Keycloak often sets aud=account).
    Optionally requires KEYCLOAK_REQUIRED_CLIENT_ROLE on the client.
    """
    s = get_auth_settings()
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256", "ES384", "ES512"],
            issuer=s.issuer,
            options={
                "verify_aud": False,
                "require": ["exp", "iss"],
            },
        )
    except jwt.PyJWTError as e:
        logger.warning("JWT verification failed: {}", e)
        raise

    client_id = s.KEYCLOAK_CLIENT_ID
    azp = claims.get("azp") or claims.get("client_id")
    resource_access = claims.get("resource_access") or {}
    # Prefer azp == client_id; otherwise accept tokens that include our client in resource_access
    if azp and azp != client_id and client_id not in resource_access:
        logger.warning("JWT azp/client mismatch: azp={} expected={}", azp, client_id)
        raise jwt.InvalidTokenError("token client mismatch")

    required_role = (s.KEYCLOAK_REQUIRED_CLIENT_ROLE or "").strip()
    if required_role:
        roles = (
            (claims.get("resource_access") or {})
            .get(client_id, {})
            .get("roles", [])
        )
        if required_role not in roles:
            logger.warning(
                "JWT missing required client role {!r} for client {}",
                required_role,
                client_id,
            )
            raise jwt.InvalidTokenError("missing required client role")

    return claims
