"""
威胁评估工具：综合 disposition、速度、与敏感区域距离、heading 逼近度等因素评估目标威胁等级。
"""

from typing import Any

from app.services.tool_handlers._geo import haversine
from app.services.tool_registry import registry


def _get_tracks() -> list[dict[str, Any]]:
    from app.services.simulation import sim_engine
    return sim_engine.get_tracks()


def _get_zones() -> list[dict[str, Any]]:
    from app.services.simulation import sim_engine
    return sim_engine.get_zones()


def _get_assets() -> list[dict[str, Any]]:
    from app.core.db_sync import get_sync_session
    from app.models.asset import Asset
    from sqlalchemy import select

    with get_sync_session() as session:
        rows = session.execute(select(Asset)).scalars().all()
        return [{"id": a.id, "name": a.name, "lat": a.lat, "lng": a.lng,
                 "type": a.asset_type, "status": a.status, "range_km": a.range_km} for a in rows]


_DISP_LABELS = {"hostile": "敌方", "friendly": "友方", "neutral": "中立"}
_TYPE_LABELS = {"air": "空中", "sea": "水面", "underwater": "水下"}
_LEVEL_LABELS = {"critical": "极高", "high": "高", "medium": "中", "low": "低"}


def _assess_single(track: dict[str, Any], zones: list[dict[str, Any]],
                    assets: list[dict[str, Any]]) -> dict[str, Any]:
    """对单个目标计算威胁评分 (0-100)。"""
    score = 0.0
    reasons: list[str] = []

    disposition = track.get("disposition", "neutral")
    track_type = track.get("type", "unknown")
    track_lat = track.get("lat", 0.0)
    track_lng = track.get("lng", 0.0)

    if disposition == "hostile":
        score += 40
        reasons.append("敌方目标")
    elif disposition == "neutral":
        score += 10

    speed = track.get("speed", 0)
    if speed > 500:
        score += 20
        reasons.append(f"超高速({speed:.0f}km/h)")
    elif speed > 200:
        score += 12
        reasons.append(f"高速({speed:.0f}km/h)")
    elif speed > 50:
        score += 5

    # --- 与限制区域/敏感区域的距离 ---
    min_zone_dist = float("inf")
    nearest_zone_name = ""
    for zone in zones:
        center = zone.get("center")
        if not center:
            continue
        dist = haversine(track_lat, track_lng, center["lat"], center["lng"])
        if dist < min_zone_dist:
            min_zone_dist = dist
            nearest_zone_name = zone.get("name", "未知区域")

    if min_zone_dist < 5:
        score += 20
        reasons.append(f"极近{nearest_zone_name}({min_zone_dist:.1f}km)")
    elif min_zone_dist < 20:
        score += 10
        reasons.append(f"临近{nearest_zone_name}({min_zone_dist:.1f}km)")

    min_asset_dist = float("inf")
    nearest_asset_name = ""
    for asset in assets:
        dist = haversine(track_lat, track_lng, asset["lat"], asset["lng"])
        if dist < min_asset_dist:
            min_asset_dist = dist
            nearest_asset_name = asset.get("name", "")

    if disposition == "hostile":
        if min_asset_dist < 10:
            score += 15
            reasons.append(f"逼近我方资产{nearest_asset_name}({min_asset_dist:.1f}km)")
        elif min_asset_dist < 30:
            score += 8
            reasons.append(f"接近我方资产{nearest_asset_name}({min_asset_dist:.1f}km)")

    score = min(100, max(0, score))

    if score >= 70:
        level = "critical"
    elif score >= 50:
        level = "high"
    elif score >= 30:
        level = "medium"
    else:
        level = "low"

    return {
        "trackId": track.get("id", "?"),
        "name": track.get("name", "未知"),
        "type": track_type,
        "typeLabel": _TYPE_LABELS.get(track_type, track_type),
        "disposition": disposition,
        "dispositionLabel": _DISP_LABELS.get(disposition, disposition),
        "lat": round(track_lat, 4),
        "lng": round(track_lng, 4),
        "speed": round(track.get("speed", 0), 1),
        "heading": round(track.get("heading", 0), 1),
        "score": round(score, 1),
        "level": level,
        "levelLabel": _LEVEL_LABELS[level],
        "reasons": reasons,
        "nearestZone": nearest_zone_name,
        "nearestZoneDist": round(min_zone_dist, 1) if min_zone_dist < float("inf") else None,
        "nearestAsset": nearest_asset_name,
        "nearestAssetDist": round(min_asset_dist, 1) if min_asset_dist < float("inf") else None,
    }


@registry.handler("assess_threats")
def handle_assess_threats(args: dict[str, Any]) -> dict[str, Any]:
    tracks = _get_tracks()
    zones = _get_zones()
    assets = _get_assets()

    scope = args.get("scope", "all")
    try:
        top_n = int(args.get("top_n", 5))
    except (TypeError, ValueError):
        top_n = 5

    if scope and scope != "all":
        tracks = [t for t in tracks if t.get("type") == scope]

    assessments = [_assess_single(t, zones, assets) for t in tracks]
    assessments.sort(key=lambda x: x["score"], reverse=True)
    top = assessments[:top_n]

    summary_by_level = {}
    for a in assessments:
        lv = a["level"]
        summary_by_level[lv] = summary_by_level.get(lv, 0) + 1

    return {
        "action": "show_threats",
        "success": True,
        "total_assessed": len(assessments),
        "summary": summary_by_level,
        "threats": top,
        "message": f"已评估 {len(assessments)} 个目标，最高威胁: {top[0]['name']}(评分{top[0]['score']})" if top else "未发现威胁目标",
    }
