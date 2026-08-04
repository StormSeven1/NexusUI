"""Public auth configuration for the frontend."""
from fastapi import APIRouter

from auth.config import auth_public_config

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.get("/config")
async def get_auth_config():
    """
    Public: Keycloak adapter settings for the browser.
    Secrets stay on the server; only url/realm/clientId/enabled are exposed.
    """
    return auth_public_config()
