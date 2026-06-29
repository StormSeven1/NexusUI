"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  applyDockLayoutSnapshot,
  captureDockLayoutSnapshot,
  getDefaultDockLayoutSnapshot,
} from "@/lib/dock/dock-layout-snapshot";
import {
  MAX_DOCK_LAYOUT_PRESETS,
  useDockLayoutPresetsStore,
} from "@/stores/dock-layout-presets-store";
import { DockLayoutNameDialog } from "@/components/layout/DockLayoutNameDialog";

type FlyoutKind = "save" | "restore" | null;

type NameDialogState =
  | { open: false }
  | { open: true; mode: "new" }
  | { open: true; mode: "overwrite"; presetId: string; initialName: string };

function LayoutMenuFlyout(props: {
  anchorRect: DOMRect;
  children: React.ReactNode;
  menuRef: React.RefObject<HTMLUListElement | null>;
  onMouseLeave?: (e: React.MouseEvent) => void;
}) {
  const { anchorRect, children, menuRef, onMouseLeave } = props;
  const width = 200;
  return createPortal(
    <ul
      ref={menuRef}
      role="menu"
      className="fixed z-[620] max-h-[min(320px,70vh)] overflow-y-auto rounded-md border border-nexus-border bg-nexus-bg-elevated py-1 text-xs shadow-xl"
      style={{
        // 与一级菜单重叠 4px，避免移入二级时经过间隙触发 mouseLeave
        left: anchorRect.right - 4,
        top: anchorRect.top,
        minWidth: width,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </ul>,
    document.body,
  );
}

/** 系统菜单内「布局」子菜单：保存 / 恢复布局及二级 flyout */
export function useDockLayoutSubmenu() {
  const [layoutFlyoutOpen, setLayoutFlyoutOpen] = useState(false);
  const [layoutFlyoutAnchor, setLayoutFlyoutAnchor] = useState<DOMRect | null>(null);
  const [flyout, setFlyout] = useState<FlyoutKind>(null);
  const [flyoutAnchor, setFlyoutAnchor] = useState<DOMRect | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState>({ open: false });

  const layoutRowRef = useRef<HTMLButtonElement>(null);
  const layoutMenuRef = useRef<HTMLUListElement>(null);
  const flyoutMenuRef = useRef<HTMLUListElement>(null);
  const saveRowRef = useRef<HTMLButtonElement>(null);
  const restoreRowRef = useRef<HTMLButtonElement>(null);

  const presets = useDockLayoutPresetsStore((s) => s.presets);
  const canAddPreset = useDockLayoutPresetsStore((s) => s.canAddPreset);
  const upsertPreset = useDockLayoutPresetsStore((s) => s.upsertPreset);

  const closeLayoutFlyouts = useCallback(() => {
    setLayoutFlyoutOpen(false);
    setLayoutFlyoutAnchor(null);
    setFlyout(null);
    setFlyoutAnchor(null);
  }, []);

  const openLayoutFlyout = () => {
    const el = layoutRowRef.current;
    if (!el) return;
    setLayoutFlyoutOpen(true);
    setLayoutFlyoutAnchor(el.getBoundingClientRect());
  };

  const openNestedFlyout = (kind: FlyoutKind, rowEl: HTMLButtonElement | null) => {
    if (!rowEl) return;
    setFlyout(kind);
    setFlyoutAnchor(rowEl.getBoundingClientRect());
  };

  const closeNestedFlyoutUnlessEntering = (
    e: React.MouseEvent,
    otherMenuRef: React.RefObject<HTMLUListElement | null>,
  ) => {
    const next = e.relatedTarget as Node | null;
    if (next && otherMenuRef.current?.contains(next)) return;
    setFlyout(null);
    setFlyoutAnchor(null);
  };

  const persistLayout = (name: string, overwriteId?: string) => {
    const snapshot = captureDockLayoutSnapshot();
    const result = upsertPreset(name, snapshot, overwriteId);
    if (!result.ok) {
      toast.error("保存布局失败", { description: result.reason });
      return;
    }
    toast.success(overwriteId ? "布局已覆盖" : "布局已保存", { description: name });
    setNameDialog({ open: false });
    closeLayoutFlyouts();
  };

  const onRestoreDefault = () => {
    applyDockLayoutSnapshot(getDefaultDockLayoutSnapshot());
    toast.success("已恢复默认布局");
    closeLayoutFlyouts();
  };

  const onRestorePreset = (
    presetName: string,
    snapshot: Parameters<typeof applyDockLayoutSnapshot>[0],
  ) => {
    applyDockLayoutSnapshot(snapshot);
    toast.success("布局已恢复", { description: presetName });
    closeLayoutFlyouts();
  };

  const layoutPrimaryFlyout =
    layoutFlyoutOpen &&
    layoutFlyoutAnchor &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={layoutMenuRef}
        role="menu"
        className="fixed z-[610] overflow-visible rounded-md border border-nexus-border bg-nexus-bg-elevated py-1 text-xs shadow-xl"
        style={{
          left: layoutFlyoutAnchor.right + 4,
          top: layoutFlyoutAnchor.top,
          minWidth: 168,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseLeave={(e) => closeNestedFlyoutUnlessEntering(e, flyoutMenuRef)}
      >
        <li role="none">
          <button
            ref={saveRowRef}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            className={cn(
              "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10",
              flyout === "save" && "bg-white/5",
            )}
            onMouseEnter={() => openNestedFlyout("save", saveRowRef.current)}
            onFocus={() => openNestedFlyout("save", saveRowRef.current)}
          >
            <span>保存布局</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </button>
        </li>
        <li role="none">
          <button
            ref={restoreRowRef}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            className={cn(
              "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10",
              flyout === "restore" && "bg-white/5",
            )}
            onMouseEnter={() => openNestedFlyout("restore", restoreRowRef.current)}
            onFocus={() => openNestedFlyout("restore", restoreRowRef.current)}
          >
            <span>恢复布局</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </button>
        </li>
      </ul>,
      document.body,
    );

  const saveFlyout =
    flyout === "save" &&
    flyoutAnchor &&
    LayoutMenuFlyout({
      anchorRect: flyoutAnchor,
      menuRef: flyoutMenuRef,
      onMouseLeave: (e) => closeNestedFlyoutUnlessEntering(e, layoutMenuRef),
      children: (
        <>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              disabled={!canAddPreset()}
              className={cn(
                "flex w-full px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10",
                !canAddPreset() && "cursor-not-allowed opacity-50",
              )}
              onClick={() => {
                if (!canAddPreset()) {
                  toast.message(`已达上限（${MAX_DOCK_LAYOUT_PRESETS} 套）`, {
                    description: "请选择下方已有布局进行覆盖",
                  });
                  return;
                }
                setFlyout(null);
                setNameDialog({ open: true, mode: "new" });
              }}
            >
              新建布局…
            </button>
          </li>
          {presets.length > 0 ? (
            <>
              <li className="my-1 border-t border-nexus-border" role="separator" />
              <li className="px-3 py-1 text-[10px] text-nexus-text-muted" role="presentation">
                覆盖已有布局
              </li>
              {presets.map((p) => (
                <li key={p.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10"
                    onClick={() => {
                      setFlyout(null);
                      setNameDialog({
                        open: true,
                        mode: "overwrite",
                        presetId: p.id,
                        initialName: p.name,
                      });
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </>
          ) : (
            <li className="px-3 py-2 text-[10px] text-nexus-text-muted" role="presentation">
              暂无已保存布局
            </li>
          )}
        </>
      ),
    });

  const restoreFlyout =
    flyout === "restore" &&
    flyoutAnchor &&
    LayoutMenuFlyout({
      anchorRect: flyoutAnchor,
      menuRef: flyoutMenuRef,
      onMouseLeave: (e) => closeNestedFlyoutUnlessEntering(e, layoutMenuRef),
      children: (
        <>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="flex w-full px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10"
              onClick={onRestoreDefault}
            >
              默认布局
            </button>
          </li>
          {presets.length > 0 ? (
            <>
              <li className="my-1 border-t border-nexus-border" role="separator" />
              {presets.map((p) => (
                <li key={p.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10"
                    onClick={() => onRestorePreset(p.name, p.snapshot)}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </>
          ) : (
            <li className="px-3 py-2 text-[10px] text-nexus-text-muted" role="presentation">
              暂无自定义布局
            </li>
          )}
        </>
      ),
    });

  const nameDialogEl = (
    <DockLayoutNameDialog
      open={nameDialog.open}
      title={
        nameDialog.open && nameDialog.mode === "overwrite" ? "覆盖布局" : "新建布局"
      }
      initialName={
        nameDialog.open && nameDialog.mode === "overwrite" ? nameDialog.initialName : ""
      }
      confirmLabel="保存"
      onClose={() => setNameDialog({ open: false })}
      onConfirm={(name) => {
        if (!nameDialog.open) return;
        if (nameDialog.mode === "new") {
          persistLayout(name);
        } else {
          persistLayout(name, nameDialog.presetId);
        }
      }}
    />
  );

  return {
    layoutRowRef,
    layoutMenuRef,
    flyoutMenuRef,
    openLayoutFlyout,
    closeLayoutFlyouts,
    layoutFlyoutOpen,
    layoutPrimaryFlyout,
    saveFlyout,
    restoreFlyout,
    nameDialogEl,
  };
}
