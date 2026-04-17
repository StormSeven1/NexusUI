/**
 * 二维底图（仅此模块；Map2D / MiniMap 只 import `getMaplibreBaseMapOptions`）
 *
 * 不设任何代码内默认值：必须在 `nexus-ui/.env.local` 中显式配置（见 `.env.example`）：
 * - `NEXT_PUBLIC_MAP2D_STYLE_URL` — 主图样式 JSON（二维底图来源）
 * - `NEXT_PUBLIC_MAP2D_MINI_STYLE_URL` — 小地图样式 JSON（可与主图相同，如离线时两行都写 `/map-styles/offline-map.json`）
 * - `NEXT_PUBLIC_MAP2D_INITIAL_CENTER` — 初始中心 `经度,纬度`
 * - `NEXT_PUBLIC_MAP2D_INITIAL_ZOOM` — 初始缩放级别（数字）
 *
 * 在线示例值见 `.env.example`；离线：样式指 `public/map-styles/` 下 JSON，PMTiles 地址写在 JSON 的 `pmtiles://...` 里。
 */

import maplibregl from "maplibre-gl";
import type { TransformStyleFunction } from "maplibre-gl";
import { Protocol } from "pmtiles";

/**
 * Next.js 只会把「写死的」`process.env.NEXT_PUBLIC_*` 打进客户端包；
 * 不能用 `process.env[key]` 动态读，否则浏览器里永远是 undefined。
 */
function requirePublicMapStyleUrl(): string {
  const v = process.env.NEXT_PUBLIC_MAP2D_STYLE_URL?.trim();
  if (!v) {
    throw new Error(
      "[map-basemap] 缺少环境变量 NEXT_PUBLIC_MAP2D_STYLE_URL。请在 nexus-ui/.env.local 中显式配置，参见 .env.example。"
    );
  }
  return v;
}

function requirePublicMapMiniStyleUrl(): string {
  const v = process.env.NEXT_PUBLIC_MAP2D_MINI_STYLE_URL?.trim();
  if (!v) {
    throw new Error(
      "[map-basemap] 缺少环境变量 NEXT_PUBLIC_MAP2D_MINI_STYLE_URL。请在 nexus-ui/.env.local 中显式配置，参见 .env.example。"
    );
  }
  return v;
}

function parseRequiredCenter(raw: string | undefined): [number, number] {
  const s = raw?.trim();
  if (!s) {
    throw new Error(
      "[map-basemap] 缺少 NEXT_PUBLIC_MAP2D_INITIAL_CENTER。请在 .env.local 中设为 经度,纬度，参见 .env.example。"
    );
  }
  const parts = s.split(/[,\s]+/).map(Number);
  if (parts.length < 2 || !parts.slice(0, 2).every((n) => Number.isFinite(n))) {
    throw new Error(
      `[map-basemap] NEXT_PUBLIC_MAP2D_INITIAL_CENTER 格式无效，应为 经度,纬度，当前: ${raw}`
    );
  }
  return [parts[0]!, parts[1]!];
}
function parseRequiredZoom(raw: string | undefined): number {
  const s = raw?.trim();
  if (!s) {
    throw new Error(
      "[map-basemap] 缺少 NEXT_PUBLIC_MAP2D_INITIAL_ZOOM。请在 .env.local 中设为数字，参见 .env.example。"
    );
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error(
      `[map-basemap] NEXT_PUBLIC_MAP2D_INITIAL_ZOOM 格式无效，应为数字，当前: ${raw}`
    );
  }
  return n;
}

/* ─── PMTiles 协议（style 里 pmtiles://...）─── */

let pmtilesRegistered = false;

function ensurePmtilesProtocol(): void {
  if (pmtilesRegistered || typeof window === "undefined") return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  pmtilesRegistered = true;
}

/**
 * MapLibre 5 对 sprite 会先 `new URL(sprite)`（无 base），相对路径会报错。
 * 样式里可写相对样式文件的路径，在此按样式 JSON 的 URL 转为绝对地址。
 *
 * 注意：不要对 glyphs 做 `new URL().href`——会把 `{fontstack}`、`{range}` 编码掉，
 * 导致规范校验报错「url must include a {fontstack} token」。glyphs 保持 `../fonts/...` 即可。
 */
export function createMaplibreTransformStyle(styleJsonUrl: string): TransformStyleFunction {
  return (_prev, next) => {
    if (typeof window === "undefined") return next;
    const base = new URL(styleJsonUrl, window.location.href).href;
    const o = { ...next };
    if (typeof o.sprite === "string" && o.sprite.length > 0) {
      try {
        new URL(o.sprite);
      } catch {
        o.sprite = new URL(o.sprite, base).href;
      }
    }
    return o;
  };
}

export function getMaplibreTransformStyle(kind: "main" | "mini"): TransformStyleFunction {
  const url = kind === "mini" ? requirePublicMapMiniStyleUrl() : requirePublicMapStyleUrl();
  return createMaplibreTransformStyle(url);
}

/* ─── 对外：创建 Map 时 spread（不含 style，需再 setStyle + transformStyle）─── */

export function getMaplibreBaseMapOptions(kind: "main" | "mini"): {
  style: string;
  center: [number, number];
  zoom: number;
  transformStyle: TransformStyleFunction;
} {
  const mainStyle = requirePublicMapStyleUrl();
  const miniStyle = requirePublicMapMiniStyleUrl();
  const center = parseRequiredCenter(process.env.NEXT_PUBLIC_MAP2D_INITIAL_CENTER);
  const zoom = parseRequiredZoom(process.env.NEXT_PUBLIC_MAP2D_INITIAL_ZOOM);

  ensurePmtilesProtocol();
  const style = kind === "mini" ? miniStyle : mainStyle;
  return {
    style,
    center,
    zoom,
    transformStyle: createMaplibreTransformStyle(style),
  };
}
