/**
 * 三维资产模型渲染模块。
 *
 * 模型映射：
 *   - radar                  → radar.glb
 *   - camera                 → camera.glb
 *   - laser / tower / tdoa   → laser.glb
 *   - airport                → airport.glb
 *
 * 视棱锥（四棱锥）：
 *   - camera：showFov≠false 且 range>0 时渲染
 *   - laser：activationEnabled=true（与二维逻辑一致）时渲染
 *   - tdoa：activationEnabled=true（与二维逻辑一致）时渲染
 *
 * 更新策略：diff，仅对新增 / 移除 / 位置变化的资产执行 entity 操作
 */

import { useAssetStore } from "@/stores/asset-store";
import type { AssetData } from "@/stores/asset-store";
import { adaptAssetsForMap } from "@/lib/map-asset-adapter";
import type { Asset, PublicMapAssetType } from "@/lib/map-entity-model";
import { getMapModules } from "@/lib/map-module-registry";
import { getAssetFovFillStyle } from "@/lib/map-app-config";

type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumEntity = import("cesium").Entity;
type Cartesian3 = import("cesium").Cartesian3;

/* ── 模型路径 ── */
function assetModelUri(type: PublicMapAssetType): string | null {
  switch (type) {
    case "radar":   return "/3dmodules/radar.glb";
    case "camera":  return "/3dmodules/camera.glb";
    case "laser":
    case "tower":
    case "tdoa":    return "/3dmodules/laser.glb";
    case "airport": return "/3dmodules/airport.glb";
    default:        return null;
  }
}

/** 每类资产独立缩放（根据模型原始尺寸调整） */
function assetModelScale(type: PublicMapAssetType): number {
  switch (type) {
    case "airport": return 0.001;
    case "radar":   return 2;
    case "camera":  return 6;
    case "laser":
    case "tower":
    case "tdoa":    return 1;
    default:        return 2;
  }
}
const MODEL_MIN_PIXEL_SIZE = 32;
const MODEL_MAX_SCALE = 50;

/**
 * 从 app-config 读取视棱锥填充色（与二维 FOV 色调完全一致）。
 * 配置未加载时回落款默认色。
 */
function getFrustumFillColor(C: CesiumModule, type: PublicMapAssetType): import("cesium").Color {
  if (type === "camera" || type === "laser" || type === "tdoa") {
    const { color, opacity } = getAssetFovFillStyle(type);
    return (C.Color.fromCssColorString(color) ?? C.Color.WHITE.clone()).withAlpha(opacity);
  }
  return C.Color.WHITE.withAlpha(0.2);
}

/** 相机视锥默认参数（实时报文缺失时回退） */
const ASSET_DEFAULT_HFOV_DEG = 10;
const ASSET_DEFAULT_VFOV_DEG = 10;
const ASSET_DEFAULT_PITCH_DEG = 0;

/**
 * 传感器相对安装基座的额外高度偏移（米）。
 * 视场（四棱锥）起点 = properties.altitude（基座高度）+ 此偏移（镜头/天线离基座的距离）。
 * 模型仍放在 properties.altitude 处。
 */
const SENSOR_OFFSET_M: Record<PublicMapAssetType, number> = {
  radar:   15,   // 雷达天线杆
  camera:   16,   // 光电镜头离基座
  tower:    3,   // 电侦天线离基座
  laser:    3,   // 激光炮口离基座
  tdoa:     3,   // TDOA 天线离基座
  airport:  0,   // 机场停机坪，视场从基座出发
  drone:    0,   // 由 drones-cesium 独立处理
};

/* ── 接口 ── */

interface AssetFrustumState {
  origin: Cartesian3;
  corners: Cartesian3[];
}

/** 单个资产的全部 3D entity 集合 */
interface AssetEntitySet {
  entity: CesiumEntity;
  /** 4 个侧面三角形（顶点→corner[i]→corner[(i+1)%4]）；无视棱锥时为空数组 */
  frustumSides: CesiumEntity[];
  /** 远端封口面（4 角连成四边形）；无视棱锥时为 null */
  frustumCap: CesiumEntity | null;
  /** CallbackProperty 共享可变状态；无视棱锥时为 null */
  state: AssetFrustumState | null;
}

/**
 * 球面大圆航向终点（简化球面公式，误差 <0.01% @ 50km）。
 * 返回 [lng, lat]（度）。
 */
