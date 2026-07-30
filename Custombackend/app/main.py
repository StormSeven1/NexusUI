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
from functools import partial
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
    DDS_CAMERA_STATUS_MODE,
    DRONE_STATUS_GRPC_RECEIVERS,
    DRONE_STATUS_TRANSPORT,
    HTTP_POLLERS,
    WORK_MODE_DDS_PUBLISHER,
)
from database import DatabaseManager
from websocket_manager import ws_manager
from receivers.receiver_manager import receiver_manager
from http_api import router as api_router, set_db_manager
from camera_task_routes import router as camera_tasks_router, router_singular_alias as camera_task_singular_router
from system_eval_routes import router as system_eval_router
from radar_train_routes import router as radar_train_router
from bird_radar_capture_routes import router as bird_radar_capture_router
from auth.config import get_auth_settings
from auth.middleware import KeycloakAuthMiddleware
from auth.routes import router as auth_router
from auth.jwt_validator import verify_access_token

import os

# DDS 接收器周期性打印间隔（秒）；设为 0 则不打印与启动统计任务
_RECEIVER_STATS_LOG_INTERVAL_SEC = int(os.environ.get("RECEIVER_STATS_LOG_INTERVAL_SEC", "30"))


async def _receiver_stats_log_loop():
    """定时输出 receiver_manager.get_stats() 与航迹 DDS 健康度"""
    while True:
        try:
            stats = receiver_manager.get_stats()
            cam_entity = stats.get("dds_camera_status")
            cam_legacy = stats.get("dds_camera_status_legacy")
            if cam_entity or cam_legacy:
                logger.info(
                    "[receiver_stats] dds_camera_status(entity/200) received={} parsed={} failed={} | "
                    "dds_camera_status_legacy(149) received={} parsed={} failed={}",
                    (cam_entity or {}).get("received", 0),
                    (cam_entity or {}).get("parsed", 0),
                    (cam_entity or {}).get("failed", 0),
                    (cam_legacy or {}).get("received", 0),
                    (cam_legacy or {}).get("parsed", 0),
                    (cam_legacy or {}).get("failed", 0),
                )
            fuse_bird = stats.get("dds_forward_fuse_bird_radar_track")
            fuse_sea = stats.get("dds_forward_fuse_track")
            if fuse_bird or fuse_sea:
                logger.info(
                    "[receiver_stats] 航迹 dds_forward_fuse_bird_radar_track received={} | dds_forward_fuse_track received={}",
                    (fuse_bird or {}).get("received", 0),
                    (fuse_sea or {}).get("received", 0),
                )
            health = receiver_manager.get_dds_track_health()
            if not health.get("any_matched") and not health.get("any_received"):
                logger.warning(
                    "[receiver_stats] 航迹 DDS 尚无 matched/样本 | subscription_matched={}",
                    health.get("subscription_matched"),
                )
            elif _RECEIVER_STATS_LOG_INTERVAL_SEC > 0 and not cam_entity and not cam_legacy and not fuse_bird and not fuse_sea:
                logger.info(
                    "[receiver_stats] 当前计数键: {}",
                    sorted(stats.keys()),
                )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("[receiver_stats] 读取统计失败: {}", e)
        await asyncio.sleep(max(5, _RECEIVER_STATS_LOG_INTERVAL_SEC))


async def _dds_track_startup_health_check():
    """启动后延迟自检：航迹 DDS 未 matched 时明确告警（与相机/target_id 改动解耦）。"""
    await asyncio.sleep(20)
    health = receiver_manager.get_dds_track_health()
    if health.get("any_received"):
        logger.info(
            "[dds_track_health] 航迹 DDS 正常，已收到样本: {}",
            {k: v for k, v in health.get("received", {}).items() if v > 0},
        )
        return
    if health.get("any_matched"):
        logger.warning(
            "[dds_track_health] 航迹 DDS 已 matched 但尚无样本，subscription_matched={}",
            health.get("subscription_matched"),
        )
        return
    logger.error(
        "[dds_track_health] 航迹 DDS 异常：启动 20s 后仍无 matched/样本。"
        " 航迹已在独立子进程（mode={}），与相机/target_id 解耦。"
        " 发布端正常时请：1) docker restart casia-fastdds-discovery 后重启 xk_docker；"
        "2) curl /api/status 看 dds_track_health.worker_alive。"
        " subscription_matched={}",
        health.get("mode"),
        health.get("subscription_matched"),
    )

