"""
同步数据库访问层，供工具 handler（同步函数）使用。
工具 handler 运行在事件循环线程中但自身是同步的，
因此需要一个独立的同步引擎来执行 DB 操作。
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

_sync_url = settings.database_url.replace("+aiosqlite", "")
sync_engine = create_engine(_sync_url, echo=False)
SyncSession = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)


def get_sync_session() -> Session:
    return SyncSession()
