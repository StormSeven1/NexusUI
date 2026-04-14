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


class ToolRegistry:
    """
    从 YAML 加载工具 schema，通过 @registry.handler("tool_name") 绑定执行函数。
    """

    def __init__(self) -> None:
        self._definitions: dict[str, dict[str, Any]] = {}
        self._handlers: dict[str, HandlerFunc] = {}

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
        logger.info("Loaded %d tool definitions from %s", len(self._definitions), path)

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
