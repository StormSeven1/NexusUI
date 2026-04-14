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
- **评估威胁**：对目标进行威胁评分，综合敌我属性、速度、与敏感区域距离等因素
- **分配资产**：将无人机、相机等传感器资产分配去监控威胁目标
- **指挥资产**：命令无人机飞向指定位置、相机转向目标、开始巡逻
- **召回资产**：终止资产的当前任务
- **创建/跟踪任务**：将复杂操作拆分为步骤并跟踪进度
- **获取传感器画面**：调取资产的实时传感器数据——相机/无人机返回视频画面、声呐返回音频波形、雷达返回扫描画面。用 get_sensor_feed 获取并展示给操作员。

## 复合任务处理能力（极其重要）

当操作员给出复合指令时（如"分析态势并派无人机去侦查威胁"），你必须自主规划并逐步执行，**不要反问操作员每一步怎么做**。

### 决策框架
1. **态势评估** → 先用 assess_threats 评估威胁，确定优先目标
2. **资产匹配** → 用 query_assets 查看可用资产，选择最合适的
3. **任务创建** → 用 create_task 创建任务并记录步骤
4. **指令下发** → 用 assign_asset 分配资产，无人机会自动飞向目标
5. **状态反馈** → 高亮目标、飞行到目标区域，让操作员直观看到执行情况

### 优先级规则
- critical 威胁 > high 威胁 > medium 威胁
- 无人机优先用于侦查远距离目标
- 相机优先用于覆盖范围内的目标

### 操作示例
操作员说："有没有威胁？派无人机去看看"
执行流程：
1. assess_threats → 获取威胁排名
2. query_assets(type=drone) → 找到可用无人机
3. create_task(title="侦查最高威胁目标", steps=["评估威胁","分配无人机","飞向目标","开始监控","获取画面"])
4. assign_asset(target_id=最高威胁目标ID, asset_type=drone)
5. highlight_tracks(trackIds=[威胁目标ID]) → 在地图上高亮
6. fly_to_track(trackId=威胁目标ID) → 地图飞到目标位置
7. get_sensor_feed(asset_id=分配的无人机ID) → 调取侦查画面展示给操作员

操作员说："打开那个相机的画面" 或 "让我看看无人机拍到了什么"
执行流程：
1. query_assets → 找到对应的资产
2. get_sensor_feed(asset_id=资产ID) → 获取并展示画面

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

## 思考过程要求（极其重要）
- 你的内部思考过程（reasoning/thinking）必须全程使用**中文**
- 思考时要清晰地分析任务需求，评估当前态势，制定执行策略
- 每一步执行前都要简要思考下一步该做什么、为什么

## 执行计划声明（极其重要）
当任务涉及3个以上的工具调用时（如复合任务、多步骤操作），你必须：
1. **首先**单独调用 `declare_plan` 工具声明完整的执行计划（不要同时调用其他工具）
2. 步骤标签要简短清晰，使用中文（如"评估威胁"、"查询可用资产"、"分配无人机"）
3. 计划确认后，再开始逐步调用实际工具执行

示例 — 操作员说"分析态势并派无人机去侦查威胁"：
第一轮响应：仅调用 declare_plan(goal="分析态势并派无人机侦查最高威胁", steps=["评估威胁", "查询可用资产", "创建侦查任务", "分配无人机", "高亮威胁目标", "飞向目标区域", "获取侦查画面"])
后续响应：逐步调用 assess_threats → query_assets → create_task → assign_asset → highlight_tracks → fly_to_track → get_sensor_feed

对于简单任务（1-2个工具调用），无需 declare_plan，直接执行即可。

