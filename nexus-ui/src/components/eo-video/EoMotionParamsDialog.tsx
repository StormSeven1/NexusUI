"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ensureEntitiesTrackTaskCache } from "@/lib/entities-track-task-cache";
import {
  EMPTY_MOTION_CAMERA,
  EMPTY_MOTION_FIELDS,
  MOTION_PARAM_KEYS,
  fetchEoMotionParams,
  isEditableMotionCamera,
  postEoMotionParams,
  type MotionCameraParams,
  type MotionParamsFields,
} from "@/lib/eo-video/eoMotionParamsClient";
import { EoAimParamsPanel } from "@/components/eo-video/EoAimParamsDialog";
import { toast } from "sonner";

export type EoMotionParamsDialogProps = {
  open: boolean;
  onClose: () => void;
  backendBaseUrl?: string;
};

const MOTION_FIELDS: { key: keyof MotionParamsFields; label: string }[] = [
  { key: "speed_turn", label: "转动参数 speed_turn" },
  { key: "turn_t", label: "转动时间 turn_t" },
  { key: "multiple", label: "倍数 multiple" },
  { key: "multiple_angle", label: "倍数角度限制 multiple_angle" },
  { key: "angle_limit", label: "角度增益限制 angle_limit" },
  { key: "ht_angle", label: "历史角度增益 ht_angle" },
  { key: "t_move", label: "动态目标延迟时间 t_move" },
  { key: "track_T", label: "航迹周期 track_T" },
];

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Number(n.toPrecision(8)));
}

function fieldsFromCamera(c: MotionCameraParams): MotionParamsFields {
  return {
    speed_turn: c.speed_turn,
    turn_t: c.turn_t,
    multiple: c.multiple,
    multiple_angle: c.multiple_angle,
    angle_limit: c.angle_limit,
    ht_angle: c.ht_angle,
    t_move: c.t_move,
    track_T: c.track_T,
  };
}

function draftFromFields(f: MotionParamsFields): Record<keyof MotionParamsFields, string> {
  const d = {} as Record<keyof MotionParamsFields, string>;
  for (const k of MOTION_PARAM_KEYS) d[k] = formatNum(f[k]);
  return d;
}

