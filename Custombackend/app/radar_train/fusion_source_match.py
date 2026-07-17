"""融合来源判定（与前端 map-gis-camera-task.ts 对齐）。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


def _norm_str(v: Any) -> str:
    return str(v or "").strip()


def is_self_report_fusion_source(item: Dict[str, Any]) -> bool:
    name = _norm_str(item.get("sourceName"))
    if "自报位" in name:
        return True
    ds = _norm_str(item.get("dataSourceId")).lower()
    if ds == "zibaowei":
        return True
    if any(k in ds for k in ("uav_pose", "self_report", "selfreport")):
        return True
    return False


def is_bird_radar_fusion_source(item: Dict[str, Any]) -> bool:
    name = _norm_str(item.get("sourceName"))
    if "探鸟" in name:
        return True
    ds = _norm_str(item.get("dataSourceId")).lower()
    if ds in ("9", "bird_radar", "birdradar"):
        return True
    if "bird" in ds and "radar" in ds:
        return True
    return False


def parse_fusion_sources(track: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = track.get("fusionSources")
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    return []


def is_fuse_air_track(track: Dict[str, Any]) -> bool:
    tlk = _norm_str(track.get("track_layer_key")).lower().replace("-", "_")
    if tlk == "fuse_air":
        return True
    dds = _norm_str(track.get("dds_source_id")).lower()
    return "dds_forward_fuse_bird_radar_track" in dds


def extract_uav_gt_from_fuse_air(track: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    对空融合航迹同时含自报位 + 探鸟雷达 → 探鸟雷达 trackId 为训练批号，真值=无人机(1)。
    """
    if not is_fuse_air_track(track):
        return None

    sources = parse_fusion_sources(track)
    if not sources:
        return None

    self_items = [s for s in sources if is_self_report_fusion_source(s)]
    bird_items = [s for s in sources if is_bird_radar_fusion_source(s)]
    if not self_items or not bird_items:
        return None

    bird = bird_items[0]
    pihao_raw = bird.get("trackId")
    if pihao_raw is None:
        return None
    pihao_str = _norm_str(pihao_raw)
    if not pihao_str.isdigit():
        return None
    pihao = int(pihao_str)
    if pihao <= 0:
        return None

    self_report_ids = []
    for s in self_items:
        tid = _norm_str(s.get("trackId"))
        if tid.isdigit():
            self_report_ids.append(int(tid))

    return {
        "pihao": pihao,
        "label_gt": 1,
        "label_str": "无人机",
        "label_source": "fuse_air:self_report+bird_radar",
        "bird_radar_track_id": pihao,
        "bird_radar_source_name": _norm_str(bird.get("sourceName")),
        "bird_radar_data_source_id": _norm_str(bird.get("dataSourceId")),
        "self_report_track_ids": self_report_ids,
        "fuse_unique_id": track.get("uniqueId") or track.get("targetId"),
        "fuse_track_id": track.get("trackId"),
        "fusion_sources": sources,
    }
