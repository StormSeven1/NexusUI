import { toast } from "sonner";
import { mapEntityId } from "@/lib/area-entity-id";
import { buildAreaPublishEntity, type BuildAreaPublishEntityInput } from "@/lib/build-area-publish-entity";
import { buildRoutePublishEntity } from "@/lib/build-route-publish-entity";
import type { AreaDrawShape } from "@/lib/area-table-serialize";
import type { LngLat } from "@/lib/area-table-serialize";
import { refetchDbAreas } from "@/lib/refetch-db-areas";

export type PublishEntityResult = {
  ok: boolean;
  error?: string;
  code?: number;
  message?: string;
  entityId?: string;
};

/** 右上角 toast：实体注册成功/失败 */
export function toastEntityPublishResult(
  result: PublishEntityResult,
  kind: "区域" | "航线",
): void {
  if (result.ok) {
    const desc = [
      result.message && result.message !== "注册成功" ? result.message : null,
      result.entityId ? `entityId: ${result.entityId}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    toast.success(`${kind}实体注册成功`, { description: desc || undefined });
  } else {
    const desc = [
      result.message || result.error,
      result.code != null && result.code !== 0 ? `code: ${result.code}` : null,
      result.entityId ? `entityId: ${result.entityId}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    toast.error(`${kind}实体注册失败`, { description: desc || "未知错误" });
  }
}

async function postPublishEntity(body: Record<string, unknown>): Promise<PublishEntityResult> {
  try {
    const res = await fetch("/api/nexus-entities/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as {
      ok?: boolean;
      error?: string;
      code?: number;
      message?: string;
      entityId?: string;
    };
    const message = j.message ?? j.error;
    if (!res.ok || !j.ok) {
      return {
        ok: false,
        error: message ?? `发布实体失败 HTTP ${res.status}`,
        code: j.code,
        message: message ?? `发布实体失败 HTTP ${res.status}`,
        entityId: j.entityId,
      };
    }
    return {
      ok: true,
      code: j.code ?? 0,
      message: message ?? "注册成功",
      entityId: j.entityId,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, message: msg };
  }
}

export async function publishAreaEntity(
  input: BuildAreaPublishEntityInput,
): Promise<PublishEntityResult> {
  const body = buildAreaPublishEntity(input);
  if (!body) {
    return {
      ok: false,
      error: "无法构建区域实体（仅支持矩形/圆/多边形）",
      message: "无法构建区域实体（仅支持矩形/圆/多边形）",
    };
  }
  return postPublishEntity(body);
}

export async function publishRouteEntity(input: {
  groupId: number;
  areaId: number;
  routeName: string;
  points: LngLat[];
}): Promise<PublishEntityResult> {
  const body = buildRoutePublishEntity(input);
  if (!body) return { ok: false, error: "无法构建航线实体（至少 2 个折点）", message: "无法构建航线实体（至少 2 个折点）" };
  return postPublishEntity(body);
}

/** 标绘存库后发布实体：区域或航线 */
export async function publishDrawnMapEntity(input: {
  groupId: number;
  areaId: number;
  name: string;
  shape: AreaDrawShape;
  points: LngLat[];
  lineColor?: string;
  lineWidth?: number;
}): Promise<PublishEntityResult> {
  if (input.shape === "route") {
    return publishRouteEntity({
      groupId: input.groupId,
      areaId: input.areaId,
      routeName: input.name,
      points: input.points,
    });
  }
  return publishAreaEntity({
    groupId: input.groupId,
    areaId: input.areaId,
    areaName: input.name,
    shape: input.shape,
    points: input.points,
    lineColor: input.lineColor,
    lineWidth: input.lineWidth,
  });
}

/** 删除实体 + 数据库 `area_table` 行 */
export async function deleteAreaWithEntity(
  groupId: number,
  areaId: number,
  areaType: number,
): Promise<{ ok: boolean; error?: string }> {
  const eid = mapEntityId(groupId, areaId, areaType);
  try {
    const entRes = await fetch(`/api/nexus-entities/${encodeURIComponent(eid)}`, { method: "DELETE" });
    const entJ = (await entRes.json()) as { ok?: boolean; error?: string; skipped?: boolean };
    if (!entRes.ok && entRes.status !== 404) {
      return { ok: false, error: entJ.error ?? `删除实体失败 HTTP ${entRes.status}` };
    }

    const dbRes = await fetch(
      `/api/db-areas?group_id=${groupId}&area_id=${areaId}`,
      { method: "DELETE" },
    );
    const dbJ = (await dbRes.json()) as { ok?: boolean; error?: string };
    if (!dbRes.ok || !dbJ.ok) {
      return { ok: false, error: dbJ.error ?? `删除数据库区域失败 HTTP ${dbRes.status}` };
    }

    await refetchDbAreas();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
