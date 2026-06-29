import { create } from "zustand";

type DzwlAlarmState = {
  isOpen: boolean;
  openToken: number;
  pageUrl: string;
  show: () => void;
  hide: () => void;
  closePopup: () => void;
  setPageUrl: (pageUrl: string) => void;
};

export const useDzwlAlarmStore = create<DzwlAlarmState>((set) => ({
  isOpen: false,
  openToken: 0,
  pageUrl: "http://192.168.28.129:3000/index.html",
  show: () => set((state) => ({ isOpen: true, openToken: state.openToken + 1 })),
  hide: () => set({ isOpen: false }),
  closePopup: () => set({ isOpen: false }),
  setPageUrl: (pageUrl: string) => set({ pageUrl }),
}));
