"""
MCP服务模块 - 地图定位服务（标准MCP协议）
提供两个工具：
1. point_location - 点定位，将地图中心移动到指定经纬度
2. area_location - 区域定位，将地图视野调整到指定区域边界

运行模式：stdio模式，通过HTTP调用后端API
"""
import asyncio
import aiohttp
from typing import List, Dict, Any, Sequence

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# 创建MCP服务器实例
mcp = Server("map-location-service")

# 后端服务地址
BACKEND_URL = "http://127.0.0.1:26000"


@mcp.list_tools()
async def list_tools() -> List[Tool]:
    """列出可用的MCP工具"""
    return [
        Tool(
            name="point_location",
            description="点定位 - 将地图中心移动到指定的经纬度坐标位置。用于在地图上定位到某个具体的点。",
            inputSchema={
                "type": "object",
                "properties": {
                    "longitude": {
                        "type": "number",
                        "description": "经度，范围 -180 到 180"
                    },
                    "latitude": {
                        "type": "number",
                        "description": "纬度，范围 -90 到 90"
                    },
                    "zoom": {
                        "type": "number",
                        "description": "缩放级别，范围 0-22，默认为 12"
                    }
                },
                "required": ["longitude", "latitude"]
            }
        ),
        Tool(
            name="area_location",
            description="区域定位 - 将地图视野调整到指定的矩形区域边界。用于显示某个区域的全貌。",
            inputSchema={
                "type": "object",
                "properties": {
                    "sw_longitude": {
                        "type": "number",
                        "description": "西南角经度"
                    },
                    "sw_latitude": {
                        "type": "number",
                        "description": "西南角纬度"
                    },
                    "ne_longitude": {
                        "type": "number",
                        "description": "东北角经度"
                    },
                    "ne_latitude": {
                        "type": "number",
                        "description": "东北角纬度"
                    }
                },
                "required": ["sw_longitude", "sw_latitude", "ne_longitude", "ne_latitude"]
            }
        ),
        Tool(
            name="export_map",
            description="地图导出 - 导出指定经纬度区域的地图图片。",
            inputSchema={
                "type": "object",
                "properties": {
                    "sw_longitude": {
                        "type": "number",
                        "description": "西南角经度"
                    },
                    "sw_latitude": {
                        "type": "number",
                        "description": "西南角纬度"
                    },
                    "ne_longitude": {
                        "type": "number",
                        "description": "东北角经度"
                    },
                    "ne_latitude": {
                        "type": "number",
                        "description": "东北角纬度"
                    },
                    "width": {
                        "type": "integer",
                        "description": "图片宽度（像素），默认1920"
                    },
                    "height": {
                        "type": "integer",
                        "description": "图片高度（像素），默认1080"
                    },
                    "format": {
                        "type": "string",
                        "description": "图片格式：png或jpg，默认png"
                    }
                },
                "required": ["sw_longitude", "sw_latitude", "ne_longitude", "ne_latitude"]
            }
        ),
        Tool(
            name="add_marker",
            description="地图标记 - 在地图上添加点标记、多边形或矩形区域，并保存图形数据。",
            inputSchema={
                "type": "object",
                "properties": {
                    "marker_type": {
                        "type": "string",
                        "description": "标记类型：point（点）、polygon（多边形）、rectangle（矩形）"
                    },
                    "coordinates": {
                        "type": "array",
                        "description": "坐标数组。点：[lng, lat]；多边形：[[lng1, lat1], [lng2, lat2], ...]；矩形：[[sw_lng, sw_lat], [ne_lng, ne_lat]]"
                    },
                    "properties": {
                        "type": "object",
                        "description": "标记属性，如名称、颜色、描述等"
                    },
                    "save": {
                        "type": "boolean",
                        "description": "是否保存到数据库，默认true"
                    }
                },
                "required": ["marker_type", "coordinates"]
            }
        ),
        Tool(
            name="measure",
            description="测量 - 测量两个或多个点之间的直线距离，计算多边形区域的面积，或测量三个点之间的角度。",
            inputSchema={
                "type": "object",
                "properties": {
                    "measure_type": {
                        "type": "string",
                        "description": "测量类型：distance（距离）、area（面积）或angle（角度）"
                    },
                    "coordinates": {
                        "type": "array",
                        "description": "坐标数组。距离：[[lng1, lat1], [lng2, lat2], ...]；面积：[[lng1, lat1], [lng2, lat2], ...]（多边形）；角度：[[lng1, lat1], [vertex_lng, vertex_lat], [lng3, lat3]]"
                    }
                },
                "required": ["measure_type", "coordinates"]
            }
        ),
        Tool(
            name="query_features",
            description="查询 - 查询在某个点一定半径内、或在某个多边形区域内的所有要素，或某个ID一段时间内的数据。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query_type": {
                        "type": "string",
                        "description": "查询类型：radius（半径查询）、polygon（多边形查询）、timeline（时间线查询）"
                    },
                    "center": {
                        "type": "array",
                        "description": "中心点坐标 [lng, lat]（半径查询用）"
                    },
                    "radius": {
                        "type": "number",
                        "description": "半径（米）（半径查询用）"
                    },
                    "polygon": {
                        "type": "array",
                        "description": "多边形坐标数组（多边形查询用）"
                    },
                    "feature_id": {
                        "type": "string",
                        "description": "要素ID（时间线查询用）"
                    },
                    "start_time": {
                        "type": "string",
                        "description": "开始时间（ISO格式）"
                    },
                    "end_time": {
                        "type": "string",
                        "description": "结束时间（ISO格式）"
                    }
                },
                "required": ["query_type"]
            }
        ),
        Tool(
            name="traffic_analysis",
            description="流量分析 - 分析某点或某区域在一定时间内的流量，生成带透明度的热力图叠加在地图上。",
            inputSchema={
                "type": "object",
                "properties": {
                    "analysis_type": {
                        "type": "string",
                        "description": "分析类型：point（点分析）或area（区域分析）"
                    },
                    "center": {
                        "type": "array",
                        "description": "中心点坐标 [lng, lat]（点分析用）"
                    },
                    "radius": {
                        "type": "number",
                        "description": "半径（米）（点分析用）"
                    },
                    "polygon": {
                        "type": "array",
                        "description": "多边形坐标数组（区域分析用）"
                    },
                    "start_time": {
                        "type": "string",
                        "description": "开始时间（ISO格式）"
                    },
                    "end_time": {
                        "type": "string",
                        "description": "结束时间（ISO格式）"
                    },
                    "grid_size": {
                        "type": "integer",
                        "description": "网格大小（米），默认100"
                    }
                },
                "required": ["analysis_type", "start_time", "end_time"]
            }
        ),
        Tool(
            name="compare_analysis",
            description="对比分析 - 在流量分析的基础上，生成多个时间段的流量图进行对比，在前端轮播显示。",
            inputSchema={
                "type": "object",
                "properties": {
                    "analysis_type": {
                        "type": "string",
                        "description": "分析类型：point（点分析）或area（区域分析）"
                    },
                    "center": {
                        "type": "array",
                        "description": "中心点坐标 [lng, lat]（点分析用）"
                    },
                    "radius": {
                        "type": "number",
                        "description": "半径（米）（点分析用）"
                    },
                    "polygon": {
                        "type": "array",
                        "description": "多边形坐标数组（区域分析用）"
                    },
                    "time_ranges": {
                        "type": "array",
                        "description": "时间范围数组，每个元素包含start_time和end_time"
                    },
                    "grid_size": {
                        "type": "integer",
                        "description": "网格大小（米），默认100"
                    }
                },
                "required": ["analysis_type", "time_ranges"]
            }
        ),
        Tool(
            name="render_path",
            description="路径渲染 - 给定一组轨迹数据，在前端地图上显示路径。",
            inputSchema={
                "type": "object",
                "properties": {
                    "path_data": {
                        "type": "array",
                        "description": "路径数据数组，每个元素包含经纬度和时间戳"
                    },
                    "style": {
                        "type": "object",
                        "description": "路径样式，如颜色、宽度、透明度等"
                    },
                    "animate": {
                        "type": "boolean",
                        "description": "是否动画显示，默认false"
                    }
                },
                "required": ["path_data"]
            }
        ),
        Tool(
            name="send_alert",
            description="预警 - 发送预警信息，在前端右上角独立窗口显示。",
            inputSchema={
                "type": "object",
                "properties": {
                    "alert_type": {
                        "type": "string",
                        "description": "预警类型：info、warning、error、critical"
                    },
                    "title": {
                        "type": "string",
                        "description": "预警标题"
                    },
                    "message": {
                        "type": "string",
                        "description": "预警消息内容"
                    },
                    "location": {
                        "type": "array",
                        "description": "预警位置坐标 [lng, lat]（可选）"
                    },
                    "duration": {
                        "type": "integer",
                        "description": "显示时长（毫秒），0表示不自动关闭，默认5000"
                    }
                },
                "required": ["alert_type", "title", "message"]
            }
        ),
        Tool(
            name="clear_map",
            description="清除地图 - 清除地图上所有或指定类型的渲染元素。",
            inputSchema={
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "清除目标：all（全部）、markers（标记点）、polygons（多边形）、paths（路径）、alerts（预警）、heatmaps（热力图）、measurements（测量元素）、queries（查询结果）"
                    },
                    "clear_all_layers": {
                        "type": "boolean",
                        "description": "是否清除所有图层（包括非MCP图层），默认false"
                    }
                },
                "required": ["target"]
            }
        )
    ]


