"""
Local conversation storage.

Conversations are persisted to JSON files by day:
    data/conversations/conversations-YYYY-MM-DD.json

The store keeps chat history and disposal-plan history separated by category.
On startup it loads the latest 5 conversations for each category so history is
available after the Python service restarts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Dict, List, Optional
import uuid

from loguru import logger


MAX_STARTUP_CONVERSATIONS = 5
DEFAULT_CATEGORY = "chat"


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
    category: str
    created_at: str
    updated_at: str
    messages: List[ConversationMessage] = field(default_factory=list)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _date_part(iso_value: str) -> str:
    value = str(iso_value or "").strip()
    if len(value) >= 10:
        return value[:10]
    return _utc_now_iso()[:10]


def _clean_category(value: Optional[str]) -> str:
    category = str(value or "").strip()
    return category or DEFAULT_CATEGORY


def _conversation_from_dict(raw: dict) -> Optional[Conversation]:
    try:
        messages = [
            ConversationMessage(
                id=str(item.get("id") or uuid.uuid4()),
                role=str(item.get("role") or "user"),
                content=str(item.get("content") or ""),
                created_at=str(item.get("created_at") or _utc_now_iso()),
            )
            for item in raw.get("messages", [])
            if isinstance(item, dict)
        ]
        conv_id = str(raw.get("id") or "").strip()
        if not conv_id:
            return None
        return Conversation(
            id=conv_id,
            title=str(raw.get("title") or "新对话"),
            model=str(raw.get("model") or ""),
            category=_clean_category(raw.get("category")),
            created_at=str(raw.get("created_at") or _utc_now_iso()),
            updated_at=str(raw.get("updated_at") or raw.get("created_at") or _utc_now_iso()),
            messages=messages,
        )
    except Exception as exc:
        logger.warning(f"Skip invalid conversation record: {exc}")
        return None


class ConversationStore:
    """JSON-file backed conversation storage."""

    def __init__(self, storage_dir: Optional[Path] = None):
        base_dir = Path(__file__).resolve().parent
        self._storage_dir = storage_dir or (base_dir / "data" / "conversations")
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        self._convs: Dict[str, Conversation] = {}
        self._load_recent(MAX_STARTUP_CONVERSATIONS)

    def list(self, limit: int = 50, offset: int = 0, category: Optional[str] = None) -> List[dict]:
        items = sorted(self._convs.values(), key=lambda c: c.updated_at, reverse=True)
        if category:
            wanted = _clean_category(category)
            items = [c for c in items if c.category == wanted]
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

    def create(self, title: str = "新对话", model: str = "", category: str = DEFAULT_CATEGORY) -> dict:
        now = _utc_now_iso()
        conv = Conversation(
            id=str(uuid.uuid4()),
            title=title,
            model=model,
            category=_clean_category(category),
            created_at=now,
            updated_at=now,
        )
        self._convs[conv.id] = conv
        self._save_all()
        return self._summary(conv)

    def update(self, conv_id: str, title: Optional[str] = None) -> Optional[dict]:
        c = self._convs.get(conv_id)
        if not c:
            return None
        if title is not None:
            c.title = title
        c.updated_at = _utc_now_iso()
        self._save_all()
        return self._summary(c)

    def delete(self, conv_id: str) -> bool:
        removed = self._convs.pop(conv_id, None)
        if not removed:
            return False
        self._save_all()
        return True

    def add_message(self, conv_id: str, role: str, content: str) -> Optional[dict]:
        c = self._convs.get(conv_id)
        if not c:
            return None
        now = _utc_now_iso()
        msg = ConversationMessage(id=str(uuid.uuid4()), role=role, content=content, created_at=now)
        c.messages.append(msg)
        c.updated_at = now
        if role == "user" and c.title == "新对话":
            c.title = content[:40]
        self._save_all()
        return {"id": msg.id, "role": msg.role, "content": msg.content, "created_at": msg.created_at}

    def clear_messages(self, conv_id: str) -> bool:
        c = self._convs.get(conv_id)
        if not c:
            return False
        c.messages.clear()
        c.updated_at = _utc_now_iso()
        self._save_all()
        return True

    def _load_recent(self, limit: int) -> None:
        loaded: Dict[str, Conversation] = {}
        for path in sorted(self._storage_dir.glob("conversations-*.json"), reverse=True):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.warning(f"Failed to read conversation file {path}: {exc}")
                continue
            records = data.get("conversations") if isinstance(data, dict) else data
            if not isinstance(records, list):
                continue
            for raw in records:
                if not isinstance(raw, dict):
                    continue
                conv = _conversation_from_dict(raw)
                if conv:
                    loaded[conv.id] = conv

        selected: Dict[str, Conversation] = {}
        categories = sorted({c.category for c in loaded.values()})
        for category in categories:
            recent_for_category = [
                c for c in sorted(loaded.values(), key=lambda item: item.updated_at, reverse=True)
                if c.category == category
            ][:limit]
            for conv in recent_for_category:
                selected[conv.id] = conv

        recent = sorted(selected.values(), key=lambda c: c.updated_at, reverse=True)
        self._convs = {c.id: c for c in recent}
        logger.info(f"Loaded {len(self._convs)} recent conversations from {self._storage_dir}")

    def _save_all(self) -> None:
        by_day: Dict[str, List[Conversation]] = {}
        for conv in self._convs.values():
            by_day.setdefault(_date_part(conv.updated_at), []).append(conv)

        for day, conversations in by_day.items():
            self._write_day_file(day, conversations)

    def _write_day_file(self, day: str, conversations: List[Conversation]) -> None:
        path = self._storage_dir / f"conversations-{day}.json"
        existing: Dict[str, Conversation] = {}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                records = data.get("conversations") if isinstance(data, dict) else data
                if isinstance(records, list):
                    for raw in records:
                        if isinstance(raw, dict):
                            conv = _conversation_from_dict(raw)
                            if conv:
                                existing[conv.id] = conv
            except Exception as exc:
                logger.warning(f"Failed to merge conversation file {path}: {exc}")

        for conv in conversations:
            existing[conv.id] = conv

        records = [self._to_dict(c) for c in sorted(existing.values(), key=lambda item: item.updated_at, reverse=True)]
        payload = {"date": day, "conversations": records}
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(path)

    @staticmethod
    def _to_dict(c: Conversation) -> dict:
        return {
            "id": c.id,
            "title": c.title,
            "model": c.model,
            "category": c.category,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
            "messages": [
                {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at}
                for m in c.messages
            ],
        }

    @staticmethod
    def _summary(c: Conversation) -> dict:
        return {
            "id": c.id,
            "title": c.title,
            "model": c.model,
            "category": c.category,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }


conversation_store = ConversationStore()
