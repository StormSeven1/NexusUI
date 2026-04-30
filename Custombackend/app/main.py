"""
主程序入口 - 航迹数据中继服务
功能：
1. 支持UDP组播/单播/广播、DDS、MQTT、TCPClient、HTTP接收数据
2. 解析数据并通过WebSocket批量发送
3. 提供HTTP服务接口
4. 查询数据库区域表
"""
import sys
import signal
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from loguru import logger

from config import (
    get_settings, 
    UDP_RECEIVERS, 
    TCP_CLIENTS, 
    MQTT_RECEIVERS, 
    DDS_RECEIVERS, 
    HTTP_POLLERS
)
from database import DatabaseManager
from websocket_manager import ws_manager
from receivers.receiver_manager import receiver_manager
from http_api import router as api_router, set_db_manager
from camera_task_routes import router as camera_tasks_router, router_singular_alias as camera_task_singular_router

import os

# DDS 接收器周期性打印间隔（秒）；设为 0 则不打印与启动统计任务
_RECEIVER_STATS_LOG_INTERVAL_SEC = int(os.environ.get("RECEIVER_STATS_LOG_INTERVAL_SEC", "30"))


async def _receiver_stats_log_loop():
    """定时输出 receiver_manager.get_stats()"""
    while True:
        try:
            stats = receiver_manager.get_stats()
            cam = stats.get("dds_camera_status")
            if cam:
                logger.info(
                    "[receiver_stats] dds_camera_status received={} parsed={} failed={}",
                    cam.get("received", 0),
                    cam.get("parsed", 0),
                    cam.get("failed", 0),
                )
            elif _RECEIVER_STATS_LOG_INTERVAL_SEC > 0:
                logger.info(
                    "[receiver_stats] 尚无 dds_camera_status | 当前计数键: {}",
                    sorted(stats.keys()),
                )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("[receiver_stats] 读取统计失败: {}", e)
        await asyncio.sleep(max(5, _RECEIVER_STATS_LOG_INTERVAL_SEC))

# MCP服务独立运行，不需要导入

# 接收器 stats 后台任务（lifespan 内 cancel）
_receiver_stats_task: Optional[asyncio.Task] = None

# 配置日志
log_dir = Path("logs")
log_dir.mkdir(exist_ok=True)

logger.remove()
logger.add(
    sys.stderr,
    level="INFO",
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
)
logger.add(
    log_dir / "app.{time:YYYY-MM-DD}.log",
    rotation="1 day",
    retention="7 days",
    level="INFO",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    encoding="utf-8"
)

settings = get_settings()

# 数据库管理器
db_manager: DatabaseManager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global db_manager, _receiver_stats_task
    
    logger.info("=" * 60)
    logger.info("启动航迹数据中继服务")
    logger.info("=" * 60)
    
    # 初始化数据库（可选，失败不影响WebSocket服务）
    try:
        logger.info("正在连接数据库...")
        db_manager = DatabaseManager({
            'host': settings.DATABASE_HOST,
            'port': settings.DATABASE_PORT,
            'database': settings.DATABASE_NAME,
            'user': settings.DATABASE_USER,
            'password': settings.DATABASE_PASSWORD
        })
        
        db_connected = await db_manager.connect()
        if db_connected:
            # 设置HTTP API的数据库管理器
            set_db_manager(db_manager)
            
            # 获取区域数据
            area_data = await db_manager.get_area_table()
            if area_data:
                ws_manager.set_area_data(area_data)
                logger.info(f"已加载 {len(area_data)} 条区域数据")
            # 获取告警方案数据（alarm_master_schemes，enabled=true）
            schemes_data = await db_manager.get_alarm_schemes()
            if schemes_data is not None:
                ws_manager.set_schemes_data(schemes_data)
                logger.info(f"已加载 {len(schemes_data)} 条告警方案")
        else:
            logger.warning("数据库连接失败，区域数据功能不可用")
    except Exception as e:
        logger.warning(f"数据库初始化失败: {e}，服务将继续运行但区域数据功能不可用")
        db_manager = None
    
    # 配置接收器管理器
    receiver_manager.local_interface = settings.LOCAL_INTERFACE
    
    # 启动WebSocket任务
    ws_manager.heartbeat_interval = settings.HEARTBEAT_INTERVAL
    ws_manager.broadcast_interval = settings.BROADCAST_INTERVAL
    ws_manager.start_tasks()
    
    logger.info("MCP地图定位服务可通过 /api/map/* 接口调用")
    
    # 启动UDP接收器
    logger.info("正在启动UDP接收器...")
    receiver_manager.start_udp_receivers(UDP_RECEIVERS)
    
    # 启动TCP客户端
    logger.info("正在启动TCP客户端...")
    receiver_manager.start_tcp_clients(TCP_CLIENTS)
    
    # 启动MQTT接收器
    logger.info("正在启动MQTT接收器...")
    receiver_manager.start_mqtt_receivers(MQTT_RECEIVERS)
    
    # 启动DDS接收器
    logger.info("正在启动DDS接收器...")
    receiver_manager.start_dds_receivers(DDS_RECEIVERS)
    
    # 启动HTTP轮询器
    logger.info("正在启动HTTP轮询器...")
    await receiver_manager.start_http_pollers(HTTP_POLLERS)

    if _RECEIVER_STATS_LOG_INTERVAL_SEC > 0:
        _receiver_stats_task = asyncio.create_task(_receiver_stats_log_loop())
    
    logger.info("=" * 60)
    logger.info(f"服务已启动: http://{settings.HOST}:{settings.PORT}")
    logger.info(f"WebSocket端点: ws://{settings.HOST}:{settings.PORT}/ws")
    logger.info("=" * 60)
    
    yield
    
    # 关闭服务
    logger.info("正在关闭服务...")

    if _receiver_stats_task is not None:
        _receiver_stats_task.cancel()
        try:
            await _receiver_stats_task
        except asyncio.CancelledError:
            pass
        finally:
            _receiver_stats_task = None
    
    # 停止接收器
    receiver_manager.stop_all()
    await receiver_manager.stop_http_pollers()
    
    # 停止WebSocket任务
    ws_manager.stop_tasks()
    
    # 关闭数据库
    if db_manager:
        await db_manager.close()
    
    logger.info("服务已关闭")


# 创建FastAPI应用
app = FastAPI(
    title="航迹数据中继服务",
    description="接收多种数据源的航迹数据，统一格式后通过WebSocket广播",
    version="1.0.0",
    lifespan=lifespan
)

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册API路由
app.include_router(api_router, prefix="/api")
app.include_router(camera_tasks_router, prefix="/api")
app.include_router(camera_task_singular_router, prefix="/api")


# WebSocket端点
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket连接端点"""
    # 显式接受所有Origin（开发环境）
    # 生产环境应该验证Origin
    origin = websocket.headers.get("origin", "*")
    logger.info(f"WebSocket连接请求，Origin: {origin}")
    
    await ws_manager.handle_connection(websocket)


# 信号处理
def signal_handler(signum, frame):
    logger.info("收到中断信号，正在退出...")
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    
    logger.info(f"正在启动服务器: {settings.HOST}:{settings.PORT}")
    
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False,
        log_level="info",
        access_log=True
    )