/** 顶栏光电 · 运动参数：首屏含对准 aimConfig 开关 + 按相机运动参数 */
export function EoMotionParamsDialog({ open, onClose, backendBaseUrl }: EoMotionParamsDialogProps) {
  const [cameras, setCameras] = useState<MotionCameraParams[]>([]);
  const [entityId, setEntityId] = useState("");
  const [draft, setDraft] = useState<Record<keyof MotionParamsFields, string>>(() =>
    draftFromFields(EMPTY_MOTION_FIELDS),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aimBusy, setAimBusy] = useState({ loading: false, saving: false });
  const [aimReloadToken, setAimReloadToken] = useState(0);
  const [aimSaveToken, setAimSaveToken] = useState(0);

  const editableCams = useMemo(
    () => cameras.filter((c) => isEditableMotionCamera(c)),
    [cameras],
  );

  const selectedCam = useMemo(() => {
    const id = entityId.trim().toLowerCase();
    if (!id) return null;
    return editableCams.find((c) => c.entityId.trim().toLowerCase() === id) ?? null;
  }, [editableCams, entityId]);

  const syncDraftFromCam = useCallback((c: MotionCameraParams | null) => {
    setDraft(draftFromFields(c ? fieldsFromCamera(c) : EMPTY_MOTION_FIELDS));
  }, []);

  const loadMotion = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await ensureEntitiesTrackTaskCache(true);

      const { res, data } = await fetchEoMotionParams({ backendBaseUrl });
      if (!res.ok || !data.ok) {
        const msg = data.detail ?? data.error ?? `HTTP ${res.status}`;
        setLoadError(msg);
        toast.error("读取运动参数失败", { description: msg.slice(0, 240) });
        return;
      }
      const cams = Array.isArray(data.cameras) ? data.cameras : [];
      setCameras(cams);
      const preferred = cams.filter((c) => isEditableMotionCamera(c));
      setEntityId((prev) => {
        if (prev && preferred.some((c) => c.entityId.toLowerCase() === prev.toLowerCase())) {
          const keep = preferred.find((c) => c.entityId.toLowerCase() === prev.toLowerCase()) ?? null;
          syncDraftFromCam(keep);
          return prev;
        }
        const next = preferred[0] ?? null;
        syncDraftFromCam(next);
        return next?.entityId ?? "";
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      toast.error("读取运动参数异常", { description: msg });
    } finally {
      setLoading(false);
    }
  }, [backendBaseUrl, syncDraftFromCam]);

  useEffect(() => {
    if (!open) return;
    void loadMotion();
    setAimReloadToken((n) => n + 1);
  }, [open, loadMotion]);

  const onSelectCamera = (nextId: string) => {
    setEntityId(nextId);
    const cam =
      editableCams.find((c) => c.entityId.trim().toLowerCase() === nextId.trim().toLowerCase()) ?? null;
    syncDraftFromCam(cam);
  };

  const setField = (key: keyof MotionParamsFields, raw: string) => {
    setDraft((prev) => ({ ...prev, [key]: raw }));
  };

  const applyMotion = async () => {
    if (saving) return;
    if (!selectedCam || selectedCam.cameraIndex < 0) {
      toast.error("请先选择相机");
      return;
    }
    const next = { ...EMPTY_MOTION_FIELDS };
    for (const k of MOTION_PARAM_KEYS) {
      const n = Number(draft[k]);
      next[k] = Number.isFinite(n) ? n : 0;
    }
    setSaving(true);
    try {
      const { res, data } = await postEoMotionParams({
        cameraIndex: selectedCam.cameraIndex,
        entityId: selectedCam.entityId,
        camera: {
          ...next,
          angle_alter: selectedCam.angle_alter,
          dis_alter: selectedCam.dis_alter,
        },
        backendBaseUrl,
      });
      const ok = res.ok && data.ok !== false;
      if (ok) {
        const cams = Array.isArray(data.cameras) ? data.cameras : [];
        if (cams.length > 0) setCameras(cams);
        const updated =
          cams.find(
            (c) =>
              c.cameraIndex === selectedCam.cameraIndex ||
              c.entityId.toLowerCase() === selectedCam.entityId.toLowerCase(),
          ) ?? null;
        if (updated) syncDraftFromCam(updated);
        else setDraft(draftFromFields(next));
        toast.success("运动参数已热更新", {
          description: `${selectedCam.entityId} · ConfigMotion.ini CAMERA${selectedCam.cameraIndex}`,
        });
      } else {
        const msg = data.detail ?? data.error ?? `HTTP ${res.status}`;
        toast.error("更新运动参数失败", { description: String(msg).slice(0, 240) });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("更新运动参数异常", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const onRefresh = () => {
    void loadMotion();
    setAimReloadToken((n) => n + 1);
  };

  const onApply = () => {
    void applyMotion();
    setAimSaveToken((n) => n + 1);
  };

  const busy = loading || saving || aimBusy.loading || aimBusy.saving;

  if (!open || typeof document === "undefined") return null;

  const camShow = selectedCam ?? { ...EMPTY_MOTION_CAMERA, entityId };

  const panel = (
    <div
      className="pointer-events-auto fixed inset-0 z-[20000] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eo-motion-params-title"
    >
      <div className="flex max-h-[88vh] w-full max-w-[640px] flex-col rounded-lg border border-white/10 bg-[#1a1f26] text-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <h2 id="eo-motion-params-title" className="text-sm font-medium">
              光电参数
            </h2>
            <p className="mt-0.5 text-[11px] text-white/50">
              对准 aimConfig + 运动参数按相机热更新（hasPtz · 主相机 · 非第三方）
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1 text-white/80 hover:bg-white/10 hover:text-white"
              disabled={busy}
              onClick={onRefresh}
            >
              {busy && (loading || aimBusy.loading) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              刷新
            </Button>
            <button
              type="button"
              className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="关闭"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
          {loadError ? (
            <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">{loadError}</p>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-white/45">相机</h3>
            <label className="flex flex-col gap-1">
              <span className="text-white/55">相机（hasPtz · 主相机 · 非第三方）</span>
              <select
                className="h-8 rounded border border-white/15 bg-black/40 px-2 text-white outline-none focus:border-nexus-accent"
                value={entityId}
                disabled={loading || editableCams.length === 0}
                onChange={(e) => onSelectCamera(e.target.value)}
              >
                {editableCams.length === 0 ? (
                  <option value="">无可用相机</option>
                ) : (
                  editableCams.map((c) => (
                    <option key={c.entityId} value={c.entityId}>
                      {c.entityId} (#{c.cameraIndex})
                    </option>
                  ))
                )}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="角度修正 angle_alter" value={formatNum(camShow.angle_alter)} readOnly />
              <Field label="距离修正 dis_alter" value={formatNum(camShow.dis_alter)} readOnly />
            </div>
          </section>

          <div className="border-t border-white/10 pt-3">
            <EoAimParamsPanel
              active={open}
              backendBaseUrl={backendBaseUrl}
              entityId={entityId}
              onEntityIdChange={onSelectCamera}
              onBusyChange={setAimBusy}
              reloadToken={aimReloadToken}
              saveToken={aimSaveToken}
            />
          </div>

          <section className="space-y-2 border-t border-white/10 pt-3">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-white/45">
              运动参数（当前相机）
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {MOTION_FIELDS.map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  value={draft[f.key]}
                  onChange={(v) => setField(f.key, v)}
                />
              ))}
            </div>
          </section>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 px-4 py-3">
          <Button type="button" size="sm" variant="secondary" className="h-8" onClick={onClose}>
            关闭
          </Button>
          <Button type="button" size="sm" className="h-8" disabled={busy || !selectedCam} onClick={onApply}>
            {saving || aimBusy.saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            应用热更新
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

function Field({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-white/55">{label}</span>
      <input
        readOnly={readOnly}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={cn(
          "h-8 rounded border border-white/15 bg-black/40 px-2 font-mono text-white outline-none",
          !readOnly && "focus:border-nexus-accent",
          readOnly && "opacity-70",
        )}
      />
    </label>
  );
}
