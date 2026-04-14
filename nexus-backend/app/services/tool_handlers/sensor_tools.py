"""
传感器画面工具：获取资产的模拟传感器数据（相机画面、声呐音频、雷达扫描）。
所有数据为确定性模拟，前端基于返回的元数据渲染动画。
"""

import hashlib
import math
import random
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.core.db_sync import get_sync_session
from app.models.asset import Asset
from app.services.tool_handlers._geo import haversine
from app.services.tool_registry import registry


def _get_tracks() -> list[dict[str, Any]]:
    from app.services.simulation import sim_engine
    return sim_engine.get_tracks()


_FEED_TYPE_MAP: dict[str, str] = {
    "camera": "video",
    "drone": "video",
    "tower": "video",
    "radar": "radar",
    "satellite": "satellite",
}

_DISP_LABELS = {"hostile": "敌方", "friendly": "友方", "neutral": "中立"}
_TYPE_LABELS = {"air": "空中目标", "sea": "水面目标", "underwater": "水下目标"}


def _seed_random(text: str) -> random.Random:
    """基于字符串的确定性随机数生成器。"""
    h = int(hashlib.md5(text.encode()).hexdigest()[:8], 16)
    return random.Random(h)


def _build_video_feed(asset: Asset, target: dict[str, Any] | None,
                      tracks_in_range: list[dict[str, Any]]) -> dict[str, Any]:
    """构造模拟视频画面的元数据。"""
    now = datetime.now(timezone.utc)
    rng = _seed_random(f"{asset.id}-{now.strftime('%H%M')}")

    feed: dict[str, Any] = {
        "feedType": "video",
        "assetId": asset.id,
        "assetName": asset.name,
        "assetType": asset.asset_type,
        "resolution": "1920x1080" if asset.asset_type == "camera" else "1280x720",
        "fps": 30 if asset.asset_type == "camera" else 24,
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "signalQuality": rng.randint(75, 99),
        "nightVision": now.hour < 6 or now.hour >= 18,
        "heading": round(asset.heading or 0, 1),
        "zoom": rng.choice([1, 2, 4, 8]),
        "status": "recording",
    }

    if target:
        dist = haversine(asset.lat, asset.lng, target["lat"], target["lng"])
        feed["target"] = {
            "id": target["id"],
            "name": target.get("name", target["id"]),
            "type": target.get("type", "unknown"),
            "typeLabel": _TYPE_LABELS.get(target.get("type", ""), "目标"),
            "disposition": target.get("disposition", "unknown"),
            "dispositionLabel": _DISP_LABELS.get(target.get("disposition", ""), "未知"),
            "distance_km": round(dist, 2),
            "bearing": round(asset.heading or 0, 1),
            "speed": round(target.get("speed", 0), 1),
            "altitude": target.get("altitude", 0),
            "locked": True,
        }

    if tracks_in_range:
        feed["detectedObjects"] = len(tracks_in_range)
        feed["objectList"] = [
            {
                "id": t["id"],
                "name": t.get("name", t["id"]),
                "type": t.get("type", "unknown"),
                "typeLabel": _TYPE_LABELS.get(t.get("type", ""), "目标"),
                "disposition": t.get("disposition", "unknown"),
                "dispositionLabel": _DISP_LABELS.get(t.get("disposition", ""), "未知"),
                "distance_km": round(haversine(asset.lat, asset.lng, t["lat"], t["lng"]), 1),
            }
            for t in tracks_in_range[:5]
        ]

    return feed


def _build_sonar_feed(asset: Asset, tracks_in_range: list[dict[str, Any]]) -> dict[str, Any]:
    """构造模拟声呐/音频画面的元数据。"""
    now = datetime.now(timezone.utc)
    rng = _seed_random(f"{asset.id}-sonar-{now.strftime('%H%M')}")

    contacts = []
    for t in tracks_in_range:
        if t.get("type") == "underwater" or t.get("type") == "sea":
            dist = haversine(asset.lat, asset.lng, t["lat"], t["lng"])
            dlng = t["lng"] - asset.lng
            dlat = t["lat"] - asset.lat
            bearing = math.degrees(math.atan2(dlng, dlat)) % 360
            contacts.append({
                "id": t["id"],
                "name": t.get("name", t["id"]),
                "type": t.get("type"),
                "disposition": t.get("disposition", "unknown"),
                "dispositionLabel": _DISP_LABELS.get(t.get("disposition", ""), "未知"),
                "bearing": round(bearing, 1),
                "distance_km": round(dist, 1),
                "speed": round(t.get("speed", 0), 1),
                "depthEstimate": rng.randint(30, 300) if t.get("type") == "underwater" else 0,
                "signalStrength": max(10, 95 - int(dist * 2)),
                "frequency_hz": rng.randint(800, 4000),
            })

    return {
        "feedType": "sonar",
        "assetId": asset.id,
        "assetName": asset.name,
        "assetType": asset.asset_type,
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "mode": "passive",
        "range_km": asset.range_km or 50,
        "noiseLevel_db": rng.randint(35, 65),
        "contacts": contacts,
        "contactCount": len(contacts),
        "status": "listening",
    }


