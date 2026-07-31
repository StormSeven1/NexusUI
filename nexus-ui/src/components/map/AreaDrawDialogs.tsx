"use client";

import { useEffect, useMemo, useState } from "react";
import { useDbAreaStore } from "@/stores/db-area-store";
import { useAreaDrawStore, type AreaDrawKind } from "@/stores/area-draw-store";
import { getMapMeasureHandlers, useMapMeasureUi } from "@/stores/map-measure-bridge";
import type { AreaDrawShape } from "@/lib/area-table-serialize";
import {
  CIRCLE_AREA_LINE_COLOR,
  defaultAreaDisplayName,
  nextAreaIdForGroup,
  nextGroupId,
  ROUTE_AREA_GROUP_ID,
} from "@/lib/area-table-serialize";
import { parseAreaLineColor } from "@/lib/area-table-geometry";
import { refetchDbAreas } from "@/lib/refetch-db-areas";
import { refetchDbAreaTargets } from "@/lib/refetch-db-area-targets";
import { publishDrawnMapEntity, toastEntityPublishResult } from "@/lib/area-entity-client";
import { toast } from "sonner";
import { AreaManageTree } from "@/components/map/AreaManageTree";
import { FixedTargetManageTree } from "@/components/map/FixedTargetManageTree";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const KIND_OPTIONS: { id: AreaDrawKind; label: string }[] = [
  { id: "area", label: "区域 / 航线" },
  { id: "fixed-target", label: "固定目标" },
];

const SHAPE_OPTIONS: { id: AreaDrawShape; label: string; hint: string }[] = [
  { id: "rect", label: "矩形", hint: "左键两点确定对角" },
  { id: "circle", label: "圆形", hint: "左键圆心，再点圆周上一点" },
  { id: "polygon", label: "多边形", hint: "左键加点，双击闭合" },
  { id: "route", label: "航线", hint: "左键加折点，双击结束（group_id=0）" },
];

