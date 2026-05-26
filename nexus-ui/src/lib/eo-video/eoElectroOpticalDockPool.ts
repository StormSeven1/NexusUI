import type { PanelId } from "@/components/dock/types";
import type { PanelWindowState } from "@/components/dock/types";
import { DEFAULT_Z_INDEX } from "@/components/dock/types";

/** 系统功能「新建光电窗口」可分配的独立实例数量 */
export const EO_ELECTRO_OPTICAL_INSTANCE_COUNT = 10;

/** `electro-optical-1` … `electro-optical-10` */
export const EO_ELECTRO_OPTICAL_PANEL_IDS: PanelId[] = Array.from(
  { length: EO_ELECTRO_OPTICAL_INSTANCE_COUNT },
  (_, i) => `electro-optical-${i + 1}` as PanelId,
);

export function createEoElectroOpticalDefaultPanelStates(): PanelWindowState[] {
  return EO_ELECTRO_OPTICAL_PANEL_IDS.map((id, index) => ({
    id,
    location: null,
    mode: "hidden" as const,
    position: { x: 340 + index * 40, y: 320 + index * 20 },
    size: { width: 360, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 10 + index,
  }));
}
