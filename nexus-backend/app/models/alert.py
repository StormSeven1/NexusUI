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


class Alert(Base):
    """实时告警记录。"""

    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    severity: Mapped[str] = mapped_column(Text, default="info")  # critical/warning/info
    message: Mapped[str] = mapped_column(Text, default="")
    alert_type: Mapped[str] = mapped_column(Text, default="general")  # zone_intrusion/asset_approach/speed_anomaly
    track_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    resolved: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
