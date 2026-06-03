import { create } from "zustand";
import {
  parseThirdPartyDevStatusBasicFromPayload,
  type ThirdPartyDevStatusBasic,
} from "@/lib/eo-video/parseThirdPartyDevStatusBasic";
import {
  parseThirdPartyWideSubLayoutFromPayload,
  type ThirdPartyWideSubCamBox,
} from "@/lib/eo-video/parseThirdPartyWideSubLayout";
import { normThirdPartyEntityId } from "@/lib/eo-video/thirdPartyEntityId";
import { recordThirdPartyDevStatusBasicReceived } from "@/stores/network-stats-store";
import { diagnoseThirdPartyPtzFovSkips, resolveThirdPartyPtzFovRows } from "@/lib/third-party-ptz-fov";
import { useAssetStore } from "@/stores/asset-store";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { useMapGisCameraMenuStore } from "@/stores/map-gis-camera-menu-store";

type Row = {
  wideSubCams: ThirdPartyWideSubCamBox[] | undefined;
  /** MSG_DEV_STATUS_BASIC 上报的当前方位（DIRECTMOVE 基准） */
  devStatus?: ThirdPartyDevStatusBasic;
  /** 最近一次收到 0x1001 的时间（视场 10s 超时） */
  devStatusAt?: number;
  /** MSG_CAM_IMAGE_REPORT 当前帧是否含检测框 */
  hasTarget: boolean;
  updatedAt: number;
  lastSequence?: number;
};

interface State {
  byEntityId: Record<string, Row>;
  /** 中继 WS 文本帧 `thirdPartyDevStatusBasic`（UDP `0x1001` JSON） */
  ingestDevStatusBasic: (d: Record<string, unknown>) => void;
  /** 中继 WS 二进制帧（UDP `0x5001` 图像上报，含检测框） */
  ingestImageReport: (entityId: string, hasBoxes: boolean) => void;
}

function rowKeyFromPayload(d: Record<string, unknown>): string {
  const raw = String(d.entityId ?? d.entity_id ?? "").trim();
  if (!raw) return "";
  return normThirdPartyEntityId(raw);
}

function parseSequence(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n >>> 0;
}

/**
 * UDP 序号按 uint32 递增，允许环回。
 * 返回 true 表示 next 比 prev 更新（或 prev 缺失）。
 */
function isNewerSequence(prev: number | undefined, next: number | undefined): boolean {
  if (next === undefined) return true;
  if (prev === undefined) return true;
  if (next === prev) return false;
  const HALF = 0x80000000;
  return ((next - prev) >>> 0) < HALF;
}

export const useEoThirdPartyUdpDevStatusStore = create<State>((set, get) => ({
  byEntityId: {},
  ingestDevStatusBasic: (d) => {
    const key = rowKeyFromPayload(d);
    if (!key) return;
    const prevRow = get().byEntityId[key];
    const nextSequence = parseSequence(d.sequence ?? d.seq);
    if (!isNewerSequence(prevRow?.lastSequence, nextSequence)) return;
    const wide = parseThirdPartyWideSubLayoutFromPayload(d);
    const prev = prevRow?.wideSubCams;
    const nextWide = wide === undefined ? prev : wide;
    const devStatus = parseThirdPartyDevStatusBasicFromPayload(d);
    const prevDev = prevRow?.devStatus;
    const nextDev: ThirdPartyDevStatusBasic | undefined =
      devStatus === undefined
        ? prevDev
        : {
            pan: devStatus.pan,
            tilt: devStatus.tilt,
            panVehicle: devStatus.panVehicle ?? prevDev?.panVehicle,
            zoom: devStatus.zoom ?? prevDev?.zoom,
            lat: devStatus.lat ?? prevDev?.lat,
            lng: devStatus.lng ?? prevDev?.lng,
          };
    set({
      byEntityId: {
        ...get().byEntityId,
        [key]: {
          wideSubCams: nextWide,
          devStatus: nextDev,
          devStatusAt: Date.now(),
          hasTarget: prevRow?.hasTarget ?? false,
          updatedAt: Date.now(),
          lastSequence: nextSequence ?? prevRow?.lastSequence,
        },
      },
    });
    recordThirdPartyDevStatusBasicReceived(key);
  },
  ingestImageReport: (entityId, hasBoxes) => {
    const key = normThirdPartyEntityId(entityId.trim());
    if (!key) return;
    const prevRow = get().byEntityId[key];
    if (prevRow?.hasTarget === hasBoxes) return;
    set({
      byEntityId: {
        ...get().byEntityId,
        [key]: {
          wideSubCams: prevRow?.wideSubCams,
          devStatus: prevRow?.devStatus,
          devStatusAt: prevRow?.devStatusAt,
          hasTarget: hasBoxes,
          updatedAt: Date.now(),
          lastSequence: prevRow?.lastSequence,
        },
      },
    });
  },
}));

