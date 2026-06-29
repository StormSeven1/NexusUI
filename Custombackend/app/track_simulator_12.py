#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
航迹模拟器。

直接通过 UDP 向 TrackManager 的“对空融合”接收口发送 FusionTrack 二进制报文。
默认目标取自 default_process_config.json 中的 dui_kong_rong_he：
239.192.63.43:6343
"""

import asyncio
import math
import socket
import struct
import time
from typing import Optional

from loguru import logger


TRACK_MANAGER_HOST = "239.192.70.77"
TRACK_MANAGER_PORT = 7077
TRACK_SIMULATOR_TARGETS = {
    "sea": ("239.192.70.77", 7077),
    "air": ("239.192.70.57", 7057),
}
LOCAL_INTERFACE = "192.168.28.9"

# Static simulator behavior:
# Set to None to keep one ID for the whole run.
# Set to seconds (for example 20.0) to keep the current movement trend and
# switch to track_id + 1 after that many seconds from simulator start.
TRACK_ID_INCREMENT_AFTER_SECONDS: Optional[float] = None

RDR_PACKET_TYPEB_TRACK_EXT = 0x112
SPX_PACKET_TRACK_EXT_LATLONG = 0x00000004
SPX_PACKET_TRACK_EXT_MSGTIME = 0x00000008
SPX_PACKET_TRACK_EXT_FUSION = 0x00000040


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1_rad, lon1_rad = math.radians(lat1), math.radians(lon1)
    lat2_rad, lon2_rad = math.radians(lat2), math.radians(lon2)
    delta_lon = lon2_rad - lon1_rad
    x = math.sin(delta_lon) * math.cos(lat2_rad)
    y = (
        math.cos(lat1_rad) * math.sin(lat2_rad)
        - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(delta_lon)
    )
    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360.0) % 360.0


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(min(1.0, a)))


class TrackSimulator:
    def __init__(self):
        self.running = False
        self.task: Optional[asyncio.Task] = None

        now = time.localtime()
        self.track_id_counter = 40000 + now.tm_min * 100 + now.tm_sec - 1
        self.current_track_id = self.track_id_counter

        self.host = TRACK_MANAGER_HOST
        self.port = TRACK_MANAGER_PORT
        self.ttl = 16
        self.interface = LOCAL_INTERFACE

        self.start_lon =122.149468
        self.start_lat = 37.498303
        self.end_lon = 122.128225
        self.end_lat = 37.512738
        self.speed_mps = 10.0
        self.interval = 1.0
        self.arrival_threshold_m = 25.0
        self.id_increment_after_seconds: Optional[float] = None

        self.transit_bearing = _bearing_deg(
            self.start_lat, self.start_lon, self.end_lat, self.end_lon
        )
        self.return_bearing = _bearing_deg(
            self.end_lat, self.end_lon, self.start_lat, self.start_lon
        )

        self.current_lon = self.start_lon
        self.current_lat = self.start_lat
        self.current_course = self.transit_bearing
        self._leg_to_end = True
        self._id_increment_deadline_monotonic: Optional[float] = None
        self._id_increment_applied = False

        self.sock: Optional[socket.socket] = None
        self.mmsi = 413000001

    def configure_target(self, kind: str) -> str:
        normalized = str(kind or "").strip().lower()
        if normalized in {"surface", "ship", "sea_target"}:
            normalized = "sea"
        elif normalized in {"sky", "flight", "air_target"}:
            normalized = "air"
        if normalized not in TRACK_SIMULATOR_TARGETS:
            raise ValueError(f"unsupported simulator target kind: {kind}")

        self.host, self.port = TRACK_SIMULATOR_TARGETS[normalized]
        return normalized

    def _current_target_kind(self) -> str:
        for kind, target in TRACK_SIMULATOR_TARGETS.items():
            if (self.host, self.port) == target:
                return kind
        return "custom"

    def _is_multicast_host(self) -> bool:
        try:
            first_octet = int(str(self.host).split(".", 1)[0])
        except Exception:
            return False
        return 224 <= first_octet <= 239

    def _create_socket(self) -> socket.socket:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        if self._is_multicast_host():
            sock.setsockopt(
                socket.IPPROTO_IP,
                socket.IP_MULTICAST_TTL,
                struct.pack("B", max(0, min(255, self.ttl))),
            )
            sock.setsockopt(
                socket.IPPROTO_IP,
                socket.IP_MULTICAST_IF,
                socket.inet_aton(self.interface),
            )
            sock.setsockopt(
                socket.IPPROTO_IP,
                socket.IP_MULTICAST_LOOP,
                1,
            )
        return sock

    def _build_packet(
        self,
        track_id: int,
        lon: float,
        lat: float,
        course: float,
        speed: float,
        now_sec: int,
    ) -> bytes:
        minimal = struct.pack(
            ">IBBBBffffffIIBBHIII",
            track_id,
            1,
            0,
            1,
            0,
            1000.0,
            course,
            speed,
            course,
            20.0,
            2.0,
            1,
            3,
            0,
            0,
            0,
            0,
            0,
            0,
        )
        normal_tail = struct.pack(
            ">ffffffffffHHIQ",
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1,
            3,
            0,
            0,
        )
        normal = minimal + normal_tail
        ext_mask = (
            SPX_PACKET_TRACK_EXT_LATLONG
            | SPX_PACKET_TRACK_EXT_MSGTIME
            | SPX_PACKET_TRACK_EXT_FUSION
        )
        sensors = 1 << 1
        track_ids = [self.mmsi] + [0] * 7
        fusion = struct.pack(
            ">II8IfIff8h8h10I",
            0,
            sensors,
            *track_ids,
            0.0,
            0,
            0.0,
            0.0,
            *([0] * 8),
            *([0] * 8),
            *([0] * 10),
        )
        body = (
            normal
            + struct.pack(">II", 0, ext_mask)
            + struct.pack(">ff", lat, lon)
            + struct.pack(">II", now_sec, 0)
            + fusion
        )
        total_size = 16 + len(body)
        header = struct.pack(
            ">HHIII",
            0xA55A,
            RDR_PACKET_TYPEB_TRACK_EXT,
            total_size,
            now_sec,
            0,
        )
        return header + body

    def _calculate_next_position(
        self, lon: float, lat: float, course: float, speed: float, dt: float
    ) -> tuple[float, float]:
        course_rad = math.radians(course)
        distance = speed * dt
        radius = 6371000.0
        delta_lat = (distance * math.cos(course_rad)) / radius
        delta_lon = (distance * math.sin(course_rad)) / (
            radius * math.cos(math.radians(lat))
        )
        return lon + math.degrees(delta_lon), lat + math.degrees(delta_lat)

    def _configure_id_increment(self, after_seconds: Optional[float]):
        if after_seconds is None:
            self.id_increment_after_seconds = None
            self._id_increment_deadline_monotonic = None
            self._id_increment_applied = False
            return

        after_seconds = max(0.0, float(after_seconds))
        self.id_increment_after_seconds = after_seconds
        self._id_increment_deadline_monotonic = time.monotonic() + after_seconds
        self._id_increment_applied = False

    def _maybe_increment_track_id(self):
        if (
            self._id_increment_applied
            or self._id_increment_deadline_monotonic is None
            or time.monotonic() < self._id_increment_deadline_monotonic
        ):
            return

        old_track_id = self.current_track_id
        self.track_id_counter = max(self.track_id_counter, self.current_track_id) + 1
        self.current_track_id = self.track_id_counter
        self._id_increment_applied = True
        logger.info(
            "[TrackSim] track_id auto incremented {} -> {}; position and trend kept",
            old_track_id,
            self.current_track_id,
        )

    def _get_id_increment_remaining_seconds(self) -> Optional[float]:
        if self._id_increment_deadline_monotonic is None or self._id_increment_applied:
            return None
        return max(0.0, self._id_increment_deadline_monotonic - time.monotonic())

    async def _run_simulation(self):
        logger.info(
            "[TrackSim] 开始循环模拟 track_id={} target={}:{} iface={} ({},{}) <-> ({},{})",
            self.current_track_id,
            self.host,
            self.port,
            self.interface,
            self.start_lon,
            self.start_lat,
            self.end_lon,
            self.end_lat,
        )
        try:
            self.sock = self._create_socket()
            while self.running:
                self._maybe_increment_track_id()
                now_sec = int(time.time())
                packet = self._build_packet(
                    self.current_track_id,
                    self.current_lon,
                    self.current_lat,
                    self.current_course,
                    self.speed_mps,
                    now_sec,
                )

                try:
                    self.sock.sendto(packet, (self.host, self.port))
                    logger.debug(
                        "[TrackSim] sent id={} lon={:.6f} lat={:.6f} course={:.1f} "
                        "target={}:{}",
                        self.current_track_id,
                        self.current_lon,
                        self.current_lat,
                        self.current_course,
                        self.host,
                        self.port,
                    )
                except Exception as exc:
                    logger.error("[TrackSim] 发送失败: {}", exc)

                dest_lat = self.end_lat if self._leg_to_end else self.start_lat
                dest_lon = self.end_lon if self._leg_to_end else self.start_lon
                dist = _haversine_m(
                    self.current_lat,
                    self.current_lon,
                    dest_lat,
                    dest_lon,
                )

                if dist <= self.arrival_threshold_m:
                    self.current_lon = dest_lon
                    self.current_lat = dest_lat
                    self._leg_to_end = not self._leg_to_end
                    self.current_course = (
                        self.transit_bearing if self._leg_to_end else self.return_bearing
                    )
                else:
                    self.current_course = _bearing_deg(
                        self.current_lat,
                        self.current_lon,
                        dest_lat,
                        dest_lon,
                    )
                    self.current_lon, self.current_lat = self._calculate_next_position(
                        self.current_lon,
                        self.current_lat,
                        self.current_course,
                        self.speed_mps,
                        self.interval,
                    )

                await asyncio.sleep(self.interval)
        except asyncio.CancelledError:
            logger.info("[TrackSim] 模拟任务已取消")
        except Exception as exc:
            logger.error("[TrackSim] 模拟出错: {}", exc)
        finally:
            if self.sock:
                self.sock.close()
                self.sock = None
            self.running = False
            logger.info("[TrackSim] 模拟已停止")

    async def start(self, kind: str = "sea") -> dict:
        if self.running:
            await self.stop()

        target_kind = self.configure_target(kind)
        self.track_id_counter += 1
        self.current_track_id = self.track_id_counter
        self.current_lon = self.start_lon
        self.current_lat = self.start_lat
        self.current_course = self.transit_bearing
        self._leg_to_end = True
        self._configure_id_increment(TRACK_ID_INCREMENT_AFTER_SECONDS)

        self.running = True
        self.task = asyncio.create_task(self._run_simulation())
        logger.info("[TrackSim] 模拟已启动，track_id={}", self.current_track_id)
        return {
            "success": True,
            "message": "模拟已启动",
            "track_id": self.current_track_id,
            "target_kind": target_kind,
            "target_host": self.host,
            "target_port": self.port,
            "start_position": {"lon": self.start_lon, "lat": self.start_lat},
            "end_position": {"lon": self.end_lon, "lat": self.end_lat},
            "speed": self.speed_mps,
            "id_increment_after_seconds": self.id_increment_after_seconds,
        }

    async def stop(self) -> dict:
        if not self.running:
            return {"success": False, "message": "模拟未在运行"}

        self.running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

        logger.info("[TrackSim] 模拟已停止")
        return {
            "success": True,
            "message": "模拟已停止",
            "track_id": self.current_track_id,
        }

    def get_status(self) -> dict:
        return {
            "running": self.running,
            "track_id": self.current_track_id,
            "target_kind": self._current_target_kind(),
            "target_host": self.host,
            "target_port": self.port,
            "current_position": {"lon": self.current_lon, "lat": self.current_lat},
            "current_course": self.current_course,
            "speed": self.speed_mps,
            "leg": "to_end" if self._leg_to_end else "to_start",
            "id_increment_after_seconds": self.id_increment_after_seconds,
            "id_increment_applied": self._id_increment_applied,
            "id_increment_remaining_seconds": self._get_id_increment_remaining_seconds(),
        }


track_simulator = TrackSimulator()


async def _run_standalone():
    await track_simulator.start()
    try:
        while True:
            await asyncio.sleep(1.0)
    except KeyboardInterrupt:
        logger.info("[TrackSim] 收到 Ctrl+C，准备停止")
    finally:
        if track_simulator.running:
            await track_simulator.stop()


if __name__ == "__main__":
    asyncio.run(_run_standalone())
