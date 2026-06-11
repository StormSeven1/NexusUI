/**
 * 三维 Cesium 相关环境变量（`NEXT_PUBLIC_MAP3D_*`），与二维 `map-2d-basemap.ts` 独立。
 *
 * Home 点：优先 `app-config.json` → `mapHome`；未配时回退 `NEXT_PUBLIC_MAP3D_INITIAL_*`。
 * `NEXT_PUBLIC_MAP3D_IMAGERY_URL`：必填，XYZ 瓦片模板 URL。
 */

import type { ImageryProvider } from "cesium";
import { resolveMap3dHomeView, type AppConfigMapHome } from "@/lib/map-home-config";

export function getMap3DInitialView(
  mapHome?: AppConfigMapHome | null,
): {
  center: [number, number];
  zoom: number;
} {
  return resolveMap3dHomeView(mapHome);
}

/** @deprecated 使用 `getMap3DInitialView(mapHome)` */
export function getMap3DInitialViewFromEnv(): {
  center: [number, number];
  zoom: number;
} {
  return resolveMap3dHomeView(null);
}

export function createCesiumBaseImageryProvider(Cesium: typeof import("cesium")): ImageryProvider {
  const url = (process.env.NEXT_PUBLIC_MAP3D_IMAGERY_URL ?? "").trim();
  if (!url) {
    throw new Error(
      "[map-3d] 缺少 NEXT_PUBLIC_MAP3D_IMAGERY_URL。须在 .env.local 配置 XYZ 瓦片模板 URL（无代码内默认），参见 .env.example。"
    );
  }
  return new Cesium.UrlTemplateImageryProvider({
    url,
    minimumLevel: 0,
    maximumLevel: 20,
  });
}
