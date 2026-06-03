"""
航迹质量评估 gRPC 客户端（TrackEvaluationService）。
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger

_PROTO_ROOT = Path(__file__).resolve().parent.parent / "proto"
_GEN_ROOT = Path(__file__).resolve().parent / "system_eval_gen"
_GENERATED = False


def _ensure_generated() -> None:
    global _GENERATED
    if _GENERATED and (_GEN_ROOT / "track" / "v1" / "track_evaluation_pb2.py").exists():
        return
    try:
        from grpc_tools import protoc
        import grpc_tools
    except ImportError as e:
        raise RuntimeError("缺少 grpcio-tools，请 pip install grpcio grpcio-tools") from e

    proto_file = _PROTO_ROOT / "track" / "v1" / "track_evaluation.proto"
    if not proto_file.exists():
        raise FileNotFoundError(f"proto 不存在: {proto_file}")

    _GEN_ROOT.mkdir(parents=True, exist_ok=True)
    proto_include = Path(grpc_tools.__file__).resolve().parent / "_proto"
    rc = protoc.main(
        [
            "grpc_tools.protoc",
            f"-I{_PROTO_ROOT}",
            f"-I{proto_include}",
            f"--python_out={_GEN_ROOT}",
            f"--grpc_python_out={_GEN_ROOT}",
            str(proto_file),
        ]
    )
    if rc != 0:
        raise RuntimeError(f"protoc 生成失败 rc={rc}")
    _GENERATED = True


def _parse_local_time(s: str) -> datetime:
    """解析前端 datetime-local：YYYY-MM-DDTHH:mm:ss"""
    s = (s or "").strip()
    if not s:
        raise ValueError("时间不能为空")
    if s.endswith("Z"):
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        dt = datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def evaluate_track_quality(
    target: str,
    *,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    scope: str = "BOTH",
    sensor_ids: Optional[List[int]] = None,
    region_type: str = "",
    bounding_box: Optional[Dict[str, float]] = None,
    polygon_points: Optional[List[Dict[str, float]]] = None,
    timeout_sec: float = 120.0,
) -> Dict[str, Any]:
    import grpc
    from google.protobuf import timestamp_pb2
    from google.protobuf.json_format import MessageToDict

    _ensure_generated()
    gen_path = str(_GEN_ROOT)
    if gen_path not in sys.path:
        sys.path.insert(0, gen_path)

    from track.v1 import track_evaluation_pb2 as track_pb2
    from track.v1 import track_evaluation_pb2_grpc as track_grpc

    scope_map = {
        "SEA": track_pb2.SEA,
        "AIR": track_pb2.AIR,
        "BOTH": track_pb2.BOTH,
    }
    req = track_pb2.EvaluateTrackQualityRequest(
        scope=scope_map.get(scope.upper(), track_pb2.BOTH),
    )
    if start_time:
        dt = _parse_local_time(start_time)
        ts = timestamp_pb2.Timestamp()
        ts.FromDatetime(dt)
        req.start_time.CopyFrom(ts)
    if end_time:
        dt = _parse_local_time(end_time)
        ts = timestamp_pb2.Timestamp()
        ts.FromDatetime(dt)
        req.end_time.CopyFrom(ts)
    if sensor_ids:
        req.sensor_ids.extend(int(x) for x in sensor_ids)

    if region_type == "rect" and bounding_box:
        req.region.type = track_pb2.RegionFilter.RECT
        bb = req.region.bounding_box
        bb.min_longitude = float(bounding_box.get("min_longitude", 0))
        bb.max_longitude = float(bounding_box.get("max_longitude", 0))
        bb.min_latitude = float(bounding_box.get("min_latitude", 0))
        bb.max_latitude = float(bounding_box.get("max_latitude", 0))
    elif region_type == "polygon" and polygon_points:
        req.region.type = track_pb2.RegionFilter.POLYGON
        for p in polygon_points:
            pt = req.region.polygon_points.add()
            pt.longitude = float(p.get("longitude", 0))
            pt.latitude = float(p.get("latitude", 0))

    channel = grpc.insecure_channel(target)
    try:
        stub = track_grpc.TrackEvaluationServiceStub(channel)
        resp = stub.EvaluateTrackQuality(req, timeout=timeout_sec)
        data = MessageToDict(resp, preserving_proto_field_name=True)
        status = data.get("status", 0)
        err = (data.get("error_message") or "").strip()
        ok = status == 0 or status == "OK"
        return {
            "ok": ok,
            "result": data,
            "error_message": err or None,
            "grpc_target": target,
        }
    except grpc.RpcError as e:
        logger.warning("track-eval gRPC 失败: {} {}", target, e)
        busy = e.code() == grpc.StatusCode.RESOURCE_EXHAUSTED
        return {
            "ok": False,
            "result": None,
            "error_message": f"gRPC 错误: {e.code().name} {e.details()}",
            "grpc_target": target,
            "resource_exhausted": busy,
        }
    except Exception as e:
        logger.exception("track-eval gRPC 异常")
        return {
            "ok": False,
            "result": None,
            "error_message": str(e),
            "grpc_target": target,
        }
    finally:
        channel.close()
