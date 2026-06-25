import type { Metadata } from "next";
import { CommandScreen } from "@/components/command/CommandScreen";

export const metadata: Metadata = {
  title: "NexusUI · 指挥员作战屏",
  description: "地图为骨、决策优势为英雄的指挥员作战屏：在地形上画出可选择的未来，监视授权包络而非按钮。",
};

export default function CommandPage() {
  return <CommandScreen />;
}
