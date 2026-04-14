"""
目标查询类工具：查询、选中、高亮、飞行到目标。
"""

from typing import Any

from app.services.tool_registry import registry


def _get_tracks() -> list[dict[str, Any]]:
    from app.services.simulation import sim_engine
    return sim_engine.get_tracks()


@registry.handler("select_track")
def handle_select_track(args: dict[str, Any]) -> dict[str, Any]:
    tracks = _get_tracks()
    track_id = args["trackId"]
    track = next((t for t in tracks if t["id"] == track_id), None)
    if not track:
        return {"action": "select_track", "success": False, "message": f"未找到目标 {track_id}"}
    return {
        "action": "select_track",
        "success": True,
        "trackId": track_id,
        "track": track,
        "message": f"已选中 {track['name']} ({track_id})",
    }


@registry.handler("query_tracks")
def handle_query_tracks(args: dict[str, Any]) -> dict[str, Any]:
    filtered = _get_tracks()
    target_type = args.get("type")
    disposition = args.get("disposition")
    if target_type and target_type != "all":
        filtered = [t for t in filtered if t["type"] == target_type]
    if disposition and disposition != "all":
        filtered = [t for t in filtered if t["disposition"] == disposition]
    return {
        "action": "query_tracks",
        "count": len(filtered),
        "tracks": filtered,
        "message": f"查询到 {len(filtered)} 个目标",
    }


@registry.handler("highlight_tracks")
def handle_highlight_tracks(args: dict[str, Any]) -> dict[str, Any]:
    tracks = _get_tracks()
    track_ids = args.get("trackIds", [])
    target_type = args.get("type")
    disposition = args.get("disposition")
    if not track_ids and (target_type or disposition):
        filtered = tracks
        if target_type and target_type != "all":
            filtered = [t for t in filtered if t["type"] == target_type]
        if disposition and disposition != "all":
            filtered = [t for t in filtered if t["disposition"] == disposition]
        track_ids = [t["id"] for t in filtered]
    matched = [t for t in tracks if t["id"] in track_ids]
    if not track_ids:
        return {"action": "highlight_tracks", "trackIds": [], "count": 0, "message": "已清除所有高亮"}
    return {
        "action": "highlight_tracks",
        "trackIds": track_ids,
        "count": len(matched),
        "tracks": matched,
        "message": f"已高亮 {len(matched)} 个目标",
    }


@registry.handler("fly_to_track")
def handle_fly_to_track(args: dict[str, Any]) -> dict[str, Any]:
    tracks = _get_tracks()
    track_id = args["trackId"]
    zoom = args.get("zoom", 12)
    track = next((t for t in tracks if t["id"] == track_id), None)
    if not track:
        return {"action": "fly_to_track", "success": False, "message": f"未找到目标 {track_id}"}
    return {
        "action": "fly_to_track",
        "success": True,
        "trackId": track_id,
        "track": track,
        "lat": track["lat"],
        "lng": track["lng"],
        "zoom": zoom,
        "message": f"正在飞向 {track['name']} ({track_id})",
    }
