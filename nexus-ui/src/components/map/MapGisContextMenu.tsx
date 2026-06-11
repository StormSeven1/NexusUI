"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CameraManagementClient,
  DEFAULT_LOOK_AT_CHECK_TIME,
  buildImportantTrackTaskBody,
  buildLookAtChildTaskBody,
} from "@/lib/camera-management-client";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  buildImportantTrackTargetFromTrack,
  numericTrackIdForDroneTask,
} from "@/lib/map-gis-camera-task";
import { uavFlightTaskTargetSourceId } from "@/lib/map-gis-uav-track-task";
import { fetchMapGisEoMenuContext, type MapGisEoMenuContext } from "@/lib/map-gis-eo-menu-context";
import {
  buildMapGisCameraMenuRows,
  type MapGisCameraMenuRow,
} from "@/lib/map-gis-camera-menu-rows";
import {
  collectMapGisDroneRowsSync,
  mapGisDroneEoFallbackLabel,
  mapGisDroneSyncSignature,
  mergeMapGisDroneRowsPreferSync,
  type MapGisDroneRow,
} from "@/lib/map-gis-drone-rows";
import type { Track } from "@/lib/map-entity-model";
import {
  ensureEntitiesTrackTaskCache,
  listTrackTaskOwnerRows,
} from "@/lib/entities-track-task-cache";
import { postUavSpotFlyToTask } from "@/lib/eo-video/uavSpotFlyClient";
import { postUavTrackFollowTask } from "@/lib/eo-video/uavTrackFollowClient";
import { useAssetStore } from "@/stores/asset-store";
import { useEoFocusedUavAirportSnStore } from "@/stores/eo-focused-uav-airport-sn-store";
import { useDroneStore } from "@/stores/drone-store";
import { useTrackStore } from "@/stores/track-store";
import { resolveUniqueIdFromTrack, sendAlarmConfirmRequest } from "@/lib/alarm-confirm-api";
import { useAppConfigStore } from "@/stores/app-config-store";

export type MapGisMenuState = {
  clientX: number;
  clientY: number;
  lng: number;
  lat: number;
  variant: "map" | "track";
  /** `Track.id` / showID */
  trackId: string | null;
};

const panelCls =
  "min-w-[11rem] max-h-[min(70vh,420px)] overflow-y-auto rounded-md border border-white/[0.1] bg-nexus-bg-overlay p-1 shadow-xl backdrop-blur-sm";

const itemCls = cn(
  "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs font-medium outline-none",
  "text-nexus-text-secondary hover:bg-white/10 hover:text-nexus-text-primary",
);

const subTriggerCls = cn(itemCls, "justify-between pr-1");

