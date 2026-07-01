"""Generate and load Python modules for entity gRPC protos."""
from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path
from typing import Tuple

from grpc_tools import protoc
from loguru import logger


ENTITY_DIR = Path(__file__).resolve().parent
PROTO_DIR = ENTITY_DIR / "proto"
GENERATED_DIR = ENTITY_DIR / "generated"

PROTO_FILES = [
    PROTO_DIR / "entity_status.proto",
    PROTO_DIR / "entity.proto",
    *sorted((PROTO_DIR / "entity").glob("*.proto")),
    *sorted((PROTO_DIR / "component").glob("*.proto")),
]


def _patch_imports(py_file: Path) -> None:
    text = py_file.read_text(encoding="utf-8")
    text = re.sub(r"^import (entity_status_pb2|entity_pb2) as ", r"from . import \1 as ", text, flags=re.M)
    if py_file.parent.name == "entity":
        text = re.sub(r"^from component import ", "from ..component import ", text, flags=re.M)
        text = re.sub(r"^import component\\.", "from .. import component.", text, flags=re.M)
    else:
        text = re.sub(r"^from component import ", "from .component import ", text, flags=re.M)
        text = re.sub(r"^from entity import ", "from .entity import ", text, flags=re.M)
        text = re.sub(r"^import component\\.", "from . import component.", text, flags=re.M)
        text = re.sub(r"^import entity\\.", "from . import entity.", text, flags=re.M)
    py_file.write_text(text, encoding="utf-8")


def ensure_entity_proto_generated() -> None:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    (GENERATED_DIR / "__init__.py").write_text("", encoding="utf-8")
    (GENERATED_DIR / "component").mkdir(exist_ok=True)
    (GENERATED_DIR / "component" / "__init__.py").write_text("", encoding="utf-8")
    (GENERATED_DIR / "entity").mkdir(exist_ok=True)
    (GENERATED_DIR / "entity" / "__init__.py").write_text("", encoding="utf-8")

    expected = [
        GENERATED_DIR / "entity_status_pb2.py",
        GENERATED_DIR / "entity_status_pb2_grpc.py",
        GENERATED_DIR / "entity_pb2.py",
        GENERATED_DIR / "entity_pb2_grpc.py",
    ]
    newest_proto = max(path.stat().st_mtime for path in PROTO_FILES)
    if all(path.exists() and path.stat().st_mtime >= newest_proto for path in expected):
        return

    args = [
        "grpc_tools.protoc",
        f"-I{PROTO_DIR.as_posix()}",
        f"--python_out={GENERATED_DIR.as_posix()}",
        f"--grpc_python_out={GENERATED_DIR.as_posix()}",
        *[path.relative_to(PROTO_DIR).as_posix() for path in PROTO_FILES],
    ]
    logger.info("[entity-grpc] generating python proto modules")
    result = protoc.main(args)
    if result != 0:
        raise RuntimeError(f"entity proto generation failed: protoc exit code {result}")

    for py_file in GENERATED_DIR.rglob("*.py"):
        _patch_imports(py_file)

    importlib.invalidate_caches()


def load_entity_proto_modules() -> Tuple[object, object, object, object]:
    ensure_entity_proto_generated()
    parent = str(ENTITY_DIR.parent.parent)
    if parent not in sys.path:
        sys.path.insert(0, parent)
    status_pb2 = importlib.import_module("grpc_services.entity.generated.entity_status_pb2")
    status_pb2_grpc = importlib.import_module("grpc_services.entity.generated.entity_status_pb2_grpc")
    entity_pb2 = importlib.import_module("grpc_services.entity.generated.entity_pb2")
    entity_pb2_grpc = importlib.import_module("grpc_services.entity.generated.entity_pb2_grpc")
    return status_pb2, status_pb2_grpc, entity_pb2, entity_pb2_grpc
