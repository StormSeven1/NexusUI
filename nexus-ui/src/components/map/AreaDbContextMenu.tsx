"use client";

import { createPortal } from "react-dom";
import { Navigation, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { mapEntityId } from "@/lib/area-entity-id";
import { deleteAreaWithEntity } from "@/lib/area-entity-client";
import { lineFromAreaRoute } from "@/lib/area-table-geometry";
import { postUavSpotFlyToTask } from "@/lib/eo-video/uavSpotFlyClient";
import { cn } from "@/lib/utils";
import { useDbAreaStore } from "@/stores/db-area-store";
import { useEoFocusedUavAirportSnStore } from "@/stores/eo-focused-uav-airport-sn-store";

export type AreaDbMenuState = {
  clientX: number;
  clientY: number;
  groupId: number;
  areaId: number;
  areaType: number;
  areaName: string;
};

const itemCls = cn(
  "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs font-medium outline-none",
  "text-nexus-text-secondary hover:bg-white/10 hover:text-nexus-text-primary",
);

async function toastFly(fn: () => Promise<boolean>, okMsg: string) {
  try {
    const ok = await fn();
    if (ok) toast.success(okMsg);
    else toast.error("航线飞行任务未成功（原因已输出到控制台）");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[area-db-menu] route fly:", e);
    toast.error(msg);
  }
}

export function AreaDbContextMenu({
  open,
  state,
  onClose,
}: {
  open: boolean;
  state: AreaDbMenuState | null;
  onClose: () => void;
}) {
  const eoFocusedAirportSn = useEoFocusedUavAirportSnStore((s) => s.airportSn);

  if (!open || !state || typeof document === "undefined") return null;

  const isRoute = state.areaType === 4;

  const resolveRouteWaypoints = (): { latitude: number; longitude: number }[] | null => {
    const row = useDbAreaStore
      .getState()
      .rows.find((r) => r.group_id === state.groupId && r.area_id === state.areaId && r.area_type === 4);
    if (!row) return null;
    const line = lineFromAreaRoute(row);
    if (!line || line.length < 2) return null;
    return line.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  };

  const onFlyRoute = () => {
    void toastFly(async () => {
      const ap = eoFocusedAirportSn.trim();
      if (!ap) {
        toast.error("请先在光电窗口选中 UAV 流且能解析到机场 SN（当前焦点光电无机场映射）");
        return false;
      }
      const waypoints = resolveRouteWaypoints();
      if (!waypoints) {
        toast.error("无法解析航线折点");
        return false;
      }
      const r = await postUavSpotFlyToTask({ airportSN: ap, waypoints });
      return r.ok === true;
    }, "已下发按航线飞行（当前光电机场）");
    onClose();
  };

  const onDelete = async () => {
    const eid = mapEntityId(state.groupId, state.areaId, state.areaType);
    const kind = isRoute ? "航线" : "区域";
    if (
      !window.confirm(
        `删除${kind}「${state.areaName}」？\n将同时删除实体 ${eid} 与数据库记录。`,
      )
    ) {
      onClose();
      return;
    }
    const r = await deleteAreaWithEntity(state.groupId, state.areaId, state.areaType);
    onClose();
    if (!r.ok) window.alert(r.error ?? "删除失败");
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[440]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="fixed min-w-[10rem] rounded-md border border-white/10 bg-nexus-bg-overlay p-1 shadow-xl backdrop-blur-sm z-[450]"
        style={{ left: state.clientX, top: state.clientY }}
        onClick={(e) => e.stopPropagation()}
      >
        {isRoute ? (
          <button type="button" className={itemCls} onClick={onFlyRoute}>
            <Navigation size={14} className="text-sky-400" />
            无人机按航线飞行
          </button>
        ) : null}
        <button type="button" className={itemCls} onClick={() => void onDelete()}>
          <Trash2 size={14} className="text-red-400" />
          {isRoute ? "删除航线" : "删除区域"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
