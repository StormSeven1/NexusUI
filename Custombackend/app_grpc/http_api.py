"""HTTP API service."""
from pathlib import Path
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from datetime import datetime
from typing import Optional
import aiohttp
from loguru import logger
from pydantic import BaseModel, Field
from websocket_manager import ws_manager
from track_simulator import track_simulator
from config import get_settings
from entity_area_service import map_entity_id, publish_area_entity, delete_area_entity
from grpc_services.destroy.service import destroy_grpc_service
import base64


router = APIRouter()
settings = get_settings()
latest_entity_records = {}

TEMP_FILTER_TARGET_URL = "http://192.168.18.103:8888/api/v1/publishTask/examples/filterTargetOrForce"
TEMP_FILTER_TARGET_API_KEY = "toksim_default_key"


# API handler
db_manager = None


def set_db_manager(manager):
    """API handler."""
    global db_manager
    db_manager = manager


async def refresh_db_area_cache_and_broadcast():
    """API handler."""
    if not db_manager:
        return
    rows = await db_manager.get_area_table_rows()
    ws_manager.set_db_area_rows(rows or [])
    await ws_manager.broadcast_db_area_rows()


def set_latest_entity_records(records):
    """Cache the latest entity records fetched by polling."""
    global latest_entity_records
    next_records = {}
    if isinstance(records, list):
      for item in records:
        if not isinstance(item, dict):
          continue
        entity_id = str(item.get("entityId", "")).strip()
        if entity_id:
          next_records[entity_id] = item
    latest_entity_records = next_records


def _safe_capture_segment(value: str, fallback: str) -> str:
    cleaned = value.strip().replace("\\", "_").replace("/", "_").replace(":", "_")
    cleaned = cleaned.replace("*", "_").replace("?", "_").replace('"', "_")
    cleaned = cleaned.replace("<", "_").replace(">", "_").replace("|", "_")
    cleaned = "_".join(cleaned.split())
    cleaned = cleaned[:80]
    return cleaned or fallback


def _safe_capture_file_name(value: str, fallback_ext: str) -> str:
    cleaned = value.strip().replace("\\", "_").replace("/", "_").replace(":", "_")
    cleaned = cleaned.replace("*", "_").replace("?", "_").replace('"', "_")
    cleaned = cleaned.replace("<", "_").replace(">", "_").replace("|", "_")
    cleaned = cleaned[:180]
    if not cleaned:
        return f"capture_{int(datetime.now().timestamp() * 1000)}.{fallback_ext}"
    return cleaned


@router.post('/eo-video/capture/save')
async def save_eo_video_capture(request: Request):
    """Save EO video snapshot or recording file."""
    kind = str(request.query_params.get("kind", "")).strip().lower()
    stream_label = str(request.query_params.get("streamLabel", "")).strip()
    file_name_raw = str(request.query_params.get("fileName", "")).strip()

    if kind not in {"snapshot", "record"}:
        return JSONResponse(status_code=400, content={"ok": False, "error": "invalid_kind"})
    if not stream_label:
        return JSONResponse(status_code=400, content={"ok": False, "error": "missing_stream_label"})

    root_raw = settings.EO_VIDEO_CAPTURE_PIC_DIR if kind == "snapshot" else settings.EO_VIDEO_CAPTURE_VIDEO_DIR
    if not root_raw.strip():
        return JSONResponse(status_code=500, content={"ok": False, "error": "missing_capture_directory_config"})

    stream_dir = _safe_capture_segment(stream_label, "eo-video")
    fallback_ext = "png" if kind == "snapshot" else "webm"
    file_name = _safe_capture_file_name(file_name_raw, fallback_ext)
    body = await request.body()
    if not body:
        return JSONResponse(status_code=400, content={"ok": False, "error": "empty_body"})

    try:
        target_dir = Path(root_raw) / stream_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        final_path = target_dir / file_name
        final_path.write_bytes(body)
        return JSONResponse(status_code=200, content={"ok": True, "path": str(final_path)})
    except Exception as exc:
        logger.error(f"保存光电视频文件失败: {exc}")
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": "save_capture_failed", "detail": str(exc)},
        )


@router.get('/entity-status/{entity_id}')
async def get_entity_status_detail(entity_id: str):
    """API handler."""
    entity_key = entity_id.strip()
    if not entity_key:
        return JSONResponse(status_code=400, content={"ok": False, "error": "missing_entity_id"})

    entity = latest_entity_records.get(entity_key)
    if entity is None:
        return JSONResponse(
            status_code=404,
            content={"ok": False, "error": "entity_not_found", "entityId": entity_key},
        )

    return JSONResponse(status_code=200, content=entity)


