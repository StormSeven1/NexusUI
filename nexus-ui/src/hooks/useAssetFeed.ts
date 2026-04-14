"use client";

import { useEffect } from "react";
import { useAssetStore } from "@/stores/asset-store";

/**
 * 初始化加载资产数据并定期刷新。
 * 在 AppShell 中调用一次即可。
 */
export function useAssetFeed() {
  const fetchAssets = useAssetStore((s) => s.fetchAssets);

  useEffect(() => {
    fetchAssets();
    const timer = setInterval(fetchAssets, 30_000);
    return () => clearInterval(timer);
  }, [fetchAssets]);
}
