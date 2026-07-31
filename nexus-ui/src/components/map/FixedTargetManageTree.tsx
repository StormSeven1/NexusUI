"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useDbAreaTargetStore, type AreaTableTargetRow } from "@/stores/db-area-target-store";
import { refetchDbAreaTargets } from "@/lib/refetch-db-area-targets";
import { cn } from "@/lib/utils";

const AREA_TYPE_LABEL: Record<number, string> = {
  1: "矩形",
  2: "圆",
  3: "多边形",
};

function labelOf(row: AreaTableTargetRow): string {
  return (row.area_name && String(row.area_name).trim()) || `固定目标-${row.target_id}`;
}

/** 绘制对话框右侧：固定目标列表（按 target_id），可删除 */
export function FixedTargetManageTree({ className }: { className?: string }) {
  const rows = useDbAreaTargetStore((s) => s.rows);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void refetchDbAreaTargets();
  }, []);

  const onDelete = async (row: AreaTableTargetRow) => {
    if (!window.confirm(`删除固定目标「${labelOf(row)}」（target_id=${row.target_id}）？`)) return;
    setDeleting(row.id);
    setErr(null);
    try {
      const res = await fetch(`/api/db-area-targets?id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErr(j.error ?? "删除失败");
      } else {
        await refetchDbAreaTargets();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  };

  const sorted = [...rows].sort((a, b) => a.target_id - b.target_id);

  return (
    <div className={cn("flex min-h-0 flex-col border-l border-white/10 bg-black/20", className)}>
      <p className="shrink-0 border-b border-white/10 px-3 py-2 text-xs font-medium text-nexus-text-primary">
        固定目标
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
        {sorted.length === 0 ? (
          <p className="px-1 py-2 text-nexus-text-muted">暂无固定目标</p>
        ) : (
          <ul className="space-y-0.5">
            {sorted.map((a) => {
              const busy = deleting === a.id;
              return (
                <li
                  key={a.id}
                  className="group flex items-center justify-between gap-1 rounded px-1 py-0.5 hover:bg-white/5"
                >
                  <span className="min-w-0 truncate text-nexus-text-secondary" title={a.id}>
                    <span className="text-amber-400/90">{a.target_id}</span>
                    <span className="mx-1 text-nexus-text-muted">·</span>
                    {labelOf(a)}
                    <span className="ml-1 text-nexus-text-muted">
                      · {AREA_TYPE_LABEL[a.area_type] ?? a.area_type}
                    </span>
                  </span>
                  <button
                    type="button"
                    title="删除固定目标"
                    disabled={busy}
                    className="shrink-0 rounded p-0.5 text-nexus-text-muted opacity-0 transition group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400 disabled:opacity-50"
                    onClick={() => void onDelete(a)}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {err ? <p className="mt-2 text-red-400">{err}</p> : null}
      </div>
    </div>
  );
}
