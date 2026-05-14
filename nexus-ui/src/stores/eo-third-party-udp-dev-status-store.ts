import { create } from "zustand";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  parseThirdPartyWideSubLayoutFromPayload,
  type ThirdPartyWideSubCamBox,
} from "@/lib/eo-video/parseThirdPartyWideSubLayout";

type Row = {
  wideSubCams: ThirdPartyWideSubCamBox[] | undefined;
  updatedAt: number;
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

export const useEoThirdPartyUdpDevStatusStore = create<State>((set, get) => ({
  byEntityId: {},
  ingestDevStatusBasic: (d) => {
    const key = rowKeyFromPayload(d);
    if (!key) return;
    const wide = parseThirdPartyWideSubLayoutFromPayload(d);
    const prev = get().byEntityId[key]?.wideSubCams;
    const nextWide = wide === undefined ? prev : wide;
    set({
      byEntityId: {
        ...get().byEntityId,
        [key]: { wideSubCams: nextWide, updatedAt: Date.now() },
      },
    });
  },
}));
