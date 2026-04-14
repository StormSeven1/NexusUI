"""
航路规划工具：计算航路点、航段距离和预计时间。
"""

from typing import Any

from app.services.tool_handlers._geo import haversine, resolve_point
from app.services.tool_registry import registry


def _get_tracks() -> list[dict[str, Any]]:
    from app.services.simulation import sim_engine
    return sim_engine.get_tracks()


@registry.handler("plan_route")
def handle_plan_route(args: dict[str, Any]) -> dict[str, Any]:
    tracks = _get_tracks()
    start = resolve_point(args["from"], tracks)
    end = resolve_point(args["to"], tracks)
    if not start or not end:
        return {"action": "plan_route", "success": False, "message": "无法解析起点或终点"}

    waypoint_refs = args.get("waypoints", [])
    speed_knots = args.get("speed_knots", 15)
    km_per_knot = 1.852

    ordered: list[dict[str, Any]] = [start]
    for ref in waypoint_refs:
        pt = resolve_point(ref, tracks)
        if pt:
            ordered.append(pt)
    ordered.append(end)

    legs: list[dict[str, Any]] = []
    total_km = 0.0
    for i in range(len(ordered) - 1):
        a, b = ordered[i], ordered[i + 1]
        dist = haversine(a["lat"], a["lng"], b["lat"], b["lng"])
        total_km += dist
        legs.append({
            "from": a,
            "to": b,
            "distanceKm": round(dist, 2),
            "cumulativeKm": round(total_km, 2),
        })

    speed_kmh = speed_knots * km_per_knot
    eta_hours = total_km / speed_kmh if speed_kmh > 0 else 0
    eta_min = round(eta_hours * 60, 1)

    route_points = [{"lat": p["lat"], "lng": p["lng"], "name": p.get("name", "")} for p in ordered]

    return {
        "action": "draw_route",
        "success": True,
        "points": route_points,
        "legs": legs,
        "totalDistanceKm": round(total_km, 2),
        "speedKnots": speed_knots,
        "etaMinutes": eta_min,
        "count": len(route_points),
        "color": "#22d3ee",
        "label": f"航路（{round(total_km, 1)}km / {eta_min}min）",
        "message": f"航路规划完成：{len(route_points)} 航点，总距离 {total_km:.1f} km，预计 {eta_min} 分钟",
    }
