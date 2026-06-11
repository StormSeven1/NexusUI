"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useDbAreaStore } from "@/stores/db-area-store";
import type { AreaTableRow } from "@/lib/area-table-geometry";
import { ROUTE_AREA_GROUP_ID, mapAreaFallbackLabel } from "@/lib/area-table-serialize";
import { isDbAreaListable } from "@/lib/map/area/db-area-panel-helpers";
import { mapEntityId } from "@/lib/area-entity-id";
import { deleteAreaWithEntity } from "@/lib/area-entity-client";
import { cn } from "@/lib/utils";

const AREA_TYPE_LABEL: Record<number, string> = {
  1: "矩形",
  2: "圆",
  3: "多边形",
  4: "航线",
};

const ROUTE_GROUP_LABEL = "航线组";

function areaLabel(row: AreaTableRow): string {
  return (
    (row.area_name && String(row.area_name).trim()) ||
    mapAreaFallbackLabel(row.group_id, row.area_id, row.area_type)
  );
}

function groupDisplayName(groupId: number, fallbackFromRow?: string | null): string {
  const gn = fallbackFromRow != null ? String(fallbackFromRow).trim() : "";
  if (groupId === ROUTE_AREA_GROUP_ID) return gn || ROUTE_GROUP_LABEL;
  return gn || `分组${groupId}`;
}

/** 绘制对话框右侧：按分组树形列出区域与航线（含固定航线组 group_id=0），可删除 */
export function AreaManageTree({ className }: { className?: string }) {
  const rows = useDbAreaStore((s) => s.rows);
  const [expanded, setExpanded] = useState<Record<number, boolean>>(() => ({
    [ROUTE_AREA_GROUP_ID]: true,
  }));
  const [deleting, setDeleting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<number, { name: string; areas: AreaTableRow[] }>();
    map.set(ROUTE_AREA_GROUP_ID, { name: ROUTE_GROUP_LABEL, areas: [] });

    for (const r of rows) {
      if (!isDbAreaListable(r)) continue;
      const groupId = Number(r.group_id);
      const areaId = Number(r.area_id);
      const areaType = Number(r.area_type);
      if (!Number.isFinite(groupId) || !Number.isFinite(areaId) || !Number.isFinite(areaType)) continue;
      const normalizedRow: AreaTableRow = {
        ...r,
        group_id: groupId,
        area_id: areaId,
        area_type: areaType,
      };
      let g = map.get(groupId);
      if (!g) {
        g = { name: groupDisplayName(groupId, r.group_name), areas: [] };
        map.set(groupId, g);
      }
      if (groupId === ROUTE_AREA_GROUP_ID) {
        g.name = groupDisplayName(ROUTE_AREA_GROUP_ID, r.group_name);
      }
      g.areas.push(normalizedRow);
    }

    for (const g of map.values()) {
      g.areas.sort((a, b) => a.area_id - b.area_id);
    }

    return [...map.entries()].sort((a, b) => {
      if (a[0] === ROUTE_AREA_GROUP_ID) return -1;
      if (b[0] === ROUTE_AREA_GROUP_ID) return 1;
      return a[0] - b[0];
    }).map(([groupId, g]) => ({
      groupId,
      groupName: g.name,
      areas: g.areas,
    }));
  }, [rows]);

  const toggleGroup = (gid: number) => {
    setExpanded((s) => ({ ...s, [gid]: !(s[gid] ?? true) }));
  };

  const onDelete = async (row: AreaTableRow) => {
    const key = mapEntityId(row.group_id, row.area_id, row.area_type);
    const kind = row.area_type === 4 ? "航线" : "区域";
    if (!window.confirm(`删除${kind}「${areaLabel(row)}」？\n将同时删除实体 ${key} 与数据库记录。`)) return;
    setDeleting(key);
    setErr(null);
    const r = await deleteAreaWithEntity(row.group_id, row.area_id, row.area_type);
    setDeleting(null);
    if (!r.ok) setErr(r.error ?? "删除失败");
  };

  return (
    <div className={cn("flex min-h-0 flex-col border-l border-white/10 bg-black/20", className)}>
      <p className="shrink-0 border-b border-white/10 px-3 py-2 text-xs font-medium text-nexus-text-primary">
        区域 / 航线
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
        <ul className="space-y-1">
            {groups.map((g) => {
              const open = expanded[g.groupId] ?? true;
              const isRouteGroup = g.groupId === ROUTE_AREA_GROUP_ID;
              return (
                <li key={g.groupId}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-1 rounded px-1 py-1 text-left hover:bg-white/5",
                      isRouteGroup ? "text-cyan-400/90" : "text-nexus-text-secondary",
                    )}
                    onClick={() => toggleGroup(g.groupId)}
                  >
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className="font-medium">{g.groupName}</span>
                    <span className="text-nexus-text-muted">({g.groupId})</span>
                    {g.areas.length > 0 ? (
                      <span className="ml-auto text-nexus-text-muted">{g.areas.length}</span>
                    ) : null}
                  </button>
                  {open ? (
                    g.areas.length === 0 ? (
                      <p className="ml-5 py-1 text-nexus-text-muted">（空）</p>
                    ) : (
                      <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                        {g.areas.map((a) => {
                          const key = mapEntityId(a.group_id, a.area_id, a.area_type);
                          const busy = deleting === key;
                          return (
                            <li
                              key={key}
                              className="group flex items-center justify-between gap-1 rounded px-1 py-0.5 hover:bg-white/5"
                            >
                              <span className="min-w-0 truncate text-nexus-text-secondary" title={key}>
                                {areaLabel(a)}
                                <span className="ml-1 text-nexus-text-muted">
                                  · {AREA_TYPE_LABEL[a.area_type] ?? a.area_type}
                                </span>
                              </span>
                              <button
                                type="button"
                                title={a.area_type === 4 ? "删除航线" : "删除区域"}
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
                    )
                  ) : null}
                </li>
              );
            })}
        </ul>
        {err ? <p className="mt-2 text-red-400">{err}</p> : null}
      </div>
    </div>
  );
}
