/**
 * 三维 Cesium 相关环境变量（`NEXT_PUBLIC_MAP3D_*`），与二维 `map-libre-basemap.ts` 独立。
 *
 * - `NEXT_PUBLIC_MAP3D_IMAGERY_URL`：必填，XYZ 瓦片模板 URL（代码不写死任何底图地址）。
 * - `NEXT_PUBLIC_MAP3D_INITIAL_CENTER` / `NEXT_PUBLIC_MAP3D_INITIAL_ZOOM`：必填，初始视角。
 *
 * 见 `nexus-ui/.env.example`。
 */

import type { ImageryProvider } from "cesium";

function parseRequiredCenter(raw: string | undefined): [number, number] {
  const s = raw?.trim();
  if (!s) {
    throw new Error(
      "[map-3d] 缺少 NEXT_PUBLIC_MAP3D_INITIAL_CENTER。请在 .env.local 中设为 经度,纬度，参见 .env.example。"
    );
  }
  const parts = s.split(/[,\s]+/).map(Number);
  if (parts.length < 2 || !parts.slice(0, 2).every((n) => Number.isFinite(n))) {
    throw new Error(
      `[map-3d] NEXT_PUBLIC_MAP3D_INITIAL_CENTER 格式无效，应为 经度,纬度，当前: ${raw}`
    );
  }
  return [parts[0]!, parts[1]!];
}

function parseRequiredZoom(raw: string | undefined): number {
  const s = raw?.trim();
  if (!s) {
    throw new Error(
      "[map-3d] 缺少 NEXT_PUBLIC_MAP3D_INITIAL_ZOOM。请在 .env.local 中设为数字，参见 .env.example。"
    );
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error(
      `[map-3d] NEXT_PUBLIC_MAP3D_INITIAL_ZOOM 格式无效，应为数字，当前: ${raw}`
    );
  }
  return n;
}

export function getMap3DInitialViewFromEnv(): {
  center: [number, number];
  zoom: number;
} {
  return {
    center: parseRequiredCenter(process.env.NEXT_PUBLIC_MAP3D_INITIAL_CENTER),
    zoom: parseRequiredZoom(process.env.NEXT_PUBLIC_MAP3D_INITIAL_ZOOM),
  };
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
