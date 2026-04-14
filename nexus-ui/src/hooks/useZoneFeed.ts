"use client";

import { useEffect } from "react";
import { useZoneStore } from "@/stores/zone-store";

/**
 * 初始化加载区域数据并定期刷新。
 * 在 AppShell 中调用一次即可。
 */
export function useZoneFeed() {
  const fetchZones = useZoneStore((s) => s.fetchZones);

  useEffect(() => {
    fetchZones();
    const timer = setInterval(fetchZones, 30_000);
    return () => clearInterval(timer);
  }, [fetchZones]);
}
