"use client";

import { useId } from "react";

export type EoPtzDragArrowBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
};

function arrowHeadPoints(x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return null;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const headLen = Math.min(26, Math.max(14, len * 0.26));
  const wing = headLen * 0.52;
  const baseX = x1 - ux * headLen;
  const baseY = y1 - uy * headLen;
  return {
    tip: { x: x1, y: y1 },
    left: { x: baseX + px * wing, y: baseY + py * wing },
    right: { x: baseX - px * wing, y: baseY - py * wing },
  };
}

/**
 * 相机画面内拖动云台时的方向箭头（对齐 Qt OpenGLWidget 线段 + 箭头，视觉重做）。
 */
export function EoPtzDragArrowOverlay({ box }: { box: EoPtzDragArrowBox }) {
  const gid = useId().replace(/:/g, "");
  const { x0, y0, x1, y1, w, h } = box;
  const head = arrowHeadPoints(x0, y0, x1, y1);
  if (!head || w <= 0 || h <= 0) return null;

  const { tip, left, right } = head;
  const points = `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`;

  return (
    <div className="pointer-events-none absolute inset-0 z-[15] overflow-hidden" aria-hidden>
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`${gid}-shaft`} x1={x0} y1={y0} x2={x1} y2={y1} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgba(6,182,212,0.35)" />
            <stop offset="45%" stopColor="rgba(103,232,249,0.92)" />
            <stop offset="100%" stopColor="rgba(240,253,250,1)" />
          </linearGradient>
          <linearGradient id={`${gid}-head`} x1={x0} y1={y0} x2={x1} y2={y1} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgba(165,243,252,0.9)" />
            <stop offset="100%" stopColor="rgba(255,255,255,1)" />
          </linearGradient>
          <filter id={`${gid}-softGlow`} x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="b" />
            <feColorMatrix
              in="b"
              type="matrix"
              values="0 0 0 0 0.05  0 0 0 0 0.75  0 0 0 0 0.85  0 0 0 0.55 0"
              result="g"
            />
            <feMerge>
              <feMergeNode in="g" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx={x0} cy={y0} r={5} fill="rgba(8,145,178,0.22)" stroke="rgba(165,243,252,0.55)" strokeWidth={1} />
        <circle cx={x0} cy={y0} r={2.2} fill="rgba(236,254,255,0.85)" />

        <line
          x1={x0}
          y1={y0}
          x2={x1}
          y2={y1}
          stroke={`url(#${gid}-shaft)`}
          strokeWidth={3.2}
          strokeLinecap="round"
          filter={`url(#${gid}-softGlow)`}
          opacity={0.95}
        />
        <line
          x1={x0}
          y1={y0}
          x2={x1}
          y2={y1}
          stroke="rgba(255,255,255,0.22)"
          strokeWidth={1}
          strokeLinecap="round"
          opacity={0.9}
        />

        <polygon
          points={points}
          fill={`url(#${gid}-head)`}
          stroke="rgba(34,211,238,0.75)"
          strokeWidth={0.9}
          strokeLinejoin="round"
          filter={`url(#${gid}-softGlow)`}
        />
      </svg>
    </div>
  );
}
