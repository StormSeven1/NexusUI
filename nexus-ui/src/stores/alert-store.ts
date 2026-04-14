import { create } from "zustand";

export interface AlertData {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
  timestamp: string;
  trackId?: string;
  lat?: number;
  lng?: number;
  type?: string;
}

interface AlertState {
  alerts: AlertData[];
  addAlerts: (newAlerts: AlertData[]) => void;
  clearAlerts: () => void;
}

const MAX_ALERTS = 100;

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],

  addAlerts: (newAlerts) =>
    set((s) => ({
      alerts: [...newAlerts, ...s.alerts].slice(0, MAX_ALERTS),
    })),

  clearAlerts: () => set({ alerts: [] }),
}));
