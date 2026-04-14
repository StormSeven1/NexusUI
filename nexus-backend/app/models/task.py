import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Task(Base):
    """Agent 创建的任务记录。"""

    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    task_type: Mapped[str] = mapped_column(Text, default="recon")  # recon/patrol/assess/monitor
    title: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(Text, default="pending")  # pending/active/completed/failed
    target_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    assigned_assets: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array of asset IDs
    steps: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array of step dicts
    result: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=_utcnow)
