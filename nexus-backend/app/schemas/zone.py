from datetime import datetime

from pydantic import BaseModel


class ZoneCreate(BaseModel):
    id: str | None = None
    name: str = ""
    zone_type: str = "custom"
    source: str = "user"
    coordinates: list[list[float]] = []
    color: str | None = None
    fill_color: str | None = None
    fill_opacity: float = 0.15
    properties: dict | None = None


class ZoneUpdate(BaseModel):
    name: str | None = None
    zone_type: str | None = None
    coordinates: list[list[float]] | None = None
    color: str | None = None
    fill_color: str | None = None
    fill_opacity: float | None = None
    properties: dict | None = None


class ZoneOut(BaseModel):
    id: str
    name: str
    zone_type: str
    source: str
    coordinates: list[list[float]]
    color: str | None
    fill_color: str | None
    fill_opacity: float
    properties: dict | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
