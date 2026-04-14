from pydantic import BaseModel, Field


class ChatMessagePart(BaseModel):
    type: str
    text: str | None = None
    url: str | None = None
    media_type: str | None = Field(None, alias="mediaType")
    filename: str | None = None

    model_config = {"populate_by_name": True}


class SituationalContext(BaseModel):
    """前端每次发送聊天时附带的 UI 态势快照。"""

    selected_track_id: str | None = Field(None, alias="selectedTrackId")
    map_center: dict | None = Field(None, alias="mapCenter")
    zoom_level: float | None = Field(None, alias="zoomLevel")
    map_view_mode: str | None = Field(None, alias="mapViewMode")
    highlighted_track_ids: list[str] | None = Field(None, alias="highlightedTrackIds")
    visible_layers: list[str] | None = Field(None, alias="visibleLayers")

    model_config = {"populate_by_name": True}


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = ""
    parts: list[ChatMessagePart] | None = None
    model: str | None = None
    situational_context: SituationalContext | None = Field(None, alias="situationalContext")

    model_config = {"populate_by_name": True}
