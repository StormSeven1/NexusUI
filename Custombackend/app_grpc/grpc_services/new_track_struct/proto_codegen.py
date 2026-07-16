"""Generate and load Python modules for NewTrackStruct gRPC protos."""
from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path
from typing import Tuple

from loguru import logger


NEW_TRACK_STRUCT_DIR = Path(__file__).resolve().parent
PROTO_DIR = NEW_TRACK_STRUCT_DIR / "proto"
GENERATED_DIR = NEW_TRACK_STRUCT_DIR / "generated"
PROTO_FILE = PROTO_DIR / "new_track_struct_stream.proto"


def _patch_imports(py_file: Path) -> None:
    text = py_file.read_text(encoding="utf-8")
    text = re.sub(
        r"^import new_track_struct_stream_pb2 as ",
        "from . import new_track_struct_stream_pb2 as ",
        text,
        flags=re.M,
    )
    py_file.write_text(text, encoding="utf-8")


def ensure_new_track_struct_proto_generated() -> None:
    if not PROTO_FILE.exists():
        raise FileNotFoundError(f"NewTrackStruct proto not found: {PROTO_FILE}")

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    (GENERATED_DIR / "__init__.py").write_text("", encoding="utf-8")

    expected = (
        GENERATED_DIR / "new_track_struct_stream_pb2.py",
        GENERATED_DIR / "new_track_struct_stream_pb2_grpc.py",
    )
    newest_proto = PROTO_FILE.stat().st_mtime
    if all(path.exists() and path.stat().st_mtime >= newest_proto for path in expected):
        return

    from grpc_tools import protoc

    logger.info("[new-track-struct-grpc] generating python proto modules")
    result = protoc.main(
        [
            "grpc_tools.protoc",
            f"-I{PROTO_DIR.as_posix()}",
            f"--python_out={GENERATED_DIR.as_posix()}",
            f"--grpc_python_out={GENERATED_DIR.as_posix()}",
            PROTO_FILE.name,
        ]
    )
    if result != 0:
        raise RuntimeError(f"NewTrackStruct proto generation failed: protoc exit code {result}")

    for py_file in GENERATED_DIR.rglob("*.py"):
        _patch_imports(py_file)

    importlib.invalidate_caches()


def load_new_track_struct_proto_modules() -> Tuple[object, object]:
    ensure_new_track_struct_proto_generated()
    parent = str(NEW_TRACK_STRUCT_DIR.parent.parent)
    if parent not in sys.path:
        sys.path.insert(0, parent)
    pb2 = importlib.import_module(
        "grpc_services.new_track_struct.generated.new_track_struct_stream_pb2"
    )
    pb2_grpc = importlib.import_module(
        "grpc_services.new_track_struct.generated.new_track_struct_stream_pb2_grpc"
    )
    return pb2, pb2_grpc
