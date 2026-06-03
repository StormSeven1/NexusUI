"""
Application entrypoint for the relay service.
"""

import asyncio
import signal
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from config import DDS_RECEIVERS, HTTP_POLLERS, MQTT_RECEIVERS, TCP_CLIENTS, UDP_RECEIVERS, get_settings
from database import DatabaseManager
from http_api import router as api_router, set_db_manager
from receivers.receiver_manager import receiver_manager
from websocket_manager import ws_manager


log_dir = Path("logs")
log_dir.mkdir(exist_ok=True)

logger.remove()
logger.add(
    sys.stderr,
    level="INFO",
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
)
logger.add(
    log_dir / "app.{time:YYYY-MM-DD}.log",
    rotation="1 day",
    retention="7 days",
    level="INFO",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    encoding="utf-8",
)

settings = get_settings()
db_manager: DatabaseManager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle."""
    global db_manager

    logger.info("=" * 60)
    logger.info("Starting relay service")
    logger.info("=" * 60)

    try:
        logger.info("Connecting to database...")
        db_manager = DatabaseManager(
            {
                "host": settings.DATABASE_HOST,
                "port": settings.DATABASE_PORT,
                "database": settings.DATABASE_NAME,
                "user": settings.DATABASE_USER,
                "password": settings.DATABASE_PASSWORD,
            }
        )

        db_connected = await db_manager.connect()
        if db_connected:
            set_db_manager(db_manager)

            logger.info("Loading DbAreas snapshot from database table area_table...")
            area_rows = await db_manager.get_area_table_rows()
            if area_rows is None:
                logger.error("Failed to load DbAreas snapshot from area_table; startup will stop")
                raise RuntimeError("Failed to load DbAreas snapshot from area_table")

            ws_manager.set_db_area_rows(area_rows)
            logger.info(f"Loaded DbAreas snapshot from area_table: {len(area_rows)} rows")

            schemes_data = await db_manager.get_alarm_schemes()
            if schemes_data is not None:
                ws_manager.set_schemes_data(schemes_data)
                logger.info(f"Loaded {len(schemes_data)} alarm schemes")
        else:
            logger.error("Database connection failed; startup will stop before websocket/receiver tasks")
            raise RuntimeError("Database connection failed")
    except Exception as exc:
        logger.exception(f"Database init or DbAreas load failed: {exc}")
        db_manager = None
        raise

    receiver_manager.local_interface = settings.LOCAL_INTERFACE

    ws_manager.heartbeat_interval = settings.HEARTBEAT_INTERVAL
    ws_manager.broadcast_interval = settings.BROADCAST_INTERVAL
    ws_manager.start_tasks()

    logger.info("Map MCP service is available through /api/map/*")

    logger.info("Starting UDP receivers...")
    receiver_manager.start_udp_receivers(UDP_RECEIVERS)

    logger.info("Starting TCP clients...")
    receiver_manager.start_tcp_clients(TCP_CLIENTS)

    logger.info("Starting MQTT receivers...")
    receiver_manager.start_mqtt_receivers(MQTT_RECEIVERS)

    logger.info("Starting DDS receivers...")
    receiver_manager.start_dds_receivers(DDS_RECEIVERS)

    logger.info("Starting HTTP pollers...")
    await receiver_manager.start_http_pollers(HTTP_POLLERS)

    logger.info("=" * 60)
    logger.info(f"Service started: http://{settings.HOST}:{settings.PORT}")
    logger.info(f"WebSocket endpoint: ws://{settings.HOST}:{settings.PORT}/ws")
    logger.info("=" * 60)

    yield

    logger.info("Shutting down service...")

    receiver_manager.stop_all()
    await receiver_manager.stop_http_pollers()
    ws_manager.stop_tasks()

    if db_manager:
        await db_manager.close()

    logger.info("Service stopped")


app = FastAPI(
    title="Relay Service",
    description="Receives multi-source runtime data and broadcasts normalized websocket messages",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    origin = websocket.headers.get("origin", "*")
    logger.info(f"WebSocket connect request, origin={origin}")
    await ws_manager.handle_connection(websocket)


def signal_handler(signum, frame):
    logger.info("Received interrupt signal, exiting...")
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    logger.info(f"Starting server on {settings.HOST}:{settings.PORT}")
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False,
        log_level="info",
        access_log=True,
    )
