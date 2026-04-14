"""
工具 handler 模块。
导入各子模块即可触发 @registry.handler 装饰器自动注册。
"""

from . import (
    asset_tools,
    assignment_tools,
    chart_tools,
    command_tools,
    map_tools,
    plan_tools,
    route_tools,
    sensor_tools,
    task_tools,
    threat_tools,
    track_tools,
    weather_tools,
)

__all__ = [
    "asset_tools",
    "assignment_tools",
    "chart_tools",
    "command_tools",
    "map_tools",
    "plan_tools",
    "route_tools",
    "sensor_tools",
    "task_tools",
    "threat_tools",
    "track_tools",
    "weather_tools",
]