function destPoint(lng: number, lat: number, bearingDeg: number, distM: number): [number, number] {
  const R = 6371000;
  const d = distM / R;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lng * Math.PI / 180;
  const θ  = bearingDeg * Math.PI / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [λ2 * 180 / Math.PI, φ2 * 180 / Math.PI];
}

/**
 * 计算视棱锥远端 4 角（顶 tl/tr 与底 bl/br 水平距离相同 → 封口面为矩形）：
 *   底两角：水平方向 rangeM，altitude = sensorAltM
 *   顶两角：同水平位置，altitude = sensorAltM + rangeM×tan(vfovDeg)
 */
function computeAssetFrustumCorners(
  C: CesiumModule,
  lng: number,
  lat: number,
  sensorAltM: number,
  headingDeg: number,
  pitchDeg: number,
  hfovDeg: number,
  vfovDeg: number,
  rangeM: number,
): Cartesian3[] {
  const halfH = hfovDeg / 2;
  const halfV = vfovDeg / 2;
  const topAlt = sensorAltM + rangeM * Math.tan(C.Math.toRadians(pitchDeg + halfV));
  const bottomAlt = sensorAltM + rangeM * Math.tan(C.Math.toRadians(pitchDeg - halfV));
  const [llng, llat] = destPoint(lng, lat, headingDeg - halfH, rangeM); // 左
  const [rlng, rlat] = destPoint(lng, lat, headingDeg + halfH, rangeM); // 右
  /* 顺序：tl → tr → br → bl（与侧面索引 i→(i+1)%4 一致） */
  return [
    C.Cartesian3.fromDegrees(llng, llat, topAlt),  // tl
    C.Cartesian3.fromDegrees(rlng, rlat, topAlt),  // tr
    C.Cartesian3.fromDegrees(rlng, rlat, bottomAlt), // br
    C.Cartesian3.fromDegrees(llng, llat, bottomAlt), // bl
  ];
}

function normalizePitchForFrustum(pitchDeg: number): number {
  const wrapped = ((((pitchDeg + 180) % 360) + 360) % 360) - 180;
  return Math.max(-89, Math.min(89, wrapped));
}

/** 该类型是否需要视棱锥 */
function needsFrustum(type: PublicMapAssetType): boolean {
  return type === "camera" || type === "laser" || type === "tdoa";
}

