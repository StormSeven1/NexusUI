"use client";

import { useEffect, useRef } from "react";
import { useDbAreaStore } from "@/stores/db-area-store";
import { useDbAreaTargetStore } from "@/stores/db-area-target-store";
import { recordDbAreasReceived } from "@/stores/network-stats-store";
import type { AreaTableRow } from "@/lib/area-table-geometry";
import { refetchDbAreaTargets } from "@/lib/refetch-db-area-targets";

const DEFAULT_INTERVAL_MS = 60_000;

async function fetchAreas(): Promise<{ rows: AreaTableRow[]; error: string | null }> {
  try {
    const res = await fetch("/api/db-areas", { cache: "no-store" });
    const j = (await res.json()) as {
      areas?: unknown[];
      error?: string;
    };
    const rows = (Array.isArray(j.areas) ? j.areas : []) as AreaTableRow[];
    return { rows, error: j.error ?? null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 定时拉取 `area_table` / `area_table_target` 并写入对应 store（供 2D/3D 区域图层绘制）。
 * 间隔：`NEXT_PUBLIC_DB_AREAS_POLL_MS`（毫秒），≤0 则仅挂载时请求一次（服务端连库 `NEXUS_POSTGRES_URL`）。
 */
export function useDbAreasPoll() {
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      if (!mounted.current) return;
      if (
        typeof window !== "undefined" &&
        "persist" in useDbAreaStore &&
        typeof useDbAreaStore.persist?.rehydrate === "function"
      ) {
        await useDbAreaStore.persist.rehydrate();
      }
      if (
        typeof window !== "undefined" &&
        "persist" in useDbAreaTargetStore &&
        typeof useDbAreaTargetStore.persist?.rehydrate === "function"
      ) {
        await useDbAreaTargetStore.persist.rehydrate();
      }
      if (!mounted.current) return;
      const [{ rows, error }, targets] = await Promise.all([fetchAreas(), refetchDbAreaTargets()]);
      if (!mounted.current) return;
      useDbAreaStore.getState().setRows(rows, error);
      if (rows.length > 0 || !error || targets.ok) recordDbAreasReceived();
    };
    void run();

    const raw = process.env.NEXT_PUBLIC_DB_AREAS_POLL_MS;
    const ms = raw == null || raw === "" ? DEFAULT_INTERVAL_MS : Number(raw);
    if (Number.isFinite(ms) && ms > 0) {
      timer = setInterval(run, ms);
    }

    return () => {
      mounted.current = false;
      if (timer) clearInterval(timer);
    };
  }, []);
}
