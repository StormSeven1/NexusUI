"use client";

import dynamic from "next/dynamic";
import { useAppStore } from "@/stores/app-store";
import { MapLegendPanel } from "./MapLegendPanel";
// import { MiniMap } from "./MiniMap"; // 小地图暂隐藏，恢复时取消注释

/** dev 热更新 / 容器重启后浏览器可能仍引用旧 chunk，自动刷新一次 */
function importWithChunkRetry<T>(loader: () => Promise<T>): Promise<T> {
  return loader().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "";
    const isChunk =
      name === "ChunkLoadError" || /Failed to load chunk|Loading chunk .* failed/i.test(msg);
    if (isChunk && typeof window !== "undefined") {
      const key = "nexus-ui:chunk-reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
        return new Promise<T>(() => {});
      }
      sessionStorage.removeItem(key);
    }
    throw err;
  });
}

const Map2D = dynamic(
  () => importWithChunkRetry(() => import("./Map2D").then((m) => m.Map2D)),
  {
    ssr: false,
    loading: () => <MapPlaceholder />,
  },
);

const Map3D = dynamic(
  () => importWithChunkRetry(() => import("./Map3D").then((m) => m.Map3D)),
  {
    ssr: false,
    loading: () => <MapPlaceholder />,
  },
);

function MapPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-nexus-bg-base">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
        <span className="text-xs text-nexus-text-muted">加载地图中...</span>
      </div>
    </div>
  );
}

export function MapContainer() {
  const mapViewMode = useAppStore((s) => s.mapViewMode);

  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full">
        {mapViewMode === "2d" ? <Map2D /> : <Map3D />}
      </div>

      {/* 小地图暂隐藏；恢复：取消上面 MiniMap import 注释并取消下一行注释 */}
      {/* <MiniMap /> */}

      <MapLegendPanel />

      {/* 中心十字
      <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
        <div className="relative h-6 w-6 opacity-20">
          <div className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-nexus-text-primary" />
          <div className="absolute bottom-0 left-1/2 h-2 w-px -translate-x-1/2 bg-nexus-text-primary" />
          <div className="absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-nexus-text-primary" />
          <div className="absolute right-0 top-1/2 h-px w-2 -translate-y-1/2 bg-nexus-text-primary" />
        </div>
      </div> */}

      {/* 边缘暗角 */}
      <div className="pointer-events-none absolute inset-0 z-[4] shadow-[inset_0_0_100px_rgba(10,10,15,0.8)]" />
    </div>
  );
}
