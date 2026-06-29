"use client";

import type { UavControlAction } from "@/lib/eo-video/uavControlClient";
import { useEoVideoPanelFocusStore } from "@/stores/eo-video-panel-focus-store";

export type LangGraphUavCommandHandler = (action: UavControlAction) => Promise<boolean>;

const handlers = new Map<string, LangGraphUavCommandHandler>();

/** LangGraph `matched_command` → 光电窗 UAV 控制 action（与 `EoVideoPanel` 按钮一致） */
export const LANGGRAPH_UAV_COMMAND_ACTION: Record<string, UavControlAction> = {
  uav_return_to_base: "back",
  uav_emergency_stop: "emergency",
};

export function registerLangGraphUavCommandHandler(
  dockPanelId: string,
  handler: LangGraphUavCommandHandler,
): void {
  const id = dockPanelId.trim();
  if (!id) return;
  handlers.set(id, handler);
}

export function unregisterLangGraphUavCommandHandler(dockPanelId: string): void {
  handlers.delete(dockPanelId.trim());
}

export function langGraphCommandToUavAction(cmd: string): UavControlAction | null {
  return LANGGRAPH_UAV_COMMAND_ACTION[cmd.trim()] ?? null;
}

function actionLabel(action: UavControlAction): string {
  if (action === "back") return "返航";
  if (action === "emergency") return "急停";
  return action;
}

export async function dispatchLangGraphUavControl(action: UavControlAction): Promise<{
  ok: boolean;
  message: string;
}> {
  const focusedId = useEoVideoPanelFocusStore.getState().focusedDockPanelId;
  const handler = handlers.get(focusedId);
  if (!handler) {
    return {
      ok: false,
      message: "请先在光电窗口选中并播放无人机画面后再执行该指令。",
    };
  }
  try {
    const ok = await handler(action);
    const label = actionLabel(action);
    if (ok) {
      return { ok: true, message: `已对当前选中光电窗口中的无人机下发${label}指令。` };
    }
    return {
      ok: false,
      message: `${label}指令下发失败，请确认光电窗已连接无人机且机场 SN 可用。`,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
