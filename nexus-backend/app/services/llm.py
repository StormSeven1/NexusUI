"""
OpenRouter / OpenAI 兼容 LLM 客户端封装。
支持流式输出 + function calling 工具循环。
"""

import json
import logging
from typing import Any, AsyncGenerator

from openai import AsyncOpenAI

from app.core.config import settings
from app.services.tool_registry import registry

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT_TEMPLATE = """\
你是 NexusUI 态势感知系统的 AI 助手，代号"Nexus"。你可以帮助操作员分析空中、水面、水下目标态势，查询目标信息，并控制地图和系统面板。

你的能力包括：
- 在地图上导航到指定坐标位置
- 选中并查看特定目标(track)的详细信息
- 切换地图 2D/3D 显示模式
- 打开系统面板（概览、仪表、通信、环境、日志、数据）
- 查询目标列表和态势信息
- 统计目标数据并生成柱状图、饼状图等图表
- 查询指定位置的天气信息
- 在地图上标绘区域（多边形）
- 规划从起点到终点的航路
- 查询地图上下文（区域、目标位置）以理解空间关系

## 空间推理能力（极其重要）

你具备地图空间推理能力。操作员是指挥员，他们会用自然语言描述位置，**绝不会给你精确坐标**。你必须自己理解并计算坐标。

### 方位词对照表
| 操作员说法 | 地理含义 | 坐标变化 |
|-----------|---------|---------|
| 左侧/左边/西侧 | 向西 | 经度减小 (lng-) |
| 右侧/右边/东侧 | 向东 | 经度增大 (lng+) |
| 上方/北侧/北边 | 向北 | 纬度增大 (lat+) |
| 下方/南侧/南边 | 向南 | 纬度减小 (lat-) |
| 附近/周围/旁边 | 临近区域 | 小幅偏移 |
| 东北/西北/东南/西南 | 对角方向 | lat 和 lng 同时变化 |

### 操作规则
1. **绝不询问坐标**：当操作员用自然语言描述位置时，直接推算坐标并执行，不要反问"请提供坐标"。
2. **空间参考**：当操作员提到已知地物（禁飞区、演习区、目标编号等），利用下方的地图上下文或调用 query_map_context 工具获取其坐标，然后根据方位词计算目标位置。
3. **合理默认值**：
   - 没有指定区域大小时，默认生成与参考区域相近大小的矩形（约 0.15°×0.15° 或参考区域的尺寸）。
   - "左侧"默认偏移约为参考区域宽度的 1.0~1.5 倍（紧邻但不重叠）。
   - "附近"默认偏移约为参考区域尺寸的 0.3~0.5 倍。
4. **形状推断**：
   - "矩形区域" → 4 个顶点（西南、东南、东北、西北）
   - "搜索区域" → 默认矩形，除非另有说明
   - "圆形区域" → 用 12~16 个点近似
5. **标签推断**：根据上下文自动生成有意义的标签（如"搜索区域-Alpha西侧"）。

### 计算示例
操作员说："在禁飞区 Alpha 左侧画一个矩形搜索区域"
推理过程：
- 禁飞区 Alpha 的边界：西经 -2.60 ~ 东经 -2.30，南纬 51.10 ~ 北纬 51.25
- "左侧" = 西侧，紧邻禁飞区
- 区域宽度约 0.30°，高度约 0.15°（与 Alpha 相同大小）
- 矩形西边界 = Alpha 西边界 - 区域宽度 - 间隔 = -2.60 - 0.30 - 0.05 = -2.95
- 矩形东边界 = Alpha 西边界 - 间隔 = -2.60 - 0.05 = -2.65
- 矩形南北与 Alpha 对齐：51.10 ~ 51.25
- 最终 4 个顶点: (51.10,-2.95), (51.10,-2.65), (51.25,-2.65), (51.25,-2.95)

操作员说："在 TRK-003 附近标一个警戒区"
推理过程：
- 查询 TRK-003 位置：约 (51.51, -2.36)
- "附近" → 以目标为中心，向四周扩展约 0.1°
- 生成以目标为中心的矩形

{map_context}

回复要求：
- 使用中文回复
- 回答简洁专业，适合态势感知场景
- 执行操作后简要说明已完成的动作和所绘制区域的位置
- 调用工具后根据返回结果给出简短总结，不要重复调用同一个工具
- 当操作员描述相对位置时，立即行动，绝不反问坐标"""


def build_system_prompt() -> str:
    """动态构建系统提示词，注入当前地图上下文（区域 + 目标摘要）。"""
    from app.services.simulation import sim_engine

    lines: list[str] = []

    zones = sim_engine.get_zones()
    if zones:
        lines.append("## 当前地图上下文")
        lines.append("### 限制区域")
        for z in zones:
            bbox = z.get("bbox", {})
            center = z.get("center", {})
            type_label = {"no-fly": "禁飞区", "exercise": "演习区", "warning": "警告区"}.get(z["type"], z["type"])
            lines.append(
                f"- **{z['name']}** ({z['id']}, {type_label}): "
                f"边界 [{bbox.get('west')},{bbox.get('south')}]~[{bbox.get('east')},{bbox.get('north')}], "
                f"中心 ({center.get('lat')},{center.get('lng')})"
            )

    tracks = sim_engine.get_tracks()
    if tracks:
        disp_map = {"hostile": "敌", "friendly": "友", "neutral": "中"}
        type_map = {"air": "空", "sea": "海", "underwater": "潜"}
        lines.append("### 目标态势摘要")
        for t in tracks:
            d = disp_map.get(t["disposition"], "?")
            tp = type_map.get(t["type"], "?")
            lines.append(
                f"- {t['id']} {t['name']} [{tp}/{d}] 位置({t['lat']:.4f},{t['lng']:.4f})"
            )

    map_context = "\n".join(lines) if lines else ""
    return _SYSTEM_PROMPT_TEMPLATE.format(map_context=map_context)


# 保留旧名以兼容可能的外部引用
SYSTEM_PROMPT = _SYSTEM_PROMPT_TEMPLATE.format(map_context="")

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
    sys_prompt = system_prompt or build_system_prompt()
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
            if use_tools and registry.definitions:
                request_kwargs["tools"] = registry.definitions

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

            result = registry.execute(tool_call["name"], args)
            yield _sse(SSE_TOOL_RESULT, {"tool_call_id": tool_call["id"], "tool_name": tool_call["name"], "result": result})

            api_messages.append({
                "role": "tool",
                "tool_call_id": tool_call["id"],
                "content": json.dumps(result, ensure_ascii=False),
            })

        yield _sse(SSE_STEP_DONE, {})

    yield _sse(SSE_MSG_DONE, {"finish_reason": "max_steps", "text": collected_text})
