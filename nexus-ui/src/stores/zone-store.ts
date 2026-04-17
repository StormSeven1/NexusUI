import { create } from "zustand";

export interface ZoneData {
  id: string;
  name: string;
  zone_type: string;
  source: string;
  /** [lng, lat][] 多边形坐标 */
  coordinates: Array<[number, number]>;
  /** 边线/标签字色来源：WS 见 `vueZoneItemToZoneData`（`strokeColor`）；2D 渲染见 `buildZonesFeatureCollection` 的 `lineColor` */
  color: string | null;
  /** 填充色：WS 见 `fillColor`；2D 当前写入 GeoJSON `fillColor` 属性，与 `polygon-draw-maplibre` 的 fill 图层一致 */
  fill_color: string | null;
  /** WS 解析写入；注意 2D `POLY_ZONES_FILL` 若未绑 `fill-opacity`，主要依赖 `fill_color` 字符串里的 alpha 或纯色与默认 paint */
  fill_opacity: number;
  properties: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface ZoneState {
  zones: ZoneData[];
  /** WebSocket 全量/同步（如 Vue `Zones` / `zones` 的 message.data 数组），见 `useUnifiedWsFeed` */
  setZones: (zones: ZoneData[]) => void;
}

export const useZoneStore = create<ZoneState>((set) => ({
  zones: [],

  setZones: (zones) => set({ zones }),
}));
