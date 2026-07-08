"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CalcRecordLocationPoint } from "@/hooks/useEoCalcRecordController";

export type EoCalcRecordLocationDialogProps = {
  open: boolean;
  onClose: () => void;
  points: CalcRecordLocationPoint[];
};

/** 简易 P–距离分布（对齐 Qt LocationWidget 的入门视图） */
export function EoCalcRecordLocationDialog({ open, onClose, points }: EoCalcRecordLocationDialogProps) {
  if (!open || typeof document === "undefined") return null;

  const w = 520;
  const h = 220;
  const pad = 28;
  const maxP = Math.max(1, ...points.map((p) => p.p));
  const minP = Math.min(0, ...points.map((p) => p.p));
  const maxD = Math.max(1, ...points.map((p) => p.distance));

  const toX = (p: number) => pad + ((p - minP) / (maxP - minP || 1)) * (w - pad * 2);
  const toY = (d: number) => h - pad - (d / maxD) * (h - pad * 2);

  const panel = (
    <div
      className="pointer-events-auto fixed inset-0 z-[20001] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[560px] rounded-lg border border-white/10 bg-[#1a1f26] text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-medium">采集数据分布（P vs 距离）</h2>
          <button
            type="button"
            className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-4">
          {points.length === 0 ? (
            <p className="text-sm text-white/60">本次会话尚无采样点。</p>
          ) : (
            <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded border border-white/10 bg-black/40">
              <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(255,255,255,0.25)" />
              <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="rgba(255,255,255,0.25)" />
              <text x={w / 2} y={h - 6} fill="rgba(255,255,255,0.5)" fontSize="10" textAnchor="middle">
                P (°)
              </text>
              <text
                x={10}
                y={h / 2}
                fill="rgba(255,255,255,0.5)"
                fontSize="10"
                textAnchor="middle"
                transform={`rotate(-90 10 ${h / 2})`}
              >
                距离 (m)
              </text>
              {points.map((pt, i) => (
                <circle key={i} cx={toX(pt.p)} cy={toY(pt.distance)} r={3} fill="#93fdff" />
              ))}
            </svg>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
