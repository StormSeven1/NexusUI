import { useDbAreaStore } from "@/stores/db-area-store";
import type { AreaTableRow } from "@/lib/area-table-geometry";
import { getHttpConfig } from "@/lib/map-app-config";

/** 单次向 Custombackend 拉取区域快照；实时刷新以 WS `DbAreas` 为主。 */
export async function refetchDbAreas(): Promise<{ ok: boolean; error?: string }> {
  try {
    const backendUrl = getHttpConfig().backendUrl.trim().replace(/\/+$/, "");
    const res = await fetch(`${backendUrl}/api/areas`, { cache: "no-store" });
    const j = (await res.json()) as { data?: unknown[]; error?: string };
    const rows = (Array.isArray(j.data) ? j.data : []) as AreaTableRow[];
    useDbAreaStore.getState().setRows(rows, j.error ?? null);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
