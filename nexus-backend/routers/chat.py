import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database import async_session
from models import Conversation, Message
from schemas import ChatRequest
from services.llm import stream_chat, _sse, SSE_MSG_START, SSE_MSG_DONE

router = APIRouter(tags=["chat"])


def _build_openai_messages(db_messages: list[Message]) -> list[dict]:
    """将 DB 消息记录转换为 OpenAI messages 格式"""
    result = []
    for msg in db_messages:
        try:
            parts = json.loads(msg.content)
        except (json.JSONDecodeError, TypeError):
            parts = msg.content

        if msg.role == "user":
            if isinstance(parts, list):
                text = " ".join(p.get("text", "") for p in parts if p.get("type") == "text")
            else:
                text = str(parts)
            result.append({"role": "user", "content": text})

        elif msg.role == "assistant":
            if isinstance(parts, list):
                text = ""
                tool_calls_raw = []
                for p in parts:
                    if p.get("type") == "text":
                        text += p.get("text", "")
                    elif p.get("type", "").startswith("tool-"):
                        tool_calls_raw.append(p)
                entry: dict = {"role": "assistant", "content": text or None}
                if tool_calls_raw:
                    entry["tool_calls"] = [
                        {
                            "id": tc.get("toolCallId", ""),
                            "type": "function",
                            "function": {
                                "name": tc.get("toolName", tc.get("type", "").removeprefix("tool-")),
                                "arguments": json.dumps(tc.get("args", tc.get("input", {})), ensure_ascii=False),
                            },
                        }
                        for tc in tool_calls_raw
                    ]
                result.append(entry)
                for tc in tool_calls_raw:
                    if tc.get("result") or tc.get("output"):
                        result.append({
                            "role": "tool",
                            "tool_call_id": tc.get("toolCallId", ""),
                            "content": json.dumps(tc.get("result", tc.get("output", {})), ensure_ascii=False),
                        })
            else:
                result.append({"role": "assistant", "content": str(parts)})

    return result


def _generate_title(first_message: str) -> str:
    clean = first_message.strip().replace("\n", " ")
    return clean[:20] + ("..." if len(clean) > 20 else "")


@router.post("/chat")
async def chat_endpoint(body: ChatRequest):
    conv_id = body.conversation_id
    is_new = False
    conv_title = "新对话"
    system_prompt = ""

    # Phase 1: 在独立 session 中完成所有 DB 读写
    async with async_session() as db:
        if conv_id:
            result = await db.execute(
                select(Conversation)
                .where(Conversation.id == conv_id)
                .options(selectinload(Conversation.messages))
            )
            conv = result.scalar_one_or_none()
            if not conv:
                conv = Conversation(id=conv_id, title="新对话", model=body.model or "")
                db.add(conv)
                is_new = True
        else:
            conv_id = uuid.uuid4().hex
            conv = Conversation(id=conv_id, title="新对话", model=body.model or "")
            db.add(conv)
            is_new = True

        if body.parts:
            user_parts = [p.model_dump(by_alias=True, exclude_none=True) for p in body.parts]
        else:
            user_parts = [{"type": "text", "text": body.message}]

        user_msg = Message(
            conversation_id=conv_id,
            role="user",
            content=json.dumps(user_parts, ensure_ascii=False),
        )
        db.add(user_msg)

        if is_new:
            conv.title = _generate_title(body.message or (user_parts[0].get("text", "") if user_parts else ""))

        await db.commit()

        # 重新加载带 messages 的 conversation 来构建历史
        result = await db.execute(
            select(Conversation)
            .where(Conversation.id == conv_id)
            .options(selectinload(Conversation.messages))
        )
        conv = result.scalar_one()
        history_msgs = _build_openai_messages(conv.messages)
        conv_title = conv.title
        system_prompt = conv.system_prompt or ""

    # Phase 2: 纯流式，不依赖 DB session
    async def event_stream():
        collected_text = ""
        tool_parts: list[dict] = []

        async for sse_event in stream_chat(history_msgs, model=body.model, system_prompt=system_prompt or None):
            if "event: text_delta" in sse_event:
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
                    for tp in tool_parts:
                        if tp["toolCallId"] == data["tool_call_id"]:
                            tp["state"] = "output-available"
                            tp["output"] = data.get("result", {})
                            break
                except (json.JSONDecodeError, IndexError, KeyError):
                    pass

            if "event: message_done" in sse_event:
                try:
                    data = json.loads(sse_event.split("data: ", 1)[1].strip())
                    data["conversation_id"] = conv_id
                    data["title"] = conv_title
                    sse_event = _sse(SSE_MSG_DONE, data)
                except (json.JSONDecodeError, IndexError):
                    pass
            elif "event: message_start" in sse_event:
                try:
                    data = json.loads(sse_event.split("data: ", 1)[1].strip())
                    data["conversation_id"] = conv_id
                    sse_event = _sse(SSE_MSG_START, data)
                except (json.JSONDecodeError, IndexError):
                    pass

            yield sse_event

        # Phase 3: 流结束后用新 session 持久化 assistant 消息
        parts: list[dict] = []
        if collected_text:
            parts.append({"type": "text", "text": collected_text})
        parts.extend(tool_parts)

        if parts:
            async with async_session() as db2:
                assistant_msg = Message(
                    conversation_id=conv_id,
                    role="assistant",
                    content=json.dumps(parts, ensure_ascii=False),
                )
                db2.add(assistant_msg)
                conv_obj = await db2.get(Conversation, conv_id)
                if conv_obj:
                    conv_obj.updated_at = datetime.now(timezone.utc)
                await db2.commit()

    return StreamingResponse(event_stream(), media_type="text/event-stream")
