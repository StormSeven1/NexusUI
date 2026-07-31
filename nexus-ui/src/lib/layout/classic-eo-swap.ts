import type { PanelId } from "@/components/dock/types";
import {
  CLASSIC_MAIN_EO_PANEL_ID,
  isClassicSubEoPanelId,
} from "@/lib/layout/classic-layout-config";
import { EO_ACTIVE_MAIN_STREAM_STORAGE_PREFIX } from "@/lib/eo-video/eoStreamSelectionKeys";
import { useEoVideoStreamSelectionSyncStore } from "@/stores/eo-video-stream-selection-sync-store";
import { useEoVideoPanelFocusStore } from "@/stores/eo-video-panel-focus-store";

function readPanelMainStreamId(panelId: string): string {
  const key = panelId.trim();
  if (!key) return "";
  const fromStore = useEoVideoStreamSelectionSyncStore.getState().mainBySyncKey[key]?.trim();
  if (fromStore) return fromStore;
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(EO_ACTIVE_MAIN_STREAM_STORAGE_PREFIX + key)?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * 经典布局：将右侧小窗当前主流与左侧大屏主流互换（经 stream sync store，两端面板会同步更新）。
 */
export function swapClassicSubWithMain(subPanelId: PanelId | string): boolean {
  const sub = String(subPanelId).trim();
  if (!isClassicSubEoPanelId(sub)) return false;
  const main = CLASSIC_MAIN_EO_PANEL_ID;
  const mainStream = readPanelMainStreamId(main);
  const subStream = readPanelMainStreamId(sub);
  if (!mainStream && !subStream) return false;
  if (mainStream && subStream && mainStream === subStream) return false;

  const sync = useEoVideoStreamSelectionSyncStore.getState();
  if (subStream) sync.setMainFromPanel(main, subStream);
  if (mainStream) sync.setMainFromPanel(sub, mainStream);
  useEoVideoPanelFocusStore.getState().setFocusedDockPanel(CLASSIC_MAIN_EO_PANEL_ID);
  return true;
}
