"""
WebSocket 端点：推送实时目标数据给前端。
"""

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.simulation import sim_engine

router = APIRouter(tags=["simulation"])


@router.websocket("/ws/tracks")
async def track_feed(websocket: WebSocket):
    await websocket.accept()
    sim_engine.subscribe(websocket)

    initial = json.dumps(
        {"type": "track_snapshot", "tracks": sim_engine.get_tracks()},
        ensure_ascii=False,
    )
    await websocket.send_text(initial)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        sim_engine.unsubscribe(websocket)
