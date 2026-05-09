/**
 * 三维资产模型渲染模块。
 *
 * 模型映射：
 *   - radar                  → radar.glb
 *   - camera / tower / tdoa  → groundDisturb.glb
 *   - airport                → airDefence.glb
 *
 * 更新策略：diff，仅对新增 / 移除 / 位置变化的资产执行 entity 操作
 */

import { useAssetStore } from "@/stores/asset-store";
import { adaptAssetsForMap } from "@/lib/map-asset-adapter";
import type { Asset, PublicMapAssetType } from "@/lib/map-entity-model";

type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumEntity = import("cesium").Entity;

/* ── 模型路径 ── */
function assetModelUri(type: PublicMapAssetType): string | null {
  switch (type) {
    case "radar":  return "/3dmodules/radar.glb";
    case "camera":
    case "tower":
    case "laser":
    case "tdoa":   return "/3dmodules/groundDisturb.glb";
    case "airport": return "/3dmodules/airDefence.glb";
    default:       return null;
  }
}

const MODEL_SCALE = 50;
const MODEL_MIN_PIXEL_SIZE = 56;
const MODEL_MAX_SCALE = 50000;

/** 单个资产 entity（model + label） */
interface AssetEntitySet {
  entity: CesiumEntity;
}

/* ── 创建 / 更新 / 移除 ── */

function resolveAssetColor(C: CesiumModule, asset: Asset) {
  if (asset.friendlyMapColor) {
    return C.Color.fromCssColorString(asset.friendlyMapColor);
  }
  return undefined;
}

function createAssetEntity(
  viewer: CesiumViewer,
  C: CesiumModule,
  asset: Asset,
): AssetEntitySet | null {
  const uri = assetModelUri(asset.type);
  if (!uri) return null;
  const pos = C.Cartesian3.fromDegrees(asset.lng, asset.lat, 0);
  const hpr = new C.HeadingPitchRoll(C.Math.toRadians(asset.heading ?? 0), 0, 0);
  const orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
  const color = resolveAssetColor(C, asset);

  const entity = viewer.entities.add({
    position: new C.ConstantPositionProperty(pos),
    orientation: new C.ConstantProperty(orientation),
    model: {
      uri,
      scale: MODEL_SCALE,
      minimumPixelSize: MODEL_MIN_PIXEL_SIZE,
      maximumScale: MODEL_MAX_SCALE,
      heightReference: C.HeightReference.NONE,
      color: color ? new C.ConstantProperty(color) : undefined,
      colorBlendMode: color ? new C.ConstantProperty(C.ColorBlendMode.MIX) : undefined,
      colorBlendAmount: color ? new C.ConstantProperty(0.6) : undefined,
    },
    label: {
      text: asset.name || "",
      font: "12px sans-serif",
      style: C.LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 2,
      verticalOrigin: C.VerticalOrigin.BOTTOM,
      pixelOffset: new C.Cartesian2(0, -20),
      scaleByDistance: new C.NearFarScalar(1e4, 1, 5e5, 0.4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: { assetId: asset.id, assetType: asset.type, kind: "asset" },
  });
  return { entity };
}

function updateAssetEntity(C: CesiumModule, set: AssetEntitySet, asset: Asset): void {
  const pos = C.Cartesian3.fromDegrees(asset.lng, asset.lat, 0);
  const hpr = new C.HeadingPitchRoll(C.Math.toRadians(asset.heading ?? 0), 0, 0);
  const orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
  set.entity.position = new C.ConstantPositionProperty(pos);
  set.entity.orientation = new C.ConstantProperty(orientation);
  if (set.entity.label) {
    set.entity.label.text = new C.ConstantProperty(asset.name || "");
  }
}

function removeAssetEntity(viewer: CesiumViewer, set: AssetEntitySet): void {
  viewer.entities.remove(set.entity);
}

/* ── 渲染器类 ── */

export class AssetsCesium {
  private map = new Map<string, AssetEntitySet>();
  private opts: { getViewer: () => CesiumViewer | null; getCesium: () => CesiumModule | null };
  private raf: number | null = null;
  private unsub: (() => void) | null = null;

  constructor(opts: { getViewer: () => CesiumViewer | null; getCesium: () => CesiumModule | null }) {
    this.opts = opts;
  }

  install(): void {
    this.unsub = useAssetStore.subscribe(() => this.scheduleFlush());
    this.scheduleFlush();
  }

  uninstall(): void {
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.unsub?.(); this.unsub = null;
    const v = this.opts.getViewer();
    if (v && !v.isDestroyed()) {
      for (const s of this.map.values()) removeAssetEntity(v, s);
    }
    this.map.clear();
  }

  private scheduleFlush(): void {
    if (this.raf != null) return;
    this.raf = requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.raf = null;
    const v = this.opts.getViewer();
    const C = this.opts.getCesium();
    if (!v || !C || v.isDestroyed()) return;

    const assets = adaptAssetsForMap(useAssetStore.getState().assets);
    const seen = new Set<string>();
    for (const a of assets) {
      if (!assetModelUri(a.type)) continue;
      seen.add(a.id);
      const existing = this.map.get(a.id);
      if (existing) {
        updateAssetEntity(C, existing, a);
      } else {
        const s = createAssetEntity(v, C, a);
        if (s) this.map.set(a.id, s);
      }
    }
    for (const [id, s] of [...this.map]) {
      if (seen.has(id)) continue;
      removeAssetEntity(v, s);
      this.map.delete(id);
    }
  }
}

export function installAssetsCesium(opts: {
  getViewer: () => CesiumViewer | null;
  getCesium: () => CesiumModule | null;
}): () => void {
  const inst = new AssetsCesium(opts);
  inst.install();
  return () => inst.uninstall();
}
