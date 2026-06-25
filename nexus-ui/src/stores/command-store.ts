"use client";

import { create } from "zustand";
import { COPILOT_SEED, type CopilotMessage } from "@/lib/command-data";

export type CommandMode = "monitor" | "highpressure";
export type Conservatism = "aggressive" | "balanced" | "conservative";

/** 选中对象（群/资产/任务） */
export interface SelectedObject {
  kind: "group" | "asset" | "task";
  id: string;
}

export interface CommandLayers {
  tracks: boolean;
  groups: boolean;
  assets: boolean;
  geo: boolean;
  prediction: boolean;
}

interface CommandState {
  mode: CommandMode;
  /** 高压窗口剩余秒 */
  windowSec: number;
  /** 选定的 COA id（null = 未择一） */
  selectedCoa: string | null;
  /** 已签字承诺 */
  committed: boolean;
  /** 承诺收窄面开关 */
  commitOpen: boolean;
  /** Scrubber 时间分数 0..1，playing 状态 */
  scrubT: number;
  playing: boolean;
  /** 选中对象 placard */
  selected: SelectedObject | null;
  /** placard 当前页 */
  placardTab: "info" | "source" | "evidence";
  /** 图层 */
  layers: CommandLayers;
  /** 保守度档位 */
  conservatism: Conservatism;
  /** 压缩比尺下钻 */
  compressionExpanded: boolean;
  /** AI 副驾面板 */
  copilotOpen: boolean;
  copilotMessages: CopilotMessage[];
  /** 执行任务详情面板 */
  openTaskId: string | null;

  enterHighPressure: () => void;
  exitHighPressure: () => void;
  tickWindow: () => void;
  selectCoa: (id: string | null) => void;
  setCommitOpen: (v: boolean) => void;
  commit: () => void;
  setScrubT: (t: number) => void;
  setPlaying: (v: boolean) => void;
  selectObject: (o: SelectedObject | null) => void;
  setPlacardTab: (t: "info" | "source" | "evidence") => void;
  toggleLayer: (k: keyof CommandLayers) => void;
  setConservatism: (c: Conservatism) => void;
  setCompressionExpanded: (v: boolean) => void;
  setCopilotOpen: (v: boolean) => void;
  sendCopilot: (text: string) => void;
  setOpenTaskId: (id: string | null) => void;
}

export const useCommandStore = create<CommandState>((set, get) => ({
  mode: "monitor",
  windowSec: 180,
  selectedCoa: null,
  committed: false,
  commitOpen: false,
  scrubT: 0,
  playing: false,
  selected: null,
  placardTab: "info",
  layers: { tracks: true, groups: true, assets: true, geo: true, prediction: true },
  conservatism: "balanced",
  compressionExpanded: false,
  copilotOpen: false,
  copilotMessages: COPILOT_SEED,
  openTaskId: null,

  enterHighPressure: () =>
    set({ mode: "highpressure", windowSec: 180, selectedCoa: null, committed: false, scrubT: 0, playing: false }),
  exitHighPressure: () =>
    set({ mode: "monitor", selectedCoa: null, committed: false, commitOpen: false, scrubT: 0, playing: false }),
  tickWindow: () => set((s) => ({ windowSec: Math.max(0, s.windowSec - 1) })),

  selectCoa: (id) => set({ selectedCoa: id }),
  setCommitOpen: (v) => set({ commitOpen: v }),
  commit: () => set({ committed: true, commitOpen: false, scrubT: 0, playing: true }),
  setScrubT: (t) => set({ scrubT: Math.min(1, Math.max(0, t)) }),
  setPlaying: (v) => set({ playing: v }),

  selectObject: (o) => set({ selected: o, placardTab: "info" }),
  setPlacardTab: (t) => set({ placardTab: t }),

  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setConservatism: (c) => set({ conservatism: c }),
  setCompressionExpanded: (v) => set({ compressionExpanded: v }),

  setCopilotOpen: (v) => set({ copilotOpen: v }),
  sendCopilot: (text) => {
    const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const cmdMsg: CopilotMessage = { id: `c-${Date.now()}`, role: "commander", text, time: t };
    set((s) => ({ copilotMessages: [...s.copilotMessages, cmdMsg] }));
    // 模拟结构化产物答复
    setTimeout(() => {
      const reply: CopilotMessage = {
        id: `r-${Date.now()}`,
        role: "copilot",
        text: "已解析为结构化对象并落入责任链/地图。本产物受工具白名单约束，写不进授权。",
        artifact: text.includes("查") || text.includes("分析") ? "analysis" : text.includes("加强") || text.includes("优先") ? "intent" : "answer",
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      };
      set((s) => ({ copilotMessages: [...s.copilotMessages, reply] }));
    }, 600);
    void get;
  },
  setOpenTaskId: (id) => set({ openTaskId: id }),
}));
