"""
航迹链路评估：在 queue_track_data 旁路采样 gRPC 航迹的 4 个链路时间戳，
计算各段延迟与更新频率。独立工作线程处理样本，不阻塞航迹广播主路径。

其他系统可通过 HTTP：
  POST /api/system-eval/track-link/trigger
  GET  /api/system-eval/track-link/result?task_id=...
"""
from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

DEFAULT_DURATION_SEC = 30
DEFAULT_MAX_TRACKS_PER_TYPE = 10
# 工作线程队列上限：防止异常洪峰撑爆内存（约 5 万条样本字段）
_FEED_QUEUE_MAX = 50_000
# 「创建→接收」优先采样阈值（用于在已更新航迹中挑选更「新鲜」的）
_CREATE_TO_RECV_PREFER_MAX_MS = 60_000.0
# 至少收到 2 帧才算「更新过」；只出现 1 帧通常是航迹已消失/残留
_MIN_FRAMES_FOR_EVAL = 2
# 候选池上限，避免洪峰占满内存
_MAX_CANDIDATE_TRACKS_PER_TYPE = 300
_MAX_SAMPLES_PER_TRACK = 150

TRACK_LAYER_LABELS: Dict[str, str] = {
    "fuse_sea": "对海融合",
    "fuse_air": "对空融合",
    "radar_wharf": "远遥雷达",
    "radar_jingzi": "靖子头雷达",
    "bird_radar": "探鸟雷达",
    "auto_bird_radar": "探鸟雷达智能跟踪点迹",
    "ais_track": "AIS",
    "uav_pose_track": "无人机位姿",
    "boat_self_track": "船载自报",
    "xpf_track": "远遥鹏飞航迹",
    "fanwu_car_radar": "防务车载雷达",
}

# 链路评估结果暂不展示（仍可走 gRPC/DDS 上图，只是不进本评估）
TRACK_LINK_EVAL_HIDDEN_LAYERS = frozenset({
    "ais_track",
    "bird_radar",
    "boat_self_track",
})


