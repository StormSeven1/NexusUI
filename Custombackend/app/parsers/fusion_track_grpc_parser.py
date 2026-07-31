"""
FusionTrack gRPC (:60056) TrackDataClassBatch → 前端雷达航迹字典。

背景（ID 撞了的根因与本方案）：
- 前端 store 主键 showID = uniqueID（resolveUniqueID：uniqueID/uniqueId/target_id…）。
- 旧路径里「对海融合」走 NewTrackStruct gRPC(:60055，showID=target_id)，
  「远遥/靖子头雷达」走 DDS(showID=雷达自身 id)——两套 id 空间，同一物理目标点位重合时
  showID 互相覆盖 → 「有雷达就没融合、有融合就没雷达」。
- 实测确认 :60055 的 target_id 与 :60056 的 uniqueId 同处一个「全局唯一 id 池」(154xxxxxx)，
  且 :60056 对每条航迹(含原始雷达点)都分配了全局唯一 uniqueId。
  因此让雷达改从 :60056 消费、用其 uniqueId 作 showID，与融合 target_id 天然不撞 → 可同时显示。
  这是发布端已保证的全局唯一，无需再人为加前缀命名空间。

只摄入下列源（与 NEXUS_RADAR_TRACK_TRANSPORT=grpc 时关闭的 DDS/UDP 一一对应）：
- yuan_yao / jing_zi_tou：远遥/靖子头雷达
- udp_xpf_track：远遥鹏飞
- udp_boatself_track：船只自报位
- ais：AIS
- tan_niao：探鸟雷达
- zi_bao_wei：无人机自报位
- udp_fanwucar_track / ku_lei_da：反无车 / Ku 雷达（同图层 fanwu_car_radar）
- auto_bird：探鸟智能跟踪点迹（关 UDP udp_auto_bird_radar）
其余源：
- dui_hai_rong_he / dui_kong_rong_he：仍走 NewTrackStruct(:60055)，此处跳过以防重复；
- udp_uav_image_track：前端暂无独立图层，此处跳过。
输出字段刻意对齐 dds_parser（雷达 / AIS），使 gRPC 与 DDS 在前端表现一致。
"""
from __future__ import annotations

import json
from typing import Any, Dict, Optional

from loguru import logger

# 业务数据源 ID → 前端 track_layer_key（FusionTrack gRPC 摄入；切 grpc 时关对应 DDS/UDP）
FUSION_TRACK_DATASOURCE_TO_LAYER: Dict[str, str] = {
    "yuan_yao": "radar_wharf",              # 远遥码头雷达
    "jing_zi_tou": "radar_jingzi",           # 靖子头雷达
    "udp_xpf_track": "xpf_track",            # 远遥鹏飞
    "udp_boatself_track": "boat_self_track",  # 船只自报位
    "ais": "ais_track",                      # AIS
    "tan_niao": "bird_radar",                # 探鸟雷达
    "zi_bao_wei": "uav_pose_track",          # 无人机自报位
    "udp_fanwucar_track": "fanwu_car_radar",  # 反无车
    "ku_lei_da": "fanwu_car_radar",          # Ku 雷达（与反无车同目标图层）
    "auto_bird": "auto_bird_radar",          # 探鸟智能跟踪点迹
}


