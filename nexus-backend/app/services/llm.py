"""
OpenRouter / OpenAI 兼容 LLM 客户端封装。
支持流式输出 + function calling 工具循环。
"""

import json
from typing import Any, AsyncGenerator

from openai import AsyncOpenAI

from app.core.config import settings
from app.services.tools import TOOL_DEFINITIONS, execute_tool

SYSTEM_PROMPT = """你是 NexusUI 态势感知系统的 AI 助手，代号"Nexus"。你可以帮助操作员分析空中、水面、水下目标态势，查询目标信息，并控制地图和系统面板。

你的能力包括：
- 在地图上导航到指定坐标位置
- 选中并查看特定目标(track)的详细信息
- 切换地图 2D/3D 显示模式
- 打开系统面板（概览、仪表、通信、环境、日志、数据）
- 查询目标列表和态势信息

回复要求：
- 使用中文回复
- 回答简洁专业，适合态势感知场景
- 执行操作后简要说明已完成的动作
- 调用工具后根据返回结果给出简短总结，不要重复调用同一个工具"""

client = AsyncOpenAI(
    base_url=settings.openai_base_url,
    api_key=settings.openai_api_key,
    default_headers={"HTTP-Referer": "https://nexusui.local", "X-Title": "NexusUI"},
)

SSE_MSG_START = "message_start"
SSE_TEXT_DELTA = "text_delta"
SSE_TOOL_CALL = "tool_call"
SSE_TOOL_RESULT = "tool_result"
SSE_STEP_DONE = "step_done"
SSE_MSG_DONE = "message_done"
SSE_ERROR = "error"

MAX_TOOL_STEPS = 5


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_chat(
    messages: list[dict[str, Any]],
    model: str | None = None,
    system_prompt: str | None = None,
) -> AsyncGenerator[str, None]:
    model_id = model or settings.openai_model
    sys_prompt = system_prompt or SYSTEM_PROMPT
    use_tools = not settings.disable_tools

    api_messages: list[dict[str, Any]] = [{"role": "system", "content": sys_prompt}, *messages]

    yield _sse(SSE_MSG_START, {"message_id": ""})

    for _ in range(MAX_TOOL_STEPS):
        try:
            request_kwargs: dict[str, Any] = {
                "model": model_id,
                "messages": api_messages,
                "stream": True,
            }
            if use_tools:
                request_kwargs["tools"] = TOOL_DEFINITIONS

            response = await client.chat.completions.create(**request_kwargs)
        except Exception as exc:
            yield _sse(SSE_ERROR, {"message": str(exc)})
            return

        collected_text = ""
        tool_calls_acc: dict[int, dict[str, Any]] = {}
        finish_reason = None

        async for chunk in response:
            delta = chunk.choices[0].delta if chunk.choices else None
            if not delta:
                continue

            if chunk.choices[0].finish_reason:
                finish_reason = chunk.choices[0].finish_reason

            if delta.content:
                collected_text += delta.content
                yield _sse(SSE_TEXT_DELTA, {"text": delta.content})

            if delta.tool_calls:
                for tool_call in delta.tool_calls:
                    idx = tool_call.index
                    if idx not in tool_calls_acc:
                        tool_calls_acc[idx] = {"id": "", "name": "", "arguments": ""}
                    if tool_call.id:
                        tool_calls_acc[idx]["id"] = tool_call.id
                    if tool_call.function:
                        if tool_call.function.name:
                            tool_calls_acc[idx]["name"] = tool_call.function.name
                        if tool_call.function.arguments:
                            tool_calls_acc[idx]["arguments"] += tool_call.function.arguments

        if not tool_calls_acc:
            yield _sse(SSE_MSG_DONE, {"finish_reason": finish_reason or "stop", "text": collected_text})
            return

        assistant_message: dict[str, Any] = {"role": "assistant", "content": collected_text or None, "tool_calls": []}
        for idx in sorted(tool_calls_acc):
            tool_call = tool_calls_acc[idx]
            assistant_message["tool_calls"].append({
                "id": tool_call["id"],
                "type": "function",
                "function": {"name": tool_call["name"], "arguments": tool_call["arguments"]},
            })
        api_messages.append(assistant_message)

        for idx in sorted(tool_calls_acc):
            tool_call = tool_calls_acc[idx]
            try:
                args = json.loads(tool_call["arguments"]) if tool_call["arguments"] else {}
            except json.JSONDecodeError:
                args = {}

            yield _sse(SSE_TOOL_CALL, {"tool_call_id": tool_call["id"], "tool_name": tool_call["name"], "args": args})

            result = execute_tool(tool_call["name"], args)
            yield _sse(SSE_TOOL_RESULT, {"tool_call_id": tool_call["id"], "tool_name": tool_call["name"], "result": result})

            api_messages.append({
                "role": "tool",
                "tool_call_id": tool_call["id"],
                "content": json.dumps(result, ensure_ascii=False),
            })

        yield _sse(SSE_STEP_DONE, {})

    yield _sse(SSE_MSG_DONE, {"finish_reason": "max_steps", "text": collected_text})
