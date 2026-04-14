import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.db import async_session
from app.models import Conversation, Message
from app.schemas import ChatRequest
from app.services.llm import SSE_MSG_DONE, SSE_MSG_START, _sse, stream_chat, resolve_approval

router = APIRouter(tags=["chat"])


class ApprovalRequest(BaseModel):
    approval_id: str
    approved: bool
    reason: str | None = None


def _build_openai_messages(db_messages: list[Message]) -> list[dict]:
    result = []
    for msg in db_messages:
        try:
            parts = json.loads(msg.content)
        except (json.JSONDecodeError, TypeError):
            parts = msg.content

        if msg.role == "user":
            if isinstance(parts, list):
                text = " ".join(part.get("text", "") for part in parts if part.get("type") == "text")
            else:
                text = str(parts)
            result.append({"role": "user", "content": text})
        elif msg.role == "assistant":
            if isinstance(parts, list):
                text = ""
                tool_calls_raw = []
                for part in parts:
                    if part.get("type") == "text":
                        text += part.get("text", "")
                    elif part.get("type", "").startswith("tool-"):
                        tool_calls_raw.append(part)
                entry: dict[str, object] = {"role": "assistant", "content": text or None}
                if tool_calls_raw:
                    entry["tool_calls"] = [
                        {
                            "id": tool_call.get("toolCallId", ""),
                            "type": "function",
                            "function": {
                                "name": tool_call.get("toolName", tool_call.get("type", "").removeprefix("tool-")),
                                "arguments": json.dumps(tool_call.get("args", tool_call.get("input", {})), ensure_ascii=False),
                            },
                        }
                        for tool_call in tool_calls_raw
                    ]
                result.append(entry)
                for tool_call in tool_calls_raw:
                    if tool_call.get("result") or tool_call.get("output"):
                        result.append({
                            "role": "tool",
                            "tool_call_id": tool_call.get("toolCallId", ""),
                            "content": json.dumps(tool_call.get("result", tool_call.get("output", {})), ensure_ascii=False),
                        })
            else:
                result.append({"role": "assistant", "content": str(parts)})

    return result


def _generate_title(first_message: str) -> str:
    clean = first_message.strip().replace("\n", " ")
    return clean[:20] + ("..." if len(clean) > 20 else "")


@router.post("/chat")
async def chat_endpoint(body: ChatRequest):
    conversation_id = body.conversation_id
    is_new = False
    conversation_title = "新对话"
    system_prompt = ""

    async with async_session() as db:
        if conversation_id:
            result = await db.execute(
                select(Conversation)
                .where(Conversation.id == conversation_id)
                .options(selectinload(Conversation.messages))
            )
            conversation = result.scalar_one_or_none()
            if not conversation:
                conversation = Conversation(id=conversation_id, title="新对话", model=body.model or "")
                db.add(conversation)
                is_new = True
        else:
            conversation_id = uuid.uuid4().hex
            conversation = Conversation(id=conversation_id, title="新对话", model=body.model or "")
            db.add(conversation)
            is_new = True

        if body.parts:
            user_parts = [part.model_dump(by_alias=True, exclude_none=True) for part in body.parts]
        else:
            user_parts = [{"type": "text", "text": body.message}]

        db.add(
            Message(
                conversation_id=conversation_id,
                role="user",
                content=json.dumps(user_parts, ensure_ascii=False),
            )
        )

        if is_new:
            conversation.title = _generate_title(body.message or (user_parts[0].get("text", "") if user_parts else ""))

        await db.commit()

        result = await db.execute(
            select(Conversation)
            .where(Conversation.id == conversation_id)
            .options(selectinload(Conversation.messages))
        )
        conversation = result.scalar_one()
        history_messages = _build_openai_messages(conversation.messages)
        conversation_title = conversation.title
        system_prompt = conversation.system_prompt or ""

    async def event_stream():
        collected_text = ""
        collected_thinking = ""
        tool_parts: list[dict] = []

        sit_ctx = body.situational_context.model_dump(by_alias=False) if body.situational_context else None
        async for sse_event in stream_chat(history_messages, model=body.model, system_prompt=system_prompt or None, situational_context=sit_ctx):
            if "event: thinking_delta" in sse_event:
                try:
                    data = json.loads(sse_event.split("data: ", 1)[1].strip())
                    collected_thinking += data.get("text", "")
                except (json.JSONDecodeError, IndexError):
                    pass
            elif "event: text_delta" in sse_event:
                try:
                    data = json.loads(sse_event.split("data: ", 1)[1].strip())
                    collected_text += data.get("text", "")
                except (json.JSONDecodeError, IndexError):
                    pass
            elif "event: tool_call" in sse_event:
                try:
                    data = json.loads(sse_event.split("data: ", 1)[1].strip())
                    tool_parts.append({
                        "type": f"tool-{data['tool_name']}",
                        "toolCallId": data["tool_call_id"],
                        "toolName": data["tool_name"],
                        "state": "input-available",
                        "input": data.get("args", {}),
                    })
                except (json.JSONDecodeError, IndexError, KeyError):
                    pass
            elif "event: tool_result" in sse_event:
                try:
                    data = json.loads(sse_event.split("data: ", 1)[1].strip())
                    for tool_part in tool_parts:
                        if tool_part["toolCallId"] == data["tool_call_id"]:
                            tool_part["state"] = "output-available"
                            tool_part["output"] = data.get("result", {})
                            break
                except (json.JSONDecodeError, IndexError, KeyError):
                    pass

            if "event: message_done" in sse_event:
                try:
                    data = json.loads(sse_event.split("data: ", 1)[1].strip())
                    data["conversation_id"] = conversation_id
                    data["title"] = conversation_title
                    sse_event = _sse(SSE_MSG_DONE, data)
                except (json.JSONDecodeError, IndexError):
                    pass
            elif "event: message_start" in sse_event:
                try:
                    data = json.loads(sse_event.split("data: ", 1)[1].strip())
                    data["conversation_id"] = conversation_id
                    sse_event = _sse(SSE_MSG_START, data)
                except (json.JSONDecodeError, IndexError):
                    pass

            yield sse_event

        parts: list[dict] = []
        if collected_thinking:
            parts.append({"type": "reasoning", "text": collected_thinking})
        if collected_text:
            parts.append({"type": "text", "text": collected_text})
        parts.extend(tool_parts)

        if parts:
            async with async_session() as db:
                db.add(
                    Message(
                        conversation_id=conversation_id,
                        role="assistant",
                        content=json.dumps(parts, ensure_ascii=False),
                    )
                )
                conversation = await db.get(Conversation, conversation_id)
                if conversation:
                    conversation.updated_at = datetime.now(timezone.utc)
                await db.commit()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/chat/approve")
async def approve_endpoint(body: ApprovalRequest):
    ok = resolve_approval(body.approval_id, body.approved, body.reason)
    if not ok:
        return {"success": False, "message": f"审批 {body.approval_id} 不存在或已过期"}
    return {"success": True, "approved": body.approved}