@router.get('/test')
async def test():
    """API handler."""
    return JSONResponse(
        status_code=200,
        content={
            "code": 200,
            "message": "服务运行正常",
            "timestamp": datetime.now().isoformat()
        }
    )


@router.get('/alarm/dzwl/on')
@router.post('/alarm/dzwl/on')
async def dzwl_alarm_on():
    """Open the DZWL popup on all connected frontend clients."""
    await ws_manager.broadcast({"type": "dzwl_alarm", "state": "on"})
    logger.info("[API] DZWL alarm popup opened")
    return JSONResponse(status_code=200, content={"ok": True, "state": "on"})


@router.get('/alarm/dzwl/off')
@router.post('/alarm/dzwl/off')
async def dzwl_alarm_off():
    """Close the DZWL popup on all connected frontend clients."""
    await ws_manager.broadcast({"type": "dzwl_alarm", "state": "off"})
    logger.info("[API] DZWL alarm popup closed")
    return JSONResponse(status_code=200, content={"ok": True, "state": "off"})


@router.get('/health')
async def health_check():
    """API handler."""
    return JSONResponse(
        status_code=200,
        content={
            "code": 200,
            "status": "healthy",
            "timestamp": datetime.now().isoformat()
        }
    )


@router.get('/image/{targetID}')
async def get_image_by_target_id(targetID: str):
    """API handler."""
    try:
        if not db_manager:
            raise HTTPException(
                status_code=503,
                detail="数据库服务不可用"
            )
        
        payload = await db_manager.fetch_hanging_image_for_api(targetID)
        if not payload.get("ok"):
            reason = payload.get("reason")
            if reason == "not_found":
                return JSONResponse(
                    status_code=404,
                    content={
                        "code": 404,
                        "message": f"image not found for targetID {targetID}",
                        "timestamp": datetime.now().isoformat(),
                    },
                )
            if reason == "no_url":
                logger.warning(f"图片信息中没有 imageUrl: {targetID}")
                return JSONResponse(
                    status_code=404,
                    content={
                        "code": 404,
                        "message": "image URL not found",
                        "timestamp": datetime.now().isoformat(),
                    },
                )
            if reason == "bad_http":
                logger.error(f"从 MinIO 读取图片失败: HTTP {payload.get('http_status')}")
                return JSONResponse(
                    status_code=404,
                    content={
                        "code": 404,
                        "message": "无法从 MinIO 读取图片",
                        "timestamp": datetime.now().isoformat(),
                    },
                )
            if reason == "network":
                return JSONResponse(
                    status_code=500,
                    content={
                        "code": 500,
                        "message": f"读取图片失败: {payload.get('message', '')}",
                        "timestamp": datetime.now().isoformat(),
                    },
                )
            return JSONResponse(
                status_code=500,
                content={
                    "code": 500,
                    "message": "internal server error",
                    "timestamp": datetime.now().isoformat(),
                },
            )

        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "message": "查询成功",
                "data": {
                    "imageBase64": payload["imageBase64"],
                    "contentType": payload["contentType"],
                    "fileName": payload.get("fileName"),
                    "fileSize": payload.get("fileSize"),
                    "targetID": payload.get("targetID"),
                    "external_target_id": payload.get("external_target_id"),
                },
                "timestamp": datetime.now().isoformat(),
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"查询图片失败: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": "internal server error",
                "timestamp": datetime.now().isoformat()
            }
        )


@router.get('/image/external/{external_target_id}')
async def get_image_by_external_target_id(external_target_id: str):
    """API handler."""
    try:
        if not db_manager:
            raise HTTPException(
                status_code=503,
                detail="数据库服务不可用"
            )
        
        # API handler
        image_info = await db_manager.get_hanging_image("", external_target_id)
        
        if not image_info:
            return JSONResponse(
                status_code=404,
                content={
                    "code": 404,
                    "message": f"image not found for external_target_id {external_target_id}",
                    "timestamp": datetime.now().isoformat()
                }
            )
        
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "message": "查询成功",
                "data": image_info,
                "timestamp": datetime.now().isoformat()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"查询图片失败: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": "internal server error",
                "timestamp": datetime.now().isoformat()
            }
        )


@router.get('/areas')
async def get_areas():
    """API handler."""
    if not db_manager:
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": "数据库未连接",
                "data": None
            }
        )
    
    try:
        areas = await db_manager.get_area_table()
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "message": "获取区域数据成功",
                "data": areas or []
            }
        )
    except Exception as e:
        logger.error(f"获取区域数据失败: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"获取区域数据失败: {str(e)}",
                "data": None
            }
        )


