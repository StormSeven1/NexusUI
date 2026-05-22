import { useDbAreaStore } from "@/stores/db-area-store";
import type { AreaTableRow } from "@/lib/area-table-geometry";

/** 立即拉取 `area_table` 并更新 store（保存区域后调用） */
export async function refetchDbAreas(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/db-areas", { cache: "no-store" });
    const j = (await res.json()) as { areas?: unknown[]; error?: string };
    const rows = (Array.isArray(j.areas) ? j.areas : []) as AreaTableRow[];
    useDbAreaStore.getState().setRows(rows, j.error ?? null);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
