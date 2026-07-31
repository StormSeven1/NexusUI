"""对空/探鸟雷达数据采集 UDP 下发（对齐 WatchSys_Widget auto_catch_airRadarData_dialog）。"""
from __future__ import annotations

import socket
import struct
from typing import Any, Dict, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel, Field

from config import get_settings

router = APIRouter(prefix="/air-radar-collect", tags=["air-radar-collect"])

# sendAirRadarHeader.flag = 0x55444352（小端与 Qt/x86 一致）
_FLAG = 0x55444352
_HEADER_FMT = "<8I"  # flag, infolen, cmdType, back[5]
_COLLECT_BODY_FMT = "<8I"  # collectType..trackId
_COLLECT_PAD_FMT = "<24I"
_CONTROL_BODY_FMT = "<I"  # startFlag
_CONTROL_PAD_FMT = "<7I"


def _pack_header(infolen: int, cmd_type: int) -> bytes:
    return struct.pack(_HEADER_FMT, _FLAG, infolen, cmd_type, 0, 0, 0, 0, 0)


def pack_collect_params(
    collect_type: int,
    azi_center_deg: float,
    azi_range_deg: float,
    dis_center_m: float,
    dis_range_m: float,
    target_type: int,
    track_type: int,
    track_id: int,
) -> bytes:
    """dataCollectStruct：cmdType=1。azi*100 为百分之一度整数。"""
    body = struct.pack(
        _COLLECT_BODY_FMT,
        int(collect_type) & 0xFFFFFFFF,
        int(round(float(azi_center_deg) * 100)) & 0xFFFFFFFF,
        int(round(float(azi_range_deg) * 100)) & 0xFFFFFFFF,
        int(round(float(dis_center_m))) & 0xFFFFFFFF,
        int(round(float(dis_range_m))) & 0xFFFFFFFF,
        int(target_type) & 0xFFFFFFFF,
        int(track_type) & 0xFFFFFFFF,
        int(track_id) & 0xFFFFFFFF,
    )
    pad = struct.pack(_COLLECT_PAD_FMT, *([0] * 24))
    payload = body + pad
    header = _pack_header(32 + len(payload), 1)
    return header + payload


def pack_collect_control(start_flag: int) -> bytes:
    """dataCollectControl：cmdType=2；startFlag 0=启动，1=停止。"""
    body = struct.pack(_CONTROL_BODY_FMT, int(start_flag) & 0xFFFFFFFF)
    pad = struct.pack(_CONTROL_PAD_FMT, *([0] * 7))
    payload = body + pad
    header = _pack_header(32 + len(payload), 2)
    return header + payload


def _resolve_target(host: Optional[str], port: Optional[int]) -> tuple[str, int]:
    settings = get_settings()
    h = (host or "").strip() or (settings.AIR_RADAR_COLLECT_SEND_IP or "").strip()
    p = int(port) if port is not None and int(port) > 0 else int(settings.AIR_RADAR_COLLECT_SEND_PORT or 0)
    return h, p


def send_udp(payload: bytes, host: str, port: int) -> Dict[str, Any]:
    if not host or port <= 0:
        return {
            "ok": False,
            "message": "未配置采集下发地址（AIR_RADAR_COLLECT_SEND_IP/PORT 或请求体 host/port）",
        }
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            iface = (get_settings().LOCAL_INTERFACE or "").strip()
            if iface:
                try:
                    sock.setsockopt(
                        socket.IPPROTO_IP,
                        socket.IP_MULTICAST_IF,
                        socket.inet_aton(iface),
                    )
                except OSError:
                    pass
            sock.sendto(payload, (host, port))
        finally:
            sock.close()
        logger.info("air-radar-collect UDP sent {} bytes → {}:{}", len(payload), host, port)
        return {"ok": True, "host": host, "port": port, "bytes": len(payload)}
    except OSError as e:
        logger.error("air-radar-collect UDP send failed: {}", e)
        return {"ok": False, "message": str(e)}


class CollectParamsRequest(BaseModel):
    collect_type: int = Field(..., description="0=手动，1=自动")
    azi_center: float = 0
    azi_range: float = 20
    dis_center: float = 0
    dis_range: float = 200
    target_type: int = 0
    track_type: int = 0
    track_id: int = 0
    host: Optional[str] = None
    port: Optional[int] = None
    # 下发参数后是否立即启动采集（默认 true，对齐对话框「开始」）
    start: bool = True


class CollectControlRequest(BaseModel):
    start_flag: int = Field(..., description="0=启动，1=停止")
    host: Optional[str] = None
    port: Optional[int] = None


@router.get("/config")
async def get_collect_config():
    settings = get_settings()
    return JSONResponse(
        content={
            "ok": True,
            "send_ip": settings.AIR_RADAR_COLLECT_SEND_IP,
            "send_port": settings.AIR_RADAR_COLLECT_SEND_PORT,
            "configured": bool(
                (settings.AIR_RADAR_COLLECT_SEND_IP or "").strip()
                and int(settings.AIR_RADAR_COLLECT_SEND_PORT or 0) > 0
            ),
            "radar_lat": settings.AIR_RADAR_COLLECT_RADAR_LAT,
            "radar_lon": settings.AIR_RADAR_COLLECT_RADAR_LON,
        }
    )


@router.post("/params")
async def post_collect_params(body: CollectParamsRequest):
    host, port = _resolve_target(body.host, body.port)
    pkt = pack_collect_params(
        body.collect_type,
        body.azi_center,
        body.azi_range,
        body.dis_center,
        body.dis_range,
        body.target_type,
        body.track_type,
        body.track_id,
    )
    result = send_udp(pkt, host, port)
    if not result.get("ok"):
        return JSONResponse(status_code=400, content=result)
    if body.start:
        ctrl = pack_collect_control(0)
        ctrl_result = send_udp(ctrl, host, port)
        if not ctrl_result.get("ok"):
            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "message": f"参数已下发，但启动失败: {ctrl_result.get('message')}",
                    "params": result,
                },
            )
        result["started"] = True
    return JSONResponse(content={"ok": True, **result})


@router.post("/control")
async def post_collect_control(body: CollectControlRequest):
    host, port = _resolve_target(body.host, body.port)
    pkt = pack_collect_control(body.start_flag)
    result = send_udp(pkt, host, port)
    if not result.get("ok"):
        return JSONResponse(status_code=400, content=result)
    return JSONResponse(content={"ok": True, **result})
