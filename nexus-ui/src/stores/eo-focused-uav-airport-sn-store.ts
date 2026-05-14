import { create } from "zustand";

/**
 * 当前焦点光电窗口播放 UAV 时，任务服务 `specification.deviceSn` 应填 **机场（机巢）gateway SN**，非机体 SN。
 * 由 `EoVideoPanel` 在焦点 dock + UAV 流时写入；供地图右键「无人机侦察此位置」等使用。
 */
type State = {
  airportSn: string;
  setAirportSn: (sn: string) => void;
};

export const useEoFocusedUavAirportSnStore = create<State>((set) => ({
  airportSn: "",
  setAirportSn: (sn) => set({ airportSn: String(sn ?? "").trim() }),
}));