# MCP服务独立运行，不需要导入

# 接收器 stats 后台任务（lifespan 内 cancel）
_receiver_stats_task: Optional[asyncio.Task] = None
_dds_track_bridge_task: Optional[asyncio.Task] = None
_work_mode_repeat_task: Optional[asyncio.Task] = None


async def _work_mode_dds_repeat_loop():
    """按 WORK_MODE_DDS_PUBLISHER.repeat_interval_sec 重复发布当前系统模式（默认 10s）。"""
    from work_mode_dds import (
        get_effective_work_mode,
        publish_work_mode,
        work_mode_dds_enabled,
    )

    interval = int(WORK_MODE_DDS_PUBLISHER.get("repeat_interval_sec", 10) or 0)
    if interval <= 0:
        return

    while True:
        try:
            if work_mode_dds_enabled():
                mode = get_effective_work_mode()
                await asyncio.to_thread(
                    partial(publish_work_mode, mode, quiet=True)
                )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(f"系统模式 DDS 周期发布失败: {e}")
        await asyncio.sleep(interval)

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
    global db_manager, _receiver_stats_task, _work_mode_repeat_task
    
    logger.info("=" * 60)
    logger.info("启动航迹数据中继服务")
    logger.info("=" * 60)

    from radar_train.label_store import label_store
    from radar_train.service import configure as configure_radar_train
    from radar_train.csv_recorder import capture_manager
    label_store._ttl_sec = max(60, int(settings.RADAR_TRAIN_LABEL_TTL_SEC))
    label_store._persist = bool(settings.RADAR_TRAIN_LABEL_PERSIST)
    capture_manager.auto_idle_sec = max(30, int(settings.BIRD_RADAR_CAPTURE_IDLE_SEC))
    capture_manager.qualifying_fresh_sec = max(3.0, float(settings.BIRD_RADAR_QUALIFYING_FRESH_SEC))
    configure_radar_train(enabled=bool(settings.ENABLE_RADAR_TRAIN_LABEL_COLLECT))
    logger.info(
        "雷达训练真值: enabled={} idle_stop={}s fresh={}s ttl={}s",
        settings.ENABLE_RADAR_TRAIN_LABEL_COLLECT,
        settings.BIRD_RADAR_CAPTURE_IDLE_SEC,
        settings.BIRD_RADAR_QUALIFYING_FRESH_SEC,
        settings.RADAR_TRAIN_LABEL_TTL_SEC,
    )
    
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
    
    # 启动DDS接收器（航迹主要来自 config.DDS_RECEIVERS；无 fastdds 时全部跳过）
    logger.info(
        "相机 DDS 订阅模式 NEXUS_DDS_CAMERA_STATUS_MODE={} "
        "(dds_camera_status/200={}, dds_camera_status_legacy/149={})",
        DDS_CAMERA_STATUS_MODE,
        any(c.get("id") == "dds_camera_status" and c.get("enabled") for c in DDS_RECEIVERS),
        any(c.get("id") == "dds_camera_status_legacy" and c.get("enabled") for c in DDS_RECEIVERS),
    )
    logger.info("正在启动DDS接收器...")
    receiver_manager.start_dds_receivers(DDS_RECEIVERS)
    logger.info(
        "无人机状态通道 NEXUS_DRONE_STATUS_TRANSPORT={} "
        "(dds_drone_status/task/high_freq={}, grpc_sources={})",
        DRONE_STATUS_TRANSPORT,
        any(
            c.get("id") in ("dds_drone_status", "dds_drone_task", "dds_high_freq") and c.get("enabled")
            for c in DDS_RECEIVERS
        ),
        [c.get("id") for c in DRONE_STATUS_GRPC_RECEIVERS if c.get("enabled")],
    )
    receiver_manager.start_entity_status_grpc_receivers(DRONE_STATUS_GRPC_RECEIVERS)
    from receivers.network import DDS_AVAILABLE as _dds_py_ok
    dds_enabled_cfg = sum(1 for c in DDS_RECEIVERS if c.get("enabled", False))
    dds_started = len(receiver_manager.dds_receivers)
    if dds_enabled_cfg and dds_started == 0:
        logger.error(
            "航迹告警：配置了 {} 个启用的 DDS 源，但实际启动 0 个；"
            "请检查上方 DDS / fastdds 相关日志并使用含 FastDDS 的 Docker 镜像。",
            dds_enabled_cfg,
        )
    elif _dds_py_ok and dds_started:
        logger.info("DDS 接收器已成功启动 {} 路（航迹可走 DDS → WebSocket）", dds_started)
        asyncio.create_task(_dds_track_startup_health_check())
        from receivers.network.dds_track_bridge import get_track_bridge, track_bridge_poll_loop
        global _dds_track_bridge_task
        if get_track_bridge().is_running:
            _dds_track_bridge_task = asyncio.create_task(track_bridge_poll_loop(get_track_bridge()))
    
    # 启动HTTP轮询器
    logger.info("正在启动HTTP轮询器...")
    await receiver_manager.start_http_pollers(HTTP_POLLERS)

    if _RECEIVER_STATS_LOG_INTERVAL_SEC > 0:
        _receiver_stats_task = asyncio.create_task(_receiver_stats_log_loop())

    _wm_interval = int(WORK_MODE_DDS_PUBLISHER.get("repeat_interval_sec", 10) or 0)
    if WORK_MODE_DDS_PUBLISHER.get("enabled", True) and _wm_interval > 0:
        _work_mode_repeat_task = asyncio.create_task(_work_mode_dds_repeat_loop())
        logger.info(
            "系统模式 DDS 周期发布: 每 {}s（未手动设置时使用 default_mode_key）",
            _wm_interval,
        )

    logger.info("=" * 60)
    logger.info(f"服务已启动: http://{settings.HOST}:{settings.PORT}")
    logger.info(f"WebSocket端点: ws://{settings.HOST}:{settings.PORT}/ws")
    logger.info("=" * 60)
    
    yield
    
    # 关闭服务
    logger.info("正在关闭服务...")

    if _dds_track_bridge_task is not None:
        _dds_track_bridge_task.cancel()
        try:
            await _dds_track_bridge_task
        except asyncio.CancelledError:
            pass
        finally:
            _dds_track_bridge_task = None

    if _receiver_stats_task is not None:
        _receiver_stats_task.cancel()
        try:
            await _receiver_stats_task
        except asyncio.CancelledError:
            pass
        finally:
            _receiver_stats_task = None

    if _work_mode_repeat_task is not None:
        _work_mode_repeat_task.cancel()
        try:
            await _work_mode_repeat_task
        except asyncio.CancelledError:
            pass
        finally:
            _work_mode_repeat_task = None

    try:
        from work_mode_dds import shutdown_work_mode_publisher
        shutdown_work_mode_publisher()
    except Exception as e:
        logger.warning(f"关闭系统模式 DDS 发布器: {e}")

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

