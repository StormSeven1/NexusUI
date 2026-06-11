"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Aperture, Crosshair, Eye, Loader2, RefreshCw, ScanEye } from "lucide-react";
import { cn } from "@/lib/utils";
import { isThirdPartyCameraEntityId } from "@/lib/eo-video/thirdPartyEntityId";
import { useMapGisCameraMenuStore } from "@/stores/map-gis-camera-menu-store";
import {
  fetchCameraPointingAccuracyResult,
  fetchCameraSharpness,
  fetchCameraVisibility,
  formatDeltaDeg,
  formatSharpnessScore,
  formatVisibilityValue,
  POINTING_ACCURACY_POLL_MS,
  POINTING_ACCURACY_POLL_TIMEOUT_MS,
  POINTING_DEFAULT_LOOKBACK_HOURS,
  POINTING_LOOKBACK_PRESETS,
  triggerCameraPointingAccuracyEval,
  triggerCameraVisibilityCheck,
  visibilityToNormalizedScore,
  VISIBILITY_POLL_MS,
  VISIBILITY_POLL_TIMEOUT_MS,
  type CameraSharpnessResult,
  type CameraVisibilityResult,
  type PointingAccuracyResult,
} from "@/lib/system-eval-camera-api";
import { PointingAccuracyDisk } from "@/components/panels/system-evaluation/PointingAccuracyDisk";

type EvalPhase = "idle" | "running" | "done" | "error";

function rejectThirdPartyEntity(id: string): string | null {
  if (isThirdPartyCameraEntityId(id.trim())) {
    return "第三方相机不支持清晰度/能见度/指向准确度评估，请选择光电主相机";
  }
  return null;
}

function MetricCard({
  title,
  icon: Icon,
  children,
  accentClass = "text-nexus-accent",
}: {
  title: string;
  icon: typeof Aperture;
  children: React.ReactNode;
  accentClass?: string;
}) {
  return (
    <section className="rounded-lg border border-nexus-border/80 bg-nexus-bg-base/40 p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={13} className={accentClass} />
        <h4 className="text-[11px] font-semibold text-nexus-text-secondary">{title}</h4>
      </div>
      {children}
    </section>
  );
}

function ScoreBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-nexus-bg-elevated", className)}>
      <div
        className="h-full rounded-full bg-nexus-accent/80 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function CameraEvalTab() {
  const menuRows = useMapGisCameraMenuStore((s) => s.rows);
  const menuLoading = useMapGisCameraMenuStore((s) => s.loading);
  const ensureCameraMenu = useMapGisCameraMenuStore((s) => s.ensureLoaded);
  const cameraOptions = useMemo(
    () =>
      menuRows
        .filter((r) => r.kind === "opto")
        .map((r) => ({ id: r.entityId, label: r.label }))
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
    [menuRows],
  );

  const [entityId, setEntityId] = useState("");
  const [sharpness, setSharpness] = useState<CameraSharpnessResult | null>(null);
  const [sharpnessLoading, setSharpnessLoading] = useState(false);
  const [sharpnessError, setSharpnessError] = useState<string | null>(null);

  const [visibility, setVisibility] = useState<CameraVisibilityResult | null>(null);
  const [visibilityPhase, setVisibilityPhase] = useState<EvalPhase>("idle");
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const [pointingResult, setPointingResult] = useState<PointingAccuracyResult | null>(null);
  const [pointingPhase, setPointingPhase] = useState<EvalPhase>("idle");
  const [pointingError, setPointingError] = useState<string | null>(null);
  const [pointingTaskId, setPointingTaskId] = useState<string | null>(null);
  const [pointingLookbackHours, setPointingLookbackHours] = useState(POINTING_DEFAULT_LOOKBACK_HOURS);
  const pointingPollRef = useRef<number | null>(null);
  const prevPointingEntityRef = useRef("");

  useEffect(() => {
    void ensureCameraMenu();
  }, [ensureCameraMenu]);

  useEffect(() => {
    if (!entityId && cameraOptions.length > 0) {
      setEntityId(cameraOptions[0].id);
    }
  }, [cameraOptions, entityId]);

  useEffect(() => {
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current);
      if (pointingPollRef.current != null) window.clearInterval(pointingPollRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const stopPointingPolling = useCallback(() => {
    if (pointingPollRef.current != null) {
      window.clearInterval(pointingPollRef.current);
      pointingPollRef.current = null;
    }
  }, []);

  const loadStoredVisibility = useCallback(async (cameraEntityId: string) => {
    const r = await fetchCameraVisibility(cameraEntityId);
    if (r.visibility) setVisibility(r.visibility);
    return r;
  }, []);

  useEffect(() => {
    if (!entityId.trim()) return;
    void loadStoredVisibility(entityId.trim());
  }, [entityId, loadStoredVisibility]);

  const runSharpness = useCallback(async () => {
    const id = entityId.trim();
    if (!id) {
      setSharpnessError("请选择或输入相机实体 ID");
      return;
    }
    const thirdPartyErr = rejectThirdPartyEntity(id);
    if (thirdPartyErr) {
      setSharpnessError(thirdPartyErr);
      return;
    }
    setSharpnessLoading(true);
    setSharpnessError(null);
    try {
      const r = await fetchCameraSharpness(id, true);
      setSharpness(r.sharpness);
      setSharpnessError(r.error);
    } catch (e) {
      setSharpness(null);
      setSharpnessError(e instanceof Error ? e.message : String(e));
    } finally {
      setSharpnessLoading(false);
    }
  }, [entityId]);

  const runVisibility = useCallback(async () => {
    const id = entityId.trim();
    if (!id) {
      setVisibilityError("请选择或输入相机实体 ID");
      return;
    }
    const thirdPartyErr = rejectThirdPartyEntity(id);
    if (thirdPartyErr) {
      setVisibilityError(thirdPartyErr);
      return;
    }

    stopPolling();
    setVisibilityPhase("running");
    setVisibilityError(null);
    setActiveTaskId(null);

    const baseline = visibility?.visibility;
    const trigger = await triggerCameraVisibilityCheck(id, VISIBILITY_POLL_TIMEOUT_MS);
    if (!trigger.accepted || !trigger.taskId) {
      setVisibilityPhase("error");
      setVisibilityError(trigger.error || "能见度任务未被接受（相机可能正在执行其他任务）");
      return;
    }

    setActiveTaskId(trigger.taskId);
    const startedAt = Date.now();

    const pollOnce = async () => {
      const r = await fetchCameraVisibility(id);
      const v = r.visibility;
      if (v) setVisibility(v);

      const matchedTask = v?.last_task_id === trigger.taskId;
      const updatedAt = Number(v?.updated_at_unix_ms ?? 0);
      const isFreshResult = updatedAt >= startedAt - 3000;
      const valueChanged =
        baseline != null &&
        v?.visibility != null &&
        Math.abs(v.visibility - baseline) > 0.01;

      if (matchedTask && isFreshResult && (!(v?.error_message || "").trim() || valueChanged)) {
        stopPolling();
        setVisibilityPhase("done");
        setVisibilityError(r.error);
        return;
      }

      if (Date.now() - startedAt >= VISIBILITY_POLL_TIMEOUT_MS) {
        stopPolling();
        setVisibilityPhase("error");
        setVisibilityError("能见度评估超时，请稍后点击刷新结果重试");
      }
    };

    await pollOnce();
    pollRef.current = window.setInterval(() => void pollOnce(), VISIBILITY_POLL_MS);
  }, [entityId, stopPolling, visibility?.visibility]);

  const loadPointingResult = useCallback(
    async (cameraEntityId: string, taskId?: string, lookbackHours = POINTING_DEFAULT_LOOKBACK_HOURS) => {
      const id = cameraEntityId.trim();
      const r = await fetchCameraPointingAccuracyResult(id, taskId, lookbackHours);
      if (r.result) {
        setPointingResult({
          ...r.result,
          samples: r.result.samples?.map((s) => ({
            ...s,
            camera_entity_id: s.camera_entity_id?.trim() || id,
          })),
        });
      } else {
        setPointingResult(null);
      }
      return r;
    },
    [],
  );

  useEffect(() => {
    const id = entityId.trim();
    if (!id) return;
    if (prevPointingEntityRef.current !== id) {
      setPointingResult(null);
      setPointingPhase("idle");
      setPointingError(null);
      setPointingTaskId(null);
      prevPointingEntityRef.current = id;
    }
    void loadPointingResult(id, undefined, pointingLookbackHours);
  }, [entityId, pointingLookbackHours, loadPointingResult]);

  const runPointingAccuracy = useCallback(async () => {
    const id = entityId.trim();
    if (!id) {
      setPointingError("请选择或输入相机实体 ID");
      return;
    }
    const thirdPartyErr = rejectThirdPartyEntity(id);
    if (thirdPartyErr) {
      setPointingError(thirdPartyErr);
      return;
    }

    stopPointingPolling();
    setPointingPhase("running");
    setPointingError(null);
    setPointingTaskId(null);
    setPointingResult(null);

    const trigger = await triggerCameraPointingAccuracyEval(id, POINTING_ACCURACY_POLL_TIMEOUT_MS);
    if (!trigger.accepted || !trigger.taskId) {
      setPointingPhase("error");
      setPointingError(trigger.error || "指向准确度任务未被接受（相机可能正在执行其他任务）");
      return;
    }

    setPointingTaskId(trigger.taskId);
    const startedAt = Date.now();

    const pollOnce = async () => {
      const r = await loadPointingResult(id, trigger.taskId ?? undefined, 0);
      const result = r.result;
      if (result) setPointingResult(result);

      const stillRunning = (result?.error_message || "").includes("still running");
      const hasSample = (result?.samples?.length ?? 0) > 0;
      const completedAt = Number(result?.completed_at_unix_ms ?? 0);
      const isFresh = completedAt >= startedAt - 3000;

      if (!stillRunning && hasSample && isFresh && result?.all_bands_ok) {
        stopPointingPolling();
        setPointingPhase("done");
        setPointingError(r.error);
        void loadPointingResult(id, undefined, pointingLookbackHours);
        return;
      }

      if (!stillRunning && !hasSample && result?.error_message && !result.error_message.includes("still running")) {
        stopPointingPolling();
        setPointingPhase("error");
        setPointingError(result.error_message);
        return;
      }

      if (Date.now() - startedAt >= POINTING_ACCURACY_POLL_TIMEOUT_MS) {
        stopPointingPolling();
        setPointingPhase("error");
        setPointingError("指向准确度评估超时，请稍后刷新结果重试");
      }
    };

    await pollOnce();
    pointingPollRef.current = window.setInterval(() => void pollOnce(), POINTING_ACCURACY_POLL_MS);
  }, [entityId, loadPointingResult, pointingLookbackHours, stopPointingPolling]);

  const normalizedVisibility = visibilityToNormalizedScore(Number(visibility?.visibility));
  const sharpnessScore = Number(sharpness?.combined_score ?? 0);
  const sharpnessMax = Math.max(20, sharpnessScore * 1.2, 1);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-nexus-border px-2 py-1.5">
        <p className="text-[11px] font-medium text-nexus-text-secondary">相机清晰度、能见度与指向准确度</p>
        <p className="text-[9px] text-nexus-text-muted">选择相机实体 ID，提交航迹目标并执行评估</p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        <div className="rounded-lg border border-nexus-border/70 bg-nexus-bg-elevated/30 p-2">
          <label className="mb-1 block text-[9px] font-medium uppercase tracking-wide text-nexus-text-muted">
            相机实体
          </label>
          <div className="flex gap-1.5">
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-nexus-border bg-nexus-bg-base px-2 py-1.5 text-[11px] text-nexus-text-primary outline-none focus:border-nexus-accent/60"
            >
              {menuLoading && cameraOptions.length === 0 ? (
                <option value="">加载相机列表…</option>
              ) : cameraOptions.length === 0 ? (
                <option value="">暂无可选光电主相机</option>
              ) : (
                cameraOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))
              )}
            </select>
          </div>
          <input
            type="text"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="或手动输入 entityId"
            className="mt-1.5 w-full rounded-md border border-nexus-border/60 bg-nexus-bg-base/80 px-2 py-1 font-mono text-[10px] text-nexus-text-secondary outline-none focus:border-nexus-accent/50"
          />
        </div>

        {(sharpnessError || visibilityError || pointingError) &&
        visibilityPhase !== "running" &&
        pointingPhase !== "running" ? (
          <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300">
            {sharpnessError || visibilityError || pointingError}
          </p>
        ) : null}

        <MetricCard title="清晰度评估" icon={Aperture}>
          <div className="mb-2 flex items-end justify-between gap-2">
            <div>
              <p className="text-[9px] text-nexus-text-muted">综合得分</p>
              <p className="font-mono text-xl font-semibold leading-none text-nexus-text-primary">
                {formatSharpnessScore(sharpness?.combined_score)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runSharpness()}
              disabled={sharpnessLoading || !entityId.trim()}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-nexus-border px-2 py-1 text-[10px]",
                "text-nexus-text-secondary hover:bg-nexus-bg-elevated disabled:opacity-50",
              )}
            >
              {sharpnessLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <ScanEye size={12} />
              )}
              检测
            </button>
          </div>

          <ScoreBar value={sharpnessScore} max={sharpnessMax} className="mb-2" />

          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded border border-nexus-border/50 bg-nexus-bg-elevated/40 px-2 py-1">
              <p className="text-[9px] text-nexus-text-muted">边缘项</p>
              <p className="font-mono text-[11px] text-nexus-text-primary">
                {formatSharpnessScore(sharpness?.edge_component)}
              </p>
            </div>
            <div className="rounded border border-nexus-border/50 bg-nexus-bg-elevated/40 px-2 py-1">
              <p className="text-[9px] text-nexus-text-muted">纹理项</p>
              <p className="font-mono text-[11px] text-nexus-text-primary">
                {formatSharpnessScore(sharpness?.texture_component)}
              </p>
            </div>
          </div>

          {sharpness?.timestamp_unix_ms ? (
            <p className="mt-1.5 text-[9px] text-nexus-text-muted">
              采样时间：{new Date(Number(sharpness.timestamp_unix_ms)).toLocaleString()}
            </p>
          ) : null}
        </MetricCard>

        <MetricCard title="能见度评估" icon={Eye} accentClass="text-sky-400">
          <div className="mb-2 flex items-end justify-between gap-2">
            <div>
              <p className="text-[9px] text-nexus-text-muted">能力值</p>
              <p className="font-mono text-xl font-semibold leading-none text-sky-300">
                {formatVisibilityValue(visibility?.visibility)}
              </p>
              <p className="mt-0.5 text-[9px] text-nexus-text-muted">
                归一化 {Math.round(normalizedVisibility * 100)}%
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => void runVisibility()}
                disabled={visibilityPhase === "running" || !entityId.trim()}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[10px]",
                  "text-sky-200 hover:bg-sky-500/20 disabled:opacity-50",
                )}
              >
                {visibilityPhase === "running" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Eye size={12} />
                )}
                开始评估
              </button>
              <button
                type="button"
                onClick={() => entityId.trim() && void loadStoredVisibility(entityId.trim())}
                disabled={!entityId.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-nexus-border px-2 py-0.5 text-[9px] text-nexus-text-muted hover:bg-nexus-bg-elevated disabled:opacity-50"
              >
                <RefreshCw size={10} />
                刷新结果
              </button>
            </div>
          </div>

          <ScoreBar value={normalizedVisibility * 100} max={100} className="mb-2" />

          <div className="flex items-center justify-between rounded border border-nexus-border/50 bg-nexus-bg-elevated/40 px-2 py-1 text-[10px]">
            <span className="text-nexus-text-muted">任务状态</span>
            <span
              className={cn(
                "font-medium",
                visibilityPhase === "running"
                  ? "text-amber-300"
                  : visibilityPhase === "done"
                    ? "text-emerald-400"
                    : visibilityPhase === "error"
                      ? "text-red-300"
                      : "text-nexus-text-secondary",
              )}
            >
              {visibilityPhase === "running"
                ? "评估中…"
                : visibilityPhase === "done"
                  ? "已完成"
                  : visibilityPhase === "error"
                    ? "失败/超时"
                    : "待命"}
            </span>
          </div>

          {activeTaskId ? (
            <p className="mt-1 truncate font-mono text-[9px] text-nexus-text-muted" title={activeTaskId}>
              任务 ID：{activeTaskId}
            </p>
          ) : null}
          {visibility?.updated_at_unix_ms ? (
            <p className="mt-1 text-[9px] text-nexus-text-muted">
              最近更新：{new Date(Number(visibility.updated_at_unix_ms)).toLocaleString()}
            </p>
          ) : null}
        </MetricCard>

        <MetricCard title="指向准确度评估" icon={Crosshair} accentClass="text-violet-400">
          <p className="mb-2 text-[9px] text-nexus-text-muted">
            相机在可见范围内自动选 AIS 航迹测量；圆盘按 2 km 距离圈 × 30° 方位格展示已有数据
          </p>

          <div className="mb-2 flex items-end justify-between gap-2">
            <div>
              <p className="text-[9px] text-nexus-text-muted">平均偏移</p>
              <p className="font-mono text-sm font-semibold text-violet-300">
                ΔP {formatDeltaDeg(pointingResult?.mean_delta_p)} · ΔT {formatDeltaDeg(pointingResult?.mean_delta_t)}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => void runPointingAccuracy()}
                disabled={pointingPhase === "running" || !entityId.trim()}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[10px]",
                  "text-violet-200 hover:bg-violet-500/20 disabled:opacity-50",
                )}
              >
                {pointingPhase === "running" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Crosshair size={12} />
                )}
                开始评估
              </button>
              <button
                type="button"
                onClick={() =>
                  entityId.trim() &&
                  void loadPointingResult(entityId.trim(), pointingTaskId ?? undefined, pointingLookbackHours)
                }
                disabled={!entityId.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-nexus-border px-2 py-0.5 text-[9px] text-nexus-text-muted hover:bg-nexus-bg-elevated disabled:opacity-50"
              >
                <RefreshCw size={10} />
                刷新结果
              </button>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between rounded border border-nexus-border/50 bg-nexus-bg-elevated/40 px-2 py-1 text-[10px]">
            <span className="text-nexus-text-muted">任务状态</span>
            <span
              className={cn(
                "font-medium",
                pointingPhase === "running"
                  ? "text-amber-300"
                  : pointingPhase === "done"
                    ? "text-emerald-400"
                    : pointingPhase === "error"
                      ? "text-red-300"
                      : "text-nexus-text-secondary",
              )}
            >
              {pointingPhase === "running"
                ? "评估中…"
                : pointingPhase === "done"
                  ? "已完成"
                  : pointingPhase === "error"
                    ? "失败/超时"
                    : "待命"}
            </span>
          </div>

          {pointingTaskId ? (
            <p className="mb-2 truncate font-mono text-[9px] text-nexus-text-muted" title={pointingTaskId}>
              任务 ID：{pointingTaskId}
            </p>
          ) : null}

          <div className="mb-2 space-y-1">
            <p className="text-[9px] text-nexus-text-muted">数据时间范围</p>
            <div className="flex flex-wrap gap-1">
              {POINTING_LOOKBACK_PRESETS.map((preset) => {
                const active = pointingLookbackHours === preset.hours;
                return (
                  <button
                    key={preset.hours}
                    type="button"
                    onClick={() => setPointingLookbackHours(preset.hours)}
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[9px] transition-colors",
                      active
                        ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
                        : "border-nexus-border/50 text-nexus-text-muted hover:bg-nexus-bg-elevated",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <PointingAccuracyDisk
            samples={pointingResult?.samples}
            cameraEntityId={entityId.trim()}
            className="mb-2"
          />
        </MetricCard>
      </div>
    </div>
  );
}
