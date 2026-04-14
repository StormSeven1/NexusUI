"""
WebSocket 端点：推送实时目标数据、告警、资产事件给前端。
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


@router.websocket("/ws/alerts")
async def alert_feed(websocket: WebSocket):
    await websocket.accept()
    sim_engine.subscribe_alerts(websocket)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        sim_engine.unsubscribe_alerts(websocket)


@router.websocket("/ws/assets")
async def asset_feed(websocket: WebSocket):
    await websocket.accept()
    sim_engine.subscribe_assets(websocket)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        sim_engine.unsubscribe_assets(websocket)