class CreateAreaRequest(BaseModel):
    group_id: Optional[int] = None
    new_group_name: Optional[str] = None
    area_name: str
    area_type: int
    start_point: Optional[str] = None
    end_point: Optional[str] = None
    area_rect: Optional[str] = None
    area_points: Optional[str] = None
    line_color: Optional[str] = None
    line_width: Optional[int] = None


class DestroyVersionRequest(BaseModel):
    """API handler."""

    definitionVersion: int
    statusVersion: int


class DestroySpecificationRequest(BaseModel):
    """API handler."""

    at_type: str = Field(alias="@type")
    type: int
    id: str

    model_config = {"populate_by_name": True}


class DestroyCreatedBySystemRequest(BaseModel):
    """API handler."""

    serviceName: str
    entityId: str
    managesOwnScheduling: bool
    priority: int


class DestroyCreatedByRequest(BaseModel):
    """API handler."""

    system: DestroyCreatedBySystemRequest


class DestroyOwnerRequest(BaseModel):
    """API handler."""

    entityId: str


class DestroyPublishRequest(BaseModel):
    """前端发送的毁伤任务 HTTP 请求体。

    这里直接按前端现有 body 结构接收，不再拆字段，也不再转 JSON blob 到 gRPC。
    """

    taskId: str
    parentTaskId: str
    version: DestroyVersionRequest
    displayName: str
    taskType: str
    maxExecutionTimeMs: int
    specification: DestroySpecificationRequest
    createdBy: DestroyCreatedByRequest
    owner: DestroyOwnerRequest


@router.post('/destroy/publish')
async def publish_destroy_event(http_request: Request, request: DestroyPublishRequest):
    """Publish destroy event."""
    raw_body = await http_request.json()

    connected_clients = await destroy_grpc_service.publish_destroy_http_body(raw_body)

    temp_http_ok = True
    temp_http_status = 200
    temp_http_error = None
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                TEMP_FILTER_TARGET_URL,
                json=raw_body,
                headers={"x-api-key": TEMP_FILTER_TARGET_API_KEY},
            ) as response:
                temp_http_status = response.status
                if response.status >= 400:
                    temp_http_ok = False
                    temp_http_error = await response.text()
                    logger.error(
                        f"临时转发 filterTargetOrForce 失败: status={response.status}, body={temp_http_error}"
                    )
    except Exception as exc:
        temp_http_ok = False
        temp_http_status = 500
        temp_http_error = str(exc)
        logger.error(f"临时转发 filterTargetOrForce 异常: {exc}")

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "taskId": request.taskId,
            "connectedClients": connected_clients,
            "tempHttpForward": {
                "ok": temp_http_ok,
                "status": temp_http_status,
                "error": temp_http_error,
            },
        },
    )


@router.post('/areas')
async def create_area(request: CreateAreaRequest):
    """API handler."""

    if not db_manager:
        return JSONResponse(status_code=503, content={"ok": False, "error": "数据库未连接"})

    try:
        created = await db_manager.create_area(request.model_dump())
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})
    except Exception as exc:
        logger.error(f"创建区域失败: {exc}")
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})

    try:
        publish_result = await publish_area_entity(created)
        if not publish_result.get("ok"):
            logger.error(f"区域实体注册失败: {publish_result}")
            return JSONResponse(
                status_code=502,
                content={
                    "ok": False,
                    "error": publish_result.get("message") or "实体注册失败",
                    "group_id": created["group_id"],
                    "area_id": created["area_id"],
                    "entityId": publish_result.get("entityId"),
                    "publish": publish_result,
                },
            )

        await refresh_db_area_cache_and_broadcast()
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                **created,
                "entityId": publish_result.get("entityId"),
                "publish": publish_result,
            },
        )
    except Exception as exc:
        logger.error(f"区域入库后广播失败: {exc}")
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": str(exc), **created},
        )


@router.delete('/areas')
async def delete_area(group_id: int, area_id: int, area_type: int):
    """API handler."""

    if not db_manager:
        return JSONResponse(status_code=503, content={"ok": False, "error": "数据库未连接"})

    entity_id = map_entity_id(group_id, area_id, area_type)
    entity_result = await delete_area_entity(entity_id)
    if not entity_result.get("ok"):
        return JSONResponse(
            status_code=502,
            content={"ok": False, "error": entity_result.get("message") or "实体删除失败", "entityId": entity_id},
        )

    try:
        deleted = await db_manager.delete_area(group_id, area_id)
        await refresh_db_area_cache_and_broadcast()
        return JSONResponse(
            status_code=200,
            content={"ok": True, "deleted": deleted, "entityId": entity_id},
        )
    except Exception as exc:
        logger.error(f"删除区域失败: {exc}")
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc), "entityId": entity_id})


