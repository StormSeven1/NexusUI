import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Asset(Base):
    """我方资产（雷达、摄像头、塔台、无人机、卫星等）。"""

    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(Text, default="")
    asset_type: Mapped[str] = mapped_column(Text, default="tower")
    status: Mapped[str] = mapped_column(Text, default="online")
    lat: Mapped[float] = mapped_column(Float, default=0.0)
    lng: Mapped[float] = mapped_column(Float, default=0.0)
    range_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    heading: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fov_angle: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    properties: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 任务相关字段
    mission_status: Mapped[str] = mapped_column(Text, default="idle")  # idle/assigned/en_route/monitoring/returning
    assigned_target_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=_utcnow)
