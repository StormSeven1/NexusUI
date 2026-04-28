"""
数据库模块 - 用于查询区域表和获取minio图片数据
"""
import base64
import io
import os

import aiohttp
import asyncpg
from typing import Optional, List, Dict, Any
from datetime import datetime
from loguru import logger
from PIL import Image, ImageDraw, ImageFont


class DatabaseManager:
    """数据库管理器 - 查询功能和minio图片获取"""
    
    def __init__(self, config: Dict[str, Any]):
        self.host = config.get('host', 'localhost')
        self.port = config.get('port', 5432)
        self.database = config.get('database', 'postgres')
        self.user = config.get('user', 'postgres')
        self.password = config.get('password', '')
        self.pool: Optional[asyncpg.Pool] = None

    @staticmethod
    def _safe_int(v: Any) -> Optional[int]:
        if v is None:
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _safe_float(v: Any) -> Optional[float]:
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _load_font(size: int = 18):
        paths = [
            os.environ.get("VERIFICATION_IMAGE_FONT", "").strip(),
            r"C:\Windows\Fonts\msyh.ttc",
            r"C:\Windows\Fonts\simhei.ttf",
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
        for p in paths:
            if p and os.path.isfile(p):
                try:
                    return ImageFont.truetype(p, size)
                except OSError:
                    continue
        return ImageFont.load_default()

    @staticmethod
    def _modal_label(modal: Any) -> str:
        m = DatabaseManager._safe_int(modal)
        if m is None:
            return ""
        return {0: "Camera", 1: "UAV", 9: "Auto-capture"}.get(m, str(m))

    def annotate_hanging_image(self, image_data: bytes, image_info: Dict[str, Any]) -> bytes:
        """在图片上绘制检测框及 PTZ、视野、焦距、跟踪时间、类型等，输出 JPEG bytes。"""
        im = Image.open(io.BytesIO(image_data))
        if im.mode == "RGBA":
            bg = Image.new("RGB", im.size, (32, 32, 32))
            bg.paste(im, mask=im.split()[3])
            im = bg
        elif im.mode != "RGB":
            im = im.convert("RGB")

        draw = ImageDraw.Draw(im)
        font = DatabaseManager._load_font(18)

        rx = DatabaseManager._safe_int(image_info.get("rectX"))
        ry = DatabaseManager._safe_int(image_info.get("rectY"))
        rw = DatabaseManager._safe_int(image_info.get("rectWidth"))
        rh = DatabaseManager._safe_int(image_info.get("rectHeight"))
        if (
            rx is not None
            and ry is not None
            and rw is not None
            and rh is not None
            and rw > 0
            and rh > 0
        ):
            x1, y1, x2, y2 = rx, ry, rx + rw, ry + rh
            draw.rectangle([x1, y1, x2, y2], outline=(0, 255, 0), width=3)
            rid = DatabaseManager._safe_int(image_info.get("rectId"))
            if rid is not None:
                # 与左上角同字号；先铺深色底再写字，避免小字+复杂背景显得糊（JPEG 压缩也会放大这种差异）
                label = f"rect_id {rid}"
                ty = max(0, y1 - 28)
                bx = draw.textbbox((x1, ty), label, font=font)
                pad = 4
                draw.rectangle(
                    [bx[0] - pad, bx[1] - pad, bx[2] + pad, bx[3] + pad],
                    fill=(20, 20, 28),
                )
                draw.text(
                    (x1, ty),
                    label,
                    fill=(180, 255, 200),
                    font=font,
                    stroke_width=2,
                    stroke_fill=(0, 0, 0),
                )

        lines: List[str] = []
        p, t, z = (
            DatabaseManager._safe_float(image_info.get("camP")),
            DatabaseManager._safe_float(image_info.get("camT")),
            DatabaseManager._safe_float(image_info.get("camZ")),
        )
        if p is not None or t is not None or z is not None:
            ps = f"{p:.4g}" if p is not None else "-"
            ts = f"{t:.4g}" if t is not None else "-"
            zs = f"{z:.4g}" if z is not None else "-"
            lines.append(f"PTZ  P={ps}  T={ts}  Z={zs}")

        vis = DatabaseManager._safe_float(image_info.get("camVis"))
        if vis is not None:
            lines.append(f"FOV: {vis:.4g}")

        focus = DatabaseManager._safe_float(image_info.get("camFocus"))
        if focus is not None:
            lines.append(f"Focus: {focus:.4g}")

        tt = image_info.get("trackTime")
        if tt is not None:
            lines.append(f"TrackTime: {tt}")

        tgt = image_info.get("targetType")
        if tgt is not None and str(tgt).strip() != "":
            lines.append(f"Type: {tgt}")

        cidx = image_info.get("cameraIndex")
        if cidx is not None:
            lines.append(f"CameraIdx: {cidx}")

        ml = DatabaseManager._modal_label(image_info.get("modal"))
        if ml:
            lines.append(f"Modal: {ml}")

        if not lines:
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=88)
            return out.getvalue()

        pad = 8
        line_spacing = 4
        max_w = 0
        heights: List[int] = []
        for line in lines:
            bbox = draw.textbbox((0, 0), line, font=font)
            w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
            max_w = max(max_w, w)
            heights.append(h)

        box_w = max_w + pad * 2
        box_h = (
            pad * 2
            + sum(heights)
            + line_spacing * (len(lines) - 1 if len(lines) > 1 else 0)
        )
        x0, y0 = 6, 6
        draw.rectangle([x0, y0, x0 + box_w, y0 + box_h], fill=(25, 25, 30))

        cy = y0 + pad
        for line, h in zip(lines, heights):
            draw.text((x0 + pad, cy), line, fill=(255, 230, 60), font=font)
            cy += h + line_spacing

        out = io.BytesIO()
        im.save(out, format="JPEG", quality=88)
        return out.getvalue()

    async def connect(self) -> bool:
        """连接数据库"""
        try:
            self.pool = await asyncpg.create_pool(
                host=self.host,
                port=self.port,
                database=self.database,
                user=self.user,
                password=self.password,
                min_size=1,
                max_size=5,
                timeout=10
            )
            logger.info(f"数据库连接成功: {self.host}:{self.port}/{self.database}")
            return True
        except Exception as e:
            logger.error(f"数据库连接失败: {e}")
            return False
    
    async def close(self):
        """关闭数据库连接"""
        if self.pool:
            await self.pool.close()
            logger.info("数据库连接已关闭")
    
    async def get_area_table(self) -> Optional[List[Dict[str, Any]]]:
        """
        获取区域表数据
        用于WebSocket连接后发送所有区域数据
        """
        if not self.pool:
            logger.error("数据库未连接")
            return None
        
        try:
            async with self.pool.acquire() as conn:
                query = "SELECT * FROM area_table"
                records = await conn.fetch(query)
                
                if not records:
                    return None
                
                result = []
                logger.info(f"开始解析区域数据，共 {len(records)} 条记录")
                for record in records:
                    area_type = record['area_type']
                    area_id = record['area_id']
                    area_name = record['area_name']
                    coordinates = []
                    geometry_type = 'Polygon'  # 默认多边形
                    center = None
                    radius = None
                    
                    logger.info(f"解析区域 [{area_id}] {area_name}, 类型={area_type}")
                    
                    # 根据区域类型解析坐标
                    if area_type == 1:  # 矩形
                        if record['area_rect']:
                            area_rect = record['area_rect'].split(',')
                            sw_lat, ne_lng, ne_lat, sw_lng = map(float, area_rect)
                            coordinates = [
                                [sw_lng, sw_lat],
                                [ne_lng, sw_lat],
                                [ne_lng, ne_lat],
                                [sw_lng, ne_lat],
                                [sw_lng, sw_lat]  # 闭合多边形
                            ]
                            geometry_type = 'Polygon'
                    
                    elif area_type == 2:  # 圆形
                        if record['start_point'] and record['end_point']:
                            start = list(map(float, record['start_point'].split(',')))
                            end = list(map(float, record['end_point'].split(',')))
                            # start_point 是圆心，end_point 是圆上任意一点
                            # 假设格式是 "lat,lng"
                            center_lat = start[0]  # 圆心纬度
                            center_lng = start[1]  # 圆心经度
                            center = [center_lng, center_lat]  # GeoJSON格式: [lng, lat]
                            
                            # 计算圆心到圆上点的距离（半径）
                            import math
                            
                            # 使用 Haversine 公式计算两点间距离
                            def haversine_distance(lat1, lon1, lat2, lon2):
                                R = 6371000  # 地球半径（米）
                                lat1_rad = math.radians(lat1)
                                lat2_rad = math.radians(lat2)
                                delta_lat = math.radians(lat2 - lat1)
                                delta_lon = math.radians(lon2 - lon1)
                                
                                a = (math.sin(delta_lat/2)**2 + 
                                     math.cos(lat1_rad) * math.cos(lat2_rad) * 
                                     math.sin(delta_lon/2)**2)
                                c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
                                return R * c
                            
                            # 计算半径（圆心到圆上点的距离）
                            radius = haversine_distance(center_lat, center_lng, end[0], end[1])
                            geometry_type = 'Circle'
                            logger.info(f"  圆形: center={center}, radius={radius}m")
                    
                    elif area_type == 3:  # 多边形
                        if record['area_points']:
                            logger.info(f"  多边形原始数据: {record['area_points']}")
                            points = list(map(float, record['area_points'].split(',')))
                            logger.info(f"  解析后点数组: {points}")
                            if len(points) > 0:
                                point_count = int(points[0])  # 第一个数是点数量
                                logger.info(f"  点数量: {point_count}")
                                coordinates = []
                                # 数据库格式: lat,lng,lat,lng,...
                                # GeoJSON格式: [lng,lat],[lng,lat],...
                                for i in range(1, len(points), 2):
                                    if i + 1 < len(points):
                                        lat = points[i]
                                        lng = points[i + 1]
                                        coordinates.append([lng, lat])  # GeoJSON格式: [lng, lat]
                                logger.info(f"  解析后坐标: {coordinates}")
                                # 闭合多边形
                                if coordinates and coordinates[0] != coordinates[-1]:
                                    coordinates.append(coordinates[0])
                                logger.info(f"  闭合后坐标: {coordinates}")
                            geometry_type = 'Polygon'
                    
                    elif area_type == 4:  # 线
                        if record['area_points']:
                            points = list(map(float, record['area_points'].split(',')))
                            if len(points) > 0:
                                point_count = int(points[0])  # 第一个数是点数量
                                coordinates = []
                                # 数据库格式: lat,lng,lat,lng,...
                                # GeoJSON格式: [lng,lat],[lng,lat],...
                                for i in range(1, len(points), 2):
                                    if i + 1 < len(points):
                                        lat = points[i]
                                        lng = points[i + 1]
                                        coordinates.append([lng, lat])  # GeoJSON格式: [lng, lat]
                            geometry_type = 'LineString'
                    
                    elif area_type == 5:  # 文字
                        if record['start_point']:
                            point = list(map(float, record['start_point'].split(',')))
                            # 数据库格式: lat,lng
                            # GeoJSON格式: [lng, lat]
                            lat = point[0]
                            lng = point[1]
                            coordinates = [lng, lat]  # GeoJSON格式: [lng, lat]
                            geometry_type = 'Point'
                    
                    # 检查坐标是否有效
                    if not coordinates and not center:
                        logger.warning(f"  ⚠️ 区域 [{area_id}] {area_name} 坐标为空，跳过")
                        logger.warning(f"    area_rect={record.get('area_rect')}")
                        logger.warning(f"    area_points={record.get('area_points')}")
                        logger.warning(f"    start_point={record.get('start_point')}")
                        logger.warning(f"    end_point={record.get('end_point')}")
                        continue
                    
                    # 转换颜色格式 (RGB to 十六进制)
                    rgb_hex = '#00ff00'  # 默认绿色
                    if record['line_color']:
                        try:
                            line_color = record['line_color'].split(',')
                            rgb_hex = '#{:02x}{:02x}{:02x}'.format(
                                int(line_color[0]), 
                                int(line_color[1]), 
                                int(line_color[2])
                            )
                        except:
                            pass
                    
                    # 使用 group_id 和 area_id 组合作为唯一ID
                    unique_id = f"{record['group_id']}_{record['area_id']}"
                    
                    area = {
                        "id": unique_id,
                        "areaId": record['area_id'],
                        "groupId": record['group_id'],
                        "groupName": record['group_name'],
                        "name": record['area_name'],
                        # "isActive": record['check_state'],
                        "isActive":1,
                        "areaType": area_type,
                        "geometryType": geometry_type,
                        "warningType": record['waring_type'] if record['waring_type'] else 0,
                        "duration": 120,
                        "fillColor": rgb_hex,
                        "strokeColor": rgb_hex,
                        "strokeWidth": record['line_width'] if record['line_width'] else 2,
                        "coordinates": coordinates,
                        "center": center,  # 圆形专用
                        "radius": radius,  # 圆形专用
                        "createTime": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                        "creator": "system"
                    }
                    logger.info(f"  ✅ 区域 [{area_id}] {area_name} 解析成功，geometryType={geometry_type}, 坐标数={len(coordinates) if isinstance(coordinates, list) else 'N/A'}")
                    result.append(area)
                
                return result
        except Exception as e:
            logger.error(f"获取区域表数据失败: {e}")
            return None

    async def get_alarm_schemes(self) -> Optional[List[Dict[str, Any]]]:
        """
        从 alarm_master_schemes 表获取 enabled=true 的方案列表，供 WebSocket 连接后下发给前端。
        返回字段：scheme_id, scheme_name, description, enabled, is_default 等。
        """
        if not self.pool:
            logger.error("数据库未连接")
            return None
        try:
            async with self.pool.acquire() as conn:
                query = """
                    SELECT scheme_id, scheme_name, description, enabled, is_default,
                           created_by, created_at, updated_at
                    FROM alarm_master_schemes
                    WHERE enabled = true
                    ORDER BY is_default DESC NULLS LAST, created_at ASC
                """
                records = await conn.fetch(query)
                if not records:
                    logger.info("alarm_master_schemes 中无 enabled=true 的记录")
                    return []
                result = []
                for record in records:
                    result.append({
                        "scheme_id": record["scheme_id"],
                        "scheme_name": record["scheme_name"],
                        "description": record["description"] or "",
                        "enabled": bool(record["enabled"]),
                        "is_default": bool(record["is_default"]) if record["is_default"] is not None else False,
                        "created_by": record["created_by"],
                        "created_at": record["created_at"].isoformat() if record["created_at"] else None,
                        "updated_at": record["updated_at"].isoformat() if record["updated_at"] else None,
                    })
                logger.info(f"已加载 {len(result)} 条告警方案（enabled=true）")
                return result
        except Exception as e:
            logger.error(f"获取告警方案表数据失败: {e}")
            return None

    def _row_to_hanging_image_info(self, result) -> Optional[Dict[str, Any]]:
        """将 minio_multi_metadata 一行转为前端/HTTP 使用的字典（含检测框与相机字段）。"""
        if not result:
            return None
        if not result.get("download_url"):
            return None
        uploaded = result.get("uploaded_at")
        image_info: Dict[str, Any] = {
            "id": result["id"],
            "fileName": result["file_name"],
            "bucketName": result["minio_bucket"],
            "objectKey": result["minio_object_key"],
            "fileSize": result["size_bytes"],
            "contentType": result["mime_type"],
            "uploadedAt": uploaded.isoformat() if uploaded else None,
            "uniqueId": result.get("unique_id"),
            "trackId": result.get("trackid"),
            "downloadUrl": result["download_url"],
            "imageUrl": result["download_url"],
            # 检测框与标注
            "rectId": result.get("rect_id"),
            "rectX": result.get("rect_x"),
            "rectY": result.get("rect_y"),
            "rectWidth": result.get("rect_width"),
            "rectHeight": result.get("rect_height"),
            "cameraIndex": result.get("camera_index"),
            "camP": result.get("cam_p"),
            "camT": result.get("cam_t"),
            "camZ": result.get("cam_z"),
            "camVis": result.get("cam_vis"),
            "camFocus": result.get("cam_focus"),
            "trackTime": result.get("track_time"),
            "targetType": result.get("target_type"),
            "modal": result.get("modal"),
            "reid": result.get("reid"),
        }
        return image_info

    async def get_hanging_image(self, unique_id: str, track_id: str) -> Optional[Dict[str, Any]]:
        """根据 uniqueID 或 trackID 查询 minio_multi_metadata（含检测框、相机等字段）。"""
        if not self.pool:
            logger.error("数据库连接未建立")
            return None

        unique_id_int = None
        track_id_int = None
        try:
            if unique_id and str(unique_id).strip():
                unique_id_int = int(unique_id)
        except (ValueError, TypeError):
            unique_id_int = None
        try:
            if track_id and str(track_id).strip():
                track_id_int = int(track_id)
        except (ValueError, TypeError):
            track_id_int = None

        if unique_id_int is None and track_id_int is None:
            logger.info("get_hanging_image: unique_id 与 track_id 均无效")
            return None

        # 注意：unique_id 为 int8，trackid 为 int2/int4（以库表为准）
        base_select = """
                SELECT id, file_name, mime_type, minio_bucket, minio_object_key,
                       size_bytes, download_url, uploaded_at, unique_id, trackid,
                       rect_id, rect_x, rect_y, rect_width, rect_height,
                       camera_index, cam_p, cam_t, cam_z, cam_vis, cam_focus,
                       track_time, target_type, modal, reid
                FROM minio_multi_metadata
        """
        time_filter = " AND uploaded_at >= NOW() - INTERVAL '10 minutes'"

        try:
            result = None
            if unique_id_int is not None:
                query = (
                    base_select
                    + """
                WHERE unique_id = $1
                """
                    + time_filter
                    + """
                ORDER BY uploaded_at DESC
                LIMIT 1
                """
                )
                result = await self.pool.fetchrow(query, unique_id_int)
            elif track_id_int is not None:
                query = (
                    base_select
                    + """
                WHERE trackid = $1
                """
                    + time_filter
                    + """
                ORDER BY uploaded_at DESC
                LIMIT 1
                """
                )
                result = await self.pool.fetchrow(query, track_id_int)

            if not result:
                logger.info(f"未找到图片: uniqueId={unique_id}, trackId={track_id}")
                return None

            image_info = self._row_to_hanging_image_info(result)
            if not image_info:
                logger.info(f"未找到图片或缺少 download_url: uniqueId={unique_id}, trackId={track_id}")
                return None

            logger.info(
                f"获取图片成功: uniqueId={unique_id}, trackId={track_id}, fileName={result['file_name']}"
            )
            return image_info

        except Exception as e:
            logger.error(f"获取hanging图片失败: {e}")
            return None

    async def fetch_hanging_image_for_api(self, unique_id: str) -> Dict[str, Any]:
        """
        供 HTTP /image/{unique_id} 使用：查库 → 拉取 imageUrl → 绘制 → 返回最终字段。
        返回 dict：
          成功: {"ok": True, "imageBase64": str, "contentType": str, "fileName", "fileSize", "uniqueId", "trackId"}
          失败: {"ok": False, "reason": "not_found"|"no_url"|"bad_http"|"network", ...}
        """
        image_info = await self.get_hanging_image(unique_id, "")
        if not image_info:
            return {"ok": False, "reason": "not_found"}
        url = image_info.get("imageUrl")
        if not url:
            return {"ok": False, "reason": "no_url"}

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status != 200:
                        return {
                            "ok": False,
                            "reason": "bad_http",
                            "http_status": response.status,
                        }
                    raw = await response.read()
        except aiohttp.ClientError as e:
            logger.error(f"hanging 图片网络拉取失败: {e}")
            return {"ok": False, "reason": "network", "message": str(e)}

        try:
            image_data = self.annotate_hanging_image(raw, image_info)
            mime_type = "image/jpeg"
        except Exception as e:
            logger.warning(f"annotate_hanging_image 失败，返回原图: {e}")
            image_data = raw
            ct = image_info.get("contentType", "image/jpeg")
            if "png" in str(ct).lower():
                mime_type = "image/png"
            elif "gif" in str(ct).lower():
                mime_type = "image/gif"
            else:
                mime_type = "image/jpeg"

        return {
            "ok": True,
            "imageBase64": base64.b64encode(image_data).decode("utf-8"),
            "contentType": mime_type,
            "fileName": image_info.get("fileName"),
            "fileSize": image_info.get("fileSize"),
            "uniqueId": image_info.get("uniqueId"),
            "trackId": image_info.get("trackId"),
        }