@router.get('/status')
async def get_status():
    """API handler."""
    from receiver_manager import receiver_manager
    
    status = {
        "udp_receivers": len(receiver_manager.udp_receivers),
        "tcp_clients": len(receiver_manager.tcp_clients),
        "mqtt_connected": receiver_manager.mqtt_receiver is not None and receiver_manager.mqtt_receiver.running,
        "dds_connected": receiver_manager.dds_receiver is not None and receiver_manager.dds_receiver.running,
        "http_pollers": len(receiver_manager.http_pollers),
        "entity_grpc_clients": len(getattr(receiver_manager, "entity_grpc_clients", {})),
        "stats": receiver_manager.get_stats()
    }
    
    return JSONResponse(
        status_code=200,
        content={
            "code": 200,
            "message": "status loaded",
            "data": status,
            "timestamp": datetime.now().isoformat()
        }
    )


# API handler

class PointLocationRequest(BaseModel):
    longitude: float
    latitude: float
    zoom: float = 12
    animate: bool = True
    duration: int = 1500


class AreaLocationRequest(BaseModel):
    sw_longitude: float
    sw_latitude: float
    ne_longitude: float
    ne_latitude: float
    padding: int = 50
    animate: bool = True
    duration: int = 1500


@router.post('/map/point_location')
async def map_point_location(request: PointLocationRequest):
    """API handler."""
    location_command = {
        "type": "map_command",
        "command": "point_location",
        "data": {
            "longitude": request.longitude,
            "latitude": request.latitude,
            "zoom": request.zoom,
            "animate": request.animate,
            "duration": request.duration
        }
    }
    print("map_point_location:",location_command)
    
    await ws_manager.broadcast_command(location_command)
    logger.info(f"[API] 点位定位: ({request.longitude}, {request.latitude}), zoom={request.zoom}")
    
    return JSONResponse(status_code=200, content={"code": 200, "message": "已发送点位定位指令"})


@router.post('/map/area_location')
async def map_area_location(request: AreaLocationRequest):
    """API handler."""
    location_command = {
        "type": "map_command",
        "command": "area_location",
        "data": {
            "bounds": {
                "southwest": {"longitude": request.sw_longitude, "latitude": request.sw_latitude},
                "northeast": {"longitude": request.ne_longitude, "latitude": request.ne_latitude}
            },
            "padding": request.padding,
            "animate": request.animate,
            "duration": request.duration
        }
    }
    
    await ws_manager.broadcast_command(location_command)
    logger.info(f"[API] 区域定位: SW({request.sw_longitude}, {request.sw_latitude}) - NE({request.ne_longitude}, {request.ne_latitude})")
    
    return JSONResponse(status_code=200, content={"code": 200, "message": "已发送区域定位指令"})


# API handler

class ExportMapRequest(BaseModel):
    sw_longitude: float
    sw_latitude: float
    ne_longitude: float
    ne_latitude: float
    width: int = 1920
    height: int = 1080
    format: str = "png"


class AddMarkerRequest(BaseModel):
    marker_type: str
    coordinates: list
    properties: Optional[dict] = {}
    save: bool = True


class MeasureRequest(BaseModel):
    measure_type: str
    coordinates: list


class QueryFeaturesRequest(BaseModel):
    query_type: str
    center: Optional[list] = None
    radius: Optional[float] = None
    polygon: Optional[list] = None
    feature_id: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None


class TrafficAnalysisRequest(BaseModel):
    analysis_type: str
    center: Optional[list] = None
    radius: Optional[float] = None
    polygon: Optional[list] = None
    start_time: str
    end_time: str
    grid_size: int = 100


class CompareAnalysisRequest(BaseModel):
    analysis_type: str
    center: Optional[list] = None
    radius: Optional[float] = None
    polygon: Optional[list] = None
    time_ranges: list
    grid_size: int = 100


class RenderPathRequest(BaseModel):
    path_data: list
    style: Optional[dict] = {}
    animate: bool = False


class SendAlertRequest(BaseModel):
    alert_type: str
    title: str
    message: str
    location: Optional[list] = None
    duration: int = 5000


