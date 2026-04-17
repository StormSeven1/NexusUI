/**
 * 矢量底图样式 → 图层面板「叠加层」列表的解析工具（纯函数，不访问 React / 地图实例）。
 *
 * ## 端到端流程（点击按钮为何能改地图）
 *
 * 1. **样式来源**：`offline-map.json`（或 env 指向的 URL）被 MapLibre 加载为 style。
 * 2. **解析时机**：`Map2D` 在 `map.on("load")` 里**最先**调用 `parseVectorLayersForPanel(map.getStyle())`。
 *    此时业务层（航迹、限制区等）尚未 `addLayer`，故 `style.layers` 与 JSON 里一致。
 * 3. **写入状态**：`setBasemapVectorInfo` → `app-store` 保存 `basemapStyleName`、`basemapVectorLayers`、
 *    以及每项默认 `basemapVectorVisibility[id]=true`、`basemapGroupVisible=true`。
 * 4. **面板展示**：`LayerPanel` 用 `useAppStore` 读上述字段，渲染底图标题、总开关、按 `group` 分组的子开关。
 * 5. **真正显隐**：`Map2D` 里**一个** `useAppStore.subscribe`：签名（底图总开关 + 子层 id + 各层开关 + 数据图层开关）变化时，
 *    调用 `applyLayerPanelVisibilityFromStore` 写 MapLibre 并 `redraw`（与 mousemove 等无关更新自动跳过）。
 *    底图子层公式：`可见 = basemapGroupVisible && basemapVectorVisibility[id] !== false`。
 *
 * ## 本文件职责
 *
 * - 从 `StyleSpecification` 读出根级 `name`（底图标题）。
 * - 为每个 `layer.id` 生成面板用 `label`、`group`（分组仅用于 UI，不改变 MapLibre 图层 id）。
 *
 * 数据图层（航迹等）的显隐在别处（`layerVisibility` + `LAYER_MAPPING`），**不在**本模块。
 */

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

/** 单条「叠加层」开关对应的数据：id 必须与 MapLibre 中 layer.id 一致 */
export type VectorLayerPanelItem = {
  id: string;
  /** 面板展示用中文名或 fallback */
  label: string;
  /** 分组 key；中文标题见 VECTOR_LAYER_GROUP_LABELS */
  group: string;
};

/** group → 图层面板分组小标题 */
export const VECTOR_LAYER_GROUP_LABELS: Record<string, string> = {
  background: "背景",
  natural: "水系与地表",
  roads: "道路与路网",
  buildings: "建筑",
  boundaries: "边界",
  labels: "地名与道路标注",
  other: "其他",
};

/** 与 offline 矢量瓦片常见 layer id 对齐的固定中文名（未知 id 走 labelForLayer 的 fallback） */
const ID_LABELS: Record<string, string> = {
  background: "背景底色",
  water: "水体",
  landcover: "土地覆盖",
  park: "绿地",
  landuse: "用地",
  transportation: "道路",
  transportation_major: "主干道",
  building: "建筑",
  boundary: "边界线",
  place_label: "地名",
  road_label: "道路名称",
};

/**
 * 按 layer.id 粗分「要素类」；与 MapLibre 图层类型无关，仅影响面板分组顺序与标题。
 * 新增样式 id 时：可在此加规则，或落入 other。
 */
function groupForLayerId(id: string): string {
  if (id === "background") return "background";
  if (["water", "landcover", "park", "landuse"].includes(id)) return "natural";
  if (["transportation", "transportation_major", "road_label"].includes(id)) return "roads";
  if (id === "building") return "buildings";
  if (id === "boundary") return "boundaries";
  if (id === "place_label") return "labels";
  if (id.includes("label") || id.includes("symbol")) return "labels";
  return "other";
}

/** 优先固定表 → 附带 source-layer → 最后用 id */
function labelForLayer(layer: LayerSpecification): string {
  const id = layer.id;
  if (ID_LABELS[id]) return ID_LABELS[id];
  const sl =
    "source-layer" in layer && typeof (layer as { "source-layer"?: string })["source-layer"] === "string"
      ? (layer as { "source-layer": string })["source-layer"]
      : undefined;
  if (sl) return `${id} (${sl})`;
  return id;
}

/** 面板里分组出现顺序（与渲染上下层无关，仅 UX） */
const GROUP_ORDER = ["background", "natural", "roads", "buildings", "boundaries", "labels", "other"];

export function sortPanelItemsByGroup(items: VectorLayerPanelItem[]): VectorLayerPanelItem[] {
  return [...items].sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group) === -1 ? 99 : GROUP_ORDER.indexOf(a.group);
    const gb = GROUP_ORDER.indexOf(b.group) === -1 ? 99 : GROUP_ORDER.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * 从已加载的 MapLibre style 解析底图标题 + 矢量子图层列表。
 * @returns styleName — 样式 JSON 根字段 `name`；layers — 供 store / 面板 / setLayoutProperty 使用
 */
export function parseVectorLayersForPanel(style: StyleSpecification): {
  styleName: string;
  layers: VectorLayerPanelItem[];
} {
  const styleName = typeof style.name === "string" && style.name.trim() ? style.name.trim() : "底图";
  const layers: VectorLayerPanelItem[] = [];
  for (const layer of style.layers ?? []) {
    if (!layer.id) continue;
    layers.push({
      id: layer.id,
      label: labelForLayer(layer),
      group: groupForLayerId(layer.id),
    });
  }
  return { styleName, layers: sortPanelItemsByGroup(layers) };
}