# Keycloak JWT：AUTH_ENABLED=false 时整段跳过（先注册 = 内层）
app.add_middleware(KeycloakAuthMiddleware)

# CORS 后注册 = 最外层，确保 401 响应也带 CORS 头；OPTIONS 预检在鉴权内放行
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册API路由
app.include_router(api_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(camera_tasks_router, prefix="/api")
app.include_router(camera_task_singular_router, prefix="/api")
app.include_router(system_eval_router, prefix="/api")
app.include_router(radar_train_router, prefix="/api")
app.include_router(bird_radar_capture_router, prefix="/api")

_auth_boot = get_auth_settings()
logger.info(
    "Keycloak auth: enabled={} realm={} clientId={}",
    _auth_boot.AUTH_ENABLED,
    _auth_boot.KEYCLOAK_REALM,
    _auth_boot.KEYCLOAK_CLIENT_ID,
)


# WebSocket端点
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket连接端点；AUTH_ENABLED 时要求 query token / access_token。"""
    origin = websocket.headers.get("origin", "*")
    logger.info(f"WebSocket连接请求，Origin: {origin}")

    auth = get_auth_settings()
    if auth.AUTH_ENABLED:
        token = (
            websocket.query_params.get("token")
            or websocket.query_params.get("access_token")
            or ""
        ).strip()
        if not token:
            logger.warning("WebSocket 拒绝：缺少 token")
            await websocket.close(code=4401, reason="Missing token")
            return
        try:
            verify_access_token(token)
        except Exception as e:
            logger.warning("WebSocket 拒绝：token 无效 ({})", e)
            await websocket.close(code=4401, reason="Invalid token")
            return

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
