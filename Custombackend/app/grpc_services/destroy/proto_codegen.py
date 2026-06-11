"""
Destroy proto 自动生成工具。

要求：
1. gRPC 相关 Python 文件放在 destroy 目录内，避免散落到其他模块。
2. 后端每次启动时自动检查 destroy.proto 是否需要重新生成。
"""

from __future__ import annotations

import importlib
from pathlib import Path
import sys

from grpc_tools import protoc


DESTROY_DIR = Path(__file__).resolve().parent
PROTO_FILE = DESTROY_DIR / "destroy.proto"
GENERATED_FILES = (
    DESTROY_DIR / "destroy_pb2.py",
    DESTROY_DIR / "destroy_pb2_grpc.py",
)


def _needs_regenerate() -> bool:
    """只要任一生成文件不存在，或 proto 更新更晚，就重新生成。"""
    if not PROTO_FILE.exists():
        raise FileNotFoundError(f"Destroy proto not found: {PROTO_FILE}")
    proto_mtime = PROTO_FILE.stat().st_mtime
    for generated in GENERATED_FILES:
        if not generated.exists():
            return True
        if generated.stat().st_mtime < proto_mtime:
            return True
    return False


def ensure_destroy_proto_generated() -> None:
    """确保 destroy_pb2.py / destroy_pb2_grpc.py 已按最新 proto 生成。"""
    if not _needs_regenerate():
        return

    result = protoc.main(
        [
            "grpc_tools.protoc",
            f"-I{DESTROY_DIR}",
            f"--python_out={DESTROY_DIR}",
            f"--grpc_python_out={DESTROY_DIR}",
            str(PROTO_FILE),
        ]
    )
    if result != 0:
        raise RuntimeError(f"Failed to generate destroy gRPC python files, protoc exit code={result}")

    importlib.invalidate_caches()


def load_destroy_proto_modules():
    """按需生成并返回 pb2 / pb2_grpc 模块。"""
    ensure_destroy_proto_generated()
    destroy_dir_str = str(DESTROY_DIR)
    if destroy_dir_str not in sys.path:
        sys.path.insert(0, destroy_dir_str)
    pb2 = importlib.import_module("grpc_services.destroy.destroy_pb2")
    pb2_grpc = importlib.import_module("grpc_services.destroy.destroy_pb2_grpc")
    return pb2, pb2_grpc