def _build_radar_feed(asset: Asset, tracks_in_range: list[dict[str, Any]]) -> dict[str, Any]:
    """构造模拟雷达扫描画面的元数据。"""
    now = datetime.now(timezone.utc)
    rng = _seed_random(f"{asset.id}-radar-{now.strftime('%H%M')}")

    blips = []
    for t in tracks_in_range:
        dist = haversine(asset.lat, asset.lng, t["lat"], t["lng"])
        dlng = t["lng"] - asset.lng
        dlat = t["lat"] - asset.lat
        bearing = math.degrees(math.atan2(dlng, dlat)) % 360
        blips.append({
            "id": t["id"],
            "name": t.get("name", t["id"]),
            "type": t.get("type"),
            "disposition": t.get("disposition", "unknown"),
            "dispositionLabel": _DISP_LABELS.get(t.get("disposition", ""), "未知"),
            "bearing": round(bearing, 1),
            "distance_km": round(dist, 1),
            "speed": round(t.get("speed", 0), 1),
            "altitude": t.get("altitude", 0),
            "rcs": round(rng.uniform(0.5, 15.0), 1),
        })

    return {
        "feedType": "radar",
        "assetId": asset.id,
        "assetName": asset.name,
        "assetType": asset.asset_type,
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "range_km": asset.range_km or 80,
        "sweepRate_rpm": rng.choice([6, 12, 15]),
        "clutterLevel": rng.choice(["low", "medium", "high"]),
        "blips": blips,
        "blipCount": len(blips),
        "status": "scanning",
    }


@registry.handler("get_sensor_feed")
def handle_get_sensor_feed(args: dict[str, Any]) -> dict[str, Any]:
    asset_id = args.get("asset_id")
    feed_type = args.get("feed_type")

    if not asset_id:
        return {"action": "show_sensor_feed", "success": False,
                "message": "需要指定 asset_id"}

    with get_sync_session() as session:
        asset = session.execute(select(Asset).where(Asset.id == asset_id)).scalar_one_or_none()
        if not asset:
            return {"action": "show_sensor_feed", "success": False,
                    "message": f"未找到资产 {asset_id}"}
        if asset.status == "offline":
            return {"action": "show_sensor_feed", "success": False,
                    "message": f"{asset.name} 当前离线，无法获取画面"}

    tracks = _get_tracks()

    range_km = asset.range_km or 50
    tracks_in_range = [
        t for t in tracks
        if haversine(asset.lat, asset.lng, t.get("lat", 0), t.get("lng", 0)) <= range_km
    ]

    target = None
    if asset.assigned_target_id:
        target = next((t for t in tracks if t.get("id") == asset.assigned_target_id), None)

    if not feed_type:
        feed_type = _FEED_TYPE_MAP.get(asset.asset_type, "video")

    if feed_type == "sonar" or (feed_type == "audio" and asset.asset_type in ("tower",)):
        feed = _build_sonar_feed(asset, tracks_in_range)
    elif feed_type == "radar":
        feed = _build_radar_feed(asset, tracks_in_range)
    else:
        feed = _build_video_feed(asset, target, tracks_in_range)

    label_map = {"video": "视频画面", "radar": "雷达扫描", "sonar": "声呐探测"}
    feed_label = label_map.get(feed["feedType"], "传感器数据")

    return {
        "action": "show_sensor_feed",
        "success": True,
        **feed,
        "message": f"已获取 {asset.name} 的{feed_label}"
            + (f"，锁定目标 {target['name']}" if target else f"，探测范围内 {len(tracks_in_range)} 个目标"),
    }
