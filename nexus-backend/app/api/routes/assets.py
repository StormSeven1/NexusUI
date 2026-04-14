"""
资产 CRUD 端点：管理我方雷达、摄像头、无人机等传感器资产。
"""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models import Asset
from app.schemas.asset import AssetCreate, AssetOut, AssetUpdate

router = APIRouter(prefix="/assets", tags=["assets"])


def _asset_to_out(asset: Asset) -> dict:
    return {
        "id": asset.id,
        "name": asset.name,
        "asset_type": asset.asset_type,
        "status": asset.status,
        "lat": asset.lat,
        "lng": asset.lng,
        "range_km": asset.range_km,
        "heading": asset.heading,
        "fov_angle": asset.fov_angle,
        "properties": json.loads(asset.properties) if asset.properties else None,
        "mission_status": asset.mission_status,
        "assigned_target_id": asset.assigned_target_id,
        "target_lat": asset.target_lat,
        "target_lng": asset.target_lng,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
    }


@router.get("", response_model=list[AssetOut])
async def list_assets(
    asset_type: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Asset).order_by(Asset.created_at)
    if asset_type and asset_type != "all":
        stmt = stmt.where(Asset.asset_type == asset_type)
    if status and status != "all":
        stmt = stmt.where(Asset.status == status)
    result = await db.execute(stmt)
    return [_asset_to_out(a) for a in result.scalars().all()]


@router.post("", response_model=AssetOut, status_code=201)
async def create_asset(body: AssetCreate, db: AsyncSession = Depends(get_db)):
    asset = Asset(
        id=body.id or uuid.uuid4().hex,
        name=body.name,
        asset_type=body.asset_type,
        status=body.status,
        lat=body.lat,
        lng=body.lng,
        range_km=body.range_km,
        heading=body.heading,
        fov_angle=body.fov_angle,
        properties=json.dumps(body.properties) if body.properties else None,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return _asset_to_out(asset)


@router.get("/{asset_id}", response_model=AssetOut)
async def get_asset(asset_id: str, db: AsyncSession = Depends(get_db)):
    asset = await db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(404, "资产不存在")
    return _asset_to_out(asset)


@router.patch("/{asset_id}", response_model=AssetOut)
async def update_asset(asset_id: str, body: AssetUpdate, db: AsyncSession = Depends(get_db)):
    asset = await db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(404, "资产不存在")
    updates = body.model_dump(exclude_unset=True)
    if "properties" in updates and updates["properties"] is not None:
        updates["properties"] = json.dumps(updates["properties"])
    for field, value in updates.items():
        setattr(asset, field, value)
    await db.commit()
    await db.refresh(asset)
    return _asset_to_out(asset)


@router.delete("/{asset_id}", status_code=204)
async def delete_asset(asset_id: str, db: AsyncSession = Depends(get_db)):
    asset = await db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(404, "资产不存在")
    await db.delete(asset)
    await db.commit()
