"""
会话管理 - 内存存储（轻量级，不依赖数据库）

提供会话的创建、查询、删除和消息管理功能。
数据仅保存在进程内存中，重启后清空。
"""

from datetime import datetime
from typing import Dict, List, Optional
from dataclasses import dataclass, field
import uuid


@dataclass
class ConversationMessage:
    id: str
    role: str
    content: str
    created_at: str


@dataclass
class Conversation:
    id: str
    title: str
    model: str
    created_at: str
    updated_at: str
    messages: List[ConversationMessage] = field(default_factory=list)


class ConversationStore:
    """内存会话存储"""

    def __init__(self):
        self._convs: Dict[str, Conversation] = {}

    # ── 会话 CRUD ──

    def list(self, limit: int = 50, offset: int = 0) -> List[dict]:
        items = sorted(self._convs.values(), key=lambda c: c.updated_at, reverse=True)
        page = items[offset: offset + limit]
        return [self._summary(c) for c in page]

    def get(self, conv_id: str) -> Optional[dict]:
        c = self._convs.get(conv_id)
        if not c:
            return None
        return {
            **self._summary(c),
            "messages": [
                {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at}
                for m in c.messages
            ],
            "system_prompt": "",
        }

    def create(self, title: str = "新对话", model: str = "") -> dict:
        now = datetime.utcnow().isoformat() + "Z"
        conv = Conversation(
            id=str(uuid.uuid4()),
            title=title,
            model=model,
            created_at=now,
            updated_at=now,
        )
        self._convs[conv.id] = conv
        return self._summary(conv)

    def update(self, conv_id: str, title: Optional[str] = None) -> Optional[dict]:
        c = self._convs.get(conv_id)
        if not c:
            return None
        if title is not None:
            c.title = title
        c.updated_at = datetime.utcnow().isoformat() + "Z"
        return self._summary(c)

    def delete(self, conv_id: str) -> bool:
        return self._convs.pop(conv_id, None) is not None

    # ── 消息管理 ──

    def add_message(self, conv_id: str, role: str, content: str) -> Optional[dict]:
        c = self._convs.get(conv_id)
        if not c:
            return None
        now = datetime.utcnow().isoformat() + "Z"
        msg = ConversationMessage(id=str(uuid.uuid4()), role=role, content=content, created_at=now)
        c.messages.append(msg)
        c.updated_at = now
        # 首条用户消息自动作为会话标题
        if role == "user" and c.title == "新对话":
            c.title = content[:40]
        return {"id": msg.id, "role": msg.role, "content": msg.content, "created_at": msg.created_at}

    def clear_messages(self, conv_id: str) -> bool:
        c = self._convs.get(conv_id)
        if not c:
            return False
        c.messages.clear()
        c.updated_at = datetime.utcnow().isoformat() + "Z"
        return True

    # ── 辅助 ──

    @staticmethod
    def _summary(c: Conversation) -> dict:
        return {
            "id": c.id,
            "title": c.title,
            "model": c.model,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }


# 全局单例
conversation_store = ConversationStore()