@router.post('/map/export_map')
async def export_map(request: ExportMapRequest):
    """API handler."""
    try:
        import base64
        from io import BytesIO
        from PIL import Image, ImageDraw
        import math
        
        # API handler
        img = Image.new('RGB', (request.width, request.height), color='#1a1a2e')
        draw = ImageDraw.Draw(img)
        
        # API handler
        grid_size = 50
        for x in range(0, request.width, grid_size):
            draw.line([(x, 0), (x, request.height)], fill='#16213e', width=1)
        for y in range(0, request.height, grid_size):
            draw.line([(0, y), (request.width, y)], fill='#16213e', width=1)
        
        # API handler
        buffer = BytesIO()
        img.save(buffer, format=request.format.upper())
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        logger.info(f"[API] 地图导出: SW({request.sw_longitude}, {request.sw_latitude}) - NE({request.ne_longitude}, {request.ne_latitude})")
        
        return JSONResponse(status_code=200, content={
            "code": 200,
            "message": "地图导出成功",
            "data": {
                "image": f"data:image/{request.format};base64,{img_base64}",
                "bounds": {
                    "southwest": {"longitude": request.sw_longitude, "latitude": request.sw_latitude},
                    "northeast": {"longitude": request.ne_longitude, "latitude": request.ne_latitude}
                }
            }
        })
    except Exception as e:
        logger.error(f"[API] 地图导出失败: {e}")
        return JSONResponse(status_code=500, content={"code": 500, "message": f"地图导出失败: {str(e)}"})


@router.post('/map/add_marker')
async def add_marker(request: AddMarkerRequest):
    """API handler."""
    marker_command = {
        "type": "map_command",
        "command": "add_marker",
        "data": {
            "marker_type": request.marker_type,
            "coordinates": request.coordinates,
            "properties": request.properties,
            "save": request.save
        }
    }
    
    await ws_manager.broadcast_command(marker_command)
    logger.info(f"[API] 添加标记: 类型={request.marker_type}, 坐标={request.coordinates}")
    
    return JSONResponse(status_code=200, content={"code": 200, "message": f"marker {request.marker_type} added"})


@router.post('/map/measure')
async def measure(request: MeasureRequest):
    """API handler."""
    from math import radians, sin, cos, sqrt, atan2, pi
    
    def haversine_distance(coord1, coord2):
        """API handler."""
        R = 6371000  # 地球半径（米）
        lat1, lon1 = radians(coord1[1]), radians(coord1[0])
        lat2, lon2 = radians(coord2[1]), radians(coord2[0])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        return R * c
    
    def polygon_area(coords):
        """API handler."""
        if len(coords) < 3:
            return 0
        R = 6371000
        area = 0
        for i in range(len(coords)):
            j = (i + 1) % len(coords)
            lon1, lat1 = radians(coords[i][0]), radians(coords[i][1])
            lon2, lat2 = radians(coords[j][0]), radians(coords[j][1])
            area += (lon2 - lon1) * (2 + sin(lat1) + sin(lat2))
        area = abs(area * R * R / 2.0)
        return area

    def calculate_angle(p1, vertex, p2):
        """API handler."""
        from math import atan2, degrees

        # API handler
        v1 = [p1[0] - vertex[0], p1[1] - vertex[1]]
        v2 = [p2[0] - vertex[0], p2[1] - vertex[1]]

        # API handler
        angle1 = atan2(v1[1], v1[0])
        angle2 = atan2(v2[1], v2[0])

        # API handler
        diff = angle2 - angle1

        # API handler
        diff = (diff + 360) % 360
        if diff > 180:
            diff = 360 - diff

        return diff
    
    try:
        if request.measure_type == "distance":
            # API handler
            total_distance = 0
            for i in range(len(request.coordinates) - 1):
                dist = haversine_distance(request.coordinates[i], request.coordinates[i+1])
                total_distance += dist
            
            result_message = f"总距离: {total_distance:.2f}米({total_distance/1000:.2f}公里)"
            result_data = {"distance": total_distance, "unit": "meters"}
            
        elif request.measure_type == "area":
            # API handler
            area = polygon_area(request.coordinates)
            result_message = f"面积: {area:.2f}平方米({area/1000000:.2f}平方公里)"
            result_data = {"area": area, "unit": "square_meters"}

        elif request.measure_type == "angle":
            # API handler
            if len(request.coordinates) != 3:
                return JSONResponse(status_code=400, content={"code": 400, "message": "angle measurement needs three points"})
            angle = calculate_angle(request.coordinates[0], request.coordinates[1], request.coordinates[2])
            result_message = f"angle: {angle:.1f} degrees"
            result_data = {"angle": angle, "unit": "degrees"}

        else:
            return JSONResponse(status_code=400, content={"code": 400, "message": "unknown measure type"})
        
        # API handler
        measure_command = {
            "type": "map_command",
            "command": "measure_result",
            "data": {
                "measure_type": request.measure_type,
                "coordinates": request.coordinates,
                "result": result_data,
                "message": result_message
            }
        }
        await ws_manager.broadcast_command(measure_command)
        
        logger.info(f"[API] 测量: {result_message}")
        return JSONResponse(status_code=200, content={
            "code": 200,
            "message": result_message,
            "data": result_data
        })
    except Exception as e:
        logger.error(f"[API] 测量失败: {e}")
        return JSONResponse(status_code=500, content={"code": 500, "message": f"测量失败: {str(e)}"})


