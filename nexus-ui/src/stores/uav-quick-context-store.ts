"use client";

import { create } from "zustand";

/**
 * 光电面板 MQTT 解析到的机场/机体 SN；顶栏「一键返航/热备」在逐台下发时作兜底合并（见 `getAllFleetAirportSNs`）。
 */
interface UavQuickContextState {
  lastAirportSN: string | null;
  lastDeviceSN: string | null;
  setLastKnown: (airportSN: string | null, deviceSN: string | null) => void;
}

export const useUavQuickContextStore = create<UavQuickContextState>((set) => ({
  lastAirportSN: null,
  lastDeviceSN: null,
  setLastKnown: (airportSN, deviceSN) =>
    set({
      lastAirportSN: airportSN?.trim() || null,
      lastDeviceSN: deviceSN?.trim() || null,
    }),
}));
