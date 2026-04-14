"""
天气查询工具：返回模拟天气数据（后续可接入真实 API）。
"""

import hashlib
from typing import Any

from app.services.tool_registry import registry

_CONDITIONS = [
    {"condition": "晴", "icon": "sunny"},
    {"condition": "多云", "icon": "cloudy"},
    {"condition": "阴", "icon": "overcast"},
    {"condition": "小雨", "icon": "light_rain"},
    {"condition": "中雨", "icon": "rain"},
    {"condition": "雷阵雨", "icon": "thunderstorm"},
    {"condition": "雾", "icon": "fog"},
    {"condition": "大风", "icon": "windy"},
]

_WIND_DIRS = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"]


def _deterministic_hash(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest(), 16)


@registry.handler("get_weather")
def handle_get_weather(args: dict[str, Any]) -> dict[str, Any]:
    location = args["location"]
    h = _deterministic_hash(location)

    cond = _CONDITIONS[h % len(_CONDITIONS)]
    temperature = 5 + (h % 30)
    humidity = 30 + (h % 60)
    wind_dir = _WIND_DIRS[(h >> 4) % len(_WIND_DIRS)]
    wind_level = 1 + ((h >> 8) % 7)
    visibility_km = 5 + (h % 20)
    pressure_hpa = 990 + (h % 40)

    return {
        "action": "show_weather",
        "success": True,
        "location": location,
        "temperature": temperature,
        "condition": cond["condition"],
        "icon": cond["icon"],
        "humidity": humidity,
        "wind": f"{wind_dir}{wind_level}级",
        "windDirection": wind_dir,
        "windLevel": wind_level,
        "visibilityKm": visibility_km,
        "pressureHpa": pressure_hpa,
        "message": f"{location}天气：{cond['condition']}，{temperature}°C，{wind_dir}{wind_level}级",
    }
