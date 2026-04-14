"""
数据查询图表工具：按维度统计目标数据，返回图表可视化数据。
"""

from collections import Counter
from typing import Any

from app.services.tool_registry import registry


def _get_tracks() -> list[dict[str, Any]]:
    from app.services.simulation import sim_engine
    return sim_engine.get_tracks()


_TYPE_LABELS = {"air": "空中", "sea": "水面", "underwater": "水下"}
_DISP_LABELS = {"hostile": "敌方", "friendly": "友方", "neutral": "中立"}


@registry.handler("query_data_chart")
def handle_query_data_chart(args: dict[str, Any]) -> dict[str, Any]:
    tracks = _get_tracks()
    query_type = args["query_type"]
    chart_type = args["chart_type"]

    if query_type == "tracks_by_type":
        counter = Counter(t["type"] for t in tracks)
        data = [{"label": _TYPE_LABELS.get(k, k), "value": v, "key": k} for k, v in counter.items()]
        title = "目标类型分布"

    elif query_type == "tracks_by_disposition":
        counter = Counter(t["disposition"] for t in tracks)
        data = [{"label": _DISP_LABELS.get(k, k), "value": v, "key": k} for k, v in counter.items()]
        title = "敌我属性分布"

    elif query_type == "tracks_by_speed":
        buckets = {"低速(<50)": 0, "中速(50-200)": 0, "高速(200-500)": 0, "超高速(>500)": 0}
        for t in tracks:
            spd = t.get("speed", 0)
            if spd < 50:
                buckets["低速(<50)"] += 1
            elif spd < 200:
                buckets["中速(50-200)"] += 1
            elif spd <= 500:
                buckets["高速(200-500)"] += 1
            else:
                buckets["超高速(>500)"] += 1
        data = [{"label": k, "value": v} for k, v in buckets.items() if v > 0]
        title = "目标速度分段统计"

    elif query_type == "tracks_summary":
        total = len(tracks)
        by_type = Counter(t["type"] for t in tracks)
        by_disp = Counter(t["disposition"] for t in tracks)
        data = [
            *[{"label": _TYPE_LABELS.get(k, k), "value": v, "group": "类型"} for k, v in by_type.items()],
            *[{"label": _DISP_LABELS.get(k, k), "value": v, "group": "属性"} for k, v in by_disp.items()],
        ]
        title = f"态势综合摘要（共 {total} 个目标）"
    else:
        return {"action": "show_chart", "success": False, "message": f"不支持的查询类型: {query_type}"}

    return {
        "action": "show_chart",
        "success": True,
        "chartType": chart_type,
        "data": data,
        "title": title,
        "message": f"已生成{title}（{chart_type}图）",
    }