const FIXED_TARGET_SHAPES = SHAPE_OPTIONS.filter((o) => o.id !== "route");

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
  const [kind, setKind] = useState<AreaDrawKind>("area");
  const [shape, setShape] = useState<AreaDrawShape>("polygon");
  const [groupMode, setGroupMode] = useState<"existing" | "new">("existing");
  const [selectedGroupId, setSelectedGroupId] = useState<number | "">("");
  const [newGroupName, setNewGroupName] = useState("");

  const groups = useMemo((): GroupOption[] => {
    const map = new Map<number, string>();
    for (const r of rows) {
      if (!map.has(r.group_id)) {
        map.set(r.group_id, (r.group_name && String(r.group_name).trim()) || `分组${r.group_id}`);
      }
    }
    return [...map.entries()]
      .map(([groupId, groupName]) => ({ groupId, groupName }))
      .sort((a, b) => a.groupId - b.groupId);
  }, [rows]);

  const routeGroupName = useMemo(() => {
    const g0 = rows.find((r) => r.group_id === ROUTE_AREA_GROUP_ID);
    return (g0?.group_name && String(g0.group_name).trim()) || "航线";
  }, [rows]);

  useEffect(() => {
    if (!open) return;
    if (groups.length > 0 && selectedGroupId === "") setSelectedGroupId(groups[0]!.groupId);
    if (groups.length === 0) setGroupMode("new");
  }, [open, groups, selectedGroupId]);

  useEffect(() => {
    if (kind === "fixed-target" && shape === "route") setShape("polygon");
  }, [kind, shape]);

  if (!open) return null;

  const shapeOptions = kind === "fixed-target" ? FIXED_TARGET_SHAPES : SHAPE_OPTIONS;

  const startDraw = () => {
    const h = getMapMeasureHandlers();
    if (!h?.startAreaDraw) {
      onClose();
      return;
    }

    if (kind === "fixed-target") {
      if (shape === "route") return;
      h.startAreaDraw({
        kind: "fixed-target",
        shape,
        groupId: -1,
        groupName: "固定目标",
        isNewGroup: false,
      });
      onClose();
      return;
    }

    if (shape === "route") {
      h.startAreaDraw({
        kind: "area",
        shape: "route",
        groupId: ROUTE_AREA_GROUP_ID,
        groupName: routeGroupName,
        isNewGroup: false,
      });
      onClose();
      return;
    }
    if (groupMode === "new") {
      const gid = nextGroupId(rows);
      h.startAreaDraw({
        kind: "area",
        shape,
        groupId: gid,
        groupName: newGroupName.trim() || `分组${gid}`,
        isNewGroup: true,
      });
    } else {
      const gid = Number(selectedGroupId);
      if (!Number.isFinite(gid)) return;
      const g = groups.find((x) => x.groupId === gid);
      h.startAreaDraw({
        kind: "area",
        shape,
        groupId: gid,
        groupName: g?.groupName ?? `分组${gid}`,
        isNewGroup: false,
      });
    }
    onClose();
  };

  return (
    <DialogOverlay onClose={onClose}>
      <div className="flex max-h-[min(85vh,640px)] w-full max-w-3xl overflow-hidden rounded-lg border border-white/10 bg-[#141418] shadow-xl">
        <div className="relative flex min-w-0 flex-1 flex-col p-4">
        <button
          type="button"
          title={listOpen ? "收起列表" : "展开列表"}
          className="absolute right-2 top-2 z-10 rounded border border-white/10 bg-black/40 p-1 text-nexus-text-muted hover:text-nexus-text-primary"
          onClick={() => setListOpen((v) => !v)}
        >
          {listOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        </button>
        <h2 className="text-sm font-semibold text-nexus-text-primary">绘制区域</h2>
        <p className="mt-1 text-xs text-nexus-text-muted">
          {kind === "fixed-target"
            ? "固定目标写入 area_table_target；target_id 从 10000 起由系统分配，不可改；右键取消。"
            : "先选择分组与形状；标绘时鼠标为十字、不可漫游，右键取消。"}
        </p>

        <div className="mt-4 flex gap-1 rounded-md border border-white/10 bg-black/20 p-0.5">
          {KIND_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={cn(
                "flex-1 rounded px-2 py-1.5 text-xs font-medium",
                kind === o.id
                  ? "bg-nexus-accent-glow/30 text-nexus-text-primary"
                  : "text-nexus-text-muted hover:text-nexus-text-secondary",
              )}
              onClick={() => setKind(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>

        {kind === "fixed-target" ? (
          <p className="mt-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-nexus-text-muted">
            存库后自动分配 <span className="text-amber-300">target_id ≥ 10000</span>（唯一、不可编辑）
          </p>
        ) : shape === "route" ? (
          <p className="mt-4 rounded-md border border-white/10 bg-black/25 px-3 py-2 text-xs text-nexus-text-muted">
            航线固定存入分组 <span className="text-nexus-text-primary">group_id = 0</span>（{routeGroupName}）
          </p>
        ) : (
          <div className="mt-4">
            <p className="text-xs font-medium text-nexus-text-primary">分组</p>
            <div className="mt-2 flex gap-1 rounded-md border border-white/10 bg-black/20 p-0.5">
              {(["existing", "new"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "flex-1 rounded px-2 py-1 text-xs",
                    groupMode === id
                      ? "bg-nexus-accent-glow/30 text-nexus-text-primary"
                      : "text-nexus-text-muted hover:text-nexus-text-secondary",
                  )}
                  onClick={() => setGroupMode(id)}
                >
                  {id === "existing" ? "已有分组" : "新建分组"}
                </button>
              ))}
            </div>
            {groupMode === "existing" ? (
              <select
                className="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-nexus-text-primary outline-none focus:border-nexus-border-accent"
                value={selectedGroupId === "" ? "" : String(selectedGroupId)}
                onChange={(e) => setSelectedGroupId(Number(e.target.value))}
              >
                {groups.length === 0 ? (
                  <option value="">暂无分组（请新建）</option>
                ) : (
                  groups.map((g) => (
                    <option key={g.groupId} value={g.groupId}>
                      {g.groupName}（ID {g.groupId}）
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
            {shapeOptions.map((o) => (
              <label
                key={o.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs",
                  shape === o.id
                    ? "border-nexus-border-accent bg-nexus-accent-glow/15 text-nexus-text-primary"
                    : "border-white/10 text-nexus-text-secondary hover:bg-white/5",
                )}
              >
                <input
                  type="radio"
                  name="area-shape"
                  className="mt-0.5"
                  checked={shape === o.id}
                  onChange={() => setShape(o.id)}
                />
                <span>
                  <span className="font-medium">{o.label}</span>
                  <span className="mt-0.5 block text-nexus-text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded-md px-3 py-1.5 text-xs text-nexus-text-muted hover:bg-white/5" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="rounded-md bg-nexus-accent-glow/30 px-3 py-1.5 text-xs font-medium text-nexus-text-primary hover:bg-nexus-accent-glow/50 disabled:opacity-50"
            disabled={
              kind === "area" && shape !== "route" && groupMode === "existing" && groups.length === 0
            }
            onClick={startDraw}
          >
            开始绘制
          </button>
        </div>
        </div>
        {listOpen ? (
          kind === "fixed-target" ? (
            <FixedTargetManageTree className="w-52 shrink-0" />
          ) : (
            <AreaManageTree className="w-52 shrink-0" />
          )
        ) : null}
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

  const isFixedTarget = pending?.session.kind === "fixed-target";

  const defaultName = useMemo(() => {
    if (!pending) return "";
    if (pending.session.kind === "fixed-target") {
      const shapeLabel = FIXED_TARGET_SHAPES.find((s) => s.id === pending.shape)?.label ?? pending.shape;
      return `固定目标-${shapeLabel}`;
    }
    const aid = pending.session.isNewGroup ? 1 : nextAreaIdForGroup(rows, pending.session.groupId);
    return defaultAreaDisplayName(pending.session.groupId, aid, pending.shape);
  }, [pending, rows]);

  useEffect(() => {
    if (!pending) return;
    setName(defaultName);
    // 组件在 pending 清空后仍挂载（仅 return null），须清掉上次成功保存残留的 saving
    setSaving(false);
    setError(null);
  }, [pending, defaultName]);

  if (!pending) return null;

  const { session, geometry } = pending;
  const shapeLabel =
    (isFixedTarget ? FIXED_TARGET_SHAPES : SHAPE_OPTIONS).find((s) => s.id === pending.shape)?.label ??
    pending.shape;

  const saveFixedTarget = async () => {
    setSaving(true);
    setError(null);
    const areaName = name.trim() || defaultName;
    try {
      if (!geometry || geometry.area_type === 4) {
        setError("固定目标几何无效");
        return;
      }
      const body = {
        area_name: areaName,
        ...geometry,
      };
      const res = await fetch("/api/db-area-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        target_id?: number;
        id?: string;
      };
      if (!res.ok || !j.ok) {
        const msg = j.error ?? `保存失败 (${res.status})`;
        setError(msg);
        toast.error("保存固定目标失败", { description: msg });
        return;
      }
      toast.success("固定目标已保存", {
        description: `target_id=${j.target_id}（系统分配）`,
      });
      await refetchDbAreaTargets();
      useAreaDrawStore.getState().reset();
      useMapMeasureUi.getState().setActiveDrawTool(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("保存失败", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const saveArea = async () => {
    setSaving(true);
    setError(null);
    const areaName = name.trim() || defaultName;
    try {
      const circleLineCss = parseAreaLineColor(CIRCLE_AREA_LINE_COLOR, "#ffff00");
      const body: Record<string, unknown> = {
        area_name: areaName,
        ...geometry,
        line_color: CIRCLE_AREA_LINE_COLOR,
        line_width: 2,
      };
      if (session.isNewGroup) body.new_group_name = session.groupName;
      else body.group_id = session.groupId;

      const res = await fetch("/api/db-areas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        group_id?: number;
        area_id?: number;
      };
      if (!res.ok || !j.ok) {
        const msg = j.error ?? `保存失败 (${res.status})`;
        setError(msg);
        toast.error("保存数据库失败", { description: msg });
        return;
      }
      const gid = Number(j.group_id);
      const aid = Number(j.area_id);
      const entityKind = pending.shape === "route" ? "航线" : "区域";
      if (Number.isFinite(gid) && Number.isFinite(aid)) {
        const pub = await publishDrawnMapEntity({
          groupId: gid,
          areaId: aid,
          name: areaName,
          shape: pending.shape,
          points: pending.points,
          lineColor: circleLineCss,
          lineWidth: 2,
        });
        toastEntityPublishResult(pub, entityKind);
        if (!pub.ok) {
          setError(`已写入数据库，但实体注册失败：${pub.message ?? pub.error ?? "未知错误"}`);
          await refetchDbAreas();
          return;
        }
      }
      await refetchDbAreas();
      useAreaDrawStore.getState().reset();
      useMapMeasureUi.getState().setActiveDrawTool(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("保存失败", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (isFixedTarget) void saveFixedTarget();
    else void saveArea();
  };

  return (
    <DialogOverlay onClose={() => useAreaDrawStore.getState().setPendingSave(null)}>
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#141418] p-4 shadow-xl">
        <h2 className="text-sm font-semibold text-nexus-text-primary">
          {isFixedTarget ? "命名固定目标" : pending.shape === "route" ? "命名航线" : "命名区域"}
        </h2>
        <p className="mt-1 text-xs text-nexus-text-muted">
          {isFixedTarget ? (
            <>
              target_id 存库时由系统从 10000 起分配 · 形状：{shapeLabel}
            </>
          ) : (
            <>
              分组：{session.groupName}（{session.isNewGroup ? "新建" : `ID ${session.groupId}`}）· 形状：
              {shapeLabel}
            </>
          )}
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-nexus-text-primary outline-none focus:border-nexus-border-accent"
          placeholder={defaultName}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
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
            onClick={save}
          >
            {saving ? "保存中…" : "确定存库"}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