async function toastCameraTask(fn: () => Promise<boolean>, okMsg: string) {
  try {
    const ok = await fn();
    if (ok) toast.success(okMsg);
    else {
      console.warn("[map-gis-menu] 任务回调返回 false（未抛错）:", okMsg);
      toast.error("任务下发未全部成功（原因已输出到控制台 [map-gis-menu]）");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[map-gis-menu] 任务异常:", okMsg, e);
    toast.error(msg);
  }
}

/** WatchSys `sendSpotFlightRequest3`：任务服务 DroneFlyTo（非 MQTT takeoff_to_point） */
async function spotFlyRecon(latitude: number, longitude: number, airportSN: string) {
  const ap = airportSN.trim();
  if (!ap) {
    console.warn("[map-gis-menu] spot-fly: airportSN 为空");
    return false;
  }
  const r = await postUavSpotFlyToTask({ latitude, longitude, airportSN: ap });
  return r.ok === true;
}

/** WatchSys `PtzMainWidget::SendUavFlightTask`：`MultiDroneTracking`，`mode=1`、`rectID`/`rectType=-1`、`traceMode=0` */
async function uavTrackFollowOnTrack(track: Track, airportSN: string) {
  const ap = airportSN.trim();
  if (!ap) {
    console.warn("[map-gis-menu] track-follow: airportSN 为空");
    return false;
  }
  const tid = numericTrackIdForDroneTask(track);
  if (tid === 0) {
    console.warn("[map-gis-menu] track-follow: 业务 track_id 解析为 0", {
      showID: track.showID,
      uniqueID: track.uniqueID,
      trackId: track.trackId,
    });
    return false;
  }
  const r = await postUavTrackFollowTask({
    airportSN: ap,
    trackId: tid,
    latitude: track.lat,
    longitude: track.lng,
    targetSourceId: uavFlightTaskTargetSourceId(track),
    mode: 1,
    rectID: -1,
    rectType: -1,
    traceMode: 0,
  });
  return r.ok === true;
}

/** 与子菜单 open 配套的触发项矩形（viewport） */
type SubCascade = null | {
  key: "cam-map" | "uav-map" | "cam-trk" | "uav-trk" | "aff";
  anchor: DOMRectReadOnly;
};

function clampCascadePosition(anchor: DOMRectReadOnly, subW: number, subH: number, gap = 6) {
  const pad = 8;
  let left = anchor.right + gap;
  let top = anchor.top;

  if (left + subW > window.innerWidth - pad) {
    left = anchor.left - subW - gap;
  }
  if (left < pad) left = pad;

  if (top + subH > window.innerHeight - pad) {
    top = window.innerHeight - subH - pad;
  }
  if (top < pad) top = pad;

  return { left, top };
}

function CascadeMenu({
  cascade,
  subRef,
  measureRevision,
  children,
}: {
  cascade: NonNullable<SubCascade>;
  subRef: React.RefObject<HTMLDivElement | null>;
  /** 列表项数量变化后重算贴边定位 */
  measureRevision: number;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top: number }>(() => ({
    left: cascade.anchor.right + 6,
    top: cascade.anchor.top,
  }));

  const ax = cascade.anchor;
  useLayoutEffect(() => {
    const el = subRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(clampCascadePosition(ax, r.width, r.height));
  }, [cascade.key, measureRevision, ax.top, ax.right, ax.bottom, ax.left, ax.width, ax.height]);

  useEffect(() => {
    const onResize = () => {
      const el = subRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos(clampCascadePosition(ax, r.width, r.height));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measureRevision, ax.top, ax.right, ax.bottom, ax.left, ax.width, ax.height]);

  return (
    <div
      ref={subRef}
      role="menu"
      data-map-gis-sub
      className={cn(panelCls, "fixed z-[460]")}
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(ev) => ev.stopPropagation()}
    >
      {children}
    </div>
  );
}

type SubKey = NonNullable<SubCascade>["key"];

export function MapGisContextMenu({
  open,
  state,
  onClose,
}: {
  open: boolean;
  state: MapGisMenuState;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [cascade, setCascade] = useState<SubCascade>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const subPanelRef = useRef<HTMLDivElement>(null);

  const track = useTrackStore((s) =>
    state.variant === "track" && state.trackId ? s.tracks.find((t) => t.id === state.trackId) ?? null : null,
  );

  const [trackOwnersEpoch, setTrackOwnersEpoch] = useState(0);

  const dronesMap = useDroneStore((s) => s.drones);
  const droneToAirport = useDroneStore((s) => s.droneToAirport);
  const airportRelSig = useDroneStore((s) =>
    (s.relationships?.airports ?? [])
      .map((a) => `${a.dockSn}:${a.drones.map((d) => d.deviceSn).sort().join(",")}`)
      .join(";"),
  );
  const droneAssetSig = useAssetStore((s) => mapGisDroneSyncSignature(s.assets));

  const syncDroneRows = useMemo(
    () => collectMapGisDroneRowsSync(),
    [dronesMap, droneToAirport, airportRelSig, droneAssetSig],
  );

  const [eoMenuCtx, setEoMenuCtx] = useState<MapGisEoMenuContext | null>(null);
  const eoFocusedAirportSn = useEoFocusedUavAirportSnStore((s) => s.airportSn);

  useEffect(() => setMounted(typeof document !== "undefined"), []);

  useEffect(() => {
    if (!open) {
      setEoMenuCtx(null);
      return;
    }
    let cancelled = false;
    void fetchMapGisEoMenuContext().then((ctx) => {
      if (!cancelled) setEoMenuCtx(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const drones = useMemo(
    () => mergeMapGisDroneRowsPreferSync(syncDroneRows, eoMenuCtx?.registryDroneRows ?? []),
    [syncDroneRows, eoMenuCtx],
  );

  const cameraMenuLabel = (c: Pick<MapGisCameraMenuRow, "entityId" | "label">) => {
    const id = canonicalEntityId(c.entityId.trim());
    const fromEo = eoMenuCtx?.cameraLabelByEntityId.get(id);
    if (fromEo?.trim()) return fromEo.trim();
    return c.label.trim() || id;
  };

  const droneMenuLabel = (d: MapGisDroneRow) => {
    const fromEo = eoMenuCtx?.droneLabelByDeviceSn.get(d.sn);
    if (fromEo?.trim()) return fromEo.trim();
    return mapGisDroneEoFallbackLabel(d.sn) || d.label.trim() || d.sn;
  };

  useEffect(() => {
    if (!open) setCascade(null);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    void ensureEntitiesTrackTaskCache()
      .then(() => setTrackOwnersEpoch((e) => e + 1))
      .catch(() => setTrackOwnersEpoch((e) => e + 1));
  }, [open]);

  const cameras = useMemo(() => {
    void trackOwnersEpoch;
    return buildMapGisCameraMenuRows(listTrackTaskOwnerRows(), eoMenuCtx);
  }, [trackOwnersEpoch, eoMenuCtx]);

  const toggleCascade = (key: SubKey, el: HTMLElement) => {
    setCascade((prev) => {
      if (prev?.key === key) return null;
      return { key, anchor: el.getBoundingClientRect() };
    });
  };

  const backdropDown = (e: React.MouseEvent) => {
    const t = e.target as Node | null;
    if (mainRef.current?.contains(t)) return;
    if (subPanelRef.current?.contains(t)) return;
    onClose();
  };

  if (!mounted || !open) return null;

  const CameraSubItems = ({
    variant,
    track: tr,
  }: {
    variant: "lookAt" | "important";
    track: NonNullable<typeof track> | null;
  }) => (
    <>
      {cameras.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-nexus-text-muted opacity-60">
          暂无可选相机（实体快照中无 PTZ 主相机，且未从实体服务筛出第三方相机）
        </div>
      ) : (
        cameras.map((c) => (
          <button
            key={c.entityId}
            type="button"
            className={itemCls}
            onClick={() => {
              const disp = cameraMenuLabel(c);
              void toastCameraTask(async () => {
                const cfg = await useAppConfigStore.getState().ensureLoaded();
                const cm = cfg.cameraManagement;
                if (!cm) {
                  toast.error("未配置 cameraManagement");
                  return false;
                }
                try {
                  await ensureEntitiesTrackTaskCache();
                } catch {
                  /* */
                }
                const client = CameraManagementClient.fromConfig(cm);
                if (!client) {
                  console.warn("[map-gis-menu] 相机任务: CameraManagementClient 未创建", { entityId: c.entityId });
                  return false;
                }

                if (variant === "lookAt") {
                  const lookAt = {
                    latitude: state.lat,
                    longitude: state.lng,
                    trackID: 0,
                    shipType: 3,
                    checkTime: DEFAULT_LOOK_AT_CHECK_TIME,
                  };
                  /** 与 `Map2D` 地图空白双击 `CAMERA_LOOK_AT_CHILD` 一致，仅对当前所选一台 owner 下发（双击为全部 owner 循环） */
                  const body = buildLookAtChildTaskBody(cm, c.entityId, lookAt, { taskIdSuffix: c.entityId });
                  const res = await client.publishTask(body);
                  if (!res.ok || res.networkError) {
                    console.warn("[map-gis-menu] LookAtChild 下发失败", { entityId: c.entityId, res });
                  }
                  return res.ok && !res.networkError;
                }

                if (!tr) {
                  console.warn("[map-gis-menu] 航迹跟踪: track 为空");
                  return false;
                }
                const target = buildImportantTrackTargetFromTrack(tr);
                const body = buildImportantTrackTaskBody(cm, c.entityId, target, {
                  taskIdSuffix: c.entityId,
                });
                const res = await client.publishTask(body);
                if (!res.ok || res.networkError) {
                  console.warn("[map-gis-menu] 重点关注任务下发失败", { entityId: c.entityId, showID: tr.showID, res });
                }
                return res.ok && !res.networkError;
              }, variant === "lookAt" ? `光电已对准当前点（${disp}）` : `已下发光电跟踪任务（${disp}）`);
              onClose();
            }}
          >
            {cameraMenuLabel(c)}
          </button>
        ))
      )}
    </>
  );

  const DroneSubItems = ({
    lat,
    lng,
    okToast,
    trackForFollow,
  }: {
    lat: number;
    lng: number;
    okToast: (label: string) => string;
    /** 航迹右键：下发 `SendUavFlightTask`；地图右键：仍为 DroneFlyTo 侦察 */
    trackForFollow?: Track | null;
  }) => (
    <>
      {drones.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-nexus-text-muted opacity-60">暂无无人机</div>
      ) : (
        drones.map((d) => (
          <button
            key={d.sn}
            type="button"
            className={itemCls}
            onClick={() => {
              const disp = droneMenuLabel(d);
              if (trackForFollow) {
                const tid = numericTrackIdForDroneTask(trackForFollow);
                if (tid === 0) {
                  toast.error("当前航迹无有效业务 track_id，无法下发无人机跟踪");
                  onClose();
                  return;
                }
              }
              void toastCameraTask(async () => {
                if (trackForFollow) return uavTrackFollowOnTrack(trackForFollow, d.airportSN);
                return spotFlyRecon(lat, lng, d.airportSN);
              }, okToast(disp));
              onClose();
            }}
          >
            {droneMenuLabel(d)}
          </button>
        ))
      )}
    </>
  );

  function AffiliationSubItems({ tr }: { tr: Track }) {
    return (
      <>
        {(
          [
            ["unknown", "不明"],
            ["red", "红方"],
            ["blue", "蓝方"],
            ["white", "白方"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={itemCls}
            onClick={() => {
              useTrackStore.getState().setManualTrackAffiliation(tr.showID, k);
              toast.success(`已设为：${label}`);
              if (k === "blue") {
                const uniqueId = resolveUniqueIdFromTrack(tr);
                if (uniqueId == null) {
                  toast.error("确认告警失败：航迹缺少 uniqueId");
                } else {
                  void sendAlarmConfirmRequest(uniqueId).then((result) => {
                    if (result.ok) {
                      toast.success("已确认告警", { description: `uniqueId ${uniqueId}` });
                    } else {
                      toast.error("确认告警失败", { description: result.message ?? "告警服务无响应" });
                    }
                  });
                }
              }
              onClose();
            }}
          >
            {label}
          </button>
        ))}
      </>
    );
  }

  let cascadeBody: React.ReactNode = null;
  if (cascade) {
    if (cascade.key === "cam-map") cascadeBody = <CameraSubItems variant="lookAt" track={null} />;
    else if (cascade.key === "cam-trk" && track) cascadeBody = <CameraSubItems variant="important" track={track} />;
    else if (cascade.key === "uav-map")
      cascadeBody = (
        <DroneSubItems lat={state.lat} lng={state.lng} okToast={(lbl) => `已下发多点飞行侦察（${lbl}）`} />
      );
    else if (cascade.key === "uav-trk" && track)
      cascadeBody = (
        <DroneSubItems
          lat={track.lat}
          lng={track.lng}
          trackForFollow={track}
          okToast={(lbl) => `已下发无人机跟踪任务（${lbl}）`}
        />
      );
    else if (cascade.key === "aff" && track) cascadeBody = <AffiliationSubItems tr={track} />;
    else cascadeBody = null;
  }

  const menuBody =
    state.variant === "map" ? (
      <>
        <button
          type="button"
          className={itemCls}
          onClick={() => {
            void toastCameraTask(async () => {
              const ap = eoFocusedAirportSn.trim();
              if (!ap) {
                toast.error("请先在光电窗口选中 UAV 流且能解析到机场 SN（当前焦点光电无机场映射）");
                return false;
              }
              return spotFlyRecon(state.lat, state.lng, ap);
            }, "已下发无人机多点飞行侦察（当前光电机场）");
            onClose();
          }}
        >
          无人机侦察此位置
        </button>

        <button
          type="button"
          className={cn(subTriggerCls, cascade?.key === "cam-map" ? "bg-white/10" : "")}
          onClick={(e) => toggleCascade("cam-map", e.currentTarget)}
        >
          <span className="min-w-0 flex-1">选择光电看向此位置</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        </button>

        <button
          type="button"
          className={cn(subTriggerCls, cascade?.key === "uav-map" ? "bg-white/10" : "")}
          onClick={(e) => toggleCascade("uav-map", e.currentTarget)}
        >
          <span className="min-w-0 flex-1">选择无人机侦察此位置</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </>
    ) : track ? (
      <>
        <button
          type="button"
          className={cn(subTriggerCls, cascade?.key === "cam-trk" ? "bg-white/10" : "")}
          onClick={(e) => toggleCascade("cam-trk", e.currentTarget)}
        >
          <span className="min-w-0 flex-1">选择光电跟踪此目标</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        </button>

        <button
          type="button"
          className={itemCls}
          onClick={() => {
            const tid = numericTrackIdForDroneTask(track);
            if (tid === 0) {
              toast.error("当前航迹无有效业务 track_id，无法下发无人机跟踪");
              onClose();
              return;
            }
            void toastCameraTask(async () => {
              const ap = eoFocusedAirportSn.trim();
              if (!ap) {
                toast.error("请先在光电窗口选中 UAV 流且能解析到机场 SN（当前焦点光电无机场映射）");
                return false;
              }
              return uavTrackFollowOnTrack(track, ap);
            }, "已下发无人机跟踪任务（当前光电机场）");
            onClose();
          }}
        >
          无人机跟踪此目标
        </button>

        <button
          type="button"
          className={cn(subTriggerCls, cascade?.key === "uav-trk" ? "bg-white/10" : "")}
          onClick={(e) => toggleCascade("uav-trk", e.currentTarget)}
        >
          <span className="min-w-0 flex-1">选择无人机跟踪此目标</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        </button>

        <div className="-mx-1 my-1 h-px bg-white/[0.08]" />

        <button
          type="button"
          className={cn(subTriggerCls, cascade?.key === "aff" ? "bg-white/10" : "")}
          onClick={(e) => toggleCascade("aff", e.currentTarget)}
        >
          <span className="min-w-0 flex-1">设置敌我属性</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </>
    ) : (
      <div className="px-2 py-1.5 text-xs text-nexus-text-muted opacity-60">未找到航迹数据</div>
    );

  return createPortal(
    <>
      <div className="fixed inset-0 z-[440]" aria-hidden onMouseDown={backdropDown} />
      <div
        ref={mainRef}
        role="menu"
        className={cn(panelCls, "fixed z-[450]")}
        style={{ left: state.clientX, top: state.clientY }}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        {menuBody}
      </div>
      {cascade && cascadeBody ? (
        <CascadeMenu
          key={cascade.key}
          cascade={cascade}
          subRef={subPanelRef}
          measureRevision={cameras.length * 4096 + drones.length}
        >
          {cascadeBody}
        </CascadeMenu>
      ) : null}
    </>,
    document.body,
  );
}
