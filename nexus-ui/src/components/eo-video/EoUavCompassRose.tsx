"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/** 与 uavcompass.cpp paintEvent 对齐：固定底盘 + 随航向旋转的刻度环；机头固定朝上。 */

const VB = 200;
const CX = VB / 2;
const CY = VB / 2;
const R = 78;
const R_INNER_STROKE = R - 30;
const R_GRAD = R - 20;
/** 对角 15° 黑扇（NE / SE / SW / NW），与 Qt drawPie 一致 */
const DIAG_CENTERS = [45, 135, 225, 315];
const PIE_HALF = 7.5;

function norm360(deg: number): number {
  let x = deg % 360;
  if (x < 0) x += 360;
  return x;
}

/** 罗盘角：0=北，顺时针；返回 SVG 坐标 */
function polar(x0: number, y0: number, r: number, degFromNorthCw: number): { x: number; y: number } {
  const rad = (degFromNorthCw * Math.PI) / 180;
  return { x: x0 + r * Math.sin(rad), y: y0 - r * Math.cos(rad) };
}

function wedgePath(cx: number, cy: number, r: number, centerDeg: number, halfSpan: number): string {
  const t1 = ((centerDeg - halfSpan) * Math.PI) / 180;
  const t2 = ((centerDeg + halfSpan) * Math.PI) / 180;
  const x1 = cx + r * Math.sin(t1);
  const y1 = cy - r * Math.cos(t1);
  const x2 = cx + r * Math.sin(t2);
  const y2 = cy - r * Math.cos(t2);
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`;
}

/** 供控制台在表盘外展示航向三位数 */
export function formatEoUavHeading3(n: number): string {
  const h = Math.round(norm360(n));
  if (h < 10) return `00${h}`;
  if (h < 100) return `0${h}`;
  return String(h);
}

export interface EoUavCompassRoseProps {
  /** 航向角，对应 setAttitudeHead / m_dBow */
  attitudeDeg?: number;
  /** 云台/相机相对机头方位，对应 m_dCamBow；未传则不画外缘游标 */
  cameraBowDeg?: number | null;
  className?: string;
  /** 在 SVG 内绘制顶部航向读数（叠在表盘上）；表盘外展示时请 false */
  inlineHeading?: boolean;
  /** 在 SVG 内绘制指北短线 */
  inlineNorthTick?: boolean;
}

export function EoUavCompassRose({
  attitudeDeg = 0,
  cameraBowDeg = null,
  className,
  inlineHeading = true,
  inlineNorthTick = true,
}: EoUavCompassRoseProps) {
  const uid = useId().replace(/:/g, "");
  const gradId = `eo-uav-compass-grad-${uid}`;
  const glowId = `eo-uav-compass-glow-${uid}`;
  const bow = norm360(attitudeDeg);
  const cam = cameraBowDeg == null ? null : norm360(cameraBowDeg);

  const digitIndices = [3, 6, 12, 15, 21, 24, 30, 33] as const;
  const rNum = R * 0.85;
  const rTick0 = R * 0.82;
  const rTick1 = R * 0.97;
  const rLetter = 62;

  const uavScale = R / 78;
  const uTop = CY - 20 * uavScale;
  const uBotY = CY + 10 * uavScale;
  const uSide = 10 * uavScale;

  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      className={cn("h-full w-full max-h-full overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <radialGradient id={gradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(60,60,60)" />
          <stop offset="100%" stopColor="rgb(100,100,100)" />
        </radialGradient>
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#000" floodOpacity="0.85" />
        </filter>
      </defs>

      {/* 外圈 + 内圈描边（白半透明） */}
      <circle
        cx={CX}
        cy={CY}
        r={R}
        fill="#000"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth={1.5}
      />
      <circle
        cx={CX}
        cy={CY}
        r={R_INNER_STROKE}
        fill="none"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth={1.2}
      />

      {/* 中心径向渐变圆 */}
      <circle cx={CX} cy={CY} r={R_GRAD} fill={`url(#${gradId})`} />

      {/* 四块对角黑扇（覆盖在渐变层上，形成 Qt 的对角分区效果） */}
      {DIAG_CENTERS.map((c) => (
        <path key={c} d={wedgePath(CX, CY, R_GRAD, c, PIE_HALF)} fill="rgba(0,0,0,0.72)" />
      ))}

      {/* 交叉十字（对角线），贴近 Qt 观感 */}
      <line
        x1={CX - R_GRAD * 0.72}
        y1={CY - R_GRAD * 0.72}
        x2={CX + R_GRAD * 0.72}
        y2={CY + R_GRAD * 0.72}
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={1}
      />
      <line
        x1={CX - R_GRAD * 0.72}
        y1={CY + R_GRAD * 0.72}
        x2={CX + R_GRAD * 0.72}
        y2={CY - R_GRAD * 0.72}
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={1}
      />

      {inlineNorthTick ? (
        <line
          x1={CX}
          y1={CY - R - 12 * (R / 78)}
          x2={CX}
          y2={CY - R}
          stroke="rgb(96,186,123)"
          strokeWidth={3}
          strokeLinecap="square"
        />
      ) : null}

      {/* 机头朝上五边形，rgb(100,150,255) */}
      <path
        d={`M ${CX} ${uTop} L ${CX - uSide} ${uBotY} L ${CX} ${CY} L ${CX + uSide} ${uBotY} Z`}
        fill="rgb(100,150,255)"
        stroke="none"
      />

      {/* 相机游标：贴外缘，不随刻度环旋转（与 Qt 一致：先 translate 再 rotate(cam)） */}
      {cam != null ? (
        <g
          transform={`translate(${polar(CX, CY, R, cam).x},${polar(CX, CY, R, cam).y}) rotate(${cam})`}
        >
          <path d="M 0 0 L -10 10 L -10 20 L 10 20 L 10 10 Z" fill="rgb(100,150,255)" />
        </g>
      ) : null}

      {/* 刻度环：整体 -bow，与 Qt 中 i*10 - m_dBow、rotate(-90-m_dBow) 一致 */}
      <g transform={`rotate(${-bow} ${CX} ${CY})`}>
        {/* 12 条 30° 内径向线 */}
        {Array.from({ length: 12 }, (_, i) => {
          const a = -90 + i * 30;
          const rad = (a * Math.PI) / 180;
          const x0 = CX + rTick0 * Math.cos(rad);
          const y0 = CY + rTick0 * Math.sin(rad);
          const x1 = CX + rTick1 * Math.cos(rad);
          const y1 = CY + rTick1 * Math.sin(rad);
          return (
            <line
              key={i}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke="rgba(255,255,255,0.5)"
              strokeWidth={1.25}
            />
          );
        })}

        {/* 30/60/120… 数字（排除 0/90/180/270，与 i%3==0 && i%9!=0 一致） */}
        {digitIndices.map((i) => {
          const deg = i * 10;
          const p = polar(CX, CY, rNum, deg);
          return (
            <text
              key={i}
              x={p.x}
              y={p.y}
              fill="#fff"
              fontSize={11}
              fontWeight={700}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              textAnchor="middle"
              dominantBaseline="middle"
              filter={`url(#${glowId})`}
              transform={`rotate(${deg} ${p.x} ${p.y})`}
            >
              {deg}
            </text>
          );
        })}

        {/* N W S E：与 Qt direction_name 顺序及旋转链等效 — 北 0°、西 270°、南 180°、东 90°（从北顺时针标字母位置） */}
        {(
          [
            { ch: "N", deg: 0 },
            { ch: "W", deg: 270 },
            { ch: "S", deg: 180 },
            { ch: "E", deg: 90 },
          ] as const
        ).map(({ ch, deg }) => {
          const p = polar(CX, CY, rLetter, deg);
          return (
            <text
              key={ch}
              x={p.x}
              y={p.y}
              fill="#fff"
              fontSize={15}
              fontWeight={700}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              textAnchor="middle"
              dominantBaseline="middle"
              filter={`url(#${glowId})`}
            >
              {ch}
            </text>
          );
        })}
      </g>

      {inlineHeading ? (
        <text
          x={CX}
          y={CY - R * 0.72}
          fill="rgba(96,186,123,1)"
          fontSize={17}
          fontWeight={700}
          fontFamily="ui-monospace, monospace"
          textAnchor="middle"
          dominantBaseline="middle"
          filter={`url(#${glowId})`}
        >
          {formatEoUavHeading3(bow)}
        </text>
      ) : null}
    </svg>
  );
}