def _f(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _apply_uav_self_report(result: Dict[str, Any], reserved6: str) -> None:
    """reserved6 携带无人机自报位（姿态/云台/SN）时并入 result，与 DDS 雷达解析保持一致。"""
    if not reserved6 or not reserved6.strip():
        return
    try:
        extra = json.loads(reserved6)
    except (json.JSONDecodeError, ValueError):
        return
    if not isinstance(extra, dict):
        return
    result["attitude_head"] = extra.get("attitude_head")
    result["attitude_pitch"] = extra.get("attitude_pitch")
    result["attitude_roll"] = extra.get("attitude_roll")
    result["gimbal_pitch"] = extra.get("gimbal_pitch")
    result["gimbal_roll"] = extra.get("gimbal_roll")
    result["gimbal_yaw"] = extra.get("gimbal_yaw")
    result["sn"] = extra.get("sn", "")
    result["device_name"] = extra.get("device_name", "")
    result["is_uav_self_report"] = True


def _epoch_sec_to_ms(sec: Any) -> Optional[int]:
    try:
        v = float(sec or 0.0)
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    return int(v * 1000.0)


def _attach_link_times_fusion_track(result: Dict[str, Any], track) -> None:
    """
    临时约定（不改 proto）：
    - reserved0 + reserved1/1e6 = UDP 包头时间 → track_created_time_ms
    - reserved2 = 本机接收时间 → track_source_recv_time_ms
    - reserved3 = gRPC 发送时间 → track_grpc_send_time_ms
    timeStamp 仍保持原有原始秒级字段，不混用。
    """
    try:
        sec = int(getattr(track, "reserved0", 0) or 0)
        usec = int(getattr(track, "reserved1", 0) or 0)
        packet_sec = float(sec) + float(usec) / 1_000_000.0 if sec > 0 else 0.0
    except (TypeError, ValueError):
        packet_sec = 0.0
    created_ms = _epoch_sec_to_ms(packet_sec)
    source_recv_ms = _epoch_sec_to_ms(getattr(track, "reserved2", 0.0))
    send_ms = _epoch_sec_to_ms(getattr(track, "reserved3", 0.0))
    if created_ms is not None:
        result["track_created_time_ms"] = created_ms
    if source_recv_ms is not None:
        result["track_source_recv_time_ms"] = source_recv_ms
    if send_ms is not None:
        result["track_grpc_send_time_ms"] = send_ms


def track_data_class_to_radar_track(track, source) -> Optional[Dict[str, Any]]:
    """单条 (TrackDataClass, TrackDataClassSource) → 前端雷达航迹 dict。

    非雷达源（不在 FUSION_TRACK_DATASOURCE_TO_LAYER）返回 None，交由原有 DDS/gRPC 通道处理，避免重复。
    """
    data_source_id = str(getattr(source, "dataSourceId", "") or "").strip() if source is not None else ""
    layer_key = FUSION_TRACK_DATASOURCE_TO_LAYER.get(data_source_id)
    if not layer_key:
        return None

    try:
        unique_id = int(getattr(track, "uniqueId", 0) or 0)
        is_ais = layer_key == "ais_track"
        result: Dict[str, Any] = {
            # showID 主键：全局唯一 uniqueId（与 :60055 融合 target_id 同池、不撞）
            "uniqueId": unique_id,
            "uniqueID": unique_id,
            # 展示用航迹号：雷达自身 trackId / AIS 批号（小整数，做标签）
            "trackId": int(getattr(track, "trackId", 0) or 0),
            "longitude": _f(getattr(track, "longitude", 0.0)),
            "latitude": _f(getattr(track, "latitude", 0.0)),
            "height": _f(getattr(track, "height", 0.0)),
            "altitude": _f(getattr(track, "height", 0.0)),
            "course": _f(getattr(track, "course", 0.0)),
            "speed": _f(getattr(track, "speed", 0.0)),
            "azimuth": _f(getattr(track, "azimuth", 0.0)),
            "range": _f(getattr(track, "range", 0.0)),
            "radarId": str(getattr(track, "radarId", "") or ""),
            "dotID": int(getattr(track, "dotID", 0) or 0),
            "timestamp": int(getattr(track, "timeStamp", 0) or 0),
            "cpa": 0,
            "tcpa": 0,
            "trackCategoryId": int(getattr(track, "trackCategoryId", 0) or 0),
            "trackCategoryName": str(getattr(track, "trackCategoryName", "") or ""),
            "trackAlias": str(getattr(track, "trackAlias", "") or ""),
            "source": "gRPC",
            # AIS 对齐 dds_parser._parse_ais_track，其余对齐雷达
            "data_type": "ais_track" if is_ais else "radar_track",
            # 供 receiver_manager 归类 track_layer_key / dds_source_id
            "data_source_id": data_source_id,
            "track_layer_key": layer_key,
        }
        if is_ais:
            result["mmsi"] = int(getattr(track, "mmsi", 0) or 0)
        _attach_link_times_fusion_track(result, track)
        if not is_ais:
            _apply_uav_self_report(result, str(getattr(track, "reserved6", "") or ""))
        return result
    except Exception as e:  # noqa: BLE001 - 单条失败不影响整批
        logger.error(f"FusionTrack gRPC 航迹解析失败 [{data_source_id}]: {e}")
        return None
