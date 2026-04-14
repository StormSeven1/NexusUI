import { create } from "zustand";

export interface ZoneData {
  id: string;
  name: string;
  zone_type: string;
  source: string;
  /** [lng, lat][] 多边形坐标 */
  coordinates: Array<[number, number]>;
  color: string | null;
  fill_color: string | null;
  fill_opacity: number;
  properties: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const API_BASE =
  typeof window !== "undefined"
    ? `http://${window.location.hostname}:8001/api`
    : "";

interface ZoneState {
  zones: ZoneData[];
  loading: boolean;
  fetchZones: () => Promise<void>;
}

export const useZoneStore = create<ZoneState>((set) => ({
  zones: [],
  loading: false,

  fetchZones: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${API_BASE}/zones`);
      if (res.ok) {
        const data: ZoneData[] = await res.json();
        set({ zones: data });
      }
    } catch {
      /* 静默失败，保留旧数据 */
    } finally {
      set({ loading: false });
    }
  },
}));
