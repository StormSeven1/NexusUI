from pydantic import BaseModel, Field


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
