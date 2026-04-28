#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
航迹模拟器 - 起点↔终点往返循环（SPx UDP 组播）
起点: (122.1174, 37.5585) <-> 终点: (122.0969, 37.5489)
速度: 20 m/s；每秒一步，航向实时指向当前航段终点
"""

import asyncio
import socket
import struct
import time
import math
from loguru import logger
from typing import Optional

from config import get_settings

# ===== SPx 协议常量 =====
RDR_PACKET_TYPEB_TRACK_EXT = 0x112
SPX_PACKET_TRACK_EXT_LATLONG = 0x00000004
SPX_PACKET_TRACK_EXT_MSGTIME = 0x00000008
SPX_PACKET_TRACK_EXT_FUSION = 0x00000040


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """(lat1,lon1) 指向 (lat2,lon2) 的航向角，0°北顺时针 0–360"""
    φ1, λ1 = math.radians(lat1), math.radians(lon1)
    φ2, λ2 = math.radians(lat2), math.radians(lon2)
    dλ = λ2 - λ1
    x = math.sin(dλ) * math.cos(φ2)
    y = math.cos(φ1) * math.sin(φ2) - math.sin(φ1) * math.cos(φ2) * math.cos(dλ)
    brng = math.degrees(math.atan2(x, y))
    return (brng + 360.0) % 360.0


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return 2 * R * math.asin(math.sqrt(min(1.0, a)))


class TrackSimulator:
    """航迹模拟器类"""

    def __init__(self):
        self.running = False
        self.task: Optional[asyncio.Task] = None
        tm = time.localtime()
        self.track_id_counter = 40000 + tm.tm_min * 100 + tm.tm_sec - 1
        self.current_track_id = self.track_id_counter

        self.host = "239.192.63.43"
        self.port = 6343
        self.iface = get_settings().LOCAL_INTERFACE
        self.ttl = 16

        self.start_lon = 122.1174
        self.start_lat = 37.5585
        self.end_lon = 122.0920
        self.end_lat = 37.5513
        self.speed_mps = 20.0
        self.interval = 1.0
        self.arrival_threshold_m = 25.0

        self.transit_bearing = _bearing_deg(
            self.start_lat, self.start_lon, self.end_lat, self.end_lon
        )
        self.return_bearing = _bearing_deg(
            self.end_lat, self.end_lon, self.start_lat, self.start_lon
        )

        self.current_lon = self.start_lon
        self.current_lat = self.start_lat
        self.current_course = self.transit_bearing

        self.sock: Optional[socket.socket] = None
        self.mmsi = 413000001
        # True：正飞向终点；False：正飞回起点
        self._leg_to_end = True

    def _create_socket(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(
            socket.IPPROTO_IP,
            socket.IP_MULTICAST_TTL,
            struct.pack("B", max(0, min(255, self.ttl))),
        )
        if self.iface:
            try:
                sock.setsockopt(
                    socket.IPPROTO_IP,
                    socket.IP_MULTICAST_IF,
                    socket.inet_aton(self.iface),
                )
            except Exception as e:
                logger.warning(f"[TrackSim] 设置组播接口失败: {e}")
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
        # trackClass=1 与 TrackManager 对空融合认知规则一致（1/3/5/6 有效），0 会被丢弃不推前端
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
    ):
        course_rad = math.radians(course)
        distance = speed * dt
        R = 6371000
        delta_lat = (distance * math.cos(course_rad)) / R
        delta_lat_deg = math.degrees(delta_lat)
        delta_lon = (distance * math.sin(course_rad)) / (
            R * math.cos(math.radians(lat))
        )
        delta_lon_deg = math.degrees(delta_lon)
        return lon + delta_lon_deg, lat + delta_lat_deg

    async def _run_simulation(self):
        logger.info(
            f"[TrackSim] 开始循环模拟 track_id={self.current_track_id}, "
            f"({self.start_lon},{self.start_lat}) <-> ({self.end_lon},{self.end_lat})"
        )
        try:
            self.sock = self._create_socket()
            while self.running:
                now_sec = int(time.time())
                pkt = self._build_packet(
                    self.current_track_id,
                    self.current_lon,
                    self.current_lat,
                    self.current_course,
                    self.speed_mps,
                    now_sec,
                )
                try:
                    self.sock.sendto(pkt, (self.host, self.port))
                    leg = "去程" if self._leg_to_end else "回程"
                    logger.debug(
                        f"[TrackSim] id={self.current_track_id} {leg} "
                        f"lon={self.current_lon:.6f} lat={self.current_lat:.6f} "
                        f"course={self.current_course:.1f}°"
                    )
                except Exception as e:
                    logger.error(f"[TrackSim] 发送失败: {e}")

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
                    if self._leg_to_end:
                        self.current_course = self.transit_bearing
                        logger.info("[TrackSim] 到达起点，转向去程")
                    else:
                        self.current_course = self.return_bearing
                        logger.info("[TrackSim] 到达终点，转向回程")
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
            logger.info("[TrackSim] 模拟任务被取消")
        except Exception as e:
            logger.error(f"[TrackSim] 模拟出错: {e}")
        finally:
            if self.sock:
                self.sock.close()
                self.sock = None
            self.running = False
            logger.info("[TrackSim] 模拟已停止")

    async def start(self) -> dict:
        """启动模拟；若已在运行则先停止再启动新的模拟"""
        if self.running:
            await self.stop()

        self.track_id_counter += 1
        self.current_track_id = self.track_id_counter
        self.current_lon = self.start_lon
        self.current_lat = self.start_lat
        self.current_course = self.transit_bearing
        self._leg_to_end = True

        self.running = True
        self.task = asyncio.create_task(self._run_simulation())
        logger.info(f"[TrackSim] 模拟已启动，track_id={self.current_track_id}")
        return {
            "success": True,
            "message": "模拟已启动",
            "track_id": self.current_track_id,
            "start_position": {"lon": self.start_lon, "lat": self.start_lat},
            "end_position": {"lon": self.end_lon, "lat": self.end_lat},
            "transit_bearing": self.transit_bearing,
            "return_bearing": self.return_bearing,
            "speed": self.speed_mps,
            "loop": True,
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
        return {"success": True, "message": "模拟已停止", "track_id": self.current_track_id}

    def get_status(self) -> dict:
        return {
            "running": self.running,
            "track_id": self.current_track_id,
            "current_position": {"lon": self.current_lon, "lat": self.current_lat},
            "current_course": self.current_course,
            "speed": self.speed_mps,
            "end_position": {"lon": self.end_lon, "lat": self.end_lat},
            "leg": "to_end" if self._leg_to_end else "to_start",
            "transit_bearing": self.transit_bearing,
            "return_bearing": self.return_bearing,
            "loop": True,
        }


track_simulator = TrackSimulator()
