"""
系统工作模式 DDS 发布（WorkModeStatus.idl）

懒加载 DDSPublisherService；首次选择模式时初始化参与者并 publish。
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

from loguru import logger

from config import WORK_MODE_DDS_PUBLISHER

_publisher: Optional[Any] = None
_last_mode: Optional[str] = None

MODE_ALIASES: Dict[str, int] = {
    "emergency": 0,
    "debug": 1,
    "normal": 2,
    "wartime": 3,
}


def work_mode_dds_enabled() -> bool:
    return bool(WORK_MODE_DDS_PUBLISHER.get("enabled", True))


def work_mode_dds_ready_hint() -> str:
    """说明缺少运行时依赖时的提示。"""
    root = os.path.dirname(os.path.abspath(__file__))
    wm = os.path.normpath(
        os.path.join(root, WORK_MODE_DDS_PUBLISHER.get("dds_module_relative_path", "DDSReferences/WorkMode"))
    )
    if not os.path.isdir(wm):
        return f"DDS 模块目录不存在: {wm}"
    so = [f for f in os.listdir(wm) if f.endswith(".so")]
    if not so:
        return "WorkMode 目录下无 .so（请在 DDSReferences/WorkMode 下 cmake 编译生成 Python 绑定）"
    return "FastDDS 不可用或发布器初始化失败（见服务端日志）"


def get_last_published_mode() -> Optional[str]:
    return _last_mode


def get_effective_work_mode() -> str:
    """周期发布使用的模式：已有最后一次发布则用其值，否则用配置 default_mode_key（缺省 normal）。"""
    if _last_mode is not None:
        return _last_mode
    raw = WORK_MODE_DDS_PUBLISHER.get("default_mode_key") or "normal"
    k = str(raw).strip().lower()
    if k not in MODE_ALIASES:
        k = "normal"
    return k


def _build_abs_config() -> Dict[str, Any]:
    root = os.path.dirname(os.path.abspath(__file__))
    rel = WORK_MODE_DDS_PUBLISHER.get("dds_module_relative_path", "DDSReferences/WorkMode")
    dds_path = os.path.normpath(os.path.join(root, rel))
    cfg = dict(WORK_MODE_DDS_PUBLISHER)
    cfg["dds_module_path"] = dds_path
    # structure_type 仅为日志用
    cfg.setdefault("structure_type", "WorkModeStatus")
    return cfg


def _get_publisher():
    global _publisher
    if _publisher is not None:
        return _publisher
    if not work_mode_dds_enabled():
        raise RuntimeError("系统模式 DDS 已在配置中禁用（WORK_MODE_DDS_PUBLISHER.enabled=false）")

    from receivers.network.dds_publisher_service import DDSPublisherService

    if not DDSPublisherService.is_available():
        raise RuntimeError("FastDDS Python 绑定不可用")

    cfg = _build_abs_config()
    path = cfg["dds_module_path"]
    if not os.path.isdir(path):
        raise RuntimeError(f"DDS 模块路径无效: {path}")
    if not any(name.endswith(".so") for name in os.listdir(path)):
        raise RuntimeError(work_mode_dds_ready_hint())

    _publisher = DDSPublisherService(cfg)
    return _publisher


def publish_work_mode(mode_key: str, *, quiet: bool = False) -> str:
    """
    发布一条 WorkModeStatus 样本。

    mode_key: emergency | debug | normal | wartime（大小写不敏感）
    quiet: True 时为周期重复发布，日志用 debug 级别。
    """
    global _last_mode
    k = (mode_key or "").strip().lower()
    if k not in MODE_ALIASES:
        raise ValueError(f"无效模式: {mode_key}，可选: {', '.join(MODE_ALIASES)}")

    idx = MODE_ALIASES[k]
    pub = _get_publisher()
    payload = {
        "work_mode": idx,
        "reserved_str_1": "",
        "reserved_str_2": "",
        "reserved_str_3": "",
    }
    pub.write(payload)
    _last_mode = k
    if quiet:
        logger.debug(f"📤 系统工作模式 DDS（周期）: {k} (enum={idx})")
    else:
        logger.info(f"📤 已发布系统工作模式 DDS: {k} (enum={idx})")
    return k


def shutdown_work_mode_publisher() -> None:
    global _publisher
    if _publisher is None:
        return
    try:
        _publisher.delete()
    except Exception as e:
        logger.warning(f"关闭 WorkMode DDS 发布器时异常: {e}")
    finally:
        _publisher = None
