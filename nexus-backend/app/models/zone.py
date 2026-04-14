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


class Zone(Base):
    """统一管理预设限制区域 + AI/用户标绘区域。"""

    __tablename__ = "zones"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(Text, default="")
    zone_type: Mapped[str] = mapped_column(Text, default="custom")
    source: Mapped[str] = mapped_column(Text, default="predefined")
    coordinates: Mapped[str] = mapped_column(Text, default="[]")
    color: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    fill_color: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    fill_opacity: Mapped[float] = mapped_column(Float, default=0.15)
    properties: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=_utcnow)
