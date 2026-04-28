"""
HTTP API服务 - 提供REST接口
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from datetime import datetime
from typing import Optional
from loguru import logger
from pydantic import BaseModel
from websocket_manager import ws_manager
from track_simulator import track_simulator
import base64


router = APIRouter()


# 数据库管理器引用（由main.py注入）
db_manager = None


def set_db_manager(manager):
    """设置数据库管理器"""
    global db_manager
    db_manager = manager


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