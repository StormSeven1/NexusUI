"use client";

import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { mapEntityId } from "@/lib/area-entity-id";
import { deleteAreaWithEntity } from "@/lib/area-entity-client";
import { cn } from "@/lib/utils";

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

export function AreaDbContextMenu({
  open,
  state,
  onClose,
}: {
  open: boolean;
  state: AreaDbMenuState | null;
  onClose: () => void;
}) {
  if (!open || !state || typeof document === "undefined") return null;

  const onDelete = async () => {
    const eid = mapEntityId(state.groupId, state.areaId, state.areaType);
    const kind = state.areaType === 4 ? "航线" : "区域";
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
      className="fixed inset-0 z-[120]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="fixed min-w-[10rem] rounded-md border border-white/10 bg-nexus-bg-overlay p-1 shadow-xl backdrop-blur-sm"
        style={{ left: state.clientX, top: state.clientY }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={itemCls} onClick={() => void onDelete()}>
          <Trash2 size={14} className="text-red-400" />
          删除区域
        </button>
      </div>
    </div>,
    document.body,
  );
}
