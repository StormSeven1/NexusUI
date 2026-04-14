"""
目标模拟引擎：管理目标列表，按 heading/speed 周期更新位置，通过 WebSocket 广播给前端。
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


class SimulationEngine:
    """
    每 tick 更新各目标的 lat/lng（按 heading/speed），并支持随机航向/速度微调。
    同时管理静态地图区域（禁飞区、演习区等）。
    """

    def __init__(self) -> None:
        self._tracks: list[dict[str, Any]] = []
        self._zones: list[dict[str, Any]] = []
        self._clients: set[WebSocket] = set()
        self._task: asyncio.Task[None] | None = None
        self._tick_interval: float = 1.0
        self._heading_drift: float = 5.0
        self._speed_drift_pct: float = 0.02

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

    async def _run(self) -> None:
        while True:
            self._tick()
            await self._broadcast()
            await asyncio.sleep(self._tick_interval)

    def start(self) -> None:
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


sim_engine = SimulationEngine()
