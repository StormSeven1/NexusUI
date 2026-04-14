"""
工具注册表：从 YAML 配置加载工具定义，通过装饰器注册 handler 函数。
"""

import logging
from pathlib import Path
from typing import Any, Callable

import yaml

logger = logging.getLogger(__name__)

HandlerFunc = Callable[[dict[str, Any]], dict[str, Any]]

_CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config"


_ASSET_LABELS: dict[str, str] = {
    "drone": "无人机",
    "camera": "摄像头",
    "radar": "雷达",
    "tower": "塔台",
    "satellite": "卫星",
}


class ToolRegistry:
    """
    从 YAML 加载工具 schema，通过 @registry.handler("tool_name") 绑定执行函数。
    """

    def __init__(self) -> None:
        self._definitions: dict[str, dict[str, Any]] = {}
        self._handlers: dict[str, HandlerFunc] = {}
        self._approval_config: dict[str, dict[str, Any]] = {}

    # -- 加载 ---------------------------------------------------------------

    def load_yaml(self, path: Path | str | None = None) -> None:
        path = Path(path) if path else _CONFIG_DIR / "tools.yaml"
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        for entry in data.get("tools", []):
            if not entry.get("enabled", True):
                continue
            name = entry["name"]
            self._definitions[name] = {
                "type": "function",
                "function": {
                    "name": name,
                    "description": entry.get("description", ""),
                    "parameters": entry.get("parameters", {"type": "object", "properties": {}}),
                },
            }
            if entry.get("requires_approval"):
                self._approval_config[name] = entry["requires_approval"]
        logger.info("Loaded %d tool definitions from %s", len(self._definitions), path)

    # -- 审批判断 -----------------------------------------------------------

    def needs_approval(self, tool_name: str, args: dict[str, Any]) -> bool:
        """判断某次工具调用是否需要用户审批。"""
        cfg = self._approval_config.get(tool_name)
        if not cfg:
            return False
        if cfg is True or cfg.get("always"):
            return True
        if cfg.get("when_asset_type"):
            required_types = cfg["when_asset_type"]
            at = args.get("asset_type", "")
            aid = args.get("asset_id", "")
            if at in required_types:
                return True
            if aid and any(k in aid.lower() for k in required_types):
                return True
        if cfg.get("when_action"):
            action = args.get("action", "") or args.get("command", "")
            if action in cfg["when_action"]:
                return True
        return False

    def approval_description(self, tool_name: str, args: dict[str, Any]) -> str:
        """生成人类可读的审批描述。"""
        if tool_name == "assign_asset":
            at = _ASSET_LABELS.get(args.get("asset_type", ""), args.get("asset_type", "资产"))
            tid = args.get("target_id", "未知目标")
            aid = args.get("asset_id", "")
            if aid:
                return f"是否批准将 {aid} 分配去监控目标 {tid}？"
            return f"是否批准派遣{at}前往监控目标 {tid}？"
        if tool_name == "command_asset":
            action = args.get("command", "") or args.get("action", "")
            aid = args.get("asset_id", "")
            action_labels = {"move_to": "移动至指定位置", "start_patrol": "开始巡逻", "aim_at": "瞄准目标"}
            return f"是否批准对 {aid} 执行操作：{action_labels.get(action, action)}？"
        if tool_name == "recall_asset":
            aid = args.get("asset_id", "")
            return f"是否批准召回 {aid}？这将中断其当前任务。"
        return f"是否批准执行 {tool_name}？"

    # -- 注册 handler -------------------------------------------------------

    def handler(self, name: str) -> Callable[[HandlerFunc], HandlerFunc]:
        def decorator(func: HandlerFunc) -> HandlerFunc:
            self._handlers[name] = func
            return func
        return decorator

    # -- 对外接口 -----------------------------------------------------------

    @property
    def definitions(self) -> list[dict[str, Any]]:
        return [d for name, d in self._definitions.items() if name in self._handlers]

    def execute(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        func = self._handlers.get(name)
        if func is None:
            return {"action": name, "success": False, "message": f"未知工具 {name}"}
        return func(args)

    @property
    def tool_names(self) -> list[str]:
        return list(self._handlers.keys())


registry = ToolRegistry()
