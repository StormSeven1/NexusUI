"""
WebSocket manager: handles connections and message broadcasting.
"""

import asyncio
import json
from collections import deque
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger


class WebSocketManager:
    """Manage websocket connections and broadcasts."""

    def __init__(self, heartbeat_interval: int = 10, broadcast_interval: int = 500):
        self.connections: Dict[str, WebSocket] = {}
        self.heartbeat_interval = heartbeat_interval
        self.broadcast_interval = broadcast_interval

        self._connections_lock = asyncio.Lock()

        self.broadcast_queue: deque = deque()
        self.heartbeat_task: Optional[asyncio.Task] = None
        self.broadcast_task: Optional[asyncio.Task] = None

        # Registered areas/routes are now the only formal area snapshot pushed to clients.
        self.db_area_rows: Optional[List[Dict]] = None
        self.schemes_data: Optional[List[Dict]] = None

    def set_db_area_rows(self, rows: List[Dict]):
        """Store registered area/route rows for DbAreas broadcast."""
        self.db_area_rows = rows

    def set_schemes_data(self, data: List[Dict]):
        """Store enabled alarm scheme data."""
        self.schemes_data = data

    async def connect(self, websocket: WebSocket) -> str:
        """Accept and register a websocket connection."""
        await websocket.accept()
        client_id = str(id(websocket))

        async with self._connections_lock:
            self.connections[client_id] = websocket

        logger.info(f"WebSocket client connected: {client_id}, active={len(self.connections)}")

        if self.db_area_rows is not None:
            db_areas_message = {
                "type": "DbAreas",
                "timestamp": datetime.now().isoformat(),
                "data": self.db_area_rows,
            }
            success_db_areas = await self._send_to_client(client_id, db_areas_message)
            if success_db_areas:
                logger.info(f"Sent DbAreas snapshot to client {client_id}: {len(self.db_area_rows)} rows")
            else:
                logger.error(f"Failed to send DbAreas snapshot to client {client_id}")
        else:
            logger.warning(f"No DbAreas snapshot available for client {client_id}")

        if self.schemes_data:
            schemes_message = {
                "type": "Schemes",
                "timestamp": datetime.now().isoformat(),
                "data": self.schemes_data,
            }
            success_schemes = await self._send_to_client(client_id, schemes_message)
            if success_schemes:
                logger.info(f"Sent Schemes snapshot to client {client_id}: {len(self.schemes_data)} items")
            else:
                logger.error(f"Failed to send Schemes snapshot to client {client_id}")
        else:
            logger.warning(f"No Schemes snapshot available for client {client_id}")

        return client_id

    def disconnect(self, client_id: str):
        """Remove a websocket connection."""

        async def _disconnect():
            async with self._connections_lock:
                if client_id in self.connections:
                    del self.connections[client_id]
                    logger.info(f"WebSocket client disconnected: {client_id}, active={len(self.connections)}")

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(_disconnect())
            else:
                loop.run_until_complete(_disconnect())
        except Exception:
            asyncio.run(_disconnect())

    async def _send_to_client(self, client_id: str, message: Dict[str, Any]) -> bool:
        """Send a message to one client."""
        async with self._connections_lock:
            if client_id not in self.connections:
                return False
            websocket = self.connections[client_id]

        try:
            await websocket.send_json(message)
            return True
        except Exception as exc:
            logger.debug(f"Failed to send message to client [{client_id}]: {exc}")
            return False

    async def broadcast(self, message: Dict[str, Any]):
        """Broadcast a message to all clients."""
        disconnected: List[str] = []
        async with self._connections_lock:
            connections_snapshot = list(self.connections.items())

        for client_id, websocket in connections_snapshot:
            try:
                await websocket.send_json(message)
            except Exception as exc:
                logger.error(f"Broadcast failed for [{client_id}]: {exc}")
                disconnected.append(client_id)

        if disconnected:
            logger.info(f"Disconnected clients found during broadcast: {disconnected}")

        for client_id in disconnected:
            logger.info(f"Calling disconnect for client: {client_id}")
            self.disconnect(client_id)

    async def broadcast_command(self, command: Dict[str, Any]):
        """Broadcast a map command to all clients."""
        if not self.connections:
            logger.warning("[MCP] No active WebSocket connections")
            return

        message = {
            "type": "map_command",
            "timestamp": datetime.now().isoformat(),
            "data": command,
        }
        await self.broadcast(message)
        logger.info(f"[MCP] Broadcast map command: {command.get('command', 'unknown')}")

    async def broadcast_db_area_rows(self):
        """Broadcast the current registered area/route snapshot to all clients."""
        message = {
            "type": "DbAreas",
            "timestamp": datetime.now().isoformat(),
            "data": self.db_area_rows or [],
        }
        await self.broadcast(message)

    def queue_track_data(self, track_data: Dict[str, Any]):
        """Queue one track message for batched broadcast."""
        if "is_air_track" not in track_data:
            track_data["is_air_track"] = self._determine_air_track(track_data)

        message = {
            "type": "Track",
            "timestamp": datetime.now().isoformat(),
            "data": track_data,
        }
        self.broadcast_queue.append(message)

    def _determine_air_track(self, track_data: Dict[str, Any]) -> bool:
        """Return True for air tracks, otherwise sea track."""
        source_name = track_data.get("source_name", "")
        air_keywords = ["对空", "无人机", "自报位", "机场"]
        return any(keyword in source_name for keyword in air_keywords)

    def queue_message(self, message: Dict[str, Any]):
        """Queue a generic message for broadcast."""
        self.broadcast_queue.append(message)

    async def _heartbeat_loop(self):
        """Heartbeat loop."""
        while True:
            try:
                await asyncio.sleep(self.heartbeat_interval)

                async with self._connections_lock:
                    if not self.connections:
                        continue
                    connection_count = len(self.connections)

                heartbeat_msg = {
                    "type": "heartbeat",
                    "timestamp": datetime.now().isoformat(),
                    "data": {"message": "ping", "connections": connection_count},
                }
                await self.broadcast(heartbeat_msg)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"Heartbeat task failed: {exc}")

    async def _broadcast_loop(self):
        """Broadcast loop for batched queued messages."""
        while True:
            try:
                await asyncio.sleep(self.broadcast_interval / 1000)

                async with self._connections_lock:
                    if not self.connections:
                        self.broadcast_queue.clear()
                        continue

                if not self.broadcast_queue:
                    continue

                messages: List[Dict[str, Any]] = []
                while self.broadcast_queue:
                    messages.append(self.broadcast_queue.popleft())

                track_messages: List[Dict[str, Any]] = []
                other_messages: List[Dict[str, Any]] = []
                for msg in messages:
                    if msg.get("type") == "Track":
                        track_messages.append(msg)
                    else:
                        other_messages.append(msg)

                if track_messages:
                    batch_msg = {
                        "type": "trackBatch",
                        "timestamp": datetime.now().isoformat(),
                        "data": track_messages,
                    }
                    await self.broadcast(batch_msg)

                for msg in other_messages:
                    await self.broadcast(msg)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"Broadcast task failed: {exc}")

    def start_tasks(self):
        """Start heartbeat and broadcast tasks."""
        if not self.heartbeat_task or self.heartbeat_task.done():
            self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            logger.info(f"Heartbeat task started, interval={self.heartbeat_interval}s")

        if not self.broadcast_task or self.broadcast_task.done():
            self.broadcast_task = asyncio.create_task(self._broadcast_loop())
            logger.info(f"Broadcast task started, interval={self.broadcast_interval}ms")

    def stop_tasks(self):
        """Stop heartbeat and broadcast tasks."""
        if self.heartbeat_task:
            self.heartbeat_task.cancel()
            self.heartbeat_task = None

        if self.broadcast_task:
            self.broadcast_task.cancel()
            self.broadcast_task = None

        logger.info("WebSocket tasks stopped")

    async def handle_connection(self, websocket: WebSocket):
        """Handle a websocket lifecycle."""
        logger.info("handle_connection started")
        client_id = await self.connect(websocket)
        logger.info(f"connect returned client_id={client_id}, entering receive loop")

        try:
            while True:
                try:
                    data = await websocket.receive_text()
                    message = json.loads(data)
                    msg_type = message.get("type", "")

                    if msg_type == "ping":
                        await self._send_to_client(
                            client_id,
                            {
                                "type": "pong",
                                "timestamp": datetime.now().isoformat(),
                                "data": {"message": "pong"},
                            },
                        )
                    elif msg_type == "pong":
                        pass
                    else:
                        logger.debug(f"Unknown incoming message type: {msg_type}")
                except json.JSONDecodeError:
                    logger.warning(f"Unable to parse websocket message: {data}")
        except WebSocketDisconnect:
            logger.info(f"Client disconnected normally: {client_id}")
        except Exception as exc:
            logger.error(f"WebSocket connection error [{client_id}]: {exc}")
            logger.error(f"Exception type: {type(exc).__name__}")
            import traceback

            logger.error(f"Traceback: {traceback.format_exc()}")
        finally:
            logger.info(f"Connection cleanup for client {client_id}")
            self.disconnect(client_id)


ws_manager = WebSocketManager()