回复要求：
- 使用中文回复
- 回答简洁专业，适合态势感知场景
- 执行操作后简要说明已完成的动作和所绘制区域的位置
- 调用工具后根据返回结果给出简短总结，不要重复调用同一个工具
- 当操作员描述相对位置时，立即行动，绝不反问坐标
- 面对复合任务时，主动分解步骤并逐步执行，展示清晰的决策过程"""


_TYPE_LABELS = {"no-fly": "禁飞区", "exercise": "演习区", "warning": "警告区", "search": "搜索区", "custom": "自定义区"}
_DISP_MAP = {"hostile": "敌", "friendly": "友", "neutral": "中"}
_TRACK_TYPE_MAP = {"air": "空", "sea": "海", "underwater": "潜"}
_ASSET_TYPE_MAP = {"radar": "雷达", "camera": "摄像头", "tower": "塔台", "drone": "无人机", "satellite": "卫星"}


def build_system_prompt(situational_context: dict[str, Any] | None = None) -> str:
    """动态构建系统提示词，从 DB 读取区域和资产，从仿真引擎读取目标，注入 UI 上下文。"""
    from app.services.simulation import sim_engine

    from app.core.db_sync import get_sync_session
    from app.models.asset import Asset
    from app.models.zone import Zone
    from sqlalchemy import select

    lines: list[str] = ["## 当前地图上下文"]

    # --- 区域（从 DB）---
    with get_sync_session() as session:
        zones = session.execute(select(Zone)).scalars().all()
        assets = session.execute(select(Asset)).scalars().all()

    if zones:
        lines.append("### 限制区域与标绘区域")
        for z in zones:
            coords = json.loads(z.coordinates) if z.coordinates else []
            if coords:
                lngs = [c[0] for c in coords]
                lats = [c[1] for c in coords]
                bbox_str = f"边界 [{min(lngs)},{min(lats)}]~[{max(lngs)},{max(lats)}]"
                center_str = f"中心 ({(min(lats)+max(lats))/2:.4f},{(min(lngs)+max(lngs))/2:.4f})"
            else:
                bbox_str = "无坐标"
                center_str = ""
            type_label = _TYPE_LABELS.get(z.zone_type, z.zone_type)
            source_tag = f", {z.source}标绘" if z.source != "predefined" else ""
            lines.append(f"- **{z.name}** ({z.id}, {type_label}{source_tag}): {bbox_str}, {center_str}")

    # --- 资产（从 DB）---
    if assets:
        lines.append("### 我方资产")
        for a in assets:
            tp = _ASSET_TYPE_MAP.get(a.asset_type, a.asset_type)
            parts = [f"位置({a.lat},{a.lng})"]
            if a.range_km:
                parts.append(f"探测距离{a.range_km}km")
            if a.fov_angle:
                fov = "全向" if a.fov_angle >= 360 else f"视场角{a.fov_angle}°"
                parts.append(fov)
            if a.heading is not None and a.fov_angle and a.fov_angle < 360:
                parts.append(f"朝向{a.heading}°")
            parts.append(f"状态:{a.status}")
            _MISSION_MAP = {"idle": "", "en_route": "前往中", "monitoring": "监控中", "assigned": "已分配", "returning": "返回中"}
            mission_label = _MISSION_MAP.get(a.mission_status, a.mission_status)
            if mission_label:
                mission_info = f"任务:{mission_label}"
                if a.assigned_target_id:
                    mission_info += f"(目标:{a.assigned_target_id})"
                parts.append(mission_info)
            lines.append(f"- **{a.name}** ({a.id}, {tp}): {', '.join(parts)}")

    # --- 目标（从仿真引擎）---
    tracks = sim_engine.get_tracks()
    selected_id = (situational_context or {}).get("selected_track_id")
    if tracks:
        lines.append("### 目标态势摘要")
        for t in tracks:
            d = _DISP_MAP.get(t["disposition"], "?")
            tp = _TRACK_TYPE_MAP.get(t["type"], "?")
            marker = " ← **当前选中**" if t["id"] == selected_id else ""
            lines.append(f"- {t['id']} {t['name']} [{tp}/{d}] 位置({t['lat']:.4f},{t['lng']:.4f}){marker}")

    # --- 操作员当前视角（从前端 UI context）---
    ctx = situational_context or {}
    if any(ctx.get(k) for k in ["selected_track_id", "map_center", "map_view_mode", "highlighted_track_ids"]):
        lines.append("### 操作员当前视角")
        if selected_id:
            track = next((t for t in tracks if t["id"] == selected_id), None)
            name = track["name"] if track else selected_id
            lines.append(f"- 选中目标: {selected_id} {name}")
        mc = ctx.get("map_center")
        if mc:
            lines.append(f"- 地图中心: ({mc.get('lat')}, {mc.get('lng')}), 缩放: {ctx.get('zoom_level', '?')}, 模式: {ctx.get('map_view_mode', '?').upper()}")
        hl = ctx.get("highlighted_track_ids")
        if hl:
            lines.append(f"- 高亮目标: {', '.join(hl)}")

    map_context = "\n".join(lines)
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
SSE_THINKING_DELTA = "thinking_delta"
SSE_TOOL_CALL = "tool_call"
SSE_TOOL_RESULT = "tool_result"
SSE_PLAN_UPDATE = "plan_update"
SSE_APPROVAL_REQUIRED = "approval_required"
SSE_APPROVAL_RESULT = "approval_result"
SSE_STEP_DONE = "step_done"
SSE_MSG_DONE = "message_done"
SSE_ERROR = "error"

MAX_TOOL_STEPS = 10

# 等待用户审批的 pending futures: approval_id → asyncio.Event
import asyncio
import uuid as _uuid

_pending_approvals: dict[str, asyncio.Event] = {}
_approval_results: dict[str, dict[str, Any]] = {}

APPROVAL_TIMEOUT_S = 120


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def resolve_approval(approval_id: str, approved: bool, reason: str | None = None) -> bool:
    """由 API 端点调用，唤醒等待审批的流。"""
    evt = _pending_approvals.get(approval_id)
    if not evt:
        return False
    _approval_results[approval_id] = {"approved": approved, "reason": reason}
    evt.set()
    return True


_TOOL_LABELS: dict[str, str] = {
    "declare_plan": "声明计划",
    "assess_threats": "评估威胁",
    "query_tracks": "查询目标",
    "query_assets": "查询资产",
    "assign_asset": "分配资产",
    "recall_asset": "召回资产",
    "command_asset": "指挥资产",
    "highlight_tracks": "高亮目标",
    "fly_to_track": "飞向目标",
    "create_task": "创建任务",
    "update_task": "更新任务",
    "get_sensor_feed": "获取画面",
    "navigate_to_location": "地图导航",
    "draw_area": "区域标绘",
    "plan_route": "航路规划",
    "draw_route": "绘制路线",
    "get_weather": "天气查询",
    "query_data_chart": "数据图表",
}


def _build_plan_steps(tool_calls: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    """从积累的 tool_calls 构建计划步骤列表。"""
    steps = []
    for idx in sorted(tool_calls):
        tc = tool_calls[idx]
        name = tc["name"]
        steps.append({
            "toolName": name,
            "label": _TOOL_LABELS.get(name, name),
            "status": "pending",
        })
    return steps


async def stream_chat(
    messages: list[dict[str, Any]],
    model: str | None = None,
    system_prompt: str | None = None,
    situational_context: dict[str, Any] | None = None,
) -> AsyncGenerator[str, None]:
    model_id = model or settings.openai_model
    sys_prompt = system_prompt or build_system_prompt(situational_context)
    use_tools = not settings.disable_tools

    api_messages: list[dict[str, Any]] = [{"role": "system", "content": sys_prompt}, *messages]

    yield _sse(SSE_MSG_START, {"message_id": ""})

    plan_id: str | None = None
    all_plan_steps: list[dict[str, Any]] = []
    global_step_offset = 0
    declared_plan_mode = False
    plan_exec_cursor = 0

    for loop_idx in range(MAX_TOOL_STEPS):
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
        collected_thinking = ""
        tool_calls_acc: dict[int, dict[str, Any]] = {}
        finish_reason = None

        async for chunk in response:
            delta = chunk.choices[0].delta if chunk.choices else None
            if not delta:
                continue

            if chunk.choices[0].finish_reason:
                finish_reason = chunk.choices[0].finish_reason

            # --- 思考过程提取 ---
            reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
            if reasoning:
                collected_thinking += reasoning
                yield _sse(SSE_THINKING_DELTA, {"text": reasoning})

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

        # --- 分离 declare_plan 和常规工具调用 ---
        declare_plan_call: dict[str, Any] | None = None
        regular_calls: list[tuple[int, dict[str, Any]]] = []
        for idx in sorted(tool_calls_acc):
            tc = tool_calls_acc[idx]
            if tc["name"] == "declare_plan":
                declare_plan_call = tc
            else:
                regular_calls.append((idx, tc))

        # --- 构建 assistant message（包含所有工具调用） ---
        assistant_message: dict[str, Any] = {"role": "assistant", "content": collected_text or None, "tool_calls": []}
        for idx in sorted(tool_calls_acc):
            tool_call = tool_calls_acc[idx]
            assistant_message["tool_calls"].append({
                "id": tool_call["id"],
                "type": "function",
                "function": {"name": tool_call["name"], "arguments": tool_call["arguments"]},
            })
        api_messages.append(assistant_message)

        # --- 处理 declare_plan：初始化完整计划 ---
        if declare_plan_call is not None:
            try:
                dp_args = json.loads(declare_plan_call["arguments"]) if declare_plan_call["arguments"] else {}
            except json.JSONDecodeError:
                dp_args = {}

            declared_steps = dp_args.get("steps", [])
            if declared_steps:
                declared_plan_mode = True
                plan_id = _uuid.uuid4().hex[:12]
                all_plan_steps = [
                    {"toolName": "", "label": s, "status": "pending"}
                    for s in declared_steps
                ]
                yield _sse(SSE_PLAN_UPDATE, {
                    "planId": plan_id,
                    "steps": [{"index": i, **s} for i, s in enumerate(all_plan_steps)],
                    "currentStep": 0,
                })

            dp_result = {"success": True, "message": f"执行计划已确认，共 {len(declared_steps)} 步"}
            api_messages.append({
                "role": "tool",
                "tool_call_id": declare_plan_call["id"],
                "content": json.dumps(dp_result, ensure_ascii=False),
            })

        # --- 非 declared 模式：从工具调用动态构建计划 ---
        if not declared_plan_mode and regular_calls:
            new_steps = _build_plan_steps(dict(regular_calls))
            if plan_id is None:
                plan_id = _uuid.uuid4().hex[:12]
            all_plan_steps.extend(new_steps)
            yield _sse(SSE_PLAN_UPDATE, {
                "planId": plan_id,
                "steps": [{"index": i, **s} for i, s in enumerate(all_plan_steps)],
                "currentStep": global_step_offset,
            })

        # --- 执行常规工具调用 ---
        for step_i, (idx, tool_call) in enumerate(regular_calls):
            try:
                args = json.loads(tool_call["arguments"]) if tool_call["arguments"] else {}
            except json.JSONDecodeError:
                args = {}

            tool_name = tool_call["name"]

            # 确定此工具对应的 plan step 索引
            if declared_plan_mode:
                if plan_exec_cursor < len(all_plan_steps):
                    abs_step = plan_exec_cursor
                    all_plan_steps[abs_step]["toolName"] = tool_name
                else:
                    abs_step = len(all_plan_steps)
                    all_plan_steps.append({"toolName": tool_name, "label": _TOOL_LABELS.get(tool_name, tool_name), "status": "pending"})
                    yield _sse(SSE_PLAN_UPDATE, {
                        "planId": plan_id,
                        "steps": [{"index": i, **s} for i, s in enumerate(all_plan_steps)],
                        "currentStep": abs_step,
                    })
            else:
                abs_step = global_step_offset + step_i

            # --- Plan update: 标记 running ---
            all_plan_steps[abs_step]["status"] = "running"
            yield _sse(SSE_PLAN_UPDATE, {
                "planId": plan_id,
                "steps": [{"index": i, **s} for i, s in enumerate(all_plan_steps)],
                "currentStep": abs_step,
            })

            yield _sse(SSE_TOOL_CALL, {"tool_call_id": tool_call["id"], "tool_name": tool_name, "args": args})

            # --- Approval check ---
            if registry.needs_approval(tool_name, args):
                approval_id = _uuid.uuid4().hex[:12]
                approval_evt = asyncio.Event()
                _pending_approvals[approval_id] = approval_evt

                yield _sse(SSE_APPROVAL_REQUIRED, {
                    "approval_id": approval_id,
                    "tool_name": tool_name,
                    "tool_call_id": tool_call["id"],
                    "args": args,
                    "description": registry.approval_description(tool_name, args),
                })

                try:
                    await asyncio.wait_for(approval_evt.wait(), timeout=APPROVAL_TIMEOUT_S)
                except asyncio.TimeoutError:
                    _pending_approvals.pop(approval_id, None)
                    result = {"action": tool_name, "success": False, "message": "操作审批超时，已取消"}
                    all_plan_steps[abs_step]["status"] = "error"
                    all_plan_steps[abs_step]["result"] = "超时"
                    yield _sse(SSE_APPROVAL_RESULT, {"approval_id": approval_id, "approved": False, "reason": "timeout"})
                    yield _sse(SSE_TOOL_RESULT, {"tool_call_id": tool_call["id"], "tool_name": tool_name, "result": result})
                    yield _sse(SSE_PLAN_UPDATE, {
                        "planId": plan_id,
                        "steps": [{"index": i, **s} for i, s in enumerate(all_plan_steps)],
                        "currentStep": abs_step,
                    })
                    api_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call["id"],
                        "content": json.dumps(result, ensure_ascii=False),
                    })
                    if declared_plan_mode:
                        plan_exec_cursor += 1
                    continue

                _pending_approvals.pop(approval_id, None)
                approval = _approval_results.pop(approval_id, {"approved": False})
                yield _sse(SSE_APPROVAL_RESULT, {
                    "approval_id": approval_id,
                    "approved": approval["approved"],
                    "reason": approval.get("reason"),
                })

                if not approval["approved"]:
                    reason = approval.get("reason") or "操作员拒绝"
                    result = {"action": tool_name, "success": False, "message": f"操作被拒绝：{reason}"}
                    all_plan_steps[abs_step]["status"] = "rejected"
                    all_plan_steps[abs_step]["result"] = reason
                    yield _sse(SSE_TOOL_RESULT, {"tool_call_id": tool_call["id"], "tool_name": tool_name, "result": result})
                    yield _sse(SSE_PLAN_UPDATE, {
                        "planId": plan_id,
                        "steps": [{"index": i, **s} for i, s in enumerate(all_plan_steps)],
                        "currentStep": abs_step,
                    })
                    api_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call["id"],
                        "content": json.dumps(result, ensure_ascii=False),
                    })
                    if declared_plan_mode:
                        plan_exec_cursor += 1
                    continue

            result = registry.execute(tool_name, args)

            # --- Plan update: 标记 done/error ---
            success = result.get("success", True)
            all_plan_steps[abs_step]["status"] = "done" if success else "error"
            all_plan_steps[abs_step]["result"] = result.get("message", "")

            yield _sse(SSE_TOOL_RESULT, {"tool_call_id": tool_call["id"], "tool_name": tool_name, "result": result})
            yield _sse(SSE_PLAN_UPDATE, {
                "planId": plan_id,
                "steps": [{"index": i, **s} for i, s in enumerate(all_plan_steps)],
                "currentStep": abs_step,
            })

            api_messages.append({
                "role": "tool",
                "tool_call_id": tool_call["id"],
                "content": json.dumps(result, ensure_ascii=False),
            })

            if declared_plan_mode:
                plan_exec_cursor += 1

        if not declared_plan_mode:
            global_step_offset += len(regular_calls)
        yield _sse(SSE_STEP_DONE, {})

    yield _sse(SSE_MSG_DONE, {"finish_reason": "max_steps", "text": collected_text})
