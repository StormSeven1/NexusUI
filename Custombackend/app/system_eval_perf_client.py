"""
系统性能评估 gRPC 客户端（PerformanceEvaluationService）。
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
    if _GENERATED and (_GEN_ROOT / "perf" / "v1" / "performance_evaluation_pb2.py").exists():
        return
    try:
        from grpc_tools import protoc
        import grpc_tools
    except ImportError as e:
        raise RuntimeError("缺少 grpcio-tools，请 pip install grpcio grpcio-tools") from e

    proto_file = _PROTO_ROOT / "perf" / "v1" / "performance_evaluation.proto"
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


def fetch_system_response_time_stats(
    target: str,
    limit: int = 10,
    timeout_sec: float = 8.0,
) -> Dict[str, Any]:
    """
    调用 GetSystemResponseTimeStats，返回 JSON 友好结构。
    """
    try:
        import grpc
        from google.protobuf.json_format import MessageToDict

        _ensure_generated()
        gen_path = str(_GEN_ROOT)
        if gen_path not in sys.path:
            sys.path.insert(0, gen_path)

        from perf.v1 import performance_evaluation_pb2 as perf_pb2
        from perf.v1 import performance_evaluation_pb2_grpc as perf_grpc

        channel = grpc.insecure_channel(target)
        try:
            stub = perf_grpc.PerformanceEvaluationServiceStub(channel)
            req = perf_pb2.GetSystemResponseTimeStatsRequest(limit=max(1, min(int(limit), 100)))
            resp = stub.GetSystemResponseTimeStats(req, timeout=timeout_sec)
            data = json_safe_value(MessageToDict(resp, preserving_proto_field_name=True))
            stats = data.get("stats") or {}
            err = (data.get("error_message") or "").strip()
            return {
                "ok": not err,
                "stats": stats,
                "error_message": err or None,
                "grpc_target": target,
            }
        except grpc.RpcError as e:
            logger.warning("system-eval gRPC 失败: {} {}", target, e)
            return {
                "ok": False,
                "stats": None,
                "error_message": f"gRPC 错误: {e.code().name} {e.details()}",
                "grpc_target": target,
            }
        finally:
            channel.close()
    except Exception as e:
        logger.exception("system-eval gRPC 异常")
        return {
            "ok": False,
            "stats": None,
            "error_message": str(e),
            "grpc_target": target,
        }