@router.post('/map/query_features')
async def query_features(request: QueryFeaturesRequest):
    """API handler."""
    try:
        features = []
        
        if request.query_type == "radius" and request.center and request.radius:
            # API handler
            # API handler
            features = [
                {"id": "feature_1", "type": "track", "position": request.center, "distance": 100},
                {"id": "feature_2", "type": "track", "position": [request.center[0]+0.001, request.center[1]+0.001], "distance": 150}
            ]
            
        elif request.query_type == "polygon" and request.polygon:
            # API handler
            features = [
                {"id": "feature_3", "type": "track", "position": request.polygon[0]},
            ]
            
        elif request.query_type == "timeline" and request.feature_id:
            # API handler
            if db_manager:
                # API handler
                pass
            features = [
                {"id": request.feature_id, "timestamp": request.start_time, "position": [120.0, 30.0]},
                {"id": request.feature_id, "timestamp": request.end_time, "position": [120.1, 30.1]}
            ]
        
        # API handler
        query_command = {
            "type": "map_command",
            "command": "query_result",
            "data": {
                "query_type": request.query_type,
                "features": features,
                "count": len(features)
            }
        }
        await ws_manager.broadcast_command(query_command)
        
        logger.info(f"[API] query features: type={request.query_type}, count={len(features)}")
        return JSONResponse(status_code=200, content={
            "code": 200,
            "message": f"query complete, found {len(features)} features",
            "data": {"features": features, "count": len(features)}
        })
    except Exception as e:
        logger.error(f"[API] 查询要素失败: {e}")
        return JSONResponse(status_code=500, content={"code": 500, "message": f"查询失败: {str(e)}"})