@mcp.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> Sequence[TextContent]:
    """处理MCP工具调用"""
    print(f"[MCP] 工具被调用: {name}, 参数: {arguments}")
    
    try:
        if name == "point_location":
            result = await handle_point_location(arguments)
        elif name == "area_location":
            result = await handle_area_location(arguments)
        elif name == "export_map":
            result = await handle_export_map(arguments)
        elif name == "add_marker":
            result = await handle_add_marker(arguments)
        elif name == "measure":
            result = await handle_measure(arguments)
        elif name == "query_features":
            result = await handle_query_features(arguments)
        elif name == "traffic_analysis":
            result = await handle_traffic_analysis(arguments)
        elif name == "compare_analysis":
            result = await handle_compare_analysis(arguments)
        elif name == "render_path":
            result = await handle_render_path(arguments)
        elif name == "send_alert":
            result = await handle_send_alert(arguments)
        elif name == "clear_map":
            result = await handle_clear_map(arguments)
        else:
            return [TextContent(type="text", text=f"错误：未知的工具 {name}")]
        
        return [TextContent(type="text", text=result["message"] if result["success"] else f"错误：{result['error']}")]
    except Exception as e:
        print(f"[MCP] 工具调用失败: {e}")
        return [TextContent(type="text", text=f"错误：{str(e)}")]


