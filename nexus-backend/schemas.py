from datetime import datetime

from pydantic import BaseModel, Field


# ── Conversation ──


class ConversationCreate(BaseModel):
    title: str = "新对话"
    model: str = ""
    system_prompt: str = ""


class ConversationUpdate(BaseModel):
    title: str | None = None
    model: str | None = None
    system_prompt: str | None = None


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationOut(BaseModel):
    id: str
    title: str
    model: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationDetail(ConversationOut):
    messages: list[MessageOut] = []
    system_prompt: str = ""


# ── Chat ──


class ChatMessagePart(BaseModel):
    type: str
    text: str | None = None
    url: str | None = None
    media_type: str | None = Field(None, alias="mediaType")
    filename: str | None = None

    model_config = {"populate_by_name": True}


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = ""
    parts: list[ChatMessagePart] | None = None
    model: str | None = None
