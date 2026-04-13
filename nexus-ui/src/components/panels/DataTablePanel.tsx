"use client";

import { useState, useMemo } from "react";
import { MOCK_TRACKS } from "@/lib/mock-data";
import { type ForceDisposition } from "@/lib/colors";
import { useAppStore } from "@/stores/app-store";
import {
  NxPanelHeader,
  NxSearchInput,
  NxIconButton,
  NxBadge,
  NxTable,
  NxThead,
  NxTbody,
  NxTr,
  NxTh,
  NxTd,
  NxPagination,
} from "@/components/nexus";
import {
  Filter,
  Download,
  Star,
  Plane,
  Ship,
  Anchor,
  Eye,
} from "lucide-react";

type SortField = "id" | "name" | "disposition" | "type" | "speed" | "heading" | "altitude";
type SortDir = "asc" | "desc";

const TYPE_ICONS = { air: Plane, sea: Ship, underwater: Anchor };
const TYPE_LABELS: Record<string, string> = { air: "空中", sea: "水面", underwater: "水下" };

const DISPOSITION_BADGE: Record<ForceDisposition, { variant: "danger" | "warning" | "info" | "success" | "muted" | "default"; label: string }> = {
  hostile: { variant: "danger", label: "敌方" },
  friendly: { variant: "info", label: "友方" },
  neutral: { variant: "muted", label: "中立" },
};

export function DataTablePanel() {
  const { selectTrack, selectedTrackId } = useAppStore();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const pageSize = 10;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    let tracks = [...MOCK_TRACKS];
    if (search) {
      const q = search.toLowerCase();
      tracks = tracks.filter(
        (t) => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
      );
    }
    tracks.sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === "asc" ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });
    return tracks;
  }, [search, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const pageData = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="flex h-full flex-col">
      <NxPanelHeader
        title="数据表格"
        right={
          <div className="flex items-center gap-1">
            <NxIconButton size="xs" title="筛选"><Filter size={12} /></NxIconButton>
            <NxIconButton size="xs" title="导出"><Download size={12} /></NxIconButton>
          </div>
        }
      />

      <div className="border-b border-white/[0.06] px-3 py-2">
        <NxSearchInput
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="搜索编号或名称..."
        />
      </div>

      <div className="flex-1 overflow-auto">
        <NxTable>
          <NxThead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
              <NxTh sortable active={sortField === "id"} direction={sortDir} onSort={() => handleSort("id")} className="w-20 pl-3">
                编号
              </NxTh>
              <NxTh sortable active={sortField === "name"} direction={sortDir} onSort={() => handleSort("name")}>
                名称
              </NxTh>
              <NxTh sortable active={sortField === "disposition"} direction={sortDir} onSort={() => handleSort("disposition")} align="center" className="w-20">
                态势
              </NxTh>
              <NxTh sortable active={sortField === "type"} direction={sortDir} onSort={() => handleSort("type")} align="center" className="w-16">
                类型
              </NxTh>
              <NxTh sortable active={sortField === "speed"} direction={sortDir} onSort={() => handleSort("speed")} align="right" className="w-16">
                速度
              </NxTh>
              <NxTh sortable active={sortField === "heading"} direction={sortDir} onSort={() => handleSort("heading")} align="right" className="w-14">
                航向
              </NxTh>
              <NxTh className="w-10" align="center">&nbsp;</NxTh>
            </tr>
          </NxThead>
          <NxTbody>
            {pageData.map((track) => {
              const TypeIcon = TYPE_ICONS[track.type];
              const isSelected = selectedTrackId === track.id;
              const dispBadge = DISPOSITION_BADGE[track.disposition];

              return (
                <NxTr key={track.id} selected={isSelected} onClick={() => selectTrack(track.id)}>
                  <NxTd mono muted className="pl-3 text-[10px]">{track.id}</NxTd>
                  <NxTd className="max-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] font-medium text-nexus-text-primary" title={track.name}>
                        {track.name}
                      </span>
                      {track.starred && <Star size={10} className="shrink-0 text-amber-400" fill="currentColor" />}
                    </div>
                  </NxTd>
                  <NxTd align="center">
                    <NxBadge variant={dispBadge.variant} dot>{dispBadge.label}</NxBadge>
                  </NxTd>
                  <NxTd align="center">
                    <div className="flex items-center justify-center gap-1" title={TYPE_LABELS[track.type]}>
                      <TypeIcon size={12} className="text-nexus-text-muted" />
                    </div>
                  </NxTd>
                  <NxTd mono align="right" className="text-[10px]">{track.speed}</NxTd>
                  <NxTd mono muted align="right" className="text-[10px]">{track.heading}°</NxTd>
                  <NxTd align="center">
                    <NxIconButton
                      size="xs"
                      onClick={(e) => { e.stopPropagation(); selectTrack(track.id); }}
                    >
                      <Eye size={11} />
                    </NxIconButton>
                  </NxTd>
                </NxTr>
              );
            })}
          </NxTbody>
        </NxTable>
      </div>

      <NxPagination
        page={page}
        totalPages={totalPages}
        totalItems={filtered.length}
        onPageChange={setPage}
      />
    </div>
  );
}