/* ── 创建 ── */

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
  const entity = viewer.entities.add({
    position: new C.ConstantPositionProperty(pos),
    orientation: new C.ConstantProperty(orientation),
    model: {
      uri,
      scale: assetModelScale(asset.type),
      minimumPixelSize: MODEL_MIN_PIXEL_SIZE,
      maximumScale: MODEL_MAX_SCALE,
      heightReference: C.HeightReference.NONE,
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

  const frustumSides: CesiumEntity[] = [];
  let frustumCap: CesiumEntity | null = null;
  let state: AssetFrustumState | null = null;

  if (needsFrustum(asset.type)) {
    const fillCol = getFrustumFillColor(C, asset.type);
    state = { origin: pos, corners: [] };

    /* 4 三角形侧面：顶点 → corner[i] → corner[(i+1)%4] */
    for (let i = 0; i < 4; i++) {
      const idx = i; // capture per iteration
      frustumSides.push(
        viewer.entities.add({
          show: false,
          polygon: {
            hierarchy: new C.CallbackProperty(() => {
              if (!state || state.corners.length < 4) return new C.PolygonHierarchy([]);
              return new C.PolygonHierarchy([
                state.origin,
                state.corners[idx]!,
                state.corners[(idx + 1) % 4]!,
              ]);
            }, false),
            perPositionHeight: true,
            material: fillCol,
            outline: false,
          },
          properties: { assetId: asset.id, kind: "frustumSide", sideIndex: idx },
        }),
      );
    }

    /* 远端封口面：4 corner 连成四边形 */
    frustumCap = viewer.entities.add({
      show: false,
      polygon: {
        hierarchy: new C.CallbackProperty(() => {
          if (!state || state.corners.length < 4) return new C.PolygonHierarchy([]);
          return new C.PolygonHierarchy([...state.corners]);
        }, false),
        perPositionHeight: true,
        material: fillCol,
        outline: false,
      },
      properties: { assetId: asset.id, kind: "frustumCap" },
    });
  }

  return { entity, frustumSides, frustumCap, state };
}

/* ── 更新 ── */

function updateAssetEntity(
  C: CesiumModule,
  set: AssetEntitySet,
  asset: Asset,
  modelAltM: number,
  frustumAltM: number,
  frustumVisible: boolean,
  frustumShape: { hfovDeg: number; vfovDeg: number; pitchDeg: number },
): void {
  /* 模型放在基座高度；棱锥顶点从传感器实际位置（基座+偏移）出发 */
  const modelPos      = C.Cartesian3.fromDegrees(asset.lng, asset.lat, modelAltM);
  const frustumOrigin = C.Cartesian3.fromDegrees(asset.lng, asset.lat, frustumAltM);
  const hpr = new C.HeadingPitchRoll(C.Math.toRadians(asset.heading ?? 0), 0, 0);
  const orientation = C.Transforms.headingPitchRollQuaternion(modelPos, hpr);
  set.entity.position = new C.ConstantPositionProperty(modelPos);
  set.entity.orientation = new C.ConstantProperty(orientation);
  if (set.entity.label) {
    set.entity.label.text = new C.ConstantProperty(asset.name || "");
  }

  if (set.state) {
    const rangeM = (asset.range ?? 0) * 1000;
    const hfov = Math.min(frustumShape.hfovDeg, 179);
    const vfov = Math.min(frustumShape.vfovDeg, 179);
    const pitch = normalizePitchForFrustum(frustumShape.pitchDeg);
    const show   = frustumVisible && rangeM > 0;
    if (show) {
      const corners = computeAssetFrustumCorners(
        C, asset.lng, asset.lat, frustumAltM, asset.heading ?? 0, pitch, hfov, vfov, rangeM,
      );
      set.state.origin = frustumOrigin;
      set.state.corners.length = 0;
      for (const c of corners) set.state.corners.push(c);
    } else {
      set.state.corners.length = 0;
    }
    for (const e of set.frustumSides) e.show = show;
    if (set.frustumCap) set.frustumCap.show = show;
  }
}

/* ── 移除 ── */

function removeAssetEntity(viewer: CesiumViewer, set: AssetEntitySet): void {
  viewer.entities.remove(set.entity);
  for (const e of set.frustumSides) viewer.entities.remove(e);
  if (set.frustumCap) viewer.entities.remove(set.frustumCap);
}

/* ── 渲染器类 ── */

export class AssetsCesium {
  private map = new Map<string, AssetEntitySet>();
  private lastCameraFrustumLog = new Map<string, string>();
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
    this.lastCameraFrustumLog.clear();
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

    const rawStore: AssetData[] = useAssetStore.getState().assets;
    const rawById = new Map<string, AssetData>(rawStore.map((a) => [a.id, a]));
    const assets     = adaptAssetsForMap(rawStore);
    /* 读取激光/TDOA 激活状态（与二维逻辑一致，仅激活时渲染视棱锥） */
    const mods = getMapModules();
    const seen = new Set<string>();

    for (const a of assets) {
      if (!assetModelUri(a.type)) continue;
      seen.add(a.id);

      const raw = rawById.get(a.id);
      const props = raw?.properties as Record<string, unknown> | null | undefined;
      const fovObj = props?.fov as Record<string, unknown> | undefined;
      const originPtz = props?.originPtz as Record<string, unknown> | undefined;
      // const modelAltM = Number(props?.altitude ?? props?.alt ?? posObj?.altitude ?? posObj?.alt ?? 0);
      const modelAltM = 0;
      /* 视场起点：基座 + 传感器偏移（镜头/天线离基座距离） */
      const frustumAltM = modelAltM + SENSOR_OFFSET_M[a.type];
      const rawVertical = Number(fovObj?.vertical);
      const hasVertical = Number.isFinite(rawVertical) && rawVertical > 0;
      const vfovDeg =
        hasVertical ? rawVertical : ASSET_DEFAULT_VFOV_DEG;
      const rawTilt = Number(originPtz?.tilt);
      const hasTilt = Number.isFinite(rawTilt);
      const pitchDeg =
        hasTilt ? rawTilt + 180 : ASSET_DEFAULT_PITCH_DEG;
      const hfovDeg = Math.min(a.fovAngle ?? ASSET_DEFAULT_HFOV_DEG, 179);

      /* 确定视棱锥可见性 */
      let frustumVisible = false;
      if (a.type === "camera") {
        frustumVisible = a.showFov !== false && (a.range ?? 0) > 0;
      } else if (a.type === "laser") {
        frustumVisible = (mods?.laser.getDevice(a.id)?.activationEnabled ?? false) && (a.range ?? 0) > 0;
      } else if (a.type === "tdoa") {
        frustumVisible = (mods?.tdoa.getDevice(a.id)?.activationEnabled ?? false) && (a.range ?? 0) > 0;
      }

      const existing = this.map.get(a.id);
      // if (a.type === "camera") {
      //   const rangeM = (a.range ?? 0) * 1000;
      //   const sensorOffsetM = SENSOR_OFFSET_M[a.type];
      //   const normalizedPitchDeg = normalizePitchForFrustum(pitchDeg);
      //   const rawPosAltM = Number(posObj?.altitude);
      //   const rawPosLng = Number(posObj?.longitude ?? posObj?.lng ?? posObj?.lon);
      //   const rawPosLat = Number(posObj?.latitude ?? posObj?.lat);
      //   const rawOriginPan = Number(originPtz?.pan);
      //   const rawOriginTilt = Number(originPtz?.tilt);
      //   const hasOriginPan = Number.isFinite(rawOriginPan);
        // const sig = [
        //   hfovDeg.toFixed(3),
        //   vfovDeg.toFixed(3),
        //   pitchDeg.toFixed(3),
        //   modelAltM.toFixed(3),
        //   frustumAltM.toFixed(3),
        //   rangeM.toFixed(3),
        //   String(hasVertical),
        //   String(hasTilt),
        // ].join("|");
        // if (this.lastCameraFrustumLog.get(a.id) !== sig) {
        //   this.lastCameraFrustumLog.set(a.id, sig);
        //   console.log("[三维相机参数]", {
        //     相机ID: a.id,
        //     时间: new Date().toISOString(),
        //     位置经度: a.lng,
        //     位置纬度: a.lat,
        //     原始报文经度: Number.isFinite(rawPosLng) ? rawPosLng : null,
        //     原始报文纬度: Number.isFinite(rawPosLat) ? rawPosLat : null,
        //     原始报文海拔M: Number.isFinite(rawPosAltM) ? rawPosAltM : null,
        //     模型基座高度M: modelAltM,
        //     传感器杆高偏移M: sensorOffsetM,
        //     视锥起点高度M: frustumAltM,
        //     量程M: rangeM,
        //     水平角Deg: a.heading ?? 0,
        //     水平角来源: hasOriginPan ? "originPtz.pan" : "asset.heading(可能来自静态/历史值)",
        //     是否命中originPtz_pan: hasOriginPan,
        //     原始originPtz_pan: Number.isFinite(rawOriginPan) ? rawOriginPan : null,
        //     水平视场角Deg: hfovDeg,
        //     水平视场角来源: "fov.horizontal(经asset.fovAngle传递)",
        //     原始fov_horizontal: Number(fovObj?.horizontal),
        //     垂直视场角Deg: vfovDeg,
        //     是否命中fov_vertical: hasVertical,
        //     垂直视场角来源: hasVertical ? "fov.vertical" : `默认值${ASSET_DEFAULT_VFOV_DEG}`,
        //     原始fov_vertical: Number.isFinite(rawVertical) ? rawVertical : null,
        //     俯仰角Deg_原始计算: pitchDeg,
        //     俯仰角Deg_参与绘制: normalizedPitchDeg,
        //     是否命中originPtz_tilt: hasTilt,
        //     俯仰角来源: hasTilt ? "originPtz.tilt + 180" : `默认值${ASSET_DEFAULT_PITCH_DEG}`,
        //     原始originPtz_tilt: Number.isFinite(rawOriginTilt) ? rawOriginTilt : null,
        //   });
        // }
      // }
      if (existing) {
        updateAssetEntity(C, existing, a, modelAltM, frustumAltM, frustumVisible, { hfovDeg, vfovDeg, pitchDeg });
      } else {
        const s = createAssetEntity(v, C, a);
        if (s) {
          updateAssetEntity(C, s, a, modelAltM, frustumAltM, frustumVisible, { hfovDeg, vfovDeg, pitchDeg });
          this.map.set(a.id, s);
        }
      }
    }
    for (const [id, s] of [...this.map]) {
      if (seen.has(id)) continue;
      removeAssetEntity(v, s);
      this.map.delete(id);
    }
  }

  /** 激光/TDOA 激活状态变更时调用（从外部触发重绘） */
  scheduleRefresh(): void {
    this.scheduleFlush();
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
