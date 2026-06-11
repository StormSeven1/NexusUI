"""
航迹 DDS 独立子进程入口。

与 Entity/相机 等同进程加载 FastDDS 绑定会污染符号、争用 DomainParticipantFactory，
导致 domain 141 航迹订阅反复 matched=0（与前端 target_id 无关）。
本 worker 仅加载航迹相关 .so，由主进程通过 Queue 收样本。
"""
from __future__ import annotations

import os
import sys
import time
import traceback
from multiprocessing import Queue
from typing import Any, Dict, List

# 确保 app 根在 path（spawn 子进程 cwd 可能为 app/）
_APP_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _APP_ROOT not in sys.path:
    sys.path.insert(0, _APP_ROOT)


def _build_source_config(config: Dict[str, Any]) -> Dict[str, Any]:
    receiver_id = config["id"]
    return {
        "source_id": receiver_id,
        "name": config["name"],
        "dds_config": {
            "domain_id": config["domain_id"],
            "topic_name": config["topic_name"],
            "profile_name": config["profile_name"],
            "discovery_server_ip": config["discovery_server_ip"],
            "discovery_server_port": config["discovery_server_port"],
            "multicast_ip": config["multicast_ip"],
            "multicast_port": config["multicast_port"],
            "dds_module_path": config["dds_module_path"],
            "structure_type": config["structure_type"],
            "dds_module_name": config.get("dds_module_name", ""),
            "data_class_name": config["data_class_name"],
            "pubsub_type_class_name": config["pubsub_type_class_name"],
            "type_name": config["type_name"],
            "use_default_xml": config.get("use_default_xml", False),
            "subscriber_xml_file": config.get("subscriber_xml_file", ""),
            "dds_python_module": config.get("dds_python_module", ""),
        },
    }


def run_track_worker(configs: List[Dict[str, Any]], out_queue: Queue, stop_token: str) -> None:
    """子进程主循环：启动航迹 DDS 接收器，向主进程队列投递解析结果与健康度。"""
    os.environ.setdefault("TZ", "Asia/Shanghai")
    # 仅使用 Fast DDS 3.1（与 Python 绑定一致），禁止 build/ 内 3.2 库覆盖
    _eprosima = "/usr/local/eprosima/fastdds/lib:/usr/local/eprosima/fastcdr/lib"
    _existing = os.environ.get("LD_LIBRARY_PATH", "")
    _parts = [_eprosima]
    for p in _existing.split(":"):
        if not p or "NewTrackStruct/build" in p:
            continue
        if p not in _parts:
            _parts.append(p)
    os.environ["LD_LIBRARY_PATH"] = ":".join(_parts)

    try:
        from receivers.network.dds_receiver_service import (
            DDSReceiverService,
            DDS_SUBSCRIPTION_MATCHED,
            DDS_AVAILABLE,
        )
        from receivers.receiver_manager import ReceiverManager
    except Exception as exc:
        out_queue.put({"kind": "fatal", "error": f"import failed: {exc}"})
        return

    if not DDS_AVAILABLE:
        out_queue.put({"kind": "fatal", "error": "fastdds unavailable in track worker"})
        return

    receivers: Dict[str, Any] = {}
    ordered = sorted(
        configs,
        key=ReceiverManager._dds_receiver_boot_order,
    )

    def _callback(receiver_id: str, topic_name: str, source_name: str):
        def _on_data(parsed: Dict[str, Any]):
            if not parsed:
                return
            out_queue.put({
                "kind": "data",
                "receiver_id": receiver_id,
                "topic_name": topic_name,
                "source_name": source_name,
                "parsed": parsed,
            })
        return _on_data

    for config in ordered:
        rid = config["id"]
        try:
            sc = _build_source_config(config)
            recv = DDSReceiverService(
                source_config=sc,
                data_callback=_callback(rid, config["topic_name"], config["name"]),
            )
            recv.name = config["name"]
            receivers[rid] = recv
            out_queue.put({"kind": "started", "receiver_id": rid})
        except Exception as exc:
            out_queue.put({
                "kind": "start_error",
                "receiver_id": rid,
                "error": str(exc),
                "trace": traceback.format_exc(),
            })

    out_queue.put({"kind": "ready", "receiver_ids": list(receivers.keys())})
    last_health = 0.0
    token_path = stop_token if stop_token else ""

    while True:
        if token_path and os.path.isfile(token_path):
            try:
                with open(token_path, "r", encoding="utf-8") as f:
                    if f.read().strip() == "stop":
                        try:
                            os.remove(token_path)
                        except OSError:
                            pass
                        break
            except OSError:
                pass
        now = time.monotonic()
        if now - last_health >= 2.0:
            last_health = now
            track_ids = list(receivers.keys())
            out_queue.put({
                "kind": "health",
                "subscription_matched": {rid: DDS_SUBSCRIPTION_MATCHED.get(rid, 0) for rid in track_ids},
            })
        time.sleep(0.05)

    for recv in receivers.values():
        try:
            recv.delete()
        except Exception:
            pass
    out_queue.put({"kind": "stopped"})
