"""
航迹链路评估 gRPC 客户端（TrackLinkEvaluationService @ system-evaluation-server）。
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, Optional

from loguru import logger

_PROTO_ROOT = Path(__file__).resolve().parent.parent / "proto"
_GEN_ROOT = Path(__file__).resolve().parent / "system_eval_gen"
_GENERATED = False


def _ensure_generated() -> None:
    global _GENERATED
    if _GENERATED and (_GEN_ROOT / "track" / "v1" / "track_link_evaluation_pb2.py").exists():
        return
    try:
        from grpc_tools import protoc
        import grpc_tools
    except ImportError as e:
        raise RuntimeError("缺少 grpcio-tools，请 pip install grpcio grpcio-tools") from e

    proto_file = _PROTO_ROOT / "track" / "v1" / "track_link_evaluation.proto"
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


def _seg_to_dict(seg: Any) -> Dict[str, Any]:
    if seg is None:
        return {"avg_ms": None, "median_ms": None, "min_ms": None, "max_ms": None, "count": 0}
    out: Dict[str, Any] = {"count": int(getattr(seg, "count", 0) or 0)}
    for key in ("avg_ms", "median_ms", "min_ms", "max_ms"):
        if seg.HasField(key):
            out[key] = float(getattr(seg, key))
        else:
            out[key] = None
    return out


def _type_result_to_dict(row: Any) -> Dict[str, Any]:
    freq = None
    if row.HasField("update_frequency_hz"):
        freq = float(row.update_frequency_hz)
    return {
        "track_layer_key": row.track_layer_key,
        "label": row.label,
        "has_data": bool(row.has_data),
        "message": (row.message or None),
        "sampled_track_count": int(row.sampled_track_count or 0),
        "candidate_track_count": int(row.candidate_track_count or 0),
        "single_frame_dropped": int(row.single_frame_dropped or 0),
        "implausible_samples_dropped": int(row.implausible_samples_dropped or 0),
        "total_updates": int(row.total_updates or 0),
        "effective_updates": int(row.effective_updates or 0),
        "update_frequency_hz": freq,
        "segments": {
            "create_to_recv": _seg_to_dict(row.create_to_recv),
            "recv_to_send": _seg_to_dict(row.recv_to_send),
            "send_to_backend": _seg_to_dict(row.send_to_backend),
            "total": _seg_to_dict(row.total),
        },
    }


def trigger_track_link_eval_grpc(
    target: str,
    *,
    duration_sec: int = 30,
    max_tracks_per_type: int = 10,
    timeout_sec: float = 10.0,
) -> Dict[str, Any]:
    try:
        import grpc
    except Exception as e:
        return {"ok": False, "error_message": str(e), "grpc_target": target}

    _ensure_generated()
    gen_path = str(_GEN_ROOT)
    if gen_path not in sys.path:
        sys.path.insert(0, gen_path)

    from track.v1 import track_link_evaluation_pb2 as pb2
    from track.v1 import track_link_evaluation_pb2_grpc as pb2_grpc

    channel = grpc.insecure_channel(target)
    try:
        stub = pb2_grpc.TrackLinkEvaluationServiceStub(channel)
        req = pb2.TriggerTrackLinkEvalRequest(
            duration_sec=int(duration_sec),
            max_tracks_per_type=int(max_tracks_per_type),
        )
        resp = stub.TriggerTrackLinkEval(req, timeout=timeout_sec)
        return {
            "ok": not bool(resp.conflict),
            "conflict": bool(resp.conflict),
            "task_id": resp.task_id,
            "status": resp.status or "collecting",
            "duration_sec": int(resp.duration_sec or duration_sec),
            "max_tracks_per_type": int(resp.max_tracks_per_type or max_tracks_per_type),
            "message": (resp.error_message or None),
            "grpc_target": target,
        }
    except grpc.RpcError as e:
        logger.warning("track-link trigger gRPC 失败: {} {}", target, e)
        busy = e.code() == grpc.StatusCode.RESOURCE_EXHAUSTED
        return {
            "ok": False,
            "conflict": busy,
            "error_message": f"gRPC 错误: {e.code().name} {e.details()}",
            "grpc_target": target,
        }
    except Exception as e:
        logger.exception("track-link trigger 异常")
        return {"ok": False, "error_message": str(e), "grpc_target": target}
    finally:
        channel.close()


def get_track_link_eval_result_grpc(
    target: str,
    *,
    task_id: Optional[str] = None,
    timeout_sec: float = 15.0,
) -> Dict[str, Any]:
    try:
        import grpc
    except Exception as e:
        return {"ok": False, "error_message": str(e), "grpc_target": target}

    _ensure_generated()
    gen_path = str(_GEN_ROOT)
    if gen_path not in sys.path:
        sys.path.insert(0, gen_path)

    from track.v1 import track_link_evaluation_pb2 as pb2
    from track.v1 import track_link_evaluation_pb2_grpc as pb2_grpc

    channel = grpc.insecure_channel(target)
    try:
        stub = pb2_grpc.TrackLinkEvaluationServiceStub(channel)
        req = pb2.GetTrackLinkEvalResultRequest(task_id=(task_id or "").strip())
        resp = stub.GetTrackLinkEvalResult(req, timeout=timeout_sec)

        type_counts: Dict[str, Any] = {}
        for k, v in (resp.type_counts or {}).items():
            type_counts[k] = {
                "seen": int(v.seen or 0),
                "updated": int(v.updated or 0),
                "sampled": int(v.updated or 0),
                "updates": int(v.updates or 0),
            }

        results = [_type_result_to_dict(r) for r in (resp.results or [])]
        return {
            "ok": True,
            "task_id": resp.task_id,
            "status": resp.status,
            "duration_sec": int(resp.duration_sec or 0),
            "elapsed_sec": float(resp.elapsed_sec or 0),
            "remaining_sec": float(resp.remaining_sec or 0),
            "type_counts": type_counts,
            "results": results,
            "has_data": bool(resp.has_data),
            "message": (resp.message or None),
            "error": (resp.error_message or None),
            "started_at": float(resp.started_at_unix) if resp.started_at_unix else None,
            "ended_at": float(resp.ended_at_unix) if resp.ended_at_unix else None,
            "grpc_target": target,
        }
    except grpc.RpcError as e:
        logger.warning("track-link result gRPC 失败: {} {}", target, e)
        not_found = e.code() == grpc.StatusCode.NOT_FOUND
        return {
            "ok": False,
            "not_found": not_found,
            "error_message": f"gRPC 错误: {e.code().name} {e.details()}",
            "grpc_target": target,
        }
    except Exception as e:
        logger.exception("track-link result 异常")
        return {"ok": False, "error_message": str(e), "grpc_target": target}
    finally:
        channel.close()


def cancel_track_link_eval_grpc(
    target: str,
    *,
    task_id: Optional[str] = None,
    timeout_sec: float = 10.0,
) -> Dict[str, Any]:
    try:
        import grpc
    except Exception as e:
        return {"ok": False, "error_message": str(e), "grpc_target": target}

    _ensure_generated()
    gen_path = str(_GEN_ROOT)
    if gen_path not in sys.path:
        sys.path.insert(0, gen_path)

    from track.v1 import track_link_evaluation_pb2 as pb2
    from track.v1 import track_link_evaluation_pb2_grpc as pb2_grpc

    channel = grpc.insecure_channel(target)
    try:
        stub = pb2_grpc.TrackLinkEvaluationServiceStub(channel)
        req = pb2.CancelTrackLinkEvalRequest(task_id=(task_id or "").strip())
        resp = stub.CancelTrackLinkEval(req, timeout=timeout_sec)
        return {
            "ok": True,
            "cancelled": bool(resp.cancelled),
            "task_id": resp.task_id or None,
            "status": resp.status or ("cancelled" if resp.cancelled else "idle"),
            "message": (resp.message or None),
            "grpc_target": target,
        }
    except grpc.RpcError as e:
        logger.warning("track-link cancel gRPC 失败: {} {}", target, e)
        return {
            "ok": False,
            "cancelled": False,
            "error_message": f"gRPC 错误: {e.code().name} {e.details()}",
            "grpc_target": target,
        }
    except Exception as e:
        logger.exception("track-link cancel 异常")
        return {"ok": False, "cancelled": False, "error_message": str(e), "grpc_target": target}
    finally:
        channel.close()
