"""gRPC MessageToDict 结果转 HTTP JSON 前的清洗（NaN/Inf 会导致 JSONResponse 500）。"""
from __future__ import annotations

import math
from typing import Any


def json_safe_value(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: json_safe_value(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [json_safe_value(x) for x in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    return obj
