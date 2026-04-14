"""
数据库种子数据：首次启动时写入预设区域和资产。
仅在对应表为空时执行，不覆盖已有数据。
"""

import json
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.zone import Zone

logger = logging.getLogger(__name__)

_SEED_ZONES = [
    {
        "id": "ZON-001",
        "name": "禁飞区 Alpha",
        "zone_type": "no-fly",
        "source": "predefined",
        "coordinates": [[-2.60, 51.10], [-2.30, 51.10], [-2.30, 51.25], [-2.60, 51.25], [-2.60, 51.10]],
        "color": "#ef4444",
        "fill_color": "#ef4444",
        "fill_opacity": 0.12,
    },
    {
        "id": "ZON-002",
        "name": "演习区 Bravo",
        "zone_type": "exercise",
        "source": "predefined",
        "coordinates": [[-1.95, 51.35], [-1.70, 51.35], [-1.70, 51.50], [-1.95, 51.50], [-1.95, 51.35]],
        "color": "#f59e0b",
        "fill_color": "#f59e0b",
        "fill_opacity": 0.10,
    },
    {
        "id": "ZON-003",
        "name": "警告区 Charlie",
        "zone_type": "warning",
        "source": "predefined",
        "coordinates": [[-2.80, 50.55], [-2.40, 50.55], [-2.35, 50.70], [-2.75, 50.75], [-2.80, 50.55]],
        "color": "#a855f7",
        "fill_color": "#a855f7",
        "fill_opacity": 0.10,
    },
]

_SEED_ASSETS = [
    {"id": "AST-001", "name": "Tower 6.5 光电", "asset_type": "tower", "status": "online", "lat": 51.3800, "lng": -2.3590, "range_km": 15, "heading": 45, "fov_angle": 120},
    {"id": "AST-002", "name": "雷达 Alpha", "asset_type": "radar", "status": "online", "lat": 51.5000, "lng": -2.5500, "range_km": 80, "fov_angle": 360},
    {"id": "AST-003", "name": "雷达 Bravo", "asset_type": "radar", "status": "online", "lat": 51.4500, "lng": -2.1000, "range_km": 80, "fov_angle": 360},
    {"id": "AST-004", "name": "雷达 Charlie", "asset_type": "radar", "status": "degraded", "lat": 51.6500, "lng": -1.9000, "range_km": 60, "fov_angle": 360},
    {"id": "AST-005", "name": "摄像头 West-01", "asset_type": "camera", "status": "online", "lat": 51.2000, "lng": -2.8000, "range_km": 8, "heading": 160, "fov_angle": 60},
    {"id": "AST-006", "name": "侦察无人机", "asset_type": "drone", "status": "online", "lat": 51.3500, "lng": -2.2000, "range_km": 25, "heading": 270, "fov_angle": 90},
    {"id": "AST-007", "name": "TV 天线门禁", "asset_type": "tower", "status": "online", "lat": 51.0500, "lng": -2.4000, "range_km": 10, "heading": 0, "fov_angle": 180},
    {"id": "AST-008", "name": "AIS 海岸站", "asset_type": "tower", "status": "online", "lat": 50.7000, "lng": -2.0000, "range_km": 50, "fov_angle": 360},
]


async def seed_data(session: AsyncSession) -> None:
    """向空表中写入种子数据。"""

    zone_count = (await session.execute(select(func.count()).select_from(Zone))).scalar_one()
    if zone_count == 0:
        for entry in _SEED_ZONES:
            coords = entry.pop("coordinates")
            session.add(Zone(**entry, coordinates=json.dumps(coords)))
        logger.info("Seeded %d zones", len(_SEED_ZONES))

    asset_count = (await session.execute(select(func.count()).select_from(Asset))).scalar_one()
    if asset_count == 0:
        for entry in _SEED_ASSETS:
            session.add(Asset(**entry))
        logger.info("Seeded %d assets", len(_SEED_ASSETS))

    await session.commit()
