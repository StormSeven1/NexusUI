import { create } from "zustand";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  parseThirdPartyWideSubLayoutFromPayload,
  type ThirdPartyWideSubCamBox,
} from "@/lib/eo-video/parseThirdPartyWideSubLayout";
import {
  parseThirdPartyDevStatusBasicFromPayload,
  type ThirdPartyDevStatusBasic,
} from "@/lib/eo-video/parseThirdPartyDevStatusBasic";

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
  return canonicalEntityId(raw) || raw.toLowerCase();
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
  },
  ingestImageReport: (entityId, hasBoxes) => {
    const key = canonicalEntityId(entityId.trim()) || entityId.trim().toLowerCase();
    if (!key) return;
    const prevRow = get().byEntityId[key];
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
