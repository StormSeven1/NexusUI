"use client";

import { createPortal } from "react-dom";
import { Plane } from "lucide-react";
import { cn } from "@/lib/utils";

export type DroneMenuState = {
  clientX: number;
  clientY: number;
  entityId: string;
  displayName: string;
};

const itemCls = cn(
  "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs font-medium outline-none",
  "text-nexus-text-secondary hover:bg-white/10 hover:text-nexus-text-primary",
);

export function DroneContextMenu({
  open,
  state,
  onClose,
  onReturnHome,
}: {
  open: boolean;
  state: DroneMenuState | null;
  onClose: () => void;
  onReturnHome: (entityId: string) => void | Promise<void>;
}) {
  if (!open || !state || typeof document === "undefined") return null;

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
        <button
          type="button"
          className={itemCls}
          onClick={() => {
            void onReturnHome(state.entityId);
            onClose();
          }}
        >
          <Plane size={14} className="text-sky-400" />
          无人机返航
        </button>
      </div>
    </div>,
    document.body,
  );
}
