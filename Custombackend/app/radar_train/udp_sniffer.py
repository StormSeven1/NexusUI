"""探鸟 UDP:8001 旁路嗅探（不 bind，与 start.py 共存）。"""
from __future__ import annotations

import os
import socket
import struct
import threading
from pathlib import Path
from typing import Callable, List, Optional, Set, Tuple

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

ETH_P_ALL = 0x0003
ETH_P_IP = 0x0800
ETH_P_8021Q = 0x8100

BIRD_RADAR_UDP_PORT = int(os.getenv("BIRD_RADAR_UDP_PORT", "8001"))


def _udp_payload_from_ip(ip: bytes, port: int) -> Optional[bytes]:
    if len(ip) < 28:
        return None
    ver_ihl = ip[0]
    if (ver_ihl >> 4) != 4:
        return None
    ihl = (ver_ihl & 0x0F) * 4
    if ihl < 20 or len(ip) < ihl + 8:
        return None
    if ip[9] != 17:
        return None
    frag = struct.unpack("!H", ip[6:8])[0]
    if (frag & 0x1FFF) != 0:
        return None
    u = ihl
    sport, dport = struct.unpack("!HH", ip[u : u + 4])
    if sport != port and dport != port:
        return None
    ulen = struct.unpack("!H", ip[u + 4 : u + 6])[0]
    if ulen < 8:
        return None
    end = u + ulen
    payload = ip[u + 8 : end] if len(ip) >= end else ip[u + 8 :]
    return payload if payload else None


def extract_udp_payload(frame: bytes, port: int = BIRD_RADAR_UDP_PORT) -> Optional[bytes]:
    if len(frame) >= 34:
        ethertype = struct.unpack("!H", frame[12:14])[0]
        off = 14
        if ethertype == ETH_P_8021Q and len(frame) >= 18:
            ethertype = struct.unpack("!H", frame[16:18])[0]
            off = 18
        if ethertype == ETH_P_IP:
            p = _udp_payload_from_ip(frame[off:], port)
            if p is not None:
                return p
    if len(frame) >= 16 + 20:
        return _udp_payload_from_ip(frame[16:], port)
    return None


def candidate_ifaces() -> List[str]:
    preferred = (os.getenv("BIRD_RADAR_SNIFF_IFACE") or "").strip()
    if preferred:
        return [p.strip() for p in preferred.split(",") if p.strip()]

    discovered: List[str] = []
    try:
        with open("/proc/net/route", encoding="utf-8") as f:
            next(f, None)
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[1] == "00000000" and parts[0] not in discovered:
                    discovered.append(parts[0])
    except OSError:
        pass
    try:
        for name in sorted(os.listdir("/sys/class/net")):
            if name in ("lo",) or name.startswith(("veth", "br-", "docker", "virbr", "tun", "tap")):
                continue
            if name not in discovered:
                discovered.append(name)
    except OSError:
        pass

    # 141 现场探鸟 UDP 从 ens22f0 进；默认路由可能是 ens22f1，不能只信 default route
    prefer_order = ["ens22f0", "ens22f1", "eth0", "eno1"]
    ordered = [n for n in prefer_order if n in discovered]
    ordered += [n for n in discovered if n not in ordered]
    # 多开 2 个物理口，避免口选错；回调侧去重
    return ordered[:2] if ordered else ["ens22f0"]


class BirdRadarUdpSniffer:
    """AF_PACKET 旁路抓 UDP:port；不占用端口，可与 start.py 并存。"""

    def __init__(
        self,
        on_payload: Callable[[bytes], None],
        port: int = BIRD_RADAR_UDP_PORT,
        ifaces: Optional[List[str]] = None,
    ) -> None:
        self.on_payload = on_payload
        self.port = port
        self.ifaces = ifaces
        self._stop = threading.Event()
        self._threads: List[threading.Thread] = []
        self._socks: List[socket.socket] = []
        self._dedup_lock = threading.Lock()
        self._recent: Set[Tuple[int, bytes]] = set()
        self._recent_order: List[Tuple[int, bytes]] = []
        self.packets = 0
        self.payloads = 0
        self.errors = 0

    def _dedup_ok(self, payload: bytes) -> bool:
        """多网卡同时 sniff 时去掉重复帧。"""
        key = (len(payload), payload[:48])
        with self._dedup_lock:
            if key in self._recent:
                return False
            self._recent.add(key)
            self._recent_order.append(key)
            if len(self._recent_order) > 4096:
                old = self._recent_order.pop(0)
                self._recent.discard(old)
        return True

    @property
    def running(self) -> bool:
        return any(t.is_alive() for t in self._threads)

    def start(self) -> bool:
        if self._threads:
            return True
        self._stop.clear()
        ifaces = self.ifaces or candidate_ifaces()
        started: List[str] = []
        for name in ifaces:
            try:
                sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(ETH_P_ALL))
                sock.bind((name, 0))
                sock.settimeout(0.5)
            except OSError as e:
                logger.debug("探鸟旁路嗅探跳过 {}: {}", name, e)
                continue
            self._socks.append(sock)
            th = threading.Thread(
                target=self._run_one,
                args=(sock, name),
                name=f"bird-udp-sniff-{name}",
                daemon=True,
            )
            self._threads.append(th)
            th.start()
            started.append(name)

        if not started:
            logger.error("探鸟 UDP 旁路嗅探启动失败：无可用网卡 {}", ifaces)
            return False

        logger.info("探鸟 UDP 旁路嗅探启动 ifaces={} port={}", started, self.port)
        return True

    def stop(self) -> None:
        self._stop.set()
        for s in self._socks:
            try:
                s.close()
            except OSError:
                pass
        self._socks.clear()
        for th in self._threads:
            th.join(timeout=2.0)
        self._threads.clear()
        logger.info(
            "探鸟 UDP 旁路嗅探停止 packets={} payloads={} errors={}",
            self.packets,
            self.payloads,
            self.errors,
        )

    def _run_one(self, sock: socket.socket, name: str) -> None:
        while not self._stop.is_set():
            try:
                frame = sock.recv(65535)
            except socket.timeout:
                continue
            except OSError:
                break
            if not frame:
                continue
            self.packets += 1
            try:
                payload = extract_udp_payload(frame, self.port)
                if not payload:
                    continue
                if not self._dedup_ok(payload):
                    continue
                self.payloads += 1
                self.on_payload(payload)
            except Exception as e:
                self.errors += 1
                if self.errors <= 5:
                    logger.warning("探鸟旁路处理失败 [{}]: {}", name, e)
