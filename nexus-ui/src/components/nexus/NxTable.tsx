"use client";

import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";

/* ── Table Container ── */
export function NxTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <table className={cn("w-full border-collapse text-left", className)}>
      {children}
    </table>
  );
}

/* ── Table Head ── */
export function NxThead({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <thead className={cn("sticky top-0 z-10 bg-nexus-bg-surface", className)}>
      {children}
    </thead>
  );
}

/* ── Table Body ── */
export function NxTbody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tbody className={className}>{children}</tbody>;
}

/* ── Table Row ── */
export function NxTr({
  children,
  selected,
  className,
  onClick,
}: {
  children: React.ReactNode;
  selected?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-b border-white/[0.04] transition-colors",
        onClick && "cursor-pointer",
        selected
          ? "bg-white/[0.06]"
          : onClick && "hover:bg-white/[0.03]",
        className
      )}
    >
      {children}
    </tr>
  );
}

/* ── Sortable Header Cell ── */
export function NxTh({
  children,
  sortable,
  active,
  direction,
  onSort,
  align,
  className,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  active?: boolean;
  direction?: "asc" | "desc";
  onSort?: () => void;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  if (!sortable) {
    return (
      <th className={cn("h-8 px-2 text-[10px] font-semibold text-nexus-text-muted", alignClass, className)}>
        {children}
      </th>
    );
  }

  return (
    <th className={cn("h-8 px-2", alignClass, className)}>
      <button
        onClick={onSort}
        className={cn(
          "inline-flex items-center gap-0.5 text-[10px] font-semibold transition-colors",
          active ? "text-nexus-text-primary" : "text-nexus-text-muted hover:text-nexus-text-secondary"
        )}
      >
        {children}
        {active ? (
          direction === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />
        ) : (
          <ArrowUpDown size={10} className="opacity-30" />
        )}
      </button>
    </th>
  );
}

/* ── Table Cell ── */
export function NxTd({
  children,
  mono,
  muted,
  align,
  className,
}: {
  children: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  return (
    <td
      className={cn(
        "px-2 py-2 text-[11px]",
        mono && "font-mono",
        muted ? "text-nexus-text-muted" : "text-nexus-text-primary",
        alignClass,
        className
      )}
    >
      {children}
    </td>
  );
}

/* ── Pagination ── */
export function NxPagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (p: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between border-t border-white/[0.06] px-3 py-2", className)}>
      <span className="text-[10px] text-nexus-text-muted">
        共 {totalItems} 条 · 第 {page + 1}/{totalPages || 1} 页
      </span>
      <div className="flex items-center gap-0.5">
        <button
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          className="flex h-6 w-6 items-center justify-center rounded text-nexus-text-muted hover:bg-white/5 disabled:opacity-30"
        >
          <ChevronLeft size={12} />
        </button>
        {Array.from({ length: totalPages }, (_, i) => (
          <button
            key={i}
            onClick={() => onPageChange(i)}
            className={cn(
              "flex h-6 min-w-6 items-center justify-center rounded px-1 font-mono text-[10px] transition-colors",
              page === i
                ? "bg-white/[0.08] text-nexus-text-primary"
                : "text-nexus-text-muted hover:bg-white/5"
            )}
          >
            {i + 1}
          </button>
        ))}
        <button
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          className="flex h-6 w-6 items-center justify-center rounded text-nexus-text-muted hover:bg-white/5 disabled:opacity-30"
        >
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
