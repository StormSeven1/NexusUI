"""declare_plan 工具 — 由 LLM 在复杂任务开始前调用，声明完整执行计划。

实际逻辑在 llm.py 的 stream_chat 中处理，此处仅注册 handler 以使其出现在 definitions 中。
"""

from app.services.tool_registry import registry


@registry.handler("declare_plan")
def handle_declare_plan(args: dict) -> dict:
    steps = args.get("steps", [])
    return {
        "action": "declare_plan",
        "success": True,
        "message": f"执行计划已确认，共 {len(steps)} 步",
    }
