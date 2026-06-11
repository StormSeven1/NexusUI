/**
 * 地图 Home 点：优先 `public/app-config*.json` 根键 `mapHome`；
 * 未配置时回退 `NEXT_PUBLIC_MAP2D_*` / `NEXT_PUBLIC_MAP3D_*`（兼容旧部署）。
 *
 * `mapHome.center` 同时驱动：
 * - 2D / 3D 地图初始视角
 * - 小地图中心
 * - 资产列表 HOME 站点（`radar.devices` 中 id=home 的坐标会被同步覆盖）
 * - 图层面板「距离环」（态势同心圆，覆盖 localStorage 旧中心）
 */

import type { AssetData } from "@/stores/asset-store";

export type AppConfigMapHomeDistanceRings = {
  ringCount?: number;
  spacingNm?: number;
  ringColor?: string;
  ringOpacity?: number;
  labelOpacity?: number;
};

export type AppConfigMapHome = {
  center: [number, number];
  zoom2d: number;
  zoom3d: number;
  /** 可选：态势距离环样式；中心始终用 `center` */
  distanceRings?: AppConfigMapHomeDistanceRings;
};

function parseCenter(raw: unknown): [number, number] | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const lng = Number(raw[0]);
    const lat = Number(raw[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  }
  if (typeof raw === "string" && raw.trim()) {
    const parts = raw.split(/[,\s]+/).map(Number);
    if (parts.length >= 2 && parts.slice(0, 2).every((n) => Number.isFinite(n))) {
      return [parts[0]!, parts[1]!];
    }
  }
  return null;
}

function parseZoom(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseCenterFromEnv(raw: string | undefined, label: string): [number, number] | null {
  const s = raw?.trim();
  if (!s) return null;
  const parts = s.split(/[,\s]+/).map(Number);
  if (parts.length < 2 || !parts.slice(0, 2).every((n) => Number.isFinite(n))) {
    console.warn(`[map-home] ${label} 格式无效: ${raw}`);
    return null;
  }
  return [parts[0]!, parts[1]!];
}

/** 从 app-config 根对象解析 `mapHome` */
export function parseMapHomeFromRoot(root: Record<string, unknown>): AppConfigMapHome | null {
  const block = root.mapHome;
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  const o = block as Record<string, unknown>;
  const center = parseCenter(o.center);
  if (!center) return null;
  const zoom2d = parseZoom(o.zoom2d ?? o.zoom ?? o.zoom2D, 14);
  const zoom3d = parseZoom(o.zoom3d ?? o.zoom ?? o.zoom3D, zoom2d);
  const drRaw = o.distanceRings;
  let distanceRings: AppConfigMapHomeDistanceRings | undefined;
  if (drRaw && typeof drRaw === "object" && !Array.isArray(drRaw)) {
    const dr = drRaw as Record<string, unknown>;
    distanceRings = {
      ...(dr.ringCount != null ? { ringCount: Number(dr.ringCount) } : {}),
      ...(dr.spacingNm != null ? { spacingNm: Number(dr.spacingNm) } : {}),
      ...(typeof dr.ringColor === "string" ? { ringColor: dr.ringColor } : {}),
      ...(dr.ringOpacity != null ? { ringOpacity: Number(dr.ringOpacity) } : {}),
      ...(dr.labelOpacity != null ? { labelOpacity: Number(dr.labelOpacity) } : {}),
    };
    if (Object.keys(distanceRings).length === 0) distanceRings = undefined;
  }
  return { center, zoom2d, zoom3d, distanceRings };
}

function envFallback2d(): AppConfigMapHome | null {
  const center = parseCenterFromEnv(
    process.env.NEXT_PUBLIC_MAP2D_INITIAL_CENTER,
    "NEXT_PUBLIC_MAP2D_INITIAL_CENTER",
  );
  if (!center) return null;
  const zRaw = process.env.NEXT_PUBLIC_MAP2D_INITIAL_ZOOM?.trim();
  const zoom2d = zRaw && Number.isFinite(Number(zRaw)) ? Number(zRaw) : 14;
  const center3 = parseCenterFromEnv(
    process.env.NEXT_PUBLIC_MAP3D_INITIAL_CENTER,
    "NEXT_PUBLIC_MAP3D_INITIAL_CENTER",
  );
  const z3Raw = process.env.NEXT_PUBLIC_MAP3D_INITIAL_ZOOM?.trim();
  const zoom3d =
    z3Raw && Number.isFinite(Number(z3Raw))
      ? Number(z3Raw)
      : center3
        ? zoom2d
        : zoom2d;
  return {
    center,
    zoom2d,
    zoom3d: center3 ? (z3Raw && Number.isFinite(Number(z3Raw)) ? Number(z3Raw) : zoom2d) : zoom2d,
  };
}

export function resolveMap2dHomeView(mapHome: AppConfigMapHome | null | undefined): {
  center: [number, number];
  zoom: number;
} {
  if (mapHome) return { center: mapHome.center, zoom: mapHome.zoom2d };
  const env = envFallback2d();
  if (env) return { center: env.center, zoom: env.zoom2d };
  throw new Error(
    "[map-home] 未配置 Home 点。请在 app-config.json 添加 mapHome（center/zoom2d），或设置 NEXT_PUBLIC_MAP2D_INITIAL_CENTER。",
  );
}

export function resolveMap3dHomeView(mapHome: AppConfigMapHome | null | undefined): {
  center: [number, number];
  zoom: number;
} {
  if (mapHome) return { center: mapHome.center, zoom: mapHome.zoom3d };
  const env = envFallback2d();
  if (env) {
    const center3 = parseCenterFromEnv(
      process.env.NEXT_PUBLIC_MAP3D_INITIAL_CENTER,
      "NEXT_PUBLIC_MAP3D_INITIAL_CENTER",
    );
    const z3Raw = process.env.NEXT_PUBLIC_MAP3D_INITIAL_ZOOM?.trim();
    const zoom3d =
      z3Raw && Number.isFinite(Number(z3Raw)) ? Number(z3Raw) : env.zoom2d;
    return { center: center3 ?? env.center, zoom: zoom3d };
  }
  throw new Error(
    "[map-home] 未配置 3D Home 点。请在 app-config.json 添加 mapHome，或设置 NEXT_PUBLIC_MAP3D_INITIAL_CENTER。",
  );
}

/** 将 mapHome 同步到 radar HOME 静态资产（资产列表 / 距离环） */
export function applyMapHomeToRadarAssets(
  assets: AssetData[],
  mapHome: AppConfigMapHome | null,
): AssetData[] {
  if (!mapHome) return assets;
  const [lng, lat] = mapHome.center;
  return assets.map((a) => {
    if (a.id.trim().toLowerCase() !== "home") return a;
    return { ...a, lat, lng };
  });
}
