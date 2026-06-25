"use client";

import { useEffect } from "react";
import { useCommandStore } from "@/stores/command-store";
import {
  CommandMap,
  TopBar,
  PhaseSpine,
  StatusBar,
  LeftRail,
  RightRail,
  LayerTower,
  FutureCards,
  Scrubber,
  CommitNarrow,
  Placard,
  TaskDetailPanel,
  CopilotPanel,
} from "@/components/command";

export function CommandScreen() {
  const mode = useCommandStore((s) => s.mode);
  const committed = useCommandStore((s) => s.committed);
  const playing = useCommandStore((s) => s.playing);
  const tickWindow = useCommandStore((s) => s.tickWindow);
  const setScrubT = useCommandStore((s) => s.setScrubT);
  const setPlaying = useCommandStore((s) => s.setPlaying);

  // 高压窗口倒计时
  useEffect(() => {
    if (mode !== "highpressure" || committed) return;
    const id = setInterval(() => tickWindow(), 1000);
    return () => clearInterval(id);
  }, [mode, committed, tickWindow]);

  // Scrubber 自动推演
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const t = useCommandStore.getState().scrubT;
      if (t >= 1) {
        setPlaying(false);
      } else {
        setScrubT(t + 0.02);
      }
    }, 60);
    return () => clearInterval(id);
  }, [playing, setScrubT, setPlaying]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-nexus-bg-base font-sans text-nexus-text-primary">
      {/* 地图为骨：全屏铺底 */}
      <div className="absolute inset-0">
        <CommandMap />
      </div>

      {/* 顶栏 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30">
        <TopBar />
      </div>

      {/* 相位脊：最左缘竖排 */}
      <div className="absolute bottom-7 left-0 top-12 z-20 flex">
        <PhaseSpine />
      </div>

      {/* 左缘威胁/资产/执行边栏：紧贴相位脊右侧 */}
      <div className="absolute bottom-7 left-11 top-12 z-20 flex">
        <LeftRail />
      </div>

      {/* 右缘执行监看栏 + 决策脊 */}
      <div className="pointer-events-none absolute bottom-7 right-0 top-12 z-20 flex">
        <RightRail />
      </div>

      {/* 图层塔：右下浮起 */}
      <div className="pointer-events-none absolute bottom-12 right-[252px] z-20">
        <LayerTower />
      </div>

      {/* 英雄件：未来卡四件套（高压态） */}
      <FutureCards />

      {/* Scrubber 推演时间轴（高压态、择一后出现） */}
      <Scrubber />

      {/* 承诺收窄面（裁决弹层） */}
      <CommitNarrow />

      {/* 对象 placard（证据链下钻） */}
      <Placard />

      {/* 执行任务详情（授权包络下钻） */}
      <TaskDetailPanel />

      {/* AI 副驾 */}
      <CopilotPanel />

      {/* 底部状态栏 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
        <StatusBar />
      </div>
    </main>
  );
}
