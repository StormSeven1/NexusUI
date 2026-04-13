import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_app_factory_registers_health_and_api_routes():
    from app.main import create_app

    with TestClient(create_app()) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json() == {"status": "ok"}

        conversations = client.get("/api/conversations")
        assert conversations.status_code == 200


def test_app_module_exports_app():
    from app import app

    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
