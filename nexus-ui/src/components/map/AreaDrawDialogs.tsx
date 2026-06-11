"use client";

import { useMemo, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { toast } from "sonner";
import { AreaManageTree } from "@/components/map/AreaManageTree";
import { getHttpConfig } from "@/lib/map-app-config";
import type { AreaDrawShape } from "@/lib/area-table-serialize";
import {
  CIRCLE_AREA_LINE_COLOR,
  defaultAreaDisplayName,
  nextAreaIdForGroup,
  nextGroupId,
  ROUTE_AREA_GROUP_ID,
} from "@/lib/area-table-serialize";
import { refetchDbAreas } from "@/lib/refetch-db-areas";
import { cn } from "@/lib/utils";
import { useAreaDrawStore } from "@/stores/area-draw-store";
import { useDbAreaStore } from "@/stores/db-area-store";
import { getMapMeasureHandlers, useMapMeasureUi } from "@/stores/map-measure-bridge";

const SHAPE_OPTIONS: { id: AreaDrawShape; label: string; hint: string }[] = [
  { id: "rect", label: "矩形", hint: "左键两点确定对角" },
  { id: "circle", label: "圆形", hint: "左键圆心，再点圆周上一点" },
  { id: "polygon", label: "多边形", hint: "左键加点，双击闭合" },
  { id: "route", label: "航线", hint: "左键加折点，双击结束，group_id 固定为 0" },
];

type GroupOption = { groupId: number; groupName: string };

function DialogOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

export function AreaDrawSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows = useDbAreaStore((s) => s.rows);
  const [listOpen, setListOpen] = useState(true);
  const [shape, setShape] = useState<AreaDrawShape>("polygon");
  const [groupMode, setGroupMode] = useState<"existing" | "new">("existing");
  const [selectedGroupId, setSelectedGroupId] = useState<number | "">("");
  const [newGroupName, setNewGroupName] = useState("");

  const groups = useMemo((): GroupOption[] => {
    const map = new Map<number, string>();
    for (const row of rows) {
      const groupId = Number(row.group_id);
      if (!Number.isFinite(groupId)) continue;
      if (map.has(groupId)) continue;
      map.set(groupId, (row.group_name && String(row.group_name).trim()) || `分组${groupId}`);
    }
    return [...map.entries()]
      .map(([groupId, groupName]) => ({ groupId, groupName }))
      .sort((a, b) => a.groupId - b.groupId);
  }, [rows]);

  const routeGroupName = useMemo(() => {
    const routeRow = rows.find((row) => Number(row.group_id) === ROUTE_AREA_GROUP_ID);
    return (routeRow?.group_name && String(routeRow.group_name).trim()) || "航线";
  }, [rows]);

  if (!open) return null;

  const effectiveGroupMode = shape === "route" ? "existing" : groups.length === 0 ? "new" : groupMode;
  const effectiveSelectedGroupId =
    selectedGroupId === "" && groups.length > 0 ? groups[0]!.groupId : selectedGroupId;

  const startDraw = () => {
    const handlers = getMapMeasureHandlers();
    if (!handlers?.startAreaDraw) {
      onClose();
      return;
    }

    if (shape === "route") {
      handlers.startAreaDraw({
        shape: "route",
        groupId: ROUTE_AREA_GROUP_ID,
        groupName: routeGroupName,
        isNewGroup: false,
      });
      onClose();
      return;
    }

    if (effectiveGroupMode === "new") {
      const groupId = nextGroupId(rows);
      handlers.startAreaDraw({
        shape,
        groupId,
        groupName: newGroupName.trim() || `分组${groupId}`,
        isNewGroup: true,
      });
      onClose();
      return;
    }

    const groupId = Number(effectiveSelectedGroupId);
    if (!Number.isFinite(groupId)) return;
    const targetGroup = groups.find((item) => item.groupId === groupId);
    handlers.startAreaDraw({
      shape,
      groupId,
      groupName: targetGroup?.groupName ?? `分组${groupId}`,
      isNewGroup: false,
    });
    onClose();
  };

  return (
    <DialogOverlay onClose={onClose}>
      <div className="flex max-h-[min(85vh,640px)] w-full max-w-3xl overflow-hidden rounded-lg border border-white/10 bg-[#141418] shadow-xl">
        <div className="relative flex min-w-0 flex-1 flex-col p-4">
          <button
            type="button"
            title={listOpen ? "收起区域列表" : "展开区域列表"}
            className="absolute right-2 top-2 z-10 rounded border border-white/10 bg-black/40 p-1 text-nexus-text-muted hover:text-nexus-text-primary"
            onClick={() => setListOpen((value) => !value)}
          >
            {listOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>

          <h2 className="text-sm font-semibold text-nexus-text-primary">绘制区域</h2>
          <p className="mt-1 text-xs text-nexus-text-muted">
            先选择分组与形状；标绘时鼠标为十字，不可漫游，右键取消。
          </p>

          {shape === "route" ? (
            <p className="mt-4 rounded-md border border-white/10 bg-black/25 px-3 py-2 text-xs text-nexus-text-muted">
              航线固定存入分组 <span className="text-nexus-text-primary">group_id = 0</span>（{routeGroupName}）
            </p>
          ) : (
            <div className="mt-4">
              <p className="text-xs font-medium text-nexus-text-primary">分组</p>
              <div className="mt-2 flex gap-1 rounded-md border border-white/10 bg-black/20 p-0.5">
                {(["existing", "new"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={cn(
                      "flex-1 rounded px-2 py-1 text-xs",
                      effectiveGroupMode === mode
                        ? "bg-nexus-accent-glow/30 text-nexus-text-primary"
                        : "text-nexus-text-muted hover:text-nexus-text-secondary",
                    )}
                    onClick={() => setGroupMode(mode)}
                  >
                    {mode === "existing" ? "已有分组" : "新建分组"}
                  </button>
                ))}
              </div>

              {effectiveGroupMode === "existing" ? (
                <select
                  className="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-nexus-text-primary outline-none focus:border-nexus-border-accent"
                  value={effectiveSelectedGroupId === "" ? "" : String(effectiveSelectedGroupId)}
                  onChange={(e) => setSelectedGroupId(Number(e.target.value))}
                >
                  {groups.length === 0 ? (
                    <option value="">暂无分组，请新建</option>
                  ) : (
                    groups.map((group) => (
                      <option key={`group-option-${group.groupId}`} value={group.groupId}>
                        {group.groupName}（ID {group.groupId}）
                      </option>
                    ))
                  )}
                </select>
              ) : (
                <input
                  type="text"
                  className="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-nexus-text-primary outline-none focus:border-nexus-border-accent"
                  placeholder="新分组名称"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
              )}
            </div>
          )}

          <div className="mt-4">
            <p className="text-xs font-medium text-nexus-text-primary">形状</p>
            <div className="mt-2 space-y-1">
              {SHAPE_OPTIONS.map((option) => (
                <label
                  key={option.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs",
                    shape === option.id
                      ? "border-nexus-border-accent bg-nexus-accent-glow/15 text-nexus-text-primary"
                      : "border-white/10 text-nexus-text-secondary hover:bg-white/5",
                  )}
                >
                  <input
                    type="radio"
                    name="area-shape"
                    className="mt-0.5"
                    checked={shape === option.id}
                    onChange={() => setShape(option.id)}
                  />
                  <span>
                    <span className="font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-nexus-text-muted">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs text-nexus-text-muted hover:bg-white/5"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-nexus-accent-glow/30 px-3 py-1.5 text-xs font-medium text-nexus-text-primary hover:bg-nexus-accent-glow/50 disabled:opacity-50"
              disabled={shape !== "route" && effectiveGroupMode === "existing" && groups.length === 0}
              onClick={startDraw}
            >
              开始绘制
            </button>
          </div>
        </div>

        {listOpen ? <AreaManageTree className="w-52 shrink-0" /> : null}
      </div>
    </DialogOverlay>
  );
}

export function AreaDrawSaveDialog() {
  const pending = useAreaDrawStore((s) => s.pendingSave);
  const rows = useDbAreaStore((s) => s.rows);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultName = useMemo(() => {
    if (!pending) return "";
    const nextAreaId = pending.session.isNewGroup ? 1 : nextAreaIdForGroup(rows, pending.session.groupId);
    return defaultAreaDisplayName(pending.session.groupId, nextAreaId, pending.shape);
  }, [pending, rows]);

  if (!pending) return null;

  const inputValue = name || defaultName;
  const { session, geometry } = pending;
  const shapeLabel = SHAPE_OPTIONS.find((option) => option.id === pending.shape)?.label ?? pending.shape;

  const save = async () => {
    setSaving(true);
    setError(null);
    const areaName = inputValue.trim() || defaultName;

    try {
      const body: Record<string, unknown> = {
        area_name: areaName,
        ...geometry,
        line_color: pending.shape === "circle" ? CIRCLE_AREA_LINE_COLOR : "#3b82f6",
        line_width: 2,
      };

      if (session.isNewGroup) body.new_group_name = session.groupName;
      else body.group_id = session.groupId;

      const backendUrl = getHttpConfig().backendUrl.trim().replace(/\/+$/, "");
      const response = await fetch(`${backendUrl}/api/areas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !json.ok) {
        const message = json.error ?? `保存失败 (${response.status})`;
        setError(message);
        toast.error("保存后端区域失败", { description: message });
        setSaving(false);
        return;
      }

      await refetchDbAreas();
      useAreaDrawStore.getState().reset();
      useMapMeasureUi.getState().setActiveDrawTool(null);
      setSaving(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error("保存失败", { description: message });
      setSaving(false);
    }
  };

  return (
    <DialogOverlay onClose={() => useAreaDrawStore.getState().setPendingSave(null)}>
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#141418] p-4 shadow-xl">
        <h2 className="text-sm font-semibold text-nexus-text-primary">
          {pending.shape === "route" ? "命名航线" : "命名区域"}
        </h2>
        <p className="mt-1 text-xs text-nexus-text-muted">
          分组：{session.groupName}（{session.isNewGroup ? "新建" : `ID ${session.groupId}`}） | 形状：{shapeLabel}
        </p>

        <input
          type="text"
          value={inputValue}
          onChange={(e) => setName(e.target.value)}
          className="mt-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-nexus-text-primary outline-none focus:border-nexus-border-accent"
          placeholder={defaultName}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
        />

        {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-xs text-nexus-text-muted hover:bg-white/5"
            onClick={() => useAreaDrawStore.getState().setPendingSave(null)}
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            className="rounded-md bg-nexus-accent-glow/30 px-3 py-1.5 text-xs font-medium text-nexus-text-primary hover:bg-nexus-accent-glow/50 disabled:opacity-50"
            onClick={() => void save()}
          >
            {saving ? "保存中..." : "确定提交"}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
