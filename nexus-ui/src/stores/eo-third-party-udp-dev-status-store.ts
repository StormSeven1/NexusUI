import { create } from "zustand";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  parseThirdPartyWideSubLayoutFromPayload,
  type ThirdPartyWideSubCamBox,
} from "@/lib/eo-video/parseThirdPartyWideSubLayout";

type Row = {
  wideSubCams: ThirdPartyWideSubCamBox[] | undefined;
  updatedAt: number;
  lastSequence?: number;
};

interface State {
  byEntityId: Record<string, Row>;
  /** 中继 WS 文本帧 `thirdPartyDevStatusBasic`（UDP `0x1001` JSON） */
  ingestDevStatusBasic: (d: Record<string, unknown>) => void;
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
    set({
      byEntityId: {
        ...get().byEntityId,
        [key]: { wideSubCams: nextWide, updatedAt: Date.now(), lastSequence: nextSequence ?? prevRow?.lastSequence },
      },
    });
  },
}));
