/**
 * 二维 MapLibre 可选栅格底图（XYZ 瓦片），在图层面板「地图」区与矢量底图并列开关。
 *
 * 配置：`NEXT_PUBLIC_MAP2D_RASTER_LAYERS` JSON 数组，见 `.env.example`。
 */

import type maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";

export type Map2dRasterLayerConfig = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  minZoom: number;
  maxZoom: number;
  tileSize: number;
  type: "xyz";
};

export type RasterLayerPanelItem = {
  id: string;
  name: string;
};

export function rasterSourceId(configId: string): string {
  return `nexus-raster-src-${configId}`;
}

export function rasterLayerId(configId: string): string {
  return `nexus-raster-lyr-${configId}`;
}

/** 会遮挡栅格底图显示的矢量面/底色图层（道路、标注等仍可与栅格叠加） */
export const VECTOR_BASEMAP_OPAQUE_LAYER_IDS = new Set([
  "background",
  "water",
  "landcover",
  "park",
  "landuse",
  "building",
]);

export function isVectorBasemapOpaqueLayer(layerId: string): boolean {
  return VECTOR_BASEMAP_OPAQUE_LAYER_IDS.has(layerId);
}

export function anyRasterBasemapVisible(
  visibility: Record<string, boolean>,
  configs: Map2dRasterLayerConfig[],
): boolean {
  return configs.some((c) => visibility[c.id] !== false);
}

function normalizeRasterLayer(raw: unknown): Map2dRasterLayerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const url = typeof o.url === "string" ? o.url.trim() : "";
  const type = o.type === "xyz" ? "xyz" : null;
  if (!id || !name || !url || !type) return null;
  const minZoom = typeof o.minZoom === "number" && Number.isFinite(o.minZoom) ? o.minZoom : 0;
  const maxZoom = typeof o.maxZoom === "number" && Number.isFinite(o.maxZoom) ? o.maxZoom : 18;
  const tileSize = typeof o.tileSize === "number" && Number.isFinite(o.tileSize) ? o.tileSize : 256;
  const enabled = o.enabled !== false;
  return { id, name, url, enabled, minZoom, maxZoom, tileSize, type };
}

/** 从 env 解析栅格图层列表（无配置或解析失败时返回 []） */
export function parseMap2dRasterLayersFromEnv(): Map2dRasterLayerConfig[] {
  const raw = process.env.NEXT_PUBLIC_MAP2D_RASTER_LAYERS?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Map2dRasterLayerConfig[] = [];
    for (const item of parsed) {
      const cfg = normalizeRasterLayer(item);
      if (cfg) out.push(cfg);
    }
    return out;
  } catch {
    console.warn("[map-2d-raster] NEXT_PUBLIC_MAP2D_RASTER_LAYERS 不是合法 JSON 数组");
    return [];
  }
}

function findRasterInsertBeforeId(style: StyleSpecification): string | undefined {
  const layers = style.layers ?? [];
  const bgIdx = layers.findIndex((l) => l.id === "background");
  if (bgIdx >= 0 && bgIdx + 1 < layers.length) return layers[bgIdx + 1]!.id;
  for (const l of layers) {
    if (l.id !== "background") return l.id;
  }
  return undefined;
}

/** 在矢量底图 background 之上、其余要素之下插入栅格层（可重复调用，已存在则跳过） */
export function installMap2dRasterLayers(map: maplibregl.Map, configs: Map2dRasterLayerConfig[]): void {
  if (!configs.length) return;
  let beforeId: string | undefined;
  try {
    beforeId = findRasterInsertBeforeId(map.getStyle());
  } catch {
    return;
  }

  for (const cfg of configs) {
    if (cfg.type !== "xyz") continue;
    const srcId = rasterSourceId(cfg.id);
    const lyrId = rasterLayerId(cfg.id);
    try {
      if (!map.getSource(srcId)) {
        map.addSource(srcId, {
          type: "raster",
          tiles: [cfg.url],
          tileSize: cfg.tileSize,
          minzoom: cfg.minZoom,
          maxzoom: cfg.maxZoom,
        });
      }
      if (!map.getLayer(lyrId)) {
        map.addLayer(
          {
            id: lyrId,
            type: "raster",
            source: srcId,
            minzoom: cfg.minZoom,
            maxzoom: cfg.maxZoom,
            paint: { "raster-opacity": 1 },
          },
          beforeId,
        );
      }
    } catch (e) {
      console.warn("[map-2d-raster] install failed:", cfg.id, e);
    }
  }
}

export function applyMap2dRasterLayerVisibility(
  map: maplibregl.Map,
  configs: Map2dRasterLayerConfig[],
  visibility: Record<string, boolean>,
): void {
  for (const cfg of configs) {
    const lyrId = rasterLayerId(cfg.id);
    try {
      if (!map.getLayer(lyrId)) continue;
      map.setLayoutProperty(lyrId, "visibility", visibility[cfg.id] !== false ? "visible" : "none");
    } catch {
      /* 图层尚未就绪 */
    }
  }
}

/** 栅格与矢量底图平级：栅格开启时隐藏不透明矢量面，避免盖住本地瓦片底图 */
export function resolveVectorBasemapLayerVisible(
  layerId: string,
  master: boolean,
  perLayer: Record<string, boolean>,
  rasterObscures: boolean,
): boolean {
  if (!master || perLayer[layerId] === false) return false;
  if (rasterObscures && isVectorBasemapOpaqueLayer(layerId)) return false;
  return true;
}

export function mapNeedsRasterLayersInstalled(
  map: maplibregl.Map,
  configs: Map2dRasterLayerConfig[],
): boolean {
  return configs.some((c) => !map.getLayer(rasterLayerId(c.id)));
}

export function rasterLayersForPanel(configs: Map2dRasterLayerConfig[]): RasterLayerPanelItem[] {
  return configs.map((c) => ({ id: c.id, name: c.name }));
}

export function defaultRasterVisibility(configs: Map2dRasterLayerConfig[]): Record<string, boolean> {
  return Object.fromEntries(configs.map((c) => [c.id, c.enabled]));
}
