"""
HTTP API服务 - 提供REST接口
"""
from pathlib import Path
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from datetime import datetime
from typing import Optional
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


# 数据库管理器引用（由main.py注入）
db_manager = None


def set_db_manager(manager):
    """设置数据库管理器"""
    global db_manager
    db_manager = manager


async def refresh_db_area_cache_and_broadcast():
    """注册区域/航线发生变化后，刷新后端缓存并通过 WS 广播。

    这里是数据库区域/航线向前端扩散的唯一正式出口：
    1. 从 `area_table` 重新读取最新行数据
    2. 替换后端内存中的当前区域快照
    3. 向所有已连接客户端广播一份新的 `DbAreas` 全量消息

    前端不会直接读 Postgres，也不会自己轮询数据库。
    所有浏览器最终都渲染这份后端持有的统一快照。
    """
    if not db_manager:
        return
    rows = await db_manager.get_area_table_rows()
    ws_manager.set_db_area_rows(rows or [])
    await ws_manager.broadcast_db_area_rows()


def set_latest_entity_records(records):
    """缓存最近一次 HTTP 轮询拿到的实体列表"""
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
    """保存光电视频截图或录像文件。

    EO 弹窗会先在浏览器侧生成截图或录像二进制，再上传到这个接口。
    这个接口只负责把文件落到本地磁盘：
    - 不代理实时 WebRTC 视频流
    - 不参与检测框同步
    - 不参与视频播放本身
    """
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
    """返回最近一帧实体状态中的单个实体详情"""
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
    """测试接口"""
    return JSONResponse(
        status_code=200,
        content={
            "code": 200,
            "message": "服务运行正常",
            "timestamp": datetime.now().isoformat()
        }
    )


@router.get('/health')
async def health_check():
    """健康检查接口"""
    return JSONResponse(
        status_code=200,
        content={
            "code": 200,
            "status": "healthy",
            "timestamp": datetime.now().isoformat()
        }
    )


@router.get('/image/{unique_id}')
async def get_image_by_unique_id(unique_id: str):
    """根据 uniqueID 返回 base64（查库、拉取、绘制见 database.fetch_hanging_image_for_api）"""
    try:
        if not db_manager:
            raise HTTPException(
                status_code=503,
                detail="数据库服务不可用"
            )
        
        payload = await db_manager.fetch_hanging_image_for_api(unique_id)
        if not payload.get("ok"):
            reason = payload.get("reason")
            if reason == "not_found":
                return JSONResponse(
                    status_code=404,
                    content={
                        "code": 404,
                        "message": f"未找到uniqueID为 {unique_id} 的图片",
                        "timestamp": datetime.now().isoformat(),
                    },
                )
            if reason == "no_url":
                logger.warning(f"图片信息中没有imageUrl: {unique_id}")
                return JSONResponse(
                    status_code=404,
                    content={
                        "code": 404,
                        "message": "图片URL不存在",
                        "timestamp": datetime.now().isoformat(),
                    },
                )
            if reason == "bad_http":
                logger.error(f"从MinIO读取图片失败: HTTP {payload.get('http_status')}")
                return JSONResponse(
                    status_code=404,
                    content={
                        "code": 404,
                        "message": "无法从MinIO读取图片",
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
                    "message": "服务器内部错误",
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
                    "uniqueId": payload.get("uniqueId"),
                    "trackId": payload.get("trackId"),
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
                "message": "服务器内部错误",
                "timestamp": datetime.now().isoformat()
            }
        )


@router.get('/image/track/{track_id}')
async def get_image_by_track_id(track_id: str):
    """根据trackID查询图片信息"""
    try:
        if not db_manager:
            raise HTTPException(
                status_code=503,
                detail="数据库服务不可用"
            )
        
        # 查询图片信息
        image_info = await db_manager.get_hanging_image("", track_id)
        
        if not image_info:
            return JSONResponse(
                status_code=404,
                content={
                    "code": 404,
                    "message": f"未找到trackID为 {track_id} 的图片",
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
                "message": "服务器内部错误",
                "timestamp": datetime.now().isoformat()
            }
        )


