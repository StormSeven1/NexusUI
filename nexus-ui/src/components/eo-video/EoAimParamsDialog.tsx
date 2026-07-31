"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ensureEntitiesTrackTaskCache,
  listTrackTaskOwnerRows,
} from "@/lib/entities-track-task-cache";
import {
  fetchEoAimParams,
  postEoAimParams,
  type AimCameraParams,
  type AimSeaSegment,
} from "@/lib/eo-video/eoAimParamsClient";
import { toast } from "sonner";

export type EoAimParamsPanelProps = {
  /** 为 true 时加载数据 */
  active: boolean;
  backendBaseUrl?: string;
  /** 与运动参数页共用的相机 entityId（可选受控） */
  entityId?: string;
  onEntityIdChange?: (entityId: string) => void;
  onBusyChange?: (busy: { loading: boolean; saving: boolean }) => void;
  reloadToken?: number;
  saveToken?: number;
};

/**
 * 对准 aimConfig 开关（嵌入「光电参数」首屏）：只选启用，不展示系数/区段。
 */
export function EoAimParamsPanel({
  active,
  backendBaseUrl,
  entityId: entityIdProp,
  onEntityIdChange,
  onBusyChange,
  reloadToken = 0,
  saveToken = 0,
}: EoAimParamsPanelProps) {
  const [cameras, setCameras] = useState<AimCameraParams[]>([]);
  const [entityIdInner, setEntityIdInner] = useState("");
  const entityId = entityIdProp ?? entityIdInner;
  const setEntityId = onEntityIdChange ?? setEntityIdInner;

  const [ownerOptions, setOwnerOptions] = useState<{ entityId: string; label: string }[]>([]);
  const [skyParamT, setSkyParamT] = useState("");
  const [sea, setSea] = useState<AimSeaSegment[]>([]);
  const [seaAimEnabled, setSeaAimEnabled] = useState(false);
  const [skyAimEnabled, setSkyAimEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectedCam = useMemo(() => {
    const id = entityId.trim().toLowerCase();
    if (!id) return null;
    return cameras.find((c) => c.entityId.trim().toLowerCase() === id) ?? null;
  }, [cameras, entityId]);

  useEffect(() => {
    onBusyChange?.({ loading, saving });
  }, [loading, saving, onBusyChange]);

  const applyCameraDraft = useCallback((cam: AimCameraParams | null) => {
    if (!cam) {
      setSkyParamT("");
      setSea([]);
      setSeaAimEnabled(false);
      setSkyAimEnabled(false);
      return;
    }
    setSkyParamT(cam.skyParamT ?? "");
    setSeaAimEnabled(cam.seaAimEnabled === true);
    setSkyAimEnabled(cam.skyAimEnabled === true);
    setSea([...(cam.sea ?? [])]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await ensureEntitiesTrackTaskCache(true);
      const owners = listTrackTaskOwnerRows().map((r) => ({
        entityId: r.entityId,
        label: r.label?.trim() ? `${r.label} (${r.entityId})` : r.entityId,
      }));
      setOwnerOptions(owners);

      const { res, data } = await fetchEoAimParams({ backendBaseUrl });
      if (!res.ok || !data.ok) {
        const msg = data.detail ?? data.error ?? `HTTP ${res.status}`;
        setLoadError(msg);
        toast.error("读取对准开关失败", { description: msg.slice(0, 240) });
        return;
      }
      const cams = Array.isArray(data.cameras) ? data.cameras : [];
      setCameras(cams);

      const allowed = new Set(owners.map((o) => o.entityId.toLowerCase()));
      const preferred = cams.filter((c) => {
        const id = c.entityId.trim().toLowerCase();
        if (!allowed.has(id)) return false;
        if (c.hasPtz === false) return false;
        if (c.parent === false) return false;
        return true;
      });
      const pick = preferred.length > 0 ? preferred : cams.filter((c) => allowed.has(c.entityId.toLowerCase()));

      const nextId =
        entityId && pick.some((c) => c.entityId.toLowerCase() === entityId.toLowerCase())
          ? entityId
          : pick[0]?.entityId ?? owners[0]?.entityId ?? "";
      if (!entityIdProp) setEntityIdInner(nextId);
      else if (nextId && nextId !== entityId) onEntityIdChange?.(nextId);

      const cam = cams.find((c) => c.entityId.toLowerCase() === nextId.toLowerCase()) ?? null;
      applyCameraDraft(cam);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      toast.error("读取对准开关异常", { description: msg });
    } finally {
      setLoading(false);
    }
    // entityId 变化时用 applyCameraDraft 即可，避免反复整表拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyCameraDraft, backendBaseUrl, entityIdProp]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  useEffect(() => {
    if (!active || reloadToken <= 0) return;
    void load();
  }, [reloadToken, active, load]);

  useEffect(() => {
    if (!entityId || cameras.length === 0) return;
    const cam = cameras.find((c) => c.entityId.toLowerCase() === entityId.toLowerCase()) ?? null;
    applyCameraDraft(cam);
  }, [entityId, cameras, applyCameraDraft]);

  const applyToCamServer = useCallback(async () => {
    if (saving || !selectedCam) return;
    setSaving(true);
    try {
      const { res, data } = await postEoAimParams({
        cameraIndex: selectedCam.cameraIndex,
        skyParamT,
        sea,
        seaAimEnabled,
        skyAimEnabled,
        backendBaseUrl,
      });
      const ok = res.ok && data.ok !== false;
      if (ok) {
        const cams = Array.isArray(data.cameras) ? data.cameras : cameras;
        setCameras(cams);
        const refreshed =
          (data.camera ? data.camera : null) ??
          cams.find((c) => c.cameraIndex === selectedCam.cameraIndex) ??
          null;
        if (refreshed) applyCameraDraft(refreshed);
        toast.success("对准开关已热更新", {
          description: `ConfigAIM${selectedCam.cameraIndex}.ini · 对海 ${
            seaAimEnabled ? "启用" : "关闭"
          } · 对空 ${skyAimEnabled ? "启用" : "关闭"}`,
        });
      } else {
        const msg = data.detail ?? data.error ?? `HTTP ${res.status}`;
        toast.error("更新对准开关失败", { description: String(msg).slice(0, 240) });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("更新对准开关异常", { description: msg });
    } finally {
      setSaving(false);
    }
  }, [
    applyCameraDraft,
    backendBaseUrl,
    cameras,
    saving,
    sea,
    seaAimEnabled,
    selectedCam,
    skyAimEnabled,
    skyParamT,
  ]);

  useEffect(() => {
    if (!active || saveToken <= 0) return;
    void applyToCamServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveToken]);

  if (!active) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-white/45">对准 aimConfig</h3>
      {loadError ? (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">{loadError}</p>
      ) : null}
      <p className="text-[11px] text-white/40">
        仅开关：启用后使用正式 ConfigAIM 中全部区段/SkyAimParam；关闭走硬编码（配置保留不删）。
        {selectedCam ? ` · cameraIndex=${selectedCam.cameraIndex}` : ""}
      </p>

      {!entityIdProp ? (
        <label className="flex max-w-md flex-col gap-1">
          <span className="text-white/55">相机</span>
          <select
            className="h-8 rounded border border-white/15 bg-black/40 px-2 text-white outline-none focus:border-nexus-accent"
            value={entityId}
            disabled={loading || ownerOptions.length === 0}
            onChange={(e) => setEntityId(e.target.value)}
          >
            {ownerOptions.length === 0 ? (
              <option value="">无可用相机</option>
            ) : (
              ownerOptions.map((o) => (
                <option key={o.entityId} value={o.entityId}>
                  {o.label}
                </option>
              ))
            )}
          </select>
        </label>
      ) : null}

      <label className="flex max-w-md cursor-pointer items-center gap-2 rounded border border-white/10 bg-black/25 px-3 py-2">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-nexus-accent"
          checked={seaAimEnabled}
          disabled={loading || !selectedCam}
          onChange={(e) => setSeaAimEnabled(e.target.checked)}
        />
        <span className="text-white/80">启用对海对准 aimConfig</span>
      </label>

      <label className="flex max-w-md cursor-pointer items-center gap-2 rounded border border-white/10 bg-black/25 px-3 py-2">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-nexus-accent"
          checked={skyAimEnabled}
          disabled={loading || !selectedCam}
          onChange={(e) => setSkyAimEnabled(e.target.checked)}
        />
        <span className="text-white/80">启用对空对准 aimConfig</span>
      </label>
    </section>
  );
}
