from datetime import datetime

from pydantic import BaseModel


class AssetCreate(BaseModel):
    id: str | None = None
    name: str = ""
    asset_type: str = "tower"
    status: str = "online"
    lat: float = 0.0
    lng: float = 0.0
    range_km: float | None = None
    heading: float | None = None
    fov_angle: float | None = None
    properties: dict | None = None


class AssetUpdate(BaseModel):
    name: str | None = None
    asset_type: str | None = None
    status: str | None = None
    lat: float | None = None
    lng: float | None = None
    range_km: float | None = None
    heading: float | None = None
    fov_angle: float | None = None
    properties: dict | None = None


class AssetOut(BaseModel):
    id: str
    name: str
    asset_type: str
    status: str
    lat: float
    lng: float
    range_km: float | None
    heading: float | None
    fov_angle: float | None
    properties: dict | None = None
    mission_status: str = "idle"
    assigned_target_id: str | None = None
    target_lat: float | None = None
    target_lng: float | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
