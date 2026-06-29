from __future__ import annotations

import importlib
from pathlib import Path
import re
import sys

from grpc_tools import protoc


DESTROY_DIR = Path(__file__).resolve().parent
PROTO_FILE = DESTROY_DIR / "destroy.proto"
GENERATED_FILES = (
    DESTROY_DIR / "destroy_pb2.py",
    DESTROY_DIR / "destroy_pb2_grpc.py",
)
MODULE_NAMES = (
    "destroy_pb2",
    "destroy_pb2_grpc",
    "grpc_services.destroy.destroy_pb2",
    "grpc_services.destroy.destroy_pb2_grpc",
)


def _clear_destroy_proto_modules() -> None:
    for module_name in MODULE_NAMES:
        sys.modules.pop(module_name, None)


def _remove_generated_files() -> None:
    for generated in GENERATED_FILES:
        try:
            generated.unlink()
        except FileNotFoundError:
            pass


def _strip_protobuf_runtime_check() -> None:
    pb2_file = DESTROY_DIR / "destroy_pb2.py"
    if not pb2_file.exists():
        return

    text = pb2_file.read_text(encoding="utf-8")
    text = re.sub(
        r"_runtime_version\.ValidateProtobufRuntimeVersion\(\s*"
        r"_runtime_version\.Domain\.PUBLIC,\s*"
        r"\d+,\s*\d+,\s*\d+,\s*'[^']*',\s*'destroy\.proto'\s*\)\s*",
        "",
        text,
        count=1,
        flags=re.MULTILINE,
    )
    pb2_file.write_text(text, encoding="utf-8")


def ensure_destroy_proto_generated() -> None:
    """Always regenerate pb2 files with the protobuf runtime in this environment."""
    if not PROTO_FILE.exists():
        raise FileNotFoundError(f"Destroy proto not found: {PROTO_FILE}")

    _clear_destroy_proto_modules()
    _remove_generated_files()

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

    _strip_protobuf_runtime_check()
    importlib.invalidate_caches()


def load_destroy_proto_modules():
    ensure_destroy_proto_generated()
    _clear_destroy_proto_modules()

    destroy_dir_str = str(DESTROY_DIR)
    if destroy_dir_str not in sys.path:
        sys.path.insert(0, destroy_dir_str)

    pb2 = importlib.import_module("grpc_services.destroy.destroy_pb2")
    pb2_grpc = importlib.import_module("grpc_services.destroy.destroy_pb2_grpc")
    return pb2, pb2_grpc
