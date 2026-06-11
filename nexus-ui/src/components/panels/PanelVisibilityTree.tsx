"use client";

import { ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isPanelTreeLit,
  visibilityFromBoolean,
  type PanelTreeVisibilityState,
} from "@/lib/panel-tree-visibility";
import type { ReactNode } from "react";

export type { PanelTreeVisibilityState } from "@/lib/panel-tree-visibility";

/** 各面板树形显隐行统一缩进：每加深一层增加 16px */
export const PANEL_TREE_DEPTH_PX = 16;

export function panelTreePaddingLeft(depth: number): number {
  return 8 + depth * PANEL_TREE_DEPTH_PX;
}

/** 航迹类型 / 光电子项 / 区域子项等共用外框 */
export function PanelTreeGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-nexus-border/40 bg-nexus-bg-base/20",
        className,
      )}
    >
      {children}
    </div>
  );
}

function PanelTreeEye({
  state,
  size = 9,
}: {
  state: PanelTreeVisibilityState;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
        state === "all" && "border-nexus-border-accent bg-nexus-accent-glow/15 text-nexus-text-primary",
        state === "partial" &&
          "border border-dashed border-nexus-border-accent/55 bg-nexus-accent-glow/8 text-nexus-text-primary/65",
        state === "none" && "border-nexus-border bg-nexus-bg-sidebar text-nexus-text-muted",
      )}
      title={state === "partial" ? "部分显示" : state === "all" ? "全部显示" : "全部隐藏"}
    >
      {state === "partial" ? (
        <Eye size={size} strokeWidth={1.75} className="opacity-60" />
      ) : state === "all" ? (
        <Eye size={size} />
      ) : (
        <EyeOff size={size} />
      )}
    </span>
  );
}

function resolveVisibilityState(
  visibility: PanelTreeVisibilityState | undefined,
  visible: boolean | undefined,
): PanelTreeVisibilityState {
  if (visibility != null) return visibility;
  return visibilityFromBoolean(visible !== false);
}

function PanelTreeChevron({ open }: { open: boolean }) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-nexus-text-muted">
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
    </span>
  );
}

/** 叶子：左侧预留与 `PanelTreeBranchRow` 同宽的三角列，保证与分支行对齐 */
export function PanelTreeToggleRow({
  depth,
  visible,
  visibility,
  onToggle,
  label,
  disabled,
}: {
  depth: number;
  /** @deprecated 请用 `visibility` */
  visible?: boolean;
  visibility?: PanelTreeVisibilityState;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  const state = resolveVisibilityState(visibility, visible);
  const pad = panelTreePaddingLeft(depth);
  return (
    <div
      className={cn(
        "flex w-full items-stretch border-b border-nexus-border/30 last:border-b-0",
        disabled && "opacity-45",
      )}
    >
      <span
        className="h-8 w-8 shrink-0"
        style={{ marginLeft: pad - 8 }}
        aria-hidden
      />
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left",
          disabled ? "cursor-not-allowed" : "hover:bg-nexus-bg-elevated/50",
        )}
      >
        <PanelTreeEye state={state} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[10px]",
            isPanelTreeLit(state) && !disabled ? "text-nexus-text-primary" : "text-nexus-text-muted",
          )}
        >
          {label}
        </span>
      </button>
    </div>
  );
}

/**
 * 分支：左侧 chevron 展开；可选中间 eye（组/总开关）；右侧标题。
 * 子节点由调用方在 `open` 时渲染，并自行使用更大 depth。
 */
export function PanelTreeBranchRow({
  depth,
  open,
  onToggleOpen,
  label,
  visible,
  visibility,
  onToggleVisible,
  disabled,
  labelClassName,
}: {
  depth: number;
  open: boolean;
  onToggleOpen: () => void;
  label: string;
  /** @deprecated 请用 `visibility` */
  visible?: boolean;
  visibility?: PanelTreeVisibilityState;
  onToggleVisible?: () => void;
  disabled?: boolean;
  labelClassName?: string;
}) {
  const state = resolveVisibilityState(visibility, visible);
  const pad = panelTreePaddingLeft(depth);
  return (
    <div
      className={cn(
        "flex w-full items-stretch border-b border-nexus-border/30 last:border-b-0",
        disabled && "opacity-45",
      )}
    >
      <button
        type="button"
        onClick={onToggleOpen}
        disabled={disabled}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center text-nexus-text-muted",
          disabled ? "cursor-not-allowed" : "hover:bg-nexus-bg-elevated/50",
        )}
        style={{ marginLeft: pad - 8 }}
        aria-label={open ? "收起" : "展开"}
      >
        <PanelTreeChevron open={open} />
      </button>
      {onToggleVisible != null ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onToggleVisible}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left",
            disabled ? "cursor-not-allowed" : "hover:bg-nexus-bg-elevated/50",
          )}
        >
          <PanelTreeEye state={state} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[10px]",
              isPanelTreeLit(state) && !disabled ? "text-nexus-text-primary" : "text-nexus-text-muted",
              labelClassName,
            )}
          >
            {label}
          </span>
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={onToggleOpen}
          className={cn(
            "flex min-w-0 flex-1 items-center py-1.5 pr-2 text-left",
            disabled ? "cursor-not-allowed" : "hover:bg-nexus-bg-elevated/50",
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[10px] text-nexus-text-secondary",
              labelClassName,
            )}
          >
            {label}
          </span>
        </button>
      )}
    </div>
  );
}
