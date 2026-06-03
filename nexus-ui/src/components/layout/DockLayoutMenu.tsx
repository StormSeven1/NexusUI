"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, LayoutGrid } from "lucide-react";
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

function MenuFlyout(props: {
  anchorRect: DOMRect;
  children: React.ReactNode;
  menuRef: React.RefObject<HTMLUListElement | null>;
  align?: "left" | "right";
}) {
  const { anchorRect, children, menuRef, align = "right" } = props;
  const width = 200;
  const left =
    align === "right"
      ? anchorRect.right + 4
      : Math.max(8, anchorRect.left - width - 4);

  return createPortal(
    <ul
      ref={menuRef}
      role="menu"
      className="fixed z-[610] max-h-[min(320px,70vh)] overflow-y-auto rounded-md border border-nexus-border bg-nexus-bg-elevated py-1 text-xs shadow-xl"
      style={{
        left,
        top: anchorRect.top,
        minWidth: width,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </ul>,
    document.body,
  );
}

export function DockLayoutMenu() {
  const [mainOpen, setMainOpen] = useState(false);
  const [flyout, setFlyout] = useState<FlyoutKind>(null);
  const [flyoutAnchor, setFlyoutAnchor] = useState<DOMRect | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState>({ open: false });

  const btnRef = useRef<HTMLButtonElement>(null);
  const mainMenuRef = useRef<HTMLUListElement>(null);
  const flyoutMenuRef = useRef<HTMLUListElement>(null);
  const saveRowRef = useRef<HTMLButtonElement>(null);
  const restoreRowRef = useRef<HTMLButtonElement>(null);
  const [mainAnchor, setMainAnchor] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const presets = useDockLayoutPresetsStore((s) => s.presets);
  const canAddPreset = useDockLayoutPresetsStore((s) => s.canAddPreset);
  const upsertPreset = useDockLayoutPresetsStore((s) => s.upsertPreset);

  const updateMainAnchor = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMainAnchor({
      left: Math.max(8, r.right - 168),
      top: r.bottom + 4,
      width: Math.max(168, r.width),
    });
  }, []);

  const closeAll = useCallback(() => {
    setMainOpen(false);
    setFlyout(null);
    setFlyoutAnchor(null);
  }, []);

  useEffect(() => {
    if (!mainOpen) return;
    updateMainAnchor();
    const onScroll = () => closeAll();
    const onResize = () => updateMainAnchor();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [mainOpen, closeAll, updateMainAnchor]);

  useEffect(() => {
    if (!mainOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (mainMenuRef.current?.contains(t)) return;
      if (flyoutMenuRef.current?.contains(t)) return;
      closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [mainOpen, closeAll]);

  const openFlyout = (kind: FlyoutKind, rowEl: HTMLButtonElement | null) => {
    if (!rowEl) return;
    setFlyout(kind);
    setFlyoutAnchor(rowEl.getBoundingClientRect());
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
    closeAll();
  };

  const onRestoreDefault = () => {
    applyDockLayoutSnapshot(getDefaultDockLayoutSnapshot());
    toast.success("已恢复默认布局");
    closeAll();
  };

  const onRestorePreset = (presetName: string, snapshot: Parameters<typeof applyDockLayoutSnapshot>[0]) => {
    applyDockLayoutSnapshot(snapshot);
    toast.success("布局已恢复", { description: presetName });
    closeAll();
  };

  const mainMenu =
    mainOpen &&
    mainAnchor &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={mainMenuRef}
        role="menu"
        className="fixed z-[600] overflow-visible rounded-md border border-nexus-border bg-nexus-bg-elevated py-1 text-xs shadow-xl"
        style={{
          left: mainAnchor.left,
          top: mainAnchor.top,
          minWidth: mainAnchor.width,
        }}
        onMouseDown={(e) => e.stopPropagation()}
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
            onMouseEnter={() => openFlyout("save", saveRowRef.current)}
            onFocus={() => openFlyout("save", saveRowRef.current)}
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
            onMouseEnter={() => openFlyout("restore", restoreRowRef.current)}
            onFocus={() => openFlyout("restore", restoreRowRef.current)}
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
    MenuFlyout({
      anchorRect: flyoutAnchor,
      menuRef: flyoutMenuRef,
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
                setMainOpen(false);
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
                      setMainOpen(false);
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
    MenuFlyout({
      anchorRect: flyoutAnchor,
      menuRef: flyoutMenuRef,
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

  return (
    <>
      <div className="relative flex items-center">
        <button
          ref={btnRef}
          type="button"
          aria-expanded={mainOpen}
          aria-haspopup="menu"
          title="保存或恢复窗口布局"
          className={cn(
            "flex h-8 shrink-0 items-center gap-1 rounded-md border border-nexus-border bg-nexus-bg-elevated px-2.5 text-[11px] font-medium transition-colors",
            "text-nexus-text-secondary hover:border-nexus-accent/40 hover:text-nexus-text-primary",
            mainOpen && "border-nexus-accent/60 text-nexus-accent",
          )}
          onClick={() => {
            if (mainOpen) closeAll();
            else {
              updateMainAnchor();
              setMainOpen(true);
            }
          }}
        >
          <LayoutGrid size={13} />
          <span className="hidden sm:inline">布局</span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 opacity-70 transition-transform", mainOpen && "rotate-180")}
          />
        </button>
      </div>
      {mainMenu}
      {saveFlyout}
      {restoreFlyout}

      <DockLayoutNameDialog
        open={nameDialog.open}
        title={
          nameDialog.open && nameDialog.mode === "overwrite"
            ? "覆盖布局"
            : "新建布局"
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
    </>
  );
}