@router.post('/map/traffic_analysis')
async def traffic_analysis(request: TrafficAnalysisRequest):
    """API handler."""
    try:
        import base64
        from io import BytesIO
        from PIL import Image, ImageDraw
        import random
        
        # API handler
        width, height = 800, 600
        img = Image.new('RGBA', (width, height), color=(0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # API handler
        for _ in range(50):
            x = random.randint(0, width)
            y = random.randint(0, height)
            radius = random.randint(20, 60)
            intensity = random.randint(100, 255)
            color = (255, 0, 0, intensity)
            draw.ellipse([x-radius, y-radius, x+radius, y+radius], fill=color)
        
        # API handler
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        # API handler
        analysis_command = {
            "type": "map_command",
            "command": "traffic_analysis",
            "data": {
                "analysis_type": request.analysis_type,
                "image": f"data:image/png;base64,{img_base64}",
                "bounds": {
                    "center": request.center,
                    "radius": request.radius,
                    "polygon": request.polygon
                },
                "time_range": {
                    "start": request.start_time,
                    "end": request.end_time
                }
            }
        }
        await ws_manager.broadcast_command(analysis_command)
        
        logger.info(f"[API] 流量分析: 类型={request.analysis_type}, 时间={request.start_time}~{request.end_time}")
        return JSONResponse(status_code=200, content={"code": 200, "message": "流量分析完成"})
    except Exception as e:
        logger.error(f"[API] 流量分析失败: {e}")
        return JSONResponse(status_code=500, content={"code": 500, "message": f"流量分析失败: {str(e)}"})


@router.post('/map/compare_analysis')
async def compare_analysis(request: CompareAnalysisRequest):
    """API handler."""
    try:
        import base64
        from io import BytesIO
        from PIL import Image, ImageDraw
        import random
        
        images = []
        for time_range in request.time_ranges:
            # API handler
            width, height = 800, 600
            img = Image.new('RGBA', (width, height), color=(0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            
            # API handler
            for _ in range(50):
                x = random.randint(0, width)
                y = random.randint(0, height)
                radius = random.randint(20, 60)
                intensity = random.randint(100, 255)
                color = (255, 0, 0, intensity)
                draw.ellipse([x-radius, y-radius, x+radius, y+radius], fill=color)
            
            buffer = BytesIO()
            img.save(buffer, format='PNG')
            img_base64 = base64.b64encode(buffer.getvalue()).decode()
            
            images.append({
                "image": f"data:image/png;base64,{img_base64}",
                "time_range": time_range
            })
        
        # API handler
        compare_command = {
            "type": "map_command",
            "command": "compare_analysis",
            "data": {
                "analysis_type": request.analysis_type,
                "images": images,
                "bounds": {
                    "center": request.center,
                    "radius": request.radius,
                    "polygon": request.polygon
                }
            }
        }
        await ws_manager.broadcast_command(compare_command)
        
        logger.info(f"[API] 对比分析: 类型={request.analysis_type}, 生成{len(images)}张对比图")
        return JSONResponse(status_code=200, content={
            "code": 200,
            "message": f"compare analysis complete, generated {len(images)} images",
            "data": {"image_count": len(images)}
        })
    except Exception as e:
        logger.error(f"[API] 对比分析失败: {e}")
        return JSONResponse(status_code=500, content={"code": 500, "message": f"对比分析失败: {str(e)}"})


@router.post('/map/render_path')
async def render_path(request: RenderPathRequest):
    """API handler."""
    path_command = {
        "type": "map_command",
        "command": "render_path",
        "data": {
            "path_data": request.path_data,
            "style": request.style or {
                "color": "#00ff00",
                "width": 3,
                "opacity": 0.8
            },
            "animate": request.animate
        }
    }
    
    await ws_manager.broadcast_command(path_command)
    logger.info(f"[API] 路径渲染: 点数={len(request.path_data)}, 动画={request.animate}")
    
    return JSONResponse(status_code=200, content={"code": 200, "message": "路径渲染指令已发送"})


@router.post('/map/send_alert')
async def send_alert(request: SendAlertRequest):
    """API handler."""
    alert_command = {
        "type": "map_command",
        "command": "alert",
        "data": {
            "alert_type": request.alert_type,
            "title": request.title,
            "message": request.message,
            "location": request.location,
            "duration": request.duration,
            "timestamp": datetime.now().isoformat()
        }
    }

    await ws_manager.broadcast_command(alert_command)
    logger.info(f"[API] 预警: 类型={request.alert_type}, 标题={request.title}")

    return JSONResponse(status_code=200, content={"code": 200, "message": "预警已发送"})


# API handler

class ClearMapRequest(BaseModel):
    target: str = "all"  # all, markers, polygons, paths, alerts, heatmaps, measurements, queries
    clear_all_layers: bool = False  # 是否清除所有图层（包括非MCP图层）

@router.post('/map/clear')
async def clear_map(request: ClearMapRequest):
    """API handler."""
    clear_command = {
        "type": "map_command",
        "command": "clear",
        "data": {
            "target": request.target,
            "clear_all_layers": request.clear_all_layers
        }
    }

    await ws_manager.broadcast_command(clear_command)
    logger.info(f"[API] 清除地图元素: 目标={request.target}, 清除所有图层={request.clear_all_layers}")

    return JSONResponse(status_code=200, content={"code": 200, "message": f"已发送清除指令 {request.target}"})


# API handler

class SavePromptRequest(BaseModel):
    filename: str
    content: str


@router.post('/prompts/save')
async def save_prompt(request: SavePromptRequest):
    """API handler."""
    import os
    from pathlib import Path
    
    # API handler
    allowed_files = [
        'multimodalSystemPrompt.txt',
        'multimodalUserPromptSuffix.txt'
    ]
    
    if request.filename not in allowed_files:
        logger.warning(f"[API] 尝试保存不允许的文件: {request.filename}")
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "message": "invalid filename"
            }
        )
    
    try:
        # API handler
        prompts_dir = Path(__file__).parent / 'prompts'
        prompts_dir.mkdir(exist_ok=True)
        
        # API handler
        file_path = prompts_dir / request.filename
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(request.content)
        
        logger.info(f"[API] Prompt 文件保存成功: {request.filename}")
        
        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "message": "保存成功",
                "filename": request.filename
            }
        )
    except Exception as e:
        logger.error(f"[API] 保存 Prompt 文件失败: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": f"保存失败: {str(e)}"
            }
        )


