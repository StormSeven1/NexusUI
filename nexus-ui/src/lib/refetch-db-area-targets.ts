import { useDbAreaTargetStore, type AreaTableTargetRow } from "@/stores/db-area-target-store";

/** 立即拉取 `area_table_target` 并更新 store */
export async function refetchDbAreaTargets(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/db-area-targets", { cache: "no-store" });
    const j = (await res.json()) as { areas?: unknown[]; error?: string };
    const rows = (Array.isArray(j.areas) ? j.areas : []).map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        id: String(r.id ?? ""),
        area_name: String(r.area_name ?? ""),
        target_id: Number(r.target_id),
        area_type: Number(r.area_type),
        start_point: r.start_point != null ? String(r.start_point) : null,
        end_point: r.end_point != null ? String(r.end_point) : null,
        area_rect: r.area_rect != null ? String(r.area_rect) : null,
        area_points: r.area_points != null ? String(r.area_points) : null,
      } satisfies AreaTableTargetRow;
    });
    useDbAreaTargetStore.getState().setRows(rows, j.error ?? null);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
