"""对空融合航迹 → 探鸟雷达批号真值采集。"""
from __future__ import annotations

from typing import Any, Dict, Optional

from loguru import logger

from radar_train.fusion_source_match import extract_uav_gt_from_fuse_air
from radar_train.label_store import label_store
from radar_train.csv_recorder import capture_manager

_enabled = True
_log_new_label = True


def configure(enabled: bool = True, log_new_label: bool = True) -> None:
    global _enabled, _log_new_label
    _enabled = enabled
    _log_new_label = log_new_label


def process_fuse_air_track(track: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """解析单条航迹；命中则写入 label_store 并刷新采集活跃时间。"""
    if not _enabled:
        return None

    extracted = extract_uav_gt_from_fuse_air(track)
    if not extracted:
        return None

    pihao = int(extracted["pihao"])
    prev = label_store.get(pihao)
    row = label_store.upsert(extracted)
    capture_manager.touch_qualifying_track(pihao)

    if _log_new_label and prev is None:
        logger.info(
            "雷达训练真值: pihao={} 无人机 (自报位{} + 探鸟{}) fuse_unique_id={}",
            pihao,
            extracted.get("self_report_track_ids"),
            extracted.get("bird_radar_track_id"),
            extracted.get("fuse_unique_id"),
        )
    return row
