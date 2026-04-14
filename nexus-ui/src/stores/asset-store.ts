import { create } from "zustand";

export interface AssetData {
  id: string;
  name: string;
  asset_type: string;
  status: string;
  lat: number;
  lng: number;
  range_km: number | null;
  heading: number | null;
  fov_angle: number | null;
  properties: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const API_BASE =
  typeof window !== "undefined"
    ? `http://${window.location.hostname}:8001/api`
    : "";

interface AssetState {
  assets: AssetData[];
  loading: boolean;
  fetchAssets: () => Promise<void>;
}

export const useAssetStore = create<AssetState>((set) => ({
  assets: [],
  loading: false,

  fetchAssets: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${API_BASE}/assets`);
      if (res.ok) {
        const data: AssetData[] = await res.json();
        set({ assets: data });
      }
    } catch {
      /* 静默失败，保留旧数据 */
    } finally {
      set({ loading: false });
    }
  },
}));
