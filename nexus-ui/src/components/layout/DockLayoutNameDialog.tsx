"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  title: string;
  initialName?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
};

export function DockLayoutNameDialog({
  open,
  title,
  initialName = "",
  confirmLabel = "保存",
  onClose,
  onConfirm,
}: Props) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-[20000] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dock-layout-name-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-nexus-border bg-nexus-bg-elevated text-nexus-text-primary shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-nexus-border px-4 py-3">
          <h2 id="dock-layout-name-title" className="text-sm font-medium">
            {title}
          </h2>
          <button
            type="button"
            className="rounded p-1 text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-primary"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <label className="block text-xs text-nexus-text-secondary">
            布局名称
            <input
              ref={inputRef}
              type="text"
              maxLength={32}
              value={name}
              placeholder="例如：值班态势"
              className={cn(
                "mt-1.5 w-full rounded-md border border-nexus-border bg-nexus-bg-base px-3 py-2 text-sm",
                "outline-none focus:border-nexus-accent focus:ring-1 focus:ring-nexus-accent/40",
              )}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </label>
          <p className="text-[11px] text-nexus-text-muted">最多 32 个字符，最多保存 5 套自定义布局。</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-nexus-border px-4 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button type="button" size="sm" disabled={!name.trim()} onClick={submit}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
