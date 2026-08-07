"""EntityStatus gRPC 子进程 worker（独立 GIL 收流 + pending 合批）。"""
from __future__ import annotations

import os
import sys
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

_PendingKey = Tuple[str, str]


def _slot_key(resp) -> Optional[_PendingKey]:
    which = resp.WhichOneof("status")
    if not which:
        return None
    if which == "high_freq_real_time_status":
        msg = resp.high_freq_real_time_status
        eid = (msg.base.entity_id or msg.drone_sn or "") or ""
        return (which, eid)
    if which == "drone_real_time_status":
        msg = resp.drone_real_time_status
        eid = (msg.base.entity_id or msg.drone_sn or "") or ""
        return (which, eid)
    if which == "drone_task_real_time_status":
        msg = resp.drone_task_real_time_status
        eid = (msg.base.entity_id or "") or ""
        return (which, eid)
    if which == "camera_real_time_status":
        msg = resp.camera_real_time_status
        eid = (msg.base.entity_id or "") or ""
        return (which, eid)
    return None


def run_entity_status_worker(
    host: str,
    port: int,
    receiver_id: str,
    out_queue,
    stop_token_path: str,
    flush_ms: float,
) -> None:
    """子进程入口：独立 GIL 收流，pending 合批后把已解析 dict 放入 Queue。"""
    import grpc

    bridge_dir = Path(__file__).resolve().parents[2] / "bridge" / "grpc_generated"
    app_dir = Path(__file__).resolve().parents[2]
    if str(bridge_dir) not in sys.path:
        sys.path.insert(0, str(bridge_dir))
    if str(app_dir) not in sys.path:
        sys.path.insert(0, str(app_dir))

    from entity_status_pb2 import EntityStatusRequest
    from entity_status_pb2_grpc import EntityStatusServiceStub
    from parsers.entity_status_grpc_parser import parse_entity_status_response

    stop = threading.Event()
    pending: Dict[_PendingKey, Any] = {}
    pending_lock = threading.Lock()
    stats = {"coalesced": 0}

    def _stopped() -> bool:
        if stop.is_set():
            return True
        try:
            return os.path.isfile(stop_token_path)
        except OSError:
            return False

    def _emit_parsed(resp) -> None:
        parsed = parse_entity_status_response(resp, source_id=receiver_id)
        if not parsed:
            return
        try:
            out_queue.put_nowait({"kind": "data", "parsed": parsed})
        except Exception:
            pass

    def _flush() -> None:
        with pending_lock:
            if not pending:
                return
            batch = dict(pending)
            pending.clear()
        for resp in batch.values():
            _emit_parsed(resp)

    def _flush_loop() -> None:
        interval = max(0.02, flush_ms / 1000.0) if flush_ms > 0 else 0.1
        while not stop.wait(interval):
            if _stopped():
                break
            try:
                _flush()
            except Exception as e:
                try:
                    out_queue.put_nowait({"kind": "error", "error": f"flush: {e}"})
                except Exception:
                    pass

    def _watch_stop() -> None:
        while not stop.wait(0.3):
            if _stopped():
                stop.set()
                break

    options = [
        ("grpc.max_receive_message_length", 32 * 1024 * 1024),
        ("grpc.keepalive_time_ms", 10000),
        ("grpc.keepalive_timeout_ms", 5000),
        ("grpc.keepalive_permit_without_calls", 1),
    ]
    coalesce = flush_ms > 0.0
    backoff = 1.0
    if coalesce:
        threading.Thread(
            target=_flush_loop, name=f"hf-flush-{receiver_id}", daemon=True
        ).start()
    threading.Thread(
        target=_watch_stop, name=f"hf-stop-{receiver_id}", daemon=True
    ).start()

    try:
        out_queue.put({"kind": "started", "receiver_id": receiver_id, "pid": os.getpid()})
    except Exception:
        pass

    while not _stopped():
        channel = None
        try:
            channel = grpc.insecure_channel(f"{host}:{port}", options=options)
            grpc.channel_ready_future(channel).result(timeout=10)
            stub = EntityStatusServiceStub(channel)
            stream = stub.EntityStatusMethod(EntityStatusRequest())
            with pending_lock:
                pending.clear()
            try:
                out_queue.put_nowait({"kind": "connected", "receiver_id": receiver_id})
            except Exception:
                pass
            backoff = 1.0
            for resp in stream:
                if _stopped():
                    break
                if coalesce:
                    key = _slot_key(resp)
                    if key is not None:
                        with pending_lock:
                            if key in pending:
                                stats["coalesced"] += 1
                            pending[key] = resp
                        continue
                _emit_parsed(resp)
            _flush()
        except Exception as e:
            if _stopped():
                break
            try:
                out_queue.put_nowait({"kind": "error", "error": str(e)})
            except Exception:
                pass
            if stop.wait(backoff):
                break
            backoff = min(backoff * 2, 120.0)
        finally:
            if channel is not None:
                try:
                    channel.close()
                except Exception:
                    pass

    stop.set()
    try:
        _flush()
    except Exception:
        pass
    try:
        out_queue.put_nowait(
            {
                "kind": "stopped",
                "receiver_id": receiver_id,
                "coalesced": stats["coalesced"],
            }
        )
    except Exception:
        pass