@router.get('/areas')
async def get_areas():
    """获取区域数据"""
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
    """Destroy HTTP body.version。"""

    definitionVersion: int
    statusVersion: int


class DestroySpecificationRequest(BaseModel):
    """Destroy HTTP body.specification。"""

    at_type: str = Field(alias="@type")
    type: int
    id: str

    model_config = {"populate_by_name": True}


class DestroyCreatedBySystemRequest(BaseModel):
    """Destroy HTTP body.createdBy.system。"""

    serviceName: str
    entityId: str
    managesOwnScheduling: bool
    priority: int


class DestroyCreatedByRequest(BaseModel):
    """Destroy HTTP body.createdBy。"""

    system: DestroyCreatedBySystemRequest


class DestroyOwnerRequest(BaseModel):
    """Destroy HTTP body.owner。"""

    entityId: str


class DestroyPublishRequest(BaseModel):
    """
    前端“消灭”唯一 HTTP 请求体。

    这里直接按前端现有 body 结构收，不再让前端拆字段，也不再走 JSON blob 转 gRPC。
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
async def publish_destroy_event(request: DestroyPublishRequest):
    """
    告警面板“消灭”唯一 HTTP 出口。

    这条接口只做两件事：
    1. 把前端请求体逐字段映射为 destroy proto 消息。
    2. 广播给当前所有在线的 gRPC 订阅客户端，并把在线数回给前端。

    注意：
    - 这里不再转发多个地址。
    - 这里不再做实体删除。
    - gRPC 订阅服务监听地址复用后端 HOST，但使用独立端口承载订阅流。
    """
    connected_clients = await destroy_grpc_service.publish_destroy_event(
        {
            "task_id": request.taskId,
            "parent_task_id": request.parentTaskId,
            "version_definition_version": request.version.definitionVersion,
            "version_status_version": request.version.statusVersion,
            "display_name": request.displayName,
            "task_type": request.taskType,
            "max_execution_time_ms": request.maxExecutionTimeMs,
            "specification_at_type": request.specification.at_type,
            "specification_type": request.specification.type,
            "specification_id": request.specification.id,
            "created_by_service_name": request.createdBy.system.serviceName,
            "created_by_entity_id": request.createdBy.system.entityId,
            "created_by_manages_own_scheduling": request.createdBy.system.managesOwnScheduling,
            "created_by_priority": request.createdBy.system.priority,
            "owner_entity_id": request.owner.entityId,
        }
    )
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "taskId": request.taskId,
            "connectedClients": connected_clients,
        },
    )


@router.post('/areas')
async def create_area(request: CreateAreaRequest):
    """创建区域/航线：后端统一负责存库、实体注册、刷新缓存并广播。

    完整流程：
    1. 前端绘制界面把归一化后的几何数据提交到这个接口
    2. 后端先插入 `area_table`
    3. 后端再向外部实体服务注册对应的区域/航线实体
    4. 后端刷新当前区域快照缓存
    5. 后端通过 WebSocket 广播 `DbAreas`，让所有客户端一起刷新显示

    这样数据库访问和实体注册都只发生在后端，不落到浏览器。
    """
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
        logger.error(f"区域存库后注册/广播失败: {exc}")
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": str(exc), **created},
        )


@router.delete('/areas')
async def delete_area(group_id: int, area_id: int, area_type: int):
    """删除区域/航线：先删实体，再删数据库，再广播最新快照。

    删除顺序故意设计成这样：
    1. 先删除已经发布出去的实体
    2. 再删除 `area_table` 中的数据库行
    3. 然后重建后端缓存
    4. 最后广播新的 `DbAreas` 全量快照

    这样可以保证前端看到的区域列表和外部实体服务状态尽量保持一致。
    """
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
    """获取服务状态"""
    from receiver_manager import receiver_manager
    
    status = {
        "udp_receivers": len(receiver_manager.udp_receivers),
        "tcp_clients": len(receiver_manager.tcp_clients),
        "mqtt_connected": receiver_manager.mqtt_receiver is not None and receiver_manager.mqtt_receiver.running,
        "dds_connected": receiver_manager.dds_receiver is not None and receiver_manager.dds_receiver.running,
        "http_pollers": len(receiver_manager.http_pollers),
        "stats": receiver_manager.get_stats()
    }
    
    return JSONResponse(
        status_code=200,
        content={
            "code": 200,
            "message": "获取状态成功",
            "data": status,
            "timestamp": datetime.now().isoformat()
        }
    )


# ==================== 地图定位接口（供MCP服务调用） ====================

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
    """点定位 - 通过WebSocket发送到前端"""
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
    logger.info(f"[API] 点定位: ({request.longitude}, {request.latitude}), zoom={request.zoom}")
    
    return JSONResponse(status_code=200, content={"code": 200, "message": "已发送点定位指令"})


@router.post('/map/area_location')
async def map_area_location(request: AreaLocationRequest):
    """区域定位 - 通过WebSocket发送到前端"""
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


# ==================== 新增地图功能接口 ====================

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
    """地图导出 - 导出指定区域的地图图片"""
    try:
        import base64
        from io import BytesIO
        from PIL import Image, ImageDraw
        import math
        
        # 创建一个简单的地图图片（实际应用中应该使用真实的地图渲染）
        img = Image.new('RGB', (request.width, request.height), color='#1a1a2e')
        draw = ImageDraw.Draw(img)
        
        # 绘制网格线表示地图
        grid_size = 50
        for x in range(0, request.width, grid_size):
            draw.line([(x, 0), (x, request.height)], fill='#16213e', width=1)
        for y in range(0, request.height, grid_size):
            draw.line([(0, y), (request.width, y)], fill='#16213e', width=1)
        
        # 保存为base64
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
    """地图标记 - 添加点、多边形或矩形标记"""
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
    
    return JSONResponse(status_code=200, content={"code": 200, "message": f"已添加{request.marker_type}标记"})


@router.post('/map/measure')
async def measure(request: MeasureRequest):
    """测量 - 测量距离或面积"""
    from math import radians, sin, cos, sqrt, atan2, pi
    
    def haversine_distance(coord1, coord2):
        """计算两点之间的距离（米）"""
        R = 6371000  # 地球半径（米）
        lat1, lon1 = radians(coord1[1]), radians(coord1[0])
        lat2, lon2 = radians(coord2[1]), radians(coord2[0])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        return R * c
    
    def polygon_area(coords):
        """计算多边形面积（平方米）"""
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
        """计算三个点之间的角度（度）"""
        from math import atan2, degrees

        # 将地理坐标转换为向量（相对于顶点）
        v1 = [p1[0] - vertex[0], p1[1] - vertex[1]]
        v2 = [p2[0] - vertex[0], p2[1] - vertex[1]]

        # 计算两个向量的角度
        angle1 = atan2(v1[1], v1[0])
        angle2 = atan2(v2[1], v2[0])

        # 计算角度差
        diff = angle2 - angle1

        # 确保角度在0-180度范围内
        diff = (diff + 360) % 360
        if diff > 180:
            diff = 360 - diff

        return diff
    
    try:
        if request.measure_type == "distance":
            # 计算总距离
            total_distance = 0
            for i in range(len(request.coordinates) - 1):
                dist = haversine_distance(request.coordinates[i], request.coordinates[i+1])
                total_distance += dist
            
            result_message = f"总距离: {total_distance:.2f}米 ({total_distance/1000:.2f}公里)"
            result_data = {"distance": total_distance, "unit": "meters"}
            
        elif request.measure_type == "area":
            # 计算面积
            area = polygon_area(request.coordinates)
            result_message = f"面积: {area:.2f}平方米 ({area/1000000:.2f}平方公里)"
            result_data = {"area": area, "unit": "square_meters"}

        elif request.measure_type == "angle":
            # 计算角度
            if len(request.coordinates) != 3:
                return JSONResponse(status_code=400, content={"code": 400, "message": "角度测量需要三个点"})
            angle = calculate_angle(request.coordinates[0], request.coordinates[1], request.coordinates[2])
            result_message = f"角度: {angle:.1f}度"
            result_data = {"angle": angle, "unit": "degrees"}

        else:
            return JSONResponse(status_code=400, content={"code": 400, "message": "未知的测量类型"})
        
        # 发送测量结果到前端显示
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
    """查询要素 - 半径查询、多边形查询或时间线查询"""
    try:
        features = []
        
        if request.query_type == "radius" and request.center and request.radius:
            # 半径查询（这里应该查询数据库）
            # 示例：返回模拟数据
            features = [
                {"id": "feature_1", "type": "track", "position": request.center, "distance": 100},
                {"id": "feature_2", "type": "track", "position": [request.center[0]+0.001, request.center[1]+0.001], "distance": 150}
            ]
            
        elif request.query_type == "polygon" and request.polygon:
            # 多边形查询
            features = [
                {"id": "feature_3", "type": "track", "position": request.polygon[0]},
            ]
            
        elif request.query_type == "timeline" and request.feature_id:
            # 时间线查询
            if db_manager:
                # 这里应该查询数据库获取历史数据
                pass
            features = [
                {"id": request.feature_id, "timestamp": request.start_time, "position": [120.0, 30.0]},
                {"id": request.feature_id, "timestamp": request.end_time, "position": [120.1, 30.1]}
            ]
        
        # 发送查询结果到前端
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
        
        logger.info(f"[API] 查询要素: 类型={request.query_type}, 找到{len(features)}个要素")
        return JSONResponse(status_code=200, content={
            "code": 200,
            "message": f"查询完成，找到{len(features)}个要素",
            "data": {"features": features, "count": len(features)}
        })
    except Exception as e:
        logger.error(f"[API] 查询要素失败: {e}")
        return JSONResponse(status_code=500, content={"code": 500, "message": f"查询失败: {str(e)}"})


@router.post('/map/traffic_analysis')
async def traffic_analysis(request: TrafficAnalysisRequest):
    """流量分析 - 生成热力图"""
    try:
        import base64
        from io import BytesIO
        from PIL import Image, ImageDraw
        import random
        
        # 创建热力图（实际应用中应该根据真实数据生成）
        width, height = 800, 600
        img = Image.new('RGBA', (width, height), color=(0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # 生成随机热力点
        for _ in range(50):
            x = random.randint(0, width)
            y = random.randint(0, height)
            radius = random.randint(20, 60)
            intensity = random.randint(100, 255)
            color = (255, 0, 0, intensity)
            draw.ellipse([x-radius, y-radius, x+radius, y+radius], fill=color)
        
        # 保存为base64
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        # 发送热力图到前端
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
    """对比分析 - 生成多张热力图进行对比"""
    try:
        import base64
        from io import BytesIO
        from PIL import Image, ImageDraw
        import random
        
        images = []
        for time_range in request.time_ranges:
            # 为每个时间段生成热力图
            width, height = 800, 600
            img = Image.new('RGBA', (width, height), color=(0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            
            # 生成随机热力点
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
        
        # 发送对比图到前端
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
            "message": f"对比分析完成，生成{len(images)}张对比图",
            "data": {"image_count": len(images)}
        })
    except Exception as e:
        logger.error(f"[API] 对比分析失败: {e}")
        return JSONResponse(status_code=500, content={"code": 500, "message": f"对比分析失败: {str(e)}"})


@router.post('/map/render_path')
async def render_path(request: RenderPathRequest):
    """路径渲染 - 在地图上显示路径"""
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
    """预警 - 发送预警信息到前端"""
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


# ==================== 地图清除功能 ====================

class ClearMapRequest(BaseModel):
    target: str = "all"  # all, markers, polygons, paths, alerts, heatmaps, measurements, queries
    clear_all_layers: bool = False  # 是否清除所有图层（包括非MCP图层）

@router.post('/map/clear')
async def clear_map(request: ClearMapRequest):
    """清除地图渲染元素"""
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

    return JSONResponse(status_code=200, content={"code": 200, "message": f"已发送清除指令: {request.target}"})


# ==================== Prompt 配置管理接口 ====================

class SavePromptRequest(BaseModel):
    filename: str
    content: str


@router.post('/prompts/save')
async def save_prompt(request: SavePromptRequest):
    """保存 prompt 文件"""
    import os
    from pathlib import Path
    
    # 允许的文件名白名单
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
                "message": "不允许的文件名"
            }
        )
    
    try:
        # 获取 prompts 目录路径
        prompts_dir = Path(__file__).parent / 'prompts'
        prompts_dir.mkdir(exist_ok=True)
        
        # 保存文件
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
    """读取 prompt 文件"""
    import os
    from pathlib import Path
    from fastapi.responses import PlainTextResponse
    
    # 允许的文件名白名单
    allowed_files = [
        'multimodalSystemPrompt.txt',
        'multimodalUserPromptSuffix.txt'
    ]
    
    if filename not in allowed_files:
        logger.warning(f"[API] 尝试读取不允许的文件: {filename}")
        raise HTTPException(status_code=400, detail="不允许的文件名")
    
    try:
        # 获取 prompts 目录路径
        prompts_dir = Path(__file__).parent / 'prompts'
        file_path = prompts_dir / filename
        
        if not file_path.exists():
            logger.warning(f"[API] Prompt 文件不存在: {filename}")
            raise HTTPException(status_code=404, detail="文件不存在")
        
        # 读取文件内容
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        logger.info(f"[API] Prompt 文件读取成功: {filename}")
        
        # 返回纯文本内容
        return PlainTextResponse(content=content)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[API] 读取 Prompt 文件失败: {e}")
        raise HTTPException(status_code=500, detail=f"读取失败: {str(e)}")


# ==================== 航迹模拟器接口 ====================

@router.post('/track_simulator/start')
async def start_track_simulator():
    """启动航迹模拟"""
    try:
        result = await track_simulator.start()
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                **result,
                "timestamp": datetime.now().isoformat()
            }
        )
    except Exception as e:
        logger.error(f"[API] 启动航迹模拟失败: {e}")
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
    """停止航迹模拟"""
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
        logger.error(f"[API] 停止航迹模拟失败: {e}")
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
    """获取航迹模拟状态"""
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
        logger.error(f"[API] 获取航迹模拟状态失败: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"获取状态失败: {str(e)}",
                "timestamp": datetime.now().isoformat()
            }
        )


# ==================== 会话管理接口 ====================

from conversation_store import conversation_store


@router.get('/conversations')
async def list_conversations(limit: int = 50, offset: int = 0):
    """获取会话列表"""
    return JSONResponse(content=conversation_store.list(limit, offset))


@router.post('/conversations')
async def create_conversation(request: Request):
    """创建新会话"""
    body = await request.json()
    title = body.get("title", "新对话")
    conv = conversation_store.create(title=title)
    return JSONResponse(content=conv)


@router.get('/conversations/{conv_id}')
async def get_conversation(conv_id: str):
    """获取会话详情（含消息列表）"""
    detail = conversation_store.get(conv_id)
    if not detail:
        raise HTTPException(status_code=404, detail="会话不存在")
    return JSONResponse(content=detail)


@router.patch('/conversations/{conv_id}')
async def update_conversation(conv_id: str, request: Request):
    """更新会话（如修改标题）"""
    body = await request.json()
    result = conversation_store.update(conv_id, title=body.get("title"))
    if not result:
        raise HTTPException(status_code=404, detail="会话不存在")
    return JSONResponse(content=result)


@router.delete('/conversations/{conv_id}')
async def delete_conversation(conv_id: str):
    """删除会话"""
    if not conversation_store.delete(conv_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return JSONResponse(content={"ok": True})


@router.post('/conversations/{conv_id}/messages')
async def add_conversation_message(conv_id: str, request: Request):
    """向会话追加一条消息"""
    body = await request.json()
    role = body.get("role", "user")
    content = body.get("content", "")
    msg = conversation_store.add_message(conv_id, role, content)
    if not msg:
        raise HTTPException(status_code=404, detail="会话不存在")
    return JSONResponse(content=msg)


@router.delete('/conversations/{conv_id}/messages')
async def clear_conversation_messages(conv_id: str):
    """清空会话消息"""
    if not conversation_store.clear_messages(conv_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return JSONResponse(content={"ok": True})
