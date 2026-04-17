import { create } from "zustand";
import type { ForceDisposition } from "@/lib/theme-colors";

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

interface AssetState {
  assets: AssetData[];
  /** WebSocket 全量实体列表（如 `Assets` / `assetBatch` / `entity_status`），由 `useUnifiedWsFeed` */
  setAssets: (assets: AssetData[]) => void;
  /** id 合并字段（如 `asset_events` 单条）*/
  mergeAssetFields: (id: string, patch: Partial<AssetData>) => void;
  /** 新增或覆盖整条实体（如 `DockStatus` / `DroneStatus` 单条）*/
  upsertAsset: (asset: AssetData) => void;
}

export const useAssetStore = create<AssetState>((set) => ({
  assets: [],

  setAssets: (assets) => set({ assets }),

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
}));
