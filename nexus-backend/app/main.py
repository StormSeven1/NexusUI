from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.core.config import settings
from app.core.db import init_db
from app.services.simulation import sim_engine
from app.services.tool_registry import registry


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()

    registry.load_yaml()
    import app.services.tool_handlers  # noqa: F401  触发装饰器注册

    sim_engine.load_config()
    sim_engine.start()

    yield
    sim_engine.stop()


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_methods=settings.cors_allow_methods,
        allow_headers=settings.cors_allow_headers,
    )

    app.include_router(api_router, prefix=settings.api_prefix)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
