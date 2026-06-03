import { create } from "zustand";
import type { ForceDisposition } from "@/lib/theme-colors";

/**
 * Asset store is the single source of truth for all runtime assets in the active UI.
 *
 * Responsibilities:
 * - store the normalized `AssetData[]` snapshot used by map layers, panels, placards, and tools
 * - store the airport <-> drone relationship graph extracted from websocket payloads
 * - store id mapping tables so runtime packets can resolve entity ids / device serial numbers consistently
 * - expose lightweight patch helpers (`mergeAssetFields`, `upsertAsset`, `removeAsset`) for incremental updates
 *
 * Current architecture:
 * - the old dedicated `drone-store` is retired from the active runtime
 * - drone telemetry, dock telemetry, planned route, history trail, and relationship metadata
 *   all converge into this store
 * - 2D and 3D renderers derive specialized view models from here instead of owning
 *   separate websocket parsing logic
 */

export interface AssetData {
  id: string;
  name: string;
  asset_type: string;
  status: string;
  /** 敌我：友方/敌方/中立；未写时解析为友方（与静态配置默认一致） */
  disposition?: ForceDisposition;
  lat: number;
  lng: number;
  range_km: number | null;
  heading: number | null;
  fov_angle: number | null;
  properties: Record<string, unknown> | null;
  mission_status: string;
  assigned_target_id: string | null;
  target_lat: number | null;
  target_lng: number | null;
  created_at: string;
  updated_at: string;
}

export interface AssetRelationshipNode {
  id: string;
  name?: string;
  assetType?: string;
  latitude?: number;
  longitude?: number;
  deviceSn?: string;
  gatewaySn?: string;
  virtualTroop: boolean;
  disposition?: string;
}

export interface AssetRelationshipEdge {
  parent: string;
  child: string;
  relationshipId?: string;
}

export interface AssetRelationshipGraph {
  nodes: AssetRelationshipNode[];
  edges: AssetRelationshipEdge[];
}

interface AssetState {
  assets: AssetData[];
  relationships: AssetRelationshipGraph | null;
  entityIdToDeviceSn: Record<string, string>;
  deviceSnToEntityId: Record<string, string>;
  dockSnToEntityId: Record<string, string>;
  /** WebSocket 全量实体列表（如 `Assets` / `assetBatch` / `entity_status`），由 `useUnifiedWsFeed` */
  setAssets: (assets: AssetData[]) => void;
  setRelationships: (relationships: AssetRelationshipGraph | null) => void;
  setEntityMappings: (payload: {
    entityIdToDeviceSn?: Record<string, string>;
    deviceSnToEntityId?: Record<string, string>;
    dockSnToEntityId?: Record<string, string>;
  }) => void;
  /** id 合并字段（如 `asset_events` 单条）*/
  mergeAssetFields: (id: string, patch: Partial<AssetData>) => void;
  /** 新增或覆盖整条实体（如 `DockStatus` / `DroneStatus` 单条）*/
  upsertAsset: (asset: AssetData) => void;
  /** 从资产列表移除（巡飞弹摧毁等） */
  removeAsset: (id: string) => void;
  /**
   * 每个资产的显示参数覆盖（不会被 WS 刷新覆盖）。
   * key = assetId, value = 要合并到 asset.properties 的字段（如 showRings, ring_color 等）
   */
  displayOverrides: Record<string, Record<string, unknown>>;
  /** 设置（或合并）某资产的显示覆盖 */
  setDisplayOverride: (id: string, patch: Record<string, unknown>) => void;
  /** 清除某资产的所有显示覆盖（重置为默认）*/
  clearDisplayOverride: (id: string) => void;
}

function shallowEqualRecord(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function sameAsset(left: AssetData, right: AssetData): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.asset_type === right.asset_type &&
    left.status === right.status &&
    left.disposition === right.disposition &&
    left.lat === right.lat &&
    left.lng === right.lng &&
    left.range_km === right.range_km &&
    left.heading === right.heading &&
    left.fov_angle === right.fov_angle &&
    left.mission_status === right.mission_status &&
    left.assigned_target_id === right.assigned_target_id &&
    left.target_lat === right.target_lat &&
    left.target_lng === right.target_lng &&
    left.created_at === right.created_at &&
    left.updated_at === right.updated_at &&
    shallowEqualRecord(left.properties, right.properties)
  );
}

export const useAssetStore = create<AssetState>((set) => ({
  assets: [],
  relationships: null,
  entityIdToDeviceSn: {},
  deviceSnToEntityId: {},
  dockSnToEntityId: {},
  displayOverrides: {},

  setAssets: (assets) =>
    set((s) => {
      if (s.assets.length === assets.length) {
        let allSame = true;
        const next = assets.map((asset, index) => {
          const prev = s.assets[index];
          if (prev && sameAsset(prev, asset)) return prev;
          allSame = false;
          return asset;
        });
        if (allSame) return s;
        return { assets: next };
      }
      const prevById = new Map(s.assets.map((asset) => [asset.id, asset]));
      const next = assets.map((asset) => {
        const prev = prevById.get(asset.id);
        return prev && sameAsset(prev, asset) ? prev : asset;
      });
      return { assets: next };
    }),

  setRelationships: (relationships) => set({ relationships }),

  setEntityMappings: (payload) =>
    set({
      entityIdToDeviceSn: payload.entityIdToDeviceSn ?? {},
      deviceSnToEntityId: payload.deviceSnToEntityId ?? {},
      dockSnToEntityId: payload.dockSnToEntityId ?? {},
    }),

  mergeAssetFields: (id, patch) =>
    set((s) => ({
      assets: s.assets.map((a) =>
        a.id === id ? { ...a, ...patch, updated_at: new Date().toISOString() } : a
      ),
    })),

  upsertAsset: (asset) =>
    set((s) => {
      const ts = new Date().toISOString();
      const i = s.assets.findIndex((a) => a.id === asset.id);
      if (i >= 0) {
        const next = [...s.assets];
        next[i] = { ...next[i], ...asset, updated_at: ts };
        return { assets: next };
      }
      return {
        assets: [
          ...s.assets,
          {
            ...asset,
            created_at: asset.created_at || ts,
            updated_at: ts,
          },
        ],
      };
    }),

  removeAsset: (id) =>
    set((s) => ({
      assets: s.assets.filter((a) => a.id !== id),
    })),

  setDisplayOverride: (id, patch) =>
    set((s) => ({
      displayOverrides: {
        ...s.displayOverrides,
        [id]: { ...(s.displayOverrides[id] ?? {}), ...patch },
      },
    })),

  clearDisplayOverride: (id) =>
    set((s) => {
      const next = { ...s.displayOverrides };
      delete next[id];
      return { displayOverrides: next };
    }),
}));