/** 开发/调试：读取当前 0x1001 解析结果（非全局变量，需经 window 或本函数） */
export function getThirdPartyUdpDevStatusSnapshot() {
  return useEoThirdPartyUdpDevStatusStore.getState().byEntityId;
}

declare global {
  interface Window {
    /** 控制台：`useEoThirdPartyUdpDevStatusStore.getState().byEntityId`（开发/调试别名） */
    useEoThirdPartyUdpDevStatusStore?: typeof useEoThirdPartyUdpDevStatusStore;
    /** 控制台：`__nexusThirdPartyUdpDevStatus()` 或 `__nexusThirdPartyUdpDevStatus("camera-hs-001")` */
    __nexusThirdPartyUdpDevStatus?: (entityId?: string) => unknown;
    /** 控制台：`__nexusThirdPartyPtzFovRows()` 看 2D 地图实际用于画扇形的行 */
    __nexusThirdPartyPtzFovRows?: () => unknown;
    /** 控制台：`__nexusThirdPartyFovDebug()` 排查颜色/检测框/图层 */
    __nexusThirdPartyFovDebug?: () => unknown;
  }
}

if (
  typeof window !== "undefined" &&
  (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_EO_VIDEO_DEBUG_UI === "true")
) {
  window.useEoThirdPartyUdpDevStatusStore = useEoThirdPartyUdpDevStatusStore;
  window.__nexusThirdPartyUdpDevStatus = (entityId?: string) => {
    const all = useEoThirdPartyUdpDevStatusStore.getState().byEntityId;
    if (!entityId?.trim()) return all;
    return all[normThirdPartyEntityId(entityId)] ?? null;
  };
  window.__nexusThirdPartyPtzFovRows = () =>
    resolveThirdPartyPtzFovRows(
      useMapGisCameraMenuStore.getState().rows,
      useAssetStore.getState().assets,
      useEoCameraDdsStatusStore.getState().byEntityId,
      useEoThirdPartyUdpDevStatusStore.getState().byEntityId,
    );
  window.__nexusThirdPartyFovDebug = () => {
    const menu = useMapGisCameraMenuStore.getState();
    const udp = useEoThirdPartyUdpDevStatusStore.getState().byEntityId;
    const dds = useEoCameraDdsStatusStore.getState().byEntityId;
    const rows = resolveThirdPartyPtzFovRows(
      menu.rows,
      useAssetStore.getState().assets,
      dds,
      udp,
    );
    const skips = diagnoseThirdPartyPtzFovSkips(
      menu.rows,
      useAssetStore.getState().assets,
      dds,
      udp,
    );
    return {
      menuLoaded: menu.loaded,
      menuError: menu.lastError,
      thirdPartyMenuIds: menu.rows.filter((r) => r.kind === "thirdParty").map((r) => r.entityId),
      udpKeys: Object.keys(udp),
      ddsKeys: Object.keys(dds),
      fovRows: rows,
      skipReasons: skips,
      udpHasTarget: Object.fromEntries(
        Object.entries(udp).map(([k, v]) => [k, v?.hasTarget === true]),
      ),
      ddsOriginPan: Object.fromEntries(
        Object.entries(dds).map(([k, v]) => [k, v?.originPtzPanDeg]),
      ),
      expectedLayerId: "third-party-ptz-fov-fill-v2",
      legacyLayerId: "third-party-ptz-fov-fill",
    };
  };
}
