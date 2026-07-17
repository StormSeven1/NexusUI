"""探鸟采集前释放 UDP 8001，并重启 CustomBackend 侧监听。

Docker(host network) 内无法杀掉宿主机 start.py，通过触发文件通知宿主机守护进程。
"""
from __future__ import annotations

import os
import socket
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List

from loguru import logger

# 默认探鸟 ML 点迹端口（与 config UDP_RECEIVERS udp_bird_radar_ml 一致）
BIRD_RADAR_UDP_PORT = int(os.getenv("BIRD_RADAR_UDP_PORT", "8001"))
RECEIVER_ID = "udp_bird_radar_ml"

# 宿主机 guard 轮询此文件（与容器共享挂载目录）
_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "radar_train_captures"
TRIGGER_PATH = _DATA_DIR / ".request_free_udp_8001"
DONE_PATH = _DATA_DIR / ".free_udp_8001_done"

# 仅杀明显相关进程，避免误杀无关 start.py
_CMDLINE_HINTS = (
    "for_uav_recognition",
    "Predictdy",
    "BirdRadar",
    "bird_radar",
    "start.py",
)


def _port_is_free(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False
    finally:
        try:
            sock.close()
        except OSError:
            pass


def _pids_listening_udp(port: int) -> List[int]:
    """尽量从本 pid namespace 解析占用 UDP port 的进程。"""
    pids: List[int] = []
    try:
        out = subprocess.check_output(
            ["ss", "-ulnp"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        return pids

    needle = f":{port}"
    for line in out.splitlines():
        if needle not in line:
            continue
        # users:(("python",pid=123,fd=...))
        for part in line.split("pid="):
            if part is line:
                continue
            digits = ""
            for ch in part:
                if ch.isdigit():
                    digits += ch
                else:
                    break
            if digits:
                try:
                    pids.append(int(digits))
                except ValueError:
                    pass
    return sorted(set(pids))


def _cmdline(pid: int) -> str:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
        return raw.replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
    except OSError:
        return ""


def _kill_local_occupiers(port: int) -> List[str]:
    killed: List[str] = []
    for pid in _pids_listening_udp(port):
        cmd = _cmdline(pid)
        # 无 cmdline（可能是宿主机进程在容器里不可见）则跳过
        if not cmd:
            continue
        low = cmd.lower()
        if not any(h.lower() in low for h in _CMDLINE_HINTS):
            # 仍占用本端口的其它进程也杀：本机既然后端采集需要独占 8001
            logger.warning("UDP {} 被非探鸟进程占用，仍结束: pid={} cmd={}", port, pid, cmd[:160])
        try:
            os.kill(pid, 15)
            killed.append(f"SIGTERM pid={pid} ({cmd[:80]})")
            time.sleep(0.4)
            try:
                os.kill(pid, 0)
                os.kill(pid, 9)
                killed.append(f"SIGKILL pid={pid}")
            except OSError:
                pass
        except OSError as e:
            killed.append(f"kill pid={pid} 失败: {e}")
    # 再尝试 fuser（容器内常无此命令）
    try:
        r = subprocess.run(
            ["fuser", "-k", f"{port}/udp"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if r.returncode == 0 or r.stdout or r.stderr:
            killed.append(f"fuser {port}/udp: {(r.stdout or r.stderr).strip()[:120]}")
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        pass
    return killed


def _request_host_guard(port: int) -> None:
    """通知宿主机守护释放端口（Docker 无 pid=host 时必需）。"""
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        DONE_PATH.unlink(missing_ok=True)
        TRIGGER_PATH.write_text(f"{port}\n{time.time()}\n", encoding="utf-8")
        logger.info("已请求宿主机释放 UDP {} → {}", port, TRIGGER_PATH)
    except OSError as e:
        logger.warning("写 UDP 释放触发文件失败: {}", e)


def _wait_host_or_free(port: int, timeout_sec: float = 3.0) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if DONE_PATH.is_file():
            try:
                DONE_PATH.unlink(missing_ok=True)
            except OSError:
                pass
            if _port_is_free(port):
                return True
        if _port_is_free(port):
            return True
        time.sleep(0.2)
    return _port_is_free(port)


def restart_bird_radar_udp_receiver() -> Dict[str, Any]:
    from receivers.receiver_manager import receiver_manager
    from config import UDP_RECEIVERS

    cfg = next((c for c in UDP_RECEIVERS if c.get("id") == RECEIVER_ID), None)
    if not cfg or not cfg.get("enabled", False):
        return {"ok": False, "message": f"未找到启用中的 {RECEIVER_ID} 配置"}

    old = receiver_manager.udp_receivers.get(RECEIVER_ID)
    if old:
        try:
            old.stop()
        except Exception as e:
            logger.warning("停止旧 UDP 接收器失败: {}", e)
        receiver_manager.udp_receivers.pop(RECEIVER_ID, None)

    cfg = dict(cfg)
    cfg["local_interface"] = receiver_manager.local_interface
    from receivers.network import UDPReceiver

    receiver = UDPReceiver(cfg, receiver_manager._on_udp_data)
    receiver_manager.udp_receivers[RECEIVER_ID] = receiver
    receiver.start()
    time.sleep(0.3)
    alive = bool(receiver.running and receiver.thread and receiver.thread.is_alive())
    return {"ok": alive, "receiver_id": RECEIVER_ID, "running": alive}


def ensure_bird_radar_udp_ready(port: int = BIRD_RADAR_UDP_PORT) -> Dict[str, Any]:
    """
    采集开始前调用：释放 UDP 端口并重启探鸟点迹接收器。
    """
    steps: List[str] = []
    free_before = _port_is_free(port)
    steps.append(f"port_free_before={free_before}")

    if not free_before:
        local_killed = _kill_local_occupiers(port)
        steps.extend(local_killed or ["本 pid 命名空间无可杀占用进程"])
        _request_host_guard(port)
        steps.append("已触发宿主机 UDP guard")
        free_after = _wait_host_or_free(port, timeout_sec=4.0)
        steps.append(f"port_free_after_wait={free_after}")
    else:
        free_after = True

    restart = restart_bird_radar_udp_receiver()
    steps.append(f"udp_receiver_restart ok={restart.get('ok')}")

    # 重启绑定瞬间会占住端口；用「接收线程是否活着」判定成功更准
    ok = bool(restart.get("ok"))
    if not ok and not free_after:
        return {
            "ok": False,
            "message": (
                f"UDP {port} 仍被占用且探鸟点迹接收器未能重启。"
                "请确认宿主机已运行 scripts/bird_radar_udp_host_guard.sh，"
                "或手动结束占用 8001 的 start.py 后重试。"
            ),
            "port": port,
            "steps": steps,
            "restart": restart,
        }

    return {
        "ok": True,
        "message": "UDP 探鸟端口已就绪" if free_after or ok else "已尝试释放并重启接收器",
        "port": port,
        "steps": steps,
        "restart": restart,
    }
