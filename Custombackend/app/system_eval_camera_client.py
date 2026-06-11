"""
相机评估 gRPC 客户端（CameraEvaluationService）。
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, Optional

from loguru import logger

from system_eval_json_util import json_safe_value

_PROTO_ROOT = Path(__file__).resolve().parent.parent / "proto"
_GEN_ROOT = Path(__file__).resolve().parent / "system_eval_gen"
_GENERATED = False


def _ensure_generated() -> None:
    global _GENERATED
    if _GENERATED and (_GEN_ROOT / "camera" / "v1" / "camera_evaluation_pb2.py").exists():
        return
    try:
        from grpc_tools import protoc
        import grpc_tools
    except ImportError as e:
        raise RuntimeError("缺少 grpcio-tools，请 pip install grpcio grpcio-tools") from e

    proto_file = _PROTO_ROOT / "camera" / "v1" / "camera_evaluation.proto"
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


def _load_stub():
    _ensure_generated()
    gen_path = str(_GEN_ROOT)
    if gen_path not in sys.path:
        sys.path.insert(0, gen_path)
    from camera.v1 import camera_evaluation_pb2 as camera_pb2
    from camera.v1 import camera_evaluation_pb2_grpc as camera_grpc

    return camera_pb2, camera_grpc


def get_sharpness(
    target: str,
    camera_entity_id: str,
    return_components: bool = True,
    timeout_sec: float = 15.0,
) -> Dict[str, Any]:
    try:
        import grpc
        from google.protobuf.json_format import MessageToDict

        camera_pb2, camera_grpc = _load_stub()
        channel = grpc.insecure_channel(target)
        try:
            stub = camera_grpc.CameraEvaluationServiceStub(channel)
            req = camera_pb2.GetSharpnessRequest(
                camera_entity_id=(camera_entity_id or "").strip(),
                return_components=bool(return_components),
            )
            resp = stub.GetSharpness(req, timeout=timeout_sec)
            data = json_safe_value(MessageToDict(resp, preserving_proto_field_name=True))
            err = (data.get("error_message") or "").strip()
            return {
                "ok": not err,
                "sharpness": data,
                "error_message": err or None,
                "grpc_target": target,
            }
        except grpc.RpcError as e:
            logger.warning("camera-eval GetSharpness 失败: {} {}", target, e)
            return {
                "ok": False,
                "sharpness": None,
                "error_message": f"gRPC 错误: {e.code().name} {e.details()}",
                "grpc_target": target,
            }
        finally:
            channel.close()
    except Exception as e:
        logger.exception("camera-eval GetSharpness 异常")
        return {
            "ok": False,
            "sharpness": None,
            "error_message": str(e),
            "grpc_target": target,
        }


def trigger_visibility_check(
    target: str,
    camera_entity_id: str,
    task_id: Optional[str] = None,
    timeout_ms: int = 120000,
    timeout_sec: float = 15.0,
) -> Dict[str, Any]:
    import grpc
    from google.protobuf.json_format import MessageToDict

    camera_pb2, camera_grpc = _load_stub()
    channel = grpc.insecure_channel(target)
    try:
        stub = camera_grpc.CameraEvaluationServiceStub(channel)
        req = camera_pb2.TriggerVisibilityCheckRequest(
            camera_entity_id=(camera_entity_id or "").strip(),
            task_id=(task_id or "").strip(),
            timeout_ms=max(1000, int(timeout_ms)),
        )
        resp = stub.TriggerVisibilityCheck(req, timeout=timeout_sec)
        data = json_safe_value(MessageToDict(resp, preserving_proto_field_name=True))
        err = (data.get("error_message") or "").strip()
        accepted = bool(data.get("accepted"))
        return {
            "ok": accepted and not err,
            "trigger": data,
            "error_message": err or None,
            "grpc_target": target,
        }
    except grpc.RpcError as e:
        logger.warning("camera-eval TriggerVisibilityCheck 失败: {} {}", target, e)
        return {
            "ok": False,
            "trigger": None,
            "error_message": f"gRPC 错误: {e.code().name} {e.details()}",
            "grpc_target": target,
        }
    except Exception as e:
        logger.exception("camera-eval TriggerVisibilityCheck 异常")
        return {
            "ok": False,
            "trigger": None,
            "error_message": str(e),
            "grpc_target": target,
        }
    finally:
        channel.close()


def get_visibility(
    target: str,
    camera_entity_id: str,
    timeout_sec: float = 10.0,
) -> Dict[str, Any]:
    import grpc
    from google.protobuf.json_format import MessageToDict

    camera_pb2, camera_grpc = _load_stub()
    channel = grpc.insecure_channel(target)
    try:
        stub = camera_grpc.CameraEvaluationServiceStub(channel)
        req = camera_pb2.GetVisibilityRequest(camera_entity_id=(camera_entity_id or "").strip())
        resp = stub.GetVisibility(req, timeout=timeout_sec)
        data = json_safe_value(MessageToDict(resp, preserving_proto_field_name=True))
        err = (data.get("error_message") or "").strip()
        has_value = data.get("visibility") is not None
        return {
            "ok": has_value or not err,
            "visibility": data,
            "error_message": err or None,
            "grpc_target": target,
        }
    except grpc.RpcError as e:
        logger.warning("camera-eval GetVisibility 失败: {} {}", target, e)
        return {
            "ok": False,
            "visibility": None,
            "error_message": f"gRPC 错误: {e.code().name} {e.details()}",
            "grpc_target": target,
        }
    except Exception as e:
        logger.exception("camera-eval GetVisibility 异常")
        return {
            "ok": False,
            "visibility": None,
            "error_message": str(e),
            "grpc_target": target,
        }
    finally:
        channel.close()


def trigger_true_north_pointing_eval(
    target: str,
    camera_entity_id: str,
    task_id: Optional[str] = None,
    track_id: int = 0,
    unique_id: int = 0,
    longitude: float = 0.0,
    latitude: float = 0.0,
    azimuth: float = 0.0,
    distance: float = 0.0,
    range_band: str = "",
    ship_type: int = 3,
    rect_type: int = 0,
    timeout_ms: int = 120000,
    timeout_sec: float = 15.0,
) -> Dict[str, Any]:
    import grpc
    from google.protobuf.json_format import MessageToDict

    camera_pb2, camera_grpc = _load_stub()
    channel = grpc.insecure_channel(target)
    try:
        stub = camera_grpc.CameraEvaluationServiceStub(channel)
        req = camera_pb2.TriggerTrueNorthPointingEvalRequest(
            camera_entity_id=(camera_entity_id or "").strip(),
            task_id=(task_id or "").strip(),
            timeout_ms=max(1000, int(timeout_ms)),
        )
        req.target.track_id = int(track_id)
        req.target.unique_id = int(unique_id)
        req.target.longitude = float(longitude)
        req.target.latitude = float(latitude)
        req.target.azimuth = float(azimuth)
        req.target.distance = float(distance)
        req.target.range_band = (range_band or "").strip()
        req.target.ship_type = int(ship_type) if ship_type > 0 else 3
        req.target.rect_type = int(rect_type)
        resp = stub.TriggerTrueNorthPointingEval(req, timeout=timeout_sec)
        data = json_safe_value(MessageToDict(resp, preserving_proto_field_name=True))
        err = (data.get("error_message") or "").strip()
        accepted = bool(data.get("accepted"))
        return {
            "ok": accepted and not err,
            "trigger": data,
            "error_message": err or None,
            "grpc_target": target,
        }
    except grpc.RpcError as e:
        logger.warning("camera-eval TriggerTrueNorthPointingEval 失败: {} {}", target, e)
        return {
            "ok": False,
            "trigger": None,
            "error_message": f"gRPC 错误: {e.code().name} {e.details()}",
            "grpc_target": target,
        }
    except Exception as e:
        logger.exception("camera-eval TriggerTrueNorthPointingEval 异常")
        return {
            "ok": False,
            "trigger": None,
            "error_message": str(e),
            "grpc_target": target,
        }
    finally:
        channel.close()


def get_true_north_pointing_result(
    target: str,
    camera_entity_id: str,
    task_id: Optional[str] = None,
    lookback_hours: int = 72,
    timeout_sec: float = 15.0,
) -> Dict[str, Any]:
    import grpc
    from google.protobuf.json_format import MessageToDict

    camera_pb2, camera_grpc = _load_stub()
    channel = grpc.insecure_channel(target)
    try:
        stub = camera_grpc.CameraEvaluationServiceStub(channel)
        req = camera_pb2.GetTrueNorthPointingResultRequest(
            camera_entity_id=(camera_entity_id or "").strip(),
            task_id=(task_id or "").strip(),
            lookback_hours=max(0, int(lookback_hours or 0)),
        )
        resp = stub.GetTrueNorthPointingResult(req, timeout=timeout_sec)
        data = json_safe_value(MessageToDict(resp, preserving_proto_field_name=True))
        err = (data.get("error_message") or "").strip()
        has_samples = bool(data.get("samples"))
        return {
            "ok": has_samples or not err,
            "result": data,
            "error_message": err or None,
            "grpc_target": target,
        }
    except grpc.RpcError as e:
        logger.warning("camera-eval GetTrueNorthPointingResult 失败: {} {}", target, e)
        return {
            "ok": False,
            "result": None,
            "error_message": f"gRPC 错误: {e.code().name} {e.details()}",
            "grpc_target": target,
        }
    except Exception as e:
        logger.exception("camera-eval GetTrueNorthPointingResult 异常")
        return {
            "ok": False,
            "result": None,
            "error_message": str(e),
            "grpc_target": target,
        }
    finally:
        channel.close()