@router.get('/prompts/{filename}')
async def get_prompt(filename: str):
    """API handler."""
    import os
    from pathlib import Path
    from fastapi.responses import PlainTextResponse
    
    # API handler
    allowed_files = [
        'multimodalSystemPrompt.txt',
        'multimodalUserPromptSuffix.txt'
    ]
    
    if filename not in allowed_files:
        logger.warning(f"[API] 尝试读取不允许的文件: {filename}")
        raise HTTPException(status_code=400, detail="invalid filename")
    
    try:
        # API handler
        prompts_dir = Path(__file__).parent / 'prompts'
        file_path = prompts_dir / filename
        
        if not file_path.exists():
            logger.warning(f"[API] Prompt 文件不存在: {filename}")
            raise HTTPException(status_code=404, detail="file not found")
        
        # API handler
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        logger.info(f"[API] Prompt 文件读取成功: {filename}")
        
        # API handler
        return PlainTextResponse(content=content)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[API] 读取 Prompt 文件失败: {e}")
        raise HTTPException(status_code=500, detail=f"读取失败: {str(e)}")


# API handler

@router.post('/track_simulator/start')
async def start_track_simulator(request: Request, kind: Optional[str] = None):
    """API handler."""
    try:
        target_kind = kind
        try:
            body = await request.json()
            if isinstance(body, dict) and body.get("kind") is not None:
                target_kind = str(body.get("kind"))
        except Exception:
            pass

        result = await track_simulator.start(target_kind or "sea")
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                **result,
                "timestamp": datetime.now().isoformat()
            }
        )
    except Exception as e:
        logger.error(f"[API] 启动轨迹模拟失败: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "success": False,
                "message": f"启动失败: {str(e)}",
                "timestamp": datetime.now().isoformat()
            }
        )


@router.post('/track_simulator/stop')
async def stop_track_simulator():
    """API handler."""
    try:
        result = await track_simulator.stop()
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                **result,
                "timestamp": datetime.now().isoformat()
            }
        )
    except Exception as e:
        logger.error(f"[API] 停止轨迹模拟失败: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "success": False,
                "message": f"停止失败: {str(e)}",
                "timestamp": datetime.now().isoformat()
            }
        )


@router.get('/track_simulator/status')
async def get_track_simulator_status():
    """API handler."""
    try:
        status = track_simulator.get_status()
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "data": status,
                "timestamp": datetime.now().isoformat()
            }
        )
    except Exception as e:
        logger.error(f"[API] 获取轨迹模拟状态失败: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"获取状态失败: {str(e)}",
                "timestamp": datetime.now().isoformat()
            }
        )



from conversation_store import conversation_store


@router.get('/conversations')
async def list_conversations(limit: int = 50, offset: int = 0, category: Optional[str] = None):
    """List conversations, optionally filtered by category."""
    return JSONResponse(content=conversation_store.list(limit, offset, category=category))


@router.post('/conversations')
async def create_conversation(request: Request):
    """Create a conversation."""
    body = await request.json()
    title = body.get("title", "新对话")
    category = body.get("category", "chat")
    conv = conversation_store.create(title=title, category=category)
    return JSONResponse(content=conv)


@router.get('/conversations/{conv_id}')
async def get_conversation(conv_id: str):
    """Get conversation detail."""
    detail = conversation_store.get(conv_id)
    if not detail:
        raise HTTPException(status_code=404, detail="conversation not found")
    return JSONResponse(content=detail)


@router.patch('/conversations/{conv_id}')
async def update_conversation(conv_id: str, request: Request):
    """Update conversation metadata."""
    body = await request.json()
    result = conversation_store.update(conv_id, title=body.get("title"))
    if not result:
        raise HTTPException(status_code=404, detail="conversation not found")
    return JSONResponse(content=result)


@router.delete('/conversations/{conv_id}')
async def delete_conversation(conv_id: str):
    """Delete a conversation."""
    if not conversation_store.delete(conv_id):
        raise HTTPException(status_code=404, detail="conversation not found")
    return JSONResponse(content={"ok": True})


@router.post('/conversations/{conv_id}/messages')
async def add_conversation_message(conv_id: str, request: Request):
    """Append a message to a conversation."""
    body = await request.json()
    role = body.get("role", "user")
    content = body.get("content", "")
    msg = conversation_store.add_message(conv_id, role, content)
    if not msg:
        raise HTTPException(status_code=404, detail="conversation not found")
    return JSONResponse(content=msg)


@router.delete('/conversations/{conv_id}/messages')
async def clear_conversation_messages(conv_id: str):
    """Clear conversation messages."""
    if not conversation_store.clear_messages(conv_id):
        raise HTTPException(status_code=404, detail="conversation not found")
    return JSONResponse(content={"ok": True})









