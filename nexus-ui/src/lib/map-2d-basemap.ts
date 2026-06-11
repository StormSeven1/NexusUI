/**
 * 二维底图（仅此模块；Map2D / MiniMap 只 import `getMaplibreBaseMapOptions`）
 *
 * Home 点：优先 `app-config.json` → `mapHome`（见 `map-home-config.ts`）；未配时回退 `.env.local` 的 `NEXT_PUBLIC_MAP2D_INITIAL_*`。
 *
 * 在线示例值见 `.env.example`；离线：样式指 `public/map-styles/` 下 JSON，PMTiles 地址写在 JSON 的 `pmtiles://...` 里。
 */

import maplibregl from "maplibre-gl";
import type { SourceSpecification, TransformStyleFunction } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { resolveMap2dHomeView, type AppConfigMapHome } from "@/lib/map-home-config";

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

/* ─── PMTiles 协议（style 里 pmtiles://...）─── */

let pmtilesRegistered = false;

function ensurePmtilesProtocol(): void {
  if (pmtilesRegistered || typeof window === "undefined") return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  pmtilesRegistered = true;
}

/**
 * Next HTTPS dev 与样式里 `http://.../tiles/*.pmtiles` 不一致时，浏览器会对 TLS 端口发明文 HTTP → `net::ERR_EMPTY_RESPONSE`。
 * 约定：`public/tiles/` 下的离线瓦片与前端同源，将 `pmtiles://http(s)://任意主机/tiles/...` 改为当前页 `origin` + 路径。
 */
function rewritePmtilesUrlForPageOrigin(url: string): string {
  const prefix = "pmtiles://";
  if (!url.startsWith(prefix)) return url;
  const inner = url.slice(prefix.length);
  try {
    const u = new URL(inner);
    if (!u.pathname.startsWith("/tiles/")) return url;
    return `${prefix}${window.location.origin}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
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
    if (o.sources && typeof o.sources === "object") {
      o.sources = { ...o.sources };
      for (const key of Object.keys(o.sources)) {
        const src = o.sources[key] as { url?: string } | undefined;
        if (src && typeof src === "object" && typeof src.url === "string") {
          o.sources[key] = {
            ...src,
            url: rewritePmtilesUrlForPageOrigin(src.url),
          } as SourceSpecification;
        }
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

export function getMaplibreBaseMapOptions(
  kind: "main" | "mini",
  mapHome?: AppConfigMapHome | null,
): {
  style: string;
  center: [number, number];
  zoom: number;
  transformStyle: TransformStyleFunction;
} {
  const mainStyle = requirePublicMapStyleUrl();
  const miniStyle = requirePublicMapMiniStyleUrl();
  const { center, zoom } = resolveMap2dHomeView(mapHome);

  ensurePmtilesProtocol();
  const style = kind === "mini" ? miniStyle : mainStyle;
  return {
    style,
    center,
    zoom,
    transformStyle: createMaplibreTransformStyle(style),
  };
}
