"""
区域 CRUD 端点：管理限制区域、标绘区域等。
"""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models import Zone
from app.schemas.zone import ZoneCreate, ZoneOut, ZoneUpdate

router = APIRouter(prefix="/zones", tags=["zones"])


def _zone_to_out(zone: Zone) -> dict:
    """将 ORM Zone 转为 API 响应字典（解析 JSON 字段）。"""
    data = {
        "id": zone.id,
        "name": zone.name,
        "zone_type": zone.zone_type,
        "source": zone.source,
        "coordinates": json.loads(zone.coordinates) if zone.coordinates else [],
        "color": zone.color,
        "fill_color": zone.fill_color,
        "fill_opacity": zone.fill_opacity,
        "properties": json.loads(zone.properties) if zone.properties else None,
        "created_at": zone.created_at,
        "updated_at": zone.updated_at,
    }
    return data


@router.get("", response_model=list[ZoneOut])
async def list_zones(
    zone_type: str | None = None,
    source: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Zone).order_by(Zone.created_at)
    if zone_type:
        stmt = stmt.where(Zone.zone_type == zone_type)
    if source:
        stmt = stmt.where(Zone.source == source)
    result = await db.execute(stmt)
    return [_zone_to_out(z) for z in result.scalars().all()]


@router.post("", response_model=ZoneOut, status_code=201)
async def create_zone(body: ZoneCreate, db: AsyncSession = Depends(get_db)):
    zone = Zone(
        id=body.id or uuid.uuid4().hex,
        name=body.name,
        zone_type=body.zone_type,
        source=body.source,
        coordinates=json.dumps(body.coordinates),
        color=body.color,
        fill_color=body.fill_color,
        fill_opacity=body.fill_opacity,
        properties=json.dumps(body.properties) if body.properties else None,
    )
    db.add(zone)
    await db.commit()
    await db.refresh(zone)
    return _zone_to_out(zone)


@router.get("/{zone_id}", response_model=ZoneOut)
async def get_zone(zone_id: str, db: AsyncSession = Depends(get_db)):
    zone = await db.get(Zone, zone_id)
    if not zone:
        raise HTTPException(404, "区域不存在")
    return _zone_to_out(zone)


@router.patch("/{zone_id}", response_model=ZoneOut)
async def update_zone(zone_id: str, body: ZoneUpdate, db: AsyncSession = Depends(get_db)):
    zone = await db.get(Zone, zone_id)
    if not zone:
        raise HTTPException(404, "区域不存在")
    updates = body.model_dump(exclude_unset=True)
    if "coordinates" in updates:
        updates["coordinates"] = json.dumps(updates["coordinates"])
    if "properties" in updates and updates["properties"] is not None:
        updates["properties"] = json.dumps(updates["properties"])
    for field, value in updates.items():
        setattr(zone, field, value)
    await db.commit()
    await db.refresh(zone)
    return _zone_to_out(zone)


@router.delete("/{zone_id}", status_code=204)
async def delete_zone(zone_id: str, db: AsyncSession = Depends(get_db)):
    zone = await db.get(Zone, zone_id)
    if not zone:
        raise HTTPException(404, "区域不存在")
    await db.delete(zone)
    await db.commit()
