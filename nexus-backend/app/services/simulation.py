"""
目标模拟引擎：管理目标列表，按 heading/speed 周期更新位置，通过 WebSocket 广播给前端。
扩展支持：资产移动（无人机飞向目标）、资产状态广播、实时告警检测。
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import math
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import WebSocket

logger = logging.getLogger(__name__)

_CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config"

KMH_PER_KNOT = 1.852
EARTH_RADIUS_KM = 6371.0

DRONE_SPEED_KMH = 200.0
ARRIVAL_THRESHOLD_KM = 2.0


class SimulationEngine:
    """
    每 tick 更新各目标的 lat/lng（按 heading/speed），并支持随机航向/速度微调。
    同时管理静态地图区域（禁飞区、演习区等）。
    扩展：管理资产移动任务和实时告警。
    """

    def __init__(self) -> None:
        self._tracks: list[dict[str, Any]] = []
        self._zones: list[dict[str, Any]] = []
        self._clients: set[WebSocket] = set()
        self._alert_clients: set[WebSocket] = set()
        self._asset_clients: set[WebSocket] = set()
        self._task: asyncio.Task[None] | None = None
        self._tick_interval: float = 1.0
        self._heading_drift: float = 5.0
        self._speed_drift_pct: float = 0.02

        # 资产任务队列: asset_id -> mission info
        self._asset_missions: dict[str, dict[str, Any]] = {}
        # 巡逻任务: asset_id -> patrol info
        self._asset_patrols: dict[str, dict[str, Any]] = {}
        # 告警序号 + 去重集合
        self._alert_seq = 0
        self._alerted_track_zones: set[str] = set()  # "trackId:zoneId" 防止重复告警

    def load_config(self, path: Path | str | None = None) -> None:
        path = Path(path) if path else _CONFIG_DIR / "simulation.yaml"
        with open(path, encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        self._tick_interval = cfg.get("tick_interval_sec", 1.0)
        self._heading_drift = cfg.get("heading_drift_max_deg", 5.0)
        self._speed_drift_pct = cfg.get("speed_drift_pct", 0.02)

        self._zones = []
        for entry in cfg.get("zones", []):
            zone = dict(entry)
            coords = zone.get("coordinates", [])
            if coords:
                lngs = [c[0] for c in coords]
                lats = [c[1] for c in coords]
                zone["bbox"] = {
                    "south": min(lats), "north": max(lats),
                    "west": min(lngs), "east": max(lngs),
                }
                zone["center"] = {
                    "lat": (min(lats) + max(lats)) / 2,
                    "lng": (min(lngs) + max(lngs)) / 2,
                }
            self._zones.append(zone)
        logger.info("Loaded %d zones from %s", len(self._zones), path)

        self._tracks = []
        for entry in cfg.get("initial_tracks", []):
            track = dict(entry)
            track.setdefault("altitude", 0)
            track.setdefault("speed", 0)
            track.setdefault("heading", 0)
            track.setdefault("starred", False)
            track["lastUpdate"] = datetime.now(timezone.utc).strftime("%H:%M:%S")
            self._tracks.append(track)
        logger.info("Simulation loaded %d tracks from %s", len(self._tracks), path)

    def get_tracks(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._tracks)

    def get_zones(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._zones)

    # ──── 资产任务管理 ────

    def start_asset_mission(self, asset_id: str, target_lat: float, target_lng: float) -> None:
        """让资产（无人机）开始飞向目标坐标。"""
        self._asset_missions[asset_id] = {
            "target_lat": target_lat,
            "target_lng": target_lng,
            "arrived": False,
        }
        logger.info("Asset %s mission started -> (%.4f, %.4f)", asset_id, target_lat, target_lng)

    def start_asset_patrol(self, asset_id: str, waypoints: list[dict[str, float]]) -> None:
        """让资产开始沿航路点巡逻（循环）。"""
        self._asset_patrols[asset_id] = {
            "waypoints": waypoints,
            "current_idx": 0,
        }
        first = waypoints[0]
        self.start_asset_mission(asset_id, first["lat"], first["lng"])
        logger.info("Asset %s patrol started, %d waypoints", asset_id, len(waypoints))

    def cancel_asset_mission(self, asset_id: str) -> None:
        """取消资产任务。"""
        self._asset_missions.pop(asset_id, None)
        self._asset_patrols.pop(asset_id, None)
        logger.info("Asset %s mission cancelled", asset_id)

    # ──── Tick 逻辑 ────

    def _tick(self) -> None:
        now_str = datetime.now(timezone.utc).strftime("%H:%M:%S")
        for t in self._tracks:
            speed_kmh = t["speed"] * KMH_PER_KNOT if t["type"] == "sea" else t["speed"]
            dist_km = speed_kmh * (self._tick_interval / 3600.0)

            heading_rad = math.radians(t["heading"])
            lat_rad = math.radians(t["lat"])
            lng_rad = math.radians(t["lng"])

            delta = dist_km / EARTH_RADIUS_KM
            new_lat = math.asin(
                math.sin(lat_rad) * math.cos(delta)
                + math.cos(lat_rad) * math.sin(delta) * math.cos(heading_rad)
            )
            new_lng = lng_rad + math.atan2(
                math.sin(heading_rad) * math.sin(delta) * math.cos(lat_rad),
                math.cos(delta) - math.sin(lat_rad) * math.sin(new_lat),
            )

            t["lat"] = math.degrees(new_lat)
            t["lng"] = math.degrees(new_lng)

            t["heading"] = (t["heading"] + random.uniform(-self._heading_drift, self._heading_drift)) % 360
            drift = 1.0 + random.uniform(-self._speed_drift_pct, self._speed_drift_pct)
            t["speed"] = max(1, t["speed"] * drift)
            t["speed"] = round(t["speed"], 1)

            t["lastUpdate"] = now_str

    def _tick_assets_sync(self) -> list[dict[str, Any]]:
        """同步版本：移动有任务的资产，返回事件列表。在线程池中调用以避免阻塞 event loop。"""
        events: list[dict[str, Any]] = []
        if not self._asset_missions:
            return events

        from app.core.db_sync import get_sync_session
        from app.models.asset import Asset
        from sqlalchemy import select

        dist_per_tick = DRONE_SPEED_KMH * (self._tick_interval / 3600.0)

        with get_sync_session() as session:
            for asset_id, mission in list(self._asset_missions.items()):
                if mission["arrived"]:
                    continue

                asset = session.execute(select(Asset).where(Asset.id == asset_id)).scalar_one_or_none()
                if not asset:
                    self._asset_missions.pop(asset_id, None)
                    continue

                tlat, tlng = mission["target_lat"], mission["target_lng"]
                remaining = self._haversine(asset.lat, asset.lng, tlat, tlng)

                if remaining <= ARRIVAL_THRESHOLD_KM:
                    asset.lat = tlat
                    asset.lng = tlng
                    mission["arrived"] = True

                    patrol = self._asset_patrols.get(asset_id)
                    if patrol:
                        wps = patrol["waypoints"]
                        patrol["current_idx"] = (patrol["current_idx"] + 1) % len(wps)
                        nxt = wps[patrol["current_idx"]]
                        self._asset_missions[asset_id] = {
                            "target_lat": nxt["lat"],
                            "target_lng": nxt["lng"],
                            "arrived": False,
                        }
                        asset.mission_status = "en_route"
                        asset.target_lat = nxt["lat"]
                        asset.target_lng = nxt["lng"]
                    else:
                        asset.mission_status = "monitoring"
                        events.append({
                            "type": "asset_arrived",
                            "assetId": asset_id,
                            "assetName": asset.name,
                            "targetId": asset.assigned_target_id,
                            "lat": tlat,
                            "lng": tlng,
                        })
                else:
                    bearing = self._bearing(asset.lat, asset.lng, tlat, tlng)
                    new_lat, new_lng = self._destination(asset.lat, asset.lng, dist_per_tick, bearing)
                    asset.lat = new_lat
                    asset.lng = new_lng
                    asset.heading = bearing

            session.commit()

        return events

    async def _tick_assets(self) -> list[dict[str, Any]]:
        """异步包装：在线程池中执行 DB 操作，不阻塞 event loop。"""
        if not self._asset_missions:
            return []
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._tick_assets_sync)

    def _check_alerts(self) -> list[dict[str, Any]]:
        """检测告警条件：敌方目标进入限制区域（含去重，同一目标同一区域只告警一次）。"""
        alerts: list[dict[str, Any]] = []
        now_str = datetime.now(timezone.utc).strftime("%H:%M:%S")

        current_intrusions: set[str] = set()

        for track in self._tracks:
            if track.get("disposition") != "hostile":
                continue

            for zone in self._zones:
                bbox = zone.get("bbox")
                if not bbox:
                    continue
                if (bbox["south"] <= track["lat"] <= bbox["north"] and
                        bbox["west"] <= track["lng"] <= bbox["east"]):
                    key = f"{track['id']}:{zone.get('id', '')}"
                    current_intrusions.add(key)

                    if key not in self._alerted_track_zones:
                        self._alerted_track_zones.add(key)
                        self._alert_seq += 1
                        alerts.append({
                            "id": f"ALT-RT-{self._alert_seq:04d}",
                            "severity": "critical",
                            "message": f"敌方目标 {track.get('name', track['id'])} 进入{zone.get('name', '限制区域')}",
                            "timestamp": now_str,
                            "trackId": track["id"],
                            "lat": track["lat"],
                            "lng": track["lng"],
                            "type": "zone_intrusion",
                        })

        # 清除已离开区域的条目，允许重新进入时再次告警
        self._alerted_track_zones &= current_intrusions

        return alerts

    # ──── 广播 ────

    async def _broadcast(self) -> None:
        if not self._clients:
            return
        payload = json.dumps(
            {"type": "track_update", "tracks": self._tracks, "timestamp": datetime.now(timezone.utc).isoformat()},
            ensure_ascii=False,
        )
        dead: list[WebSocket] = []
        for ws in self._clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)

    async def _broadcast_alerts(self, alerts: list[dict[str, Any]]) -> None:
        if not self._alert_clients or not alerts:
            return
        payload = json.dumps(
            {"type": "alert_batch", "alerts": alerts, "timestamp": datetime.now(timezone.utc).isoformat()},
            ensure_ascii=False,
        )
        dead: list[WebSocket] = []
        for ws in self._alert_clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._alert_clients.discard(ws)

    async def _broadcast_asset_events(self, events: list[dict[str, Any]]) -> None:
        if not self._asset_clients or not events:
            return
        payload = json.dumps(
            {"type": "asset_events", "events": events, "timestamp": datetime.now(timezone.utc).isoformat()},
            ensure_ascii=False,
        )
        dead: list[WebSocket] = []
        for ws in self._asset_clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._asset_clients.discard(ws)

    # ──── 主循环 ────

    async def _run(self) -> None:
        tick_count = 0
        logger.info("Simulation _run loop started")
        while True:
            try:
                self._tick()
                asset_events = await self._tick_assets()
                await self._broadcast()
                await self._broadcast_asset_events(asset_events)

                # 每 5 tick 检测一次告警（避免过于频繁）
                tick_count += 1
                if tick_count % 5 == 0:
                    alerts = self._check_alerts()
                    await self._broadcast_alerts(alerts)
            except Exception:
                logger.exception("Simulation tick error (tick=%d), continuing", tick_count)

            await asyncio.sleep(self._tick_interval)

    def start(self) -> None:
        if self._task is not None and self._task.done():
            exc = self._task.exception() if not self._task.cancelled() else None
            if exc:
                logger.error("Previous _run task died with: %s", exc)
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())
            logger.info("Simulation engine started (interval=%.1fs)", self._tick_interval)

    def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            logger.info("Simulation engine stopped")

    def subscribe(self, ws: WebSocket) -> None:
        self._clients.add(ws)

    def unsubscribe(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    def subscribe_alerts(self, ws: WebSocket) -> None:
        self._alert_clients.add(ws)

    def unsubscribe_alerts(self, ws: WebSocket) -> None:
        self._alert_clients.discard(ws)

    def subscribe_assets(self, ws: WebSocket) -> None:
        self._asset_clients.add(ws)

    def unsubscribe_assets(self, ws: WebSocket) -> None:
        self._asset_clients.discard(ws)

    # ──── 几何辅助 ────

    @staticmethod
    def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        dlat = math.radians(lat2 - lat1)
        dlng = math.radians(lng2 - lng1)
        a = (math.sin(dlat / 2) ** 2
             + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
        return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    @staticmethod
    def _bearing(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
        dlng_r = math.radians(lng2 - lng1)
        x = math.sin(dlng_r) * math.cos(lat2_r)
        y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlng_r)
        return math.degrees(math.atan2(x, y)) % 360

    @staticmethod
    def _destination(lat: float, lng: float, dist_km: float, bearing_deg: float) -> tuple[float, float]:
        brng = math.radians(bearing_deg)
        lat1 = math.radians(lat)
        lng1 = math.radians(lng)
        ang = dist_km / EARTH_RADIUS_KM
        lat2 = math.asin(math.sin(lat1) * math.cos(ang) + math.cos(lat1) * math.sin(ang) * math.cos(brng))
        lng2 = lng1 + math.atan2(
            math.sin(brng) * math.sin(ang) * math.cos(lat1),
            math.cos(ang) - math.sin(lat1) * math.sin(lat2),
        )
        return (math.degrees(lat2), (math.degrees(lng2) + 540) % 360 - 180)


sim_engine = SimulationEngine()
