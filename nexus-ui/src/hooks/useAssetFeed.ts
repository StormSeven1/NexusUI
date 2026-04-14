"use client";

import { useEffect } from "react";
import { useAssetStore } from "@/stores/asset-store";

/**
 * 初始化加载资产数据并定期刷新。
 * 当有活跃任务的资产时（en_route/monitoring），每 3 秒刷新以跟踪移动。
 * 在 AppShell 中调用一次即可。
 */
export function useAssetFeed() {
  const fetchAssets = useAssetStore((s) => s.fetchAssets);
  const assets = useAssetStore((s) => s.assets);

  const hasActiveMission = assets.some(
    (a) => a.mission_status === "en_route" || a.mission_status === "monitoring" || a.mission_status === "assigned"
  );
  const interval = hasActiveMission ? 3_000 : 30_000;

  useEffect(() => {
    fetchAssets();
    const timer = setInterval(fetchAssets, interval);
    return () => clearInterval(timer);
  }, [fetchAssets, interval]);
}