async def handle_point_location(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理点定位请求 - 通过HTTP发送到后端"""
    longitude = args.get("longitude")
    latitude = args.get("latitude")
    zoom = args.get("zoom", 12)
    
    print(f"[MCP] 点定位: 经度={longitude}, 纬度={latitude}, zoom={zoom}")
    
    # 通过HTTP请求发送到后端
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/point_location",
                json={
                    "longitude": longitude,
                    "latitude": latitude,
                    "zoom": zoom,
                    "animate": True,
                    "duration": 1500
                },
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                print(f"[MCP] 后端响应状态: {response.status}")
                if response.status == 200:
                    return {
                        "success": True,
                        "message": f"已定位到: 经度 {longitude}, 纬度 {latitude}, 缩放级别 {zoom}"
                    }
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        print(f"[MCP] HTTP请求失败: {e}")
        return {"success": False, "error": f"无法连接后端服务: {str(e)}"}


async def handle_area_location(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理区域定位请求 - 通过HTTP发送到后端"""
    sw_lng = args.get("sw_longitude")
    sw_lat = args.get("sw_latitude")
    ne_lng = args.get("ne_longitude")
    ne_lat = args.get("ne_latitude")
    
    print(f"[MCP] 区域定位: SW({sw_lng}, {sw_lat}) - NE({ne_lng}, {ne_lat})")
    
    # 通过HTTP请求发送到后端
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/area_location",
                json={
                    "sw_longitude": sw_lng,
                    "sw_latitude": sw_lat,
                    "ne_longitude": ne_lng,
                    "ne_latitude": ne_lat,
                    "padding": 50,
                    "animate": True,
                    "duration": 1500
                },
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                print(f"[MCP] 后端响应状态: {response.status}")
                if response.status == 200:
                    return {
                        "success": True,
                        "message": f"已定位到区域: 西南角({sw_lng}, {sw_lat}), 东北角({ne_lng}, {ne_lat})"
                    }
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        print(f"[MCP] HTTP请求失败: {e}")
        return {"success": False, "error": f"无法连接后端服务: {str(e)}"}


async def handle_export_map(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理地图导出请求"""
    print(f"[MCP] 地图导出: {args}")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/export_map",
                json=args,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    return {"success": True, "message": result.get("message", "地图导出成功")}
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        return {"success": False, "error": f"请求失败: {str(e)}"}


async def handle_add_marker(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理地图标记请求"""
    print(f"[MCP] 地图标记: {args}")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/add_marker",
                json=args,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    return {"success": True, "message": f"已添加{args.get('marker_type')}标记"}
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        return {"success": False, "error": f"请求失败: {str(e)}"}


async def handle_measure(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理测量请求"""
    print(f"[MCP] 测量: {args}")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/measure",
                json=args,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    return {"success": True, "message": result.get("message", "测量完成")}
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        return {"success": False, "error": f"请求失败: {str(e)}"}


async def handle_query_features(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理要素查询请求"""
    print(f"[MCP] 要素查询: {args}")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/query_features",
                json=args,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    count = result.get("data", {}).get("count", 0)
                    return {"success": True, "message": f"查询完成，找到{count}个要素"}
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        return {"success": False, "error": f"请求失败: {str(e)}"}


async def handle_traffic_analysis(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理流量分析请求"""
    print(f"[MCP] 流量分析: {args}")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/traffic_analysis",
                json=args,
                timeout=aiohttp.ClientTimeout(total=60)
            ) as response:
                if response.status == 200:
                    return {"success": True, "message": "流量分析完成，热力图已生成"}
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        return {"success": False, "error": f"请求失败: {str(e)}"}


async def handle_compare_analysis(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理对比分析请求"""
    print(f"[MCP] 对比分析: {args}")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/compare_analysis",
                json=args,
                timeout=aiohttp.ClientTimeout(total=120)
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    count = result.get("data", {}).get("image_count", 0)
                    return {"success": True, "message": f"对比分析完成，生成{count}张对比图"}
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        return {"success": False, "error": f"请求失败: {str(e)}"}


async def handle_render_path(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理路径渲染请求"""
    print(f"[MCP] 路径渲染: {args}")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/render_path",
                json=args,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    return {"success": True, "message": "路径渲染指令已发送"}
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        return {"success": False, "error": f"请求失败: {str(e)}"}


async def handle_send_alert(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理预警请求"""
    print(f"[MCP] 预警: {args}")

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/send_alert",
                json=args,
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                if response.status == 200:
                    return {"success": True, "message": f"预警已发送: {args.get('title')}"}
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        return {"success": False, "error": f"请求失败: {str(e)}"}


async def handle_clear_map(args: Dict[str, Any]) -> Dict[str, Any]:
    """处理地图清除请求"""
    target = args.get("target", "all")
    clear_all_layers = args.get("clear_all_layers", False)

    print(f"[MCP] 清除地图: 目标={target}, 清除所有图层={clear_all_layers}")

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/map/clear",
                json={
                    "target": target,
                    "clear_all_layers": clear_all_layers
                },
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                if response.status == 200:
                    target_desc = {
                        "all": "所有渲染元素",
                        "markers": "标记点",
                        "polygons": "多边形",
                        "paths": "路径",
                        "alerts": "预警",
                        "heatmaps": "热力图",
                        "measurements": "测量元素",
                        "queries": "查询结果"
                    }.get(target, target)
                    return {"success": True, "message": f"已清除{target_desc}"}
                else:
                    return {"success": False, "error": f"后端返回错误: {response.status}"}
    except Exception as e:
        return {"success": False, "error": f"请求失败: {str(e)}"}


async def run_stdio_server():
    """以stdio模式运行MCP服务器"""
    print("[MCP] 启动MCP服务器...")
    async with stdio_server() as (read_stream, write_stream):
        await mcp.run(
            read_stream,
            write_stream,
            mcp.create_initialization_options()
        )


if __name__ == "__main__":
    asyncio.run(run_stdio_server())
