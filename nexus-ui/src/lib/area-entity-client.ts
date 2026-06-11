import { toast } from "sonner";
import { mapEntityId } from "@/lib/area-entity-id";
import type { AreaDrawShape, LngLat } from "@/lib/area-table-serialize";
import { getHttpConfig } from "@/lib/map-app-config";
import { refetchDbAreas } from "@/lib/refetch-db-areas";

export type PublishEntityResult = {
  ok: boolean;
  error?: string;
  code?: number;
  message?: string;
  entityId?: string;
};

/** 实体注册已移到 Custombackend；这里只保留兼容 toast。 */
export function toastEntityPublishResult(
  result: PublishEntityResult,
  kind: "区域" | "航线",
): void {
  if (result.ok) {
    const desc = [result.message, result.entityId ? `entityId: ${result.entityId}` : null]
      .filter(Boolean)
      .join(" | ");
    toast.success(`${kind}实体注册成功`, { description: desc || undefined });
  } else {
    const desc = [result.message || result.error, result.entityId ? `entityId: ${result.entityId}` : null]
      .filter(Boolean)
      .join(" | ");
    toast.error(`${kind}实体注册失败`, { description: desc || "未知错误" });
  }
}

export async function publishAreaEntity(): Promise<PublishEntityResult> {
  return {
    ok: false,
    error: "区域实体注册已移到 Custombackend",
    message: "区域实体注册已移到 Custombackend",
  };
}

export async function publishRouteEntity(input: {
  groupId: number;
  areaId: number;
  routeName: string;
  points: LngLat[];
}): Promise<PublishEntityResult> {
  return {
    ok: false,
    error: "航线实体注册已移到 Custombackend",
    message: "航线实体注册已移到 Custombackend",
    entityId: mapEntityId(input.groupId, input.areaId, 4),
  };
}

export async function publishDrawnMapEntity(input: {
  groupId: number;
  areaId: number;
  name: string;
  shape: AreaDrawShape;
  points: LngLat[];
  lineColor?: string;
  lineWidth?: number;
}): Promise<PublishEntityResult> {
  return {
    ok: false,
    error: "区域/航线实体注册已移到 Custombackend",
    message: "区域/航线实体注册已移到 Custombackend",
    entityId: mapEntityId(input.groupId, input.areaId, input.shape === "route" ? 4 : 3),
  };
}

/** 删除区域时统一请求 Custombackend，由后端负责删实体 + 删库 + 广播。 */
export async function deleteAreaWithEntity(
  groupId: number,
  areaId: number,
  areaType: number,
): Promise<{ ok: boolean; error?: string }> {
  const backendUrl = getHttpConfig().backendUrl.trim().replace(/\/+$/, "");
  try {
    const res = await fetch(
      `${backendUrl}/api/areas?group_id=${groupId}&area_id=${areaId}&area_type=${areaType}`,
      { method: "DELETE" },
    );
    const j = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !j.ok) {
      return { ok: false, error: j.error ?? `删除后端区域失败 HTTP ${res.status}` };
    }
    await refetchDbAreas();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