def _epoch_ms(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 and n == n else None  # NaN check


def _track_id(track: Dict[str, Any]) -> Optional[str]:
    for k in ("uniqueId", "unique_id", "trackId", "track_id", "showID", "show_id"):
        v = track.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s and s.lower() != "none":
            return s
    return None


def _layer_key(track: Dict[str, Any]) -> str:
    raw = track.get("track_layer_key") or track.get("trackLayerKey") or ""
    s = str(raw).strip().lower().replace("-", "_")
    return s if s else "unknown"


@dataclass
class _LinkSample:
    track_created_ms: Optional[float]
    track_source_recv_ms: Optional[float]
    track_grpc_send_ms: Optional[float]
    backend_recv_ms: float
    collected_at_ms: float


@dataclass
class _TypeBucket:
    """采集期先记入候选；结算时只取「至少更新过一次」(≥2 帧) 的航迹。"""
    samples: Dict[str, List[_LinkSample]] = field(default_factory=lambda: defaultdict(list))
    last_backend_recv: Dict[str, float] = field(default_factory=dict)
    last_create_lag_ms: Dict[str, float] = field(default_factory=dict)


def _median(values: List[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2:
        return float(s[mid])
    return (s[mid - 1] + s[mid]) / 2.0


def _seg_stats(values: List[float]) -> Dict[str, float]:
    """段延迟统计。排除负值（跨机时钟偏差）；中位数抗长滞后航迹拉偏。"""
    vals = [v for v in values if v is not None and v == v and v >= 0]
    if not vals:
        return {"avg_ms": 0.0, "median_ms": 0.0, "min_ms": 0.0, "max_ms": 0.0, "count": 0}
    return {
        "avg_ms": round(sum(vals) / len(vals), 3),
        "median_ms": round(_median(vals), 3),
        "min_ms": round(min(vals), 3),
        "max_ms": round(max(vals), 3),
        "count": len(vals),
    }


def _create_lag_ms(created: Optional[float], src_recv: Optional[float]) -> Optional[float]:
    if created is None or src_recv is None:
        return None
    return src_recv - created


class TrackLinkEvaluator:
    """单次评估任务：独立工作线程消费样本队列，主路径只做非阻塞 put。"""

    def __init__(
        self,
        task_id: str,
        duration_sec: int = DEFAULT_DURATION_SEC,
        max_tracks_per_type: int = DEFAULT_MAX_TRACKS_PER_TYPE,
    ):
        self.task_id = task_id
        self.duration_sec = max(5, min(int(duration_sec), 300))
        self.max_tracks_per_type = max(1, min(int(max_tracks_per_type), 50))

        self._lock = threading.Lock()
        self._status = "collecting"  # collecting | done | cancelled
        self._started_at = time.time()
        self._ended_at: Optional[float] = None
        self._error: Optional[str] = None

        self._buckets: Dict[str, _TypeBucket] = defaultdict(_TypeBucket)
        self._feed_q: deque = deque()
        self._q_lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()

        self._worker = threading.Thread(
            target=self._worker_loop,
            name=f"track-link-eval-{task_id[:8]}",
            daemon=True,
        )
        self._timer = threading.Timer(self.duration_sec, self._on_timeout)
        self._timer.daemon = True

    def start(self) -> None:
        self._worker.start()
        self._timer.start()
        logger.info(
            "航迹链路评估已启动 task_id={} duration={}s max_per_type={}",
            self.task_id,
            self.duration_sec,
            self.max_tracks_per_type,
        )

    def feed_nonblocking(self, track: Dict[str, Any]) -> None:
        """主路径调用：仅拷贝必要字段入队，绝不阻塞计算。"""
        if self._stop.is_set():
            return
        tid = _track_id(track)
        if not tid:
            return
        backend = _epoch_ms(track.get("backend_recv_ms") or track.get("backendRecvMs"))
        if backend is None:
            return
        layer = _layer_key(track)
        if layer in TRACK_LINK_EVAL_HIDDEN_LAYERS:
            return
        item = (
            layer,
            tid,
            _epoch_ms(track.get("track_created_time_ms") or track.get("trackCreatedMs")),
            _epoch_ms(track.get("track_source_recv_time_ms") or track.get("trackSourceRecvMs")),
            _epoch_ms(track.get("track_grpc_send_time_ms") or track.get("trackGrpcSendMs")),
            backend,
            time.time() * 1000.0,
        )
        with self._q_lock:
            if len(self._feed_q) >= _FEED_QUEUE_MAX:
                # 丢最旧，保最新
                try:
                    self._feed_q.popleft()
                except IndexError:
                    pass
            self._feed_q.append(item)
        self._wake.set()

    def _on_timeout(self) -> None:
        self._finalize("done")

    def cancel(self) -> None:
        try:
            self._timer.cancel()
        except Exception:
            pass
        self._finalize("cancelled")

    def _finalize(self, status: str) -> None:
        # 先排空队列再翻状态，避免 HTTP 轮询拿到 done 时仍丢尾包
        self._drain_queue()
        with self._lock:
            if self._status != "collecting":
                return
            self._status = status
            self._ended_at = time.time()
        self._stop.set()
        self._wake.set()
        logger.info(
            "航迹链路评估结束 task_id={} status={} elapsed={:.1f}s",
            self.task_id,
            status,
            (self._ended_at or time.time()) - self._started_at,
        )

    def _worker_loop(self) -> None:
        try:
            while not self._stop.is_set():
                self._wake.wait(timeout=0.2)
                self._wake.clear()
                self._drain_queue()
            self._drain_queue()
        except Exception as e:
            logger.exception("航迹链路评估工作线程异常 task_id={}", self.task_id)
            with self._lock:
                self._error = str(e)
                if self._status == "collecting":
                    self._status = "done"
                    self._ended_at = time.time()

    def _try_admit_track(
        self,
        bucket: _TypeBucket,
        tid: str,
        create_lag: Optional[float],
    ) -> bool:
        """候选池接纳：已在池中则继续；池满时优先踢掉仅 1 帧的僵尸候选。"""
        if tid in bucket.samples:
            return True

        if len(bucket.samples) < _MAX_CANDIDATE_TRACKS_PER_TYPE:
            return True

        # 池满：优先踢仅 1 帧的；同为 1 帧踢 create_lag 最大的
        one_frame = [
            (sid, bucket.last_create_lag_ms.get(sid, float("inf")))
            for sid, smps in bucket.samples.items()
            if len(smps) < _MIN_FRAMES_FOR_EVAL
        ]
        if one_frame:
            one_frame.sort(key=lambda x: x[1], reverse=True)
            worst_tid = one_frame[0][0]
        else:
            # 全是多帧：若新航迹 create_lag 明显更好，踢滞后最大的
            if create_lag is None or create_lag > _CREATE_TO_RECV_PREFER_MAX_MS:
                return False
            ranked = sorted(
                bucket.samples.keys(),
                key=lambda sid: bucket.last_create_lag_ms.get(sid, float("inf")),
                reverse=True,
            )
            worst_tid = ranked[0] if ranked else None
            if worst_tid is None:
                return False
            if bucket.last_create_lag_ms.get(worst_tid, float("inf")) <= create_lag:
                return False

        bucket.samples.pop(worst_tid, None)
        bucket.last_backend_recv.pop(worst_tid, None)
        bucket.last_create_lag_ms.pop(worst_tid, None)
        return True

    def _select_eval_tracks(
        self, bucket: _TypeBucket
    ) -> List[Tuple[str, List[_LinkSample]]]:
        """只保留采集期内至少更新过一次（≥2 帧）的航迹，最多 max_tracks_per_type 条。"""
        active: List[Tuple[str, List[_LinkSample], float, int]] = []
        for tid, smps in bucket.samples.items():
            if len(smps) < _MIN_FRAMES_FOR_EVAL:
                continue
            lag = bucket.last_create_lag_ms.get(tid)
            if lag is None and smps:
                last = smps[-1]
                lag = _create_lag_ms(last.track_created_ms, last.track_source_recv_ms)
            lag_v = float(lag) if lag is not None else float("inf")
            active.append((tid, smps, lag_v, len(smps)))
        # 更新次数多优先，其次创建滞后小
        active.sort(key=lambda x: (-x[3], x[2], x[0]))
        picked = active[: self.max_tracks_per_type]
        return [(tid, smps) for tid, smps, _, _ in picked]

    def _drain_queue(self) -> None:
        batch: List[Tuple] = []
        with self._q_lock:
            while self._feed_q:
                batch.append(self._feed_q.popleft())
        if not batch:
            return
        with self._lock:
            if self._status != "collecting":
                return
            for layer, tid, created, src_recv, grpc_send, backend, collected_at in batch:
                bucket = self._buckets[layer]
                create_lag = _create_lag_ms(created, src_recv)
                if not self._try_admit_track(bucket, tid, create_lag):
                    continue
                prev = bucket.last_backend_recv.get(tid)
                if prev is not None and prev == backend:
                    continue
                bucket.last_backend_recv[tid] = backend
                if create_lag is not None:
                    bucket.last_create_lag_ms[tid] = create_lag
                lst = bucket.samples[tid]
                lst.append(
                    _LinkSample(
                        track_created_ms=created,
                        track_source_recv_ms=src_recv,
                        track_grpc_send_ms=grpc_send,
                        backend_recv_ms=backend,
                        collected_at_ms=collected_at,
                    )
                )
                if len(lst) > _MAX_SAMPLES_PER_TRACK:
                    del lst[: len(lst) - _MAX_SAMPLES_PER_TRACK]

    def snapshot(self) -> Dict[str, Any]:
        """供 HTTP 轮询：collecting 时返回进度；done 时返回完整结果。"""
        with self._lock:
            status = self._status
            started = self._started_at
            ended = self._ended_at
            err = self._error
            elapsed = (ended or time.time()) - started
            remaining = max(0.0, self.duration_sec - (time.time() - started)) if status == "collecting" else 0.0

            type_counts = {}
            for k, b in self._buckets.items():
                if k in TRACK_LINK_EVAL_HIDDEN_LAYERS:
                    continue
                seen = len(b.samples)
                updated = sum(1 for smps in b.samples.values() if len(smps) >= _MIN_FRAMES_FOR_EVAL)
                frames = sum(len(v) for v in b.samples.values())
                type_counts[k] = {
                    "seen": seen,
                    "updated": updated,  # ≥2 帧，可参与评估
                    "sampled": updated,  # 兼容旧前端字段
                    "updates": frames,
                }

            if status == "collecting":
                return {
                    "task_id": self.task_id,
                    "status": status,
                    "duration_sec": self.duration_sec,
                    "elapsed_sec": round(elapsed, 2),
                    "remaining_sec": round(remaining, 2),
                    "type_counts": type_counts,
                    "error": err,
                }

            results = self._compute_results_unlocked()
            return {
                "task_id": self.task_id,
                "status": status,
                "duration_sec": self.duration_sec,
                "elapsed_sec": round(elapsed, 2),
                "remaining_sec": 0,
                "started_at": started,
                "ended_at": ended,
                "type_counts": type_counts,
                "results": results,
                "error": err,
            }

    def _compute_results_unlocked(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        duration = max(1e-6, (self._ended_at or time.time()) - self._started_at)
        for layer, bucket in sorted(self._buckets.items(), key=lambda x: x[0]):
            if layer in TRACK_LINK_EVAL_HIDDEN_LAYERS:
                continue
            selected = self._select_eval_tracks(bucket)
            if not selected and not bucket.samples:
                continue
            n_tracks = len(selected)
            total_updates = sum(len(smps) for _, smps in selected)
            create_to_recv: List[float] = []
            recv_to_send: List[float] = []
            send_to_backend: List[float] = []
            total: List[float] = []
            # 只用第 2 帧及以后做延迟统计（第 1 帧只用于确认航迹存活/可更新）
            for _, samples in selected:
                for s in samples[1:]:
                    if s.track_created_ms is not None and s.track_source_recv_ms is not None:
                        create_to_recv.append(s.track_source_recv_ms - s.track_created_ms)
                    if s.track_source_recv_ms is not None and s.track_grpc_send_ms is not None:
                        recv_to_send.append(s.track_grpc_send_ms - s.track_source_recv_ms)
                    if s.track_grpc_send_ms is not None:
                        send_to_backend.append(s.backend_recv_ms - s.track_grpc_send_ms)
                    if s.track_created_ms is not None:
                        total.append(s.backend_recv_ms - s.track_created_ms)

            # 频率：有效更新次数（第 2 帧起）/ 时长 / 航迹数
            effective_updates = max(0, total_updates - n_tracks)
            freq = (effective_updates / duration / n_tracks) if n_tracks > 0 else 0.0
            out.append(
                {
                    "track_layer_key": layer,
                    "label": TRACK_LAYER_LABELS.get(layer, layer),
                    "sampled_track_count": n_tracks,
                    "candidate_track_count": len(bucket.samples),
                    "single_frame_dropped": sum(
                        1 for smps in bucket.samples.values() if len(smps) < _MIN_FRAMES_FOR_EVAL
                    ),
                    "total_updates": total_updates,
                    "effective_updates": effective_updates,
                    "update_frequency_hz": round(freq, 4),
                    "segments": {
                        "create_to_recv": _seg_stats(create_to_recv),
                        "recv_to_send": _seg_stats(recv_to_send),
                        "send_to_backend": _seg_stats(send_to_backend),
                        "total": _seg_stats(total),
                    },
                }
            )
        return out


# ---------------------------------------------------------------------------
# 全局单例管理（同时只允许一个采集任务；与其他评估模块完全解耦）
# ---------------------------------------------------------------------------

_mgr_lock = threading.Lock()
_active: Optional[TrackLinkEvaluator] = None
_last_finished: Optional[TrackLinkEvaluator] = None


def feed_track_link_evaluator(track_data: Dict[str, Any]) -> None:
    """queue_track_data 旁路入口：无活跃任务时立即返回（零开销）。"""
    ev = _active
    if ev is None:
        return
    try:
        ev.feed_nonblocking(track_data)
    except Exception:
        # 绝不影响航迹主路径
        pass


def start_track_link_eval(
    duration_sec: int = DEFAULT_DURATION_SEC,
    max_tracks_per_type: int = DEFAULT_MAX_TRACKS_PER_TYPE,
) -> Dict[str, Any]:
    """启动新评估。若已有 collecting 任务，返回 conflict。"""
    global _active, _last_finished
    with _mgr_lock:
        if _active is not None and _active._status == "collecting":
            return {
                "ok": False,
                "conflict": True,
                "task_id": _active.task_id,
                "message": "已有航迹链路评估在进行中",
                "snapshot": _active.snapshot(),
            }
        # 上一任务已结束则归档
        if _active is not None and _active._status != "collecting":
            _last_finished = _active
            _active = None

        task_id = uuid.uuid4().hex
        ev = TrackLinkEvaluator(
            task_id=task_id,
            duration_sec=duration_sec,
            max_tracks_per_type=max_tracks_per_type,
        )
        _active = ev
        ev.start()
        return {
            "ok": True,
            "conflict": False,
            "task_id": task_id,
            "status": "collecting",
            "duration_sec": ev.duration_sec,
            "max_tracks_per_type": ev.max_tracks_per_type,
        }


def get_track_link_eval_result(task_id: Optional[str] = None) -> Dict[str, Any]:
    """查询任务状态/结果。task_id 为空时返回最近一次任务。"""
    global _active, _last_finished
    with _mgr_lock:
        candidates = [x for x in (_active, _last_finished) if x is not None]
        if not candidates:
            return {"ok": False, "not_found": True, "message": "尚无航迹链路评估任务"}

        if task_id:
            for ev in candidates:
                if ev.task_id == task_id:
                    snap = ev.snapshot()
                    # 已结束则归档 active
                    if ev is _active and snap.get("status") != "collecting":
                        _last_finished = ev
                        _active = None
                    return {"ok": True, **snap}
            return {"ok": False, "not_found": True, "message": f"未找到 task_id={task_id}"}

        # 无 task_id：优先 active，否则 last_finished
        ev = _active or _last_finished
        assert ev is not None
        snap = ev.snapshot()
        if ev is _active and snap.get("status") != "collecting":
            _last_finished = ev
            _active = None
        return {"ok": True, **snap}
