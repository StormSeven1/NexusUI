"use client";

import { NxCard } from "@/components/nexus";
import { cn } from "@/lib/utils";
import {
  Camera, Waves, Signal, Lock, Eye,
  Volume2, CircleDot, Zap, Target,
} from "lucide-react";
import { useRef, useEffect, useState } from "react";

/* ═══════════════ 通用类型 ═══════════════ */

interface TargetInfo {
  id: string;
  name: string;
  type?: string;
  typeLabel?: string;
  dispositionLabel?: string;
  distance_km?: number;
  bearing?: number;
  speed?: number;
  altitude?: number;
  locked?: boolean;
}

interface SonarContact {
  id: string;
  name: string;
  dispositionLabel?: string;
  bearing: number;
  distance_km: number;
  speed?: number;
  depthEstimate?: number;
  signalStrength?: number;
  frequency_hz?: number;
}

interface RadarBlip {
  id: string;
  name: string;
  dispositionLabel?: string;
  bearing: number;
  distance_km: number;
  speed?: number;
  altitude?: number;
  rcs?: number;
}

export interface SensorFeedData {
  feedType: "video" | "sonar" | "radar";
  assetId: string;
  assetName: string;
  assetType: string;
  timestamp: string;
  signalQuality?: number;
  status: string;
  message?: string;
  // video 专用
  resolution?: string;
  fps?: number;
  nightVision?: boolean;
  heading?: number;
  zoom?: number;
  target?: TargetInfo;
  detectedObjects?: number;
  objectList?: Array<{ id: string; name: string; type?: string; typeLabel?: string; disposition?: string; dispositionLabel?: string; distance_km?: number }>;
  // sonar 专用
  mode?: string;
  range_km?: number;
  noiseLevel_db?: number;
  contacts?: SonarContact[];
  contactCount?: number;
  // radar 专用
  sweepRate_rpm?: number;
  clutterLevel?: string;
  blips?: RadarBlip[];
  blipCount?: number;
}

/* ═══════════════ 目标绘制辅助 ═══════════════ */

/** 绘制战斗机/军用飞机侧影（从正面/略侧面看） */
function drawAircraft(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, nv: boolean, frame: number) {
  const s = size;
  const bob = Math.sin(frame * 0.04) * 1.5;
  ctx.save();
  ctx.translate(cx, cy + bob);

  const fill = nv ? "rgba(0,255,0,0.55)" : "rgba(160,170,190,0.7)";
  const stroke = nv ? "rgba(0,255,0,0.8)" : "rgba(200,210,220,0.9)";
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;

  // 机身
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.7);
  ctx.bezierCurveTo(s * 0.08, -s * 0.6, s * 0.1, -s * 0.2, s * 0.1, s * 0.3);
  ctx.lineTo(s * 0.06, s * 0.7);
  ctx.lineTo(-s * 0.06, s * 0.7);
  ctx.lineTo(-s * 0.1, s * 0.3);
  ctx.bezierCurveTo(-s * 0.1, -s * 0.2, -s * 0.08, -s * 0.6, 0, -s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 主翼
  ctx.beginPath();
  ctx.moveTo(-s * 0.08, -s * 0.05);
  ctx.lineTo(-s * 0.7, s * 0.15);
  ctx.lineTo(-s * 0.72, s * 0.22);
  ctx.lineTo(-s * 0.1, s * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(s * 0.08, -s * 0.05);
  ctx.lineTo(s * 0.7, s * 0.15);
  ctx.lineTo(s * 0.72, s * 0.22);
  ctx.lineTo(s * 0.1, s * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 尾翼
  ctx.beginPath();
  ctx.moveTo(-s * 0.06, s * 0.5);
  ctx.lineTo(-s * 0.3, s * 0.65);
  ctx.lineTo(-s * 0.28, s * 0.7);
  ctx.lineTo(-s * 0.06, s * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(s * 0.06, s * 0.5);
  ctx.lineTo(s * 0.3, s * 0.65);
  ctx.lineTo(s * 0.28, s * 0.7);
  ctx.lineTo(s * 0.06, s * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 座舱
  ctx.fillStyle = nv ? "rgba(0,255,0,0.3)" : "rgba(100,180,255,0.4)";
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.4, s * 0.05, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // 翼尖灯闪烁
  if (Math.sin(frame * 0.15) > 0.3) {
    ctx.fillStyle = "rgba(255,0,0,0.8)";
    ctx.beginPath();
    ctx.arc(-s * 0.71, s * 0.18, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,255,0,0.8)";
    ctx.beginPath();
    ctx.arc(s * 0.71, s * 0.18, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** 绘制水面舰船（侧面轮廓） */
function drawShip(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, nv: boolean, frame: number) {
  const s = size;
  const sway = Math.sin(frame * 0.025) * 1.2;
  const tilt = Math.sin(frame * 0.018) * 0.02;
  ctx.save();
  ctx.translate(cx, cy + sway);
  ctx.rotate(tilt);

  const fill = nv ? "rgba(0,255,0,0.45)" : "rgba(110,120,140,0.75)";
  const stroke = nv ? "rgba(0,255,0,0.7)" : "rgba(180,190,200,0.85)";
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;

  // 船体
  ctx.beginPath();
  ctx.moveTo(-s * 0.7, 0);
  ctx.lineTo(-s * 0.5, s * 0.15);
  ctx.lineTo(s * 0.5, s * 0.15);
  ctx.lineTo(s * 0.7, 0);
  ctx.lineTo(s * 0.5, -s * 0.04);
  ctx.lineTo(-s * 0.5, -s * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 上层建筑 - 舰桥
  ctx.beginPath();
  ctx.rect(-s * 0.15, -s * 0.22, s * 0.3, s * 0.18);
  ctx.fill();
  ctx.stroke();

  // 舰桥窗户
  ctx.fillStyle = nv ? "rgba(0,255,0,0.25)" : "rgba(180,220,255,0.5)";
  for (let wx = -s * 0.1; wx <= s * 0.1; wx += s * 0.07) {
    ctx.fillRect(wx, -s * 0.2, s * 0.04, s * 0.03);
  }

  ctx.fillStyle = fill;

  // 前部上层建筑
  ctx.beginPath();
  ctx.rect(-s * 0.35, -s * 0.12, s * 0.18, s * 0.08);
  ctx.fill();
  ctx.stroke();

  // 后部上层建筑
  ctx.beginPath();
  ctx.rect(s * 0.15, -s * 0.14, s * 0.2, s * 0.1);
  ctx.fill();
  ctx.stroke();

  // 桅杆/雷达
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.22);
  ctx.lineTo(0, -s * 0.42);
  ctx.stroke();

  // 雷达天线旋转
  const radarAngle = (frame * 0.06) % (Math.PI * 2);
  const rLen = s * 0.1;
  ctx.beginPath();
  ctx.moveTo(-Math.cos(radarAngle) * rLen, -s * 0.42 - Math.sin(radarAngle) * rLen * 0.3);
  ctx.lineTo(Math.cos(radarAngle) * rLen, -s * 0.42 + Math.sin(radarAngle) * rLen * 0.3);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 烟囱
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.rect(s * 0.05, -s * 0.32, s * 0.06, s * 0.1);
  ctx.fill();
  ctx.stroke();

  // 烟囱排气
  ctx.fillStyle = nv ? "rgba(0,255,0,0.08)" : "rgba(200,200,200,0.12)";
  for (let i = 0; i < 3; i++) {
    const px = s * 0.08 + Math.sin(frame * 0.03 + i) * s * 0.03;
    const py = -s * 0.35 - i * s * 0.04;
    const pr = s * 0.02 + i * s * 0.015;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 船头炮台
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, -s * 0.12);
  ctx.lineTo(-s * 0.52, -s * 0.18);
  ctx.stroke();

  ctx.restore();
}

/** 绘制潜艇（侧面轮廓） */
function drawSubmarine(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, nv: boolean, frame: number) {
  const s = size;
  const bob = Math.sin(frame * 0.02) * 2;
  ctx.save();
  ctx.translate(cx, cy + bob);

  const fill = nv ? "rgba(0,255,0,0.35)" : "rgba(60,70,80,0.7)";
  const stroke = nv ? "rgba(0,255,0,0.6)" : "rgba(140,150,160,0.8)";
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;

  // 潜艇主体
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.65, s * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 指挥塔
  ctx.beginPath();
  ctx.moveTo(-s * 0.08, -s * 0.12);
  ctx.lineTo(-s * 0.12, -s * 0.25);
  ctx.lineTo(s * 0.08, -s * 0.25);
  ctx.lineTo(s * 0.12, -s * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 潜望镜
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.25);
  ctx.lineTo(0, -s * 0.38);
  ctx.lineTo(s * 0.03, -s * 0.38);
  ctx.stroke();

  // 尾舵
  ctx.beginPath();
  ctx.moveTo(s * 0.6, -s * 0.02);
  ctx.lineTo(s * 0.72, -s * 0.1);
  ctx.lineTo(s * 0.72, s * 0.1);
  ctx.lineTo(s * 0.6, s * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/* ═══════════════ 视频画面 ═══════════════ */

function VideoFeed({ data }: { data: SensorFeedData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const [time, setTime] = useState(data.timestamp);

  useEffect(() => {
    const iv = setInterval(() => {
      const d = new Date();
      setTime(
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ` +
        `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")} UTC`,
      );
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    let raf: number;

    const targetType = data.target?.type ?? (data.objectList?.[0] as Record<string, unknown> | undefined)?.type as string | undefined ?? "sea";
    const isAir = targetType === "air";

    const draw = () => {
      frameRef.current++;
      const f = frameRef.current;
      const nv = data.nightVision;

      // --- 背景：天空 + 海面 ---
      const horizonY = isAir ? H * 0.72 : H * 0.38;

      // 天空渐变
      const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
      if (nv) {
        skyGrad.addColorStop(0, "#001200");
        skyGrad.addColorStop(1, "#002800");
      } else {
        skyGrad.addColorStop(0, "#0a1628");
        skyGrad.addColorStop(0.6, "#1a2a44");
        skyGrad.addColorStop(1, "#2a3a55");
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, horizonY);

      // 海面渐变
      const seaGrad = ctx.createLinearGradient(0, horizonY, 0, H);
      if (nv) {
        seaGrad.addColorStop(0, "#001a08");
        seaGrad.addColorStop(1, "#000c04");
      } else {
        seaGrad.addColorStop(0, "#1a2a3a");
        seaGrad.addColorStop(0.5, "#0f1a28");
        seaGrad.addColorStop(1, "#080e18");
      }
      ctx.fillStyle = seaGrad;
      ctx.fillRect(0, horizonY, W, H - horizonY);

      // 地平线光线
      ctx.strokeStyle = nv ? "rgba(0,255,0,0.15)" : "rgba(160,180,200,0.2)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(W, horizonY);
      ctx.stroke();

      // --- 海面波浪 ---
      ctx.strokeStyle = nv ? "rgba(0,255,0,0.08)" : "rgba(120,160,200,0.1)";
      ctx.lineWidth = 0.5;
      for (let waveRow = 0; waveRow < 8; waveRow++) {
        const wy = horizonY + 8 + waveRow * ((H - horizonY) / 8);
        const amp = 0.5 + waveRow * 0.4;
        const freq = 0.04 - waveRow * 0.002;
        const speed = f * (0.8 + waveRow * 0.15);
        ctx.beginPath();
        for (let x = 0; x < W; x += 2) {
          const y = wy + Math.sin((x + speed) * freq) * amp + Math.sin((x + speed * 0.7) * freq * 2.3) * amp * 0.4;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 波光粼粼
        if (waveRow < 4 && !nv) {
          const sparkle = Math.sin(f * 0.05 + waveRow * 1.5);
          if (sparkle > 0.6) {
            const sx = (f * 3 + waveRow * 97) % W;
            ctx.fillStyle = `rgba(200,220,255,${(sparkle - 0.6) * 0.3})`;
            ctx.fillRect(sx, wy - 1, 2, 1);
          }
        }
      }

      // --- 目标绘制 ---
      if (data.target) {
        const tgtX = W / 2;
        const tgtY = isAir ? H * 0.4 : horizonY;
        const tgtSize = (data.zoom ?? 1) >= 4 ? 48 : (data.zoom ?? 1) >= 2 ? 38 : 28;

        if (isAir) {
          drawAircraft(ctx, tgtX, tgtY, tgtSize, !!nv, f);
        } else if (targetType === "underwater") {
          const subY = horizonY + (H - horizonY) * 0.35;
          drawSubmarine(ctx, tgtX, subY, tgtSize * 1.2, !!nv, f);
        } else {
          drawShip(ctx, tgtX, tgtY, tgtSize * 1.3, !!nv, f);
        }
      }

      // 画面中的其他目标（小型）
      const others = data.objectList ?? [];
      for (let i = 0; i < Math.min(others.length, 3); i++) {
        const o = others[i] as Record<string, unknown>;
        if (data.target && o.id === data.target.id) continue;
        const oType = (o.type as string) ?? "sea";
        const oIsAir = oType === "air";
        const ox = W * 0.2 + i * W * 0.28 + Math.sin(f * 0.01 + i * 2) * 10;
        const oy = oIsAir ? H * 0.22 + i * 12 : horizonY + 2;
        const oSize = 16;
        if (oIsAir) {
          drawAircraft(ctx, ox, oy, oSize, !!nv, f);
        } else if (oType === "underwater") {
          drawSubmarine(ctx, ox, horizonY + (H - horizonY) * 0.4, oSize, !!nv, f);
        } else {
          drawShip(ctx, ox, oy, oSize * 1.1, !!nv, f);
        }
        // 小标签
        ctx.fillStyle = nv ? "rgba(0,255,0,0.35)" : "rgba(180,200,220,0.4)";
        ctx.font = "7px monospace";
        ctx.fillText(o.name as string ?? "", ox - 10, (oIsAir ? oy - oSize - 3 : oy - 14));
      }

      // --- 电视噪点 ---
      for (let i = 0; i < 800; i++) {
        const sx = Math.random() * W;
        const sy = Math.random() * H;
        const a = Math.random() * 0.03;
        ctx.fillStyle = nv ? `rgba(0,255,0,${a})` : `rgba(200,200,200,${a})`;
        ctx.fillRect(sx, sy, 1, 1);
      }

      // --- 扫描线 ---
      const scanY = (f * 2) % H;
      const scanGrad = ctx.createLinearGradient(0, scanY - 6, 0, scanY + 6);
      scanGrad.addColorStop(0, "transparent");
      scanGrad.addColorStop(0.5, nv ? "rgba(0,255,0,0.07)" : "rgba(100,180,255,0.04)");
      scanGrad.addColorStop(1, "transparent");
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 6, W, 12);

      // CRT 扫描线
      for (let y = 0; y < H; y += 3) {
        ctx.fillStyle = "rgba(0,0,0,0.06)";
        ctx.fillRect(0, y, W, 1);
      }

      // --- 锁定框 + 十字线 ---
      if (data.target?.locked) {
        const cx = W / 2;
        const cy = isAir ? H * 0.4 : (targetType === "underwater" ? horizonY + (H - horizonY) * 0.35 : horizonY);
        const boxSize = 62 + Math.sin(f * 0.05) * 4;
        const lockColor = nv ? "rgba(0,255,0,0.7)" : "rgba(255,60,60,0.8)";
        ctx.strokeStyle = lockColor;
        ctx.lineWidth = 1.5;

        // 角标
        const cLen = 12;
        ctx.beginPath();
        ctx.moveTo(cx - boxSize / 2, cy - boxSize / 2 + cLen);
        ctx.lineTo(cx - boxSize / 2, cy - boxSize / 2);
        ctx.lineTo(cx - boxSize / 2 + cLen, cy - boxSize / 2);
        ctx.moveTo(cx + boxSize / 2 - cLen, cy - boxSize / 2);
        ctx.lineTo(cx + boxSize / 2, cy - boxSize / 2);
        ctx.lineTo(cx + boxSize / 2, cy - boxSize / 2 + cLen);
        ctx.moveTo(cx + boxSize / 2, cy + boxSize / 2 - cLen);
        ctx.lineTo(cx + boxSize / 2, cy + boxSize / 2);
        ctx.lineTo(cx + boxSize / 2 - cLen, cy + boxSize / 2);
        ctx.moveTo(cx - boxSize / 2 + cLen, cy + boxSize / 2);
        ctx.lineTo(cx - boxSize / 2, cy + boxSize / 2);
        ctx.lineTo(cx - boxSize / 2, cy + boxSize / 2 - cLen);
        ctx.stroke();

        // 十字线
        ctx.beginPath();
        ctx.moveTo(cx - 22, cy);
        ctx.lineTo(cx - 8, cy);
        ctx.moveTo(cx + 8, cy);
        ctx.lineTo(cx + 22, cy);
        ctx.moveTo(cx, cy - 22);
        ctx.lineTo(cx, cy - 8);
        ctx.moveTo(cx, cy + 8);
        ctx.lineTo(cx, cy + 22);
        ctx.stroke();

        // 测距线
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = nv ? "rgba(0,255,0,0.3)" : "rgba(255,60,60,0.3)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(cx - boxSize / 2 - 20, cy);
        ctx.lineTo(cx - boxSize / 2, cy);
        ctx.moveTo(cx + boxSize / 2, cy);
        ctx.lineTo(cx + boxSize / 2 + 20, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        // 目标信息标签
        ctx.fillStyle = nv ? "rgba(0,255,0,0.7)" : "rgba(255,60,60,0.7)";
        ctx.font = "bold 9px monospace";
        ctx.fillText(`TGT: ${data.target.name}`, cx - boxSize / 2, cy - boxSize / 2 - 8);
        ctx.font = "8px monospace";
        ctx.fillStyle = nv ? "rgba(0,255,0,0.5)" : "rgba(255,60,60,0.5)";
        const infoY = cy + boxSize / 2 + 12;
        ctx.fillText(`${data.target.distance_km ?? "?"}km`, cx - boxSize / 2, infoY);
        if (data.target.speed) ctx.fillText(`${data.target.speed}km/h`, cx, infoY);
        if (data.target.bearing != null) ctx.fillText(`BRG ${data.target.bearing.toFixed(0)}°`, cx + boxSize / 2 - 30, cy - boxSize / 2 - 8);
      }

      // --- 偶尔出现的信号干扰条纹 ---
      if (Math.random() < 0.02) {
        const ly = Math.random() * H;
        const lh = 1 + Math.random() * 3;
        ctx.fillStyle = nv ? "rgba(0,255,0,0.08)" : "rgba(255,255,255,0.04)";
        ctx.fillRect(0, ly, W, lh);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data.nightVision, data.target, data.objectList, data.zoom]);

  return (
    <div className="relative overflow-hidden rounded-md bg-black">
      <canvas ref={canvasRef} width={360} height={220} className="block w-full" />

      {/* HUD overlay */}
      <div className="pointer-events-none absolute inset-0 p-2">
        {/* top-left: asset name + REC */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-sm bg-red-600/80 px-1 py-0.5">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            <span className="font-mono text-[8px] font-bold text-white">REC</span>
          </div>
          <span className="font-mono text-[9px] font-semibold text-white/70">
            {data.assetName}
          </span>
          {data.nightVision && (
            <span className="rounded-sm bg-green-500/20 px-1 py-0.5 font-mono text-[7px] text-green-400">NV</span>
          )}
        </div>

        {/* top-right: signal + zoom */}
        <div className="absolute right-2 top-2 flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1">
            <Signal size={8} className="text-green-400" />
            <span className="font-mono text-[8px] text-green-400">{data.signalQuality ?? 95}%</span>
          </div>
          <span className="font-mono text-[8px] text-white/50">{data.resolution} {data.fps}fps</span>
          {data.zoom && data.zoom > 1 && (
            <span className="font-mono text-[8px] text-cyan-400">×{data.zoom}</span>
          )}
        </div>

        {/* bottom-left: heading */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
          <span className="font-mono text-[8px] text-white/50">HDG {data.heading?.toFixed(1) ?? "---"}°</span>
        </div>

        {/* bottom-right: timestamp */}
        <div className="absolute bottom-2 right-2">
          <span className="font-mono text-[8px] text-white/40">{time}</span>
        </div>

        {/* target lock indicator */}
        {data.target?.locked && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-sm bg-red-600/30 px-1.5 py-0.5">
            <Lock size={7} className="text-red-400" />
            <span className="font-mono text-[8px] font-bold text-red-400">LOCKED</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════ 声呐波形 ═══════════════ */

function SonarFeed({ data }: { data: SensorFeedData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    let raf: number;

    const contacts = data.contacts ?? [];
    const rangeKm = data.range_km ?? 50;

    const draw = () => {
      frameRef.current++;
      const f = frameRef.current;

      ctx.fillStyle = "rgba(0, 8, 20, 0.15)";
      ctx.fillRect(0, 0, W, H);

      if (f % 200 === 0) {
        ctx.fillStyle = "rgba(0, 8, 20, 1)";
        ctx.fillRect(0, 0, W, H);
      }

      const cxC = W / 2;
      const cyC = H / 2;
      const R = Math.min(W, H) / 2 - 10;

      for (let r = 1; r <= 4; r++) {
        ctx.beginPath();
        ctx.arc(cxC, cyC, (R * r) / 4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,180,180,0.15)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(0,180,180,0.1)";
      for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(cxC, cyC);
        ctx.lineTo(cxC + Math.cos(rad) * R, cyC + Math.sin(rad) * R);
        ctx.stroke();
      }

      const sweepAngle = ((f * 2) % 360) * (Math.PI / 180);
      const sweepGrad = ctx.createConicGradient(sweepAngle - Math.PI / 6, cxC, cyC);
      sweepGrad.addColorStop(0, "transparent");
      sweepGrad.addColorStop(0.15, "rgba(0,255,200,0.06)");
      sweepGrad.addColorStop(0.17, "transparent");

      ctx.beginPath();
      ctx.arc(cxC, cyC, R, 0, Math.PI * 2);
      ctx.fillStyle = sweepGrad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cxC, cyC);
      ctx.lineTo(cxC + Math.cos(sweepAngle) * R, cyC + Math.sin(sweepAngle) * R);
      ctx.strokeStyle = "rgba(0,255,200,0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      for (const c of contacts) {
        const bRad = ((c.bearing - 90) * Math.PI) / 180;
        const dist = Math.min(c.distance_km / rangeKm, 1);
        const px = cxC + Math.cos(bRad) * dist * R;
        const py = cyC + Math.sin(bRad) * dist * R;

        const pulse = Math.sin(f * 0.08 + c.bearing) * 2;
        ctx.beginPath();
        ctx.arc(px, py, 3 + pulse, 0, Math.PI * 2);
        const isHostile = c.dispositionLabel === "敌方";
        ctx.fillStyle = isHostile ? "rgba(255,80,80,0.8)" : "rgba(0,200,200,0.6)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, 8 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = isHostile ? "rgba(255,80,80,0.2)" : "rgba(0,200,200,0.15)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      const waveH = 30;
      const waveY = H - waveH - 5;
      ctx.strokeStyle = "rgba(0,200,200,0.3)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, waveY + waveH / 2);
      for (let x = 0; x < W; x++) {
        const y = waveY + waveH / 2 + Math.sin((x + f * 3) * 0.03) * (waveH / 3) * Math.sin((x + f) * 0.008);
        ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.strokeStyle = "rgba(0,255,200,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, waveY + waveH / 2);
      for (let x = 0; x < W; x++) {
        const base = Math.sin((x + f * 2) * 0.02) * (waveH / 4);
        let spike = 0;
        for (const c of contacts) {
          const cPos = ((c.bearing / 360) * W + f) % W;
          const d = Math.abs(x - cPos);
          if (d < 20) spike += ((c.signalStrength ?? 50) / 100) * (waveH / 3) * Math.exp(-d * 0.15);
        }
        const y = waveY + waveH / 2 + base + spike * Math.sin(f * 0.1);
        ctx.lineTo(x, y);
      }
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };

    ctx.fillStyle = "rgba(0, 8, 20, 1)";
    ctx.fillRect(0, 0, W, H);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data.contacts, data.range_km]);

  return (
    <div className="relative overflow-hidden rounded-md bg-[#000814]">
      <canvas ref={canvasRef} width={360} height={260} className="block w-full" />

      <div className="pointer-events-none absolute inset-0 p-2">
        <div className="flex items-center gap-1.5">
          <Waves size={9} className="text-cyan-400" />
          <span className="font-mono text-[9px] font-semibold text-cyan-400/70">
            SONAR — {data.mode?.toUpperCase() ?? "PASSIVE"}
          </span>
          <span className="ml-auto font-mono text-[8px] text-cyan-400/40">
            {data.contactCount ?? 0} contacts
          </span>
        </div>

        <div className="absolute bottom-2 left-2 font-mono text-[8px] text-cyan-400/40">
          Range: {data.range_km ?? 50}km · Noise: {data.noiseLevel_db ?? "?"}dB
        </div>
        <div className="absolute bottom-2 right-2">
          <Volume2 size={9} className="text-cyan-400/30" />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ 雷达扫描 ═══════════════ */

function RadarFeed({ data }: { data: SensorFeedData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    let raf: number;

    const blips = data.blips ?? [];
    const rangeKm = data.range_km ?? 80;

    const draw = () => {
      frameRef.current++;
      const f = frameRef.current;

      ctx.fillStyle = "rgba(0, 12, 0, 0.08)";
      ctx.fillRect(0, 0, W, H);

      if (f % 300 === 0) {
        ctx.fillStyle = "rgba(0, 12, 0, 1)";
        ctx.fillRect(0, 0, W, H);
      }

      const cxC = W / 2;
      const cyC = H / 2;
      const R = Math.min(W, H) / 2 - 10;

      ctx.strokeStyle = "rgba(0,255,0,0.15)";
      ctx.lineWidth = 0.5;
      for (let r = 1; r <= 5; r++) {
        ctx.beginPath();
        ctx.arc(cxC, cyC, (R * r) / 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(0,255,0,0.08)";
      for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(cxC, cyC);
        ctx.lineTo(cxC + Math.cos(rad) * R, cyC + Math.sin(rad) * R);
        ctx.stroke();
      }

      const rpm = data.sweepRate_rpm ?? 12;
      const sweepAngle = ((f * rpm * 0.1) % 360) * (Math.PI / 180);

      const sweepGrad = ctx.createConicGradient(sweepAngle - Math.PI / 4, cxC, cyC);
      sweepGrad.addColorStop(0, "transparent");
      sweepGrad.addColorStop(0.12, "rgba(0,255,0,0.08)");
      sweepGrad.addColorStop(0.14, "transparent");

      ctx.save();
      ctx.beginPath();
      ctx.arc(cxC, cyC, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = sweepGrad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(cxC, cyC);
      ctx.lineTo(cxC + Math.cos(sweepAngle) * R, cyC + Math.sin(sweepAngle) * R);
      ctx.strokeStyle = "rgba(0,255,0,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();

      for (const b of blips) {
        const bRad = ((b.bearing - 90) * Math.PI) / 180;
        const dist = Math.min(b.distance_km / rangeKm, 1);
        const px = cxC + Math.cos(bRad) * dist * R;
        const py = cyC + Math.sin(bRad) * dist * R;

        const angleDiff = Math.abs(((sweepAngle * 180) / Math.PI - b.bearing + 360) % 360);
        const freshness = angleDiff < 40 ? 1 - angleDiff / 40 : 0;
        const baseBright = 0.4 + freshness * 0.6;

        const isHostile = b.dispositionLabel === "敌方";
        const color = isHostile ? [255, 60, 60] : [0, 255, 0];

        ctx.beginPath();
        ctx.arc(px, py, 2.5 + freshness * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${baseBright})`;
        ctx.fill();

        if (freshness > 0.3) {
          ctx.font = "bold 8px monospace";
          ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${baseBright * 0.7})`;
          ctx.fillText(b.name, px + 6, py - 4);

          ctx.font = "7px monospace";
          ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${baseBright * 0.4})`;
          ctx.fillText(`${b.distance_km}km`, px + 6, py + 5);
        }
      }

      ctx.fillStyle = "rgba(0,255,0,0.9)";
      ctx.beginPath();
      ctx.arc(cxC, cyC, 2, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    ctx.fillStyle = "rgba(0, 12, 0, 1)";
    ctx.fillRect(0, 0, W, H);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data.blips, data.range_km, data.sweepRate_rpm]);

  return (
    <div className="relative overflow-hidden rounded-md bg-[#000c00]">
      <canvas ref={canvasRef} width={360} height={300} className="block w-full" />

      <div className="pointer-events-none absolute inset-0 p-2">
        <div className="flex items-center gap-1.5">
          <CircleDot size={9} className="text-green-400" />
          <span className="font-mono text-[9px] font-semibold text-green-400/70">
            RADAR
          </span>
          <span className="ml-auto font-mono text-[8px] text-green-400/40">
            {data.blipCount ?? 0} tracks · {data.sweepRate_rpm ?? 12} RPM
          </span>
        </div>

        <div className="absolute bottom-2 left-2 font-mono text-[8px] text-green-400/40">
          Range: {data.range_km ?? 80}km · Clutter: {data.clutterLevel ?? "low"}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ 主组件 ═══════════════ */

const FEED_ICON: Record<string, typeof Camera> = {
  video: Camera,
  sonar: Waves,
  radar: CircleDot,
};

const FEED_LABEL: Record<string, string> = {
  video: "视频画面",
  sonar: "声呐探测",
  radar: "雷达扫描",
};

const FEED_COLOR: Record<string, string> = {
  video: "text-red-400",
  sonar: "text-cyan-400",
  radar: "text-green-400",
};

export function SurveillanceFeedCard({ data }: { data: SensorFeedData }) {
  const Icon = FEED_ICON[data.feedType] ?? Camera;
  const label = FEED_LABEL[data.feedType] ?? "传感器";
  const color = FEED_COLOR[data.feedType] ?? "text-zinc-400";

  return (
    <NxCard padding="sm" className="my-1.5">
      {/* 标题栏 */}
      <div className="mb-2 flex items-center gap-2">
        <div className={cn("flex h-5 w-5 items-center justify-center rounded bg-current/10", color)}>
          <Icon size={11} />
        </div>
        <span className="text-[10px] font-semibold tracking-wider text-nexus-text-secondary uppercase">
          {data.assetName} — {label}
        </span>
        <span className={cn("ml-auto flex items-center gap-1 text-[9px]", color)}>
          <Eye size={8} />
          {data.status === "recording" ? "录制中" : data.status === "scanning" ? "扫描中" : data.status === "listening" ? "监听中" : data.status}
        </span>
      </div>

      {/* 画面区域 */}
      {data.feedType === "video" && <VideoFeed data={data} />}
      {data.feedType === "sonar" && <SonarFeed data={data} />}
      {data.feedType === "radar" && <RadarFeed data={data} />}

      {/* 信息条 */}
      <div className="mt-2 space-y-1">
        {data.feedType === "video" && data.target && (
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="flex items-center gap-1 text-red-400">
              <Lock size={8} />
              锁定: {data.target.name}
            </span>
            <span className="text-nexus-text-muted">{data.target.typeLabel} · {data.target.dispositionLabel}</span>
            <span className="text-nexus-text-muted">{data.target.distance_km}km</span>
            {data.target.speed != null && <span className="text-nexus-text-muted">{data.target.speed}km/h</span>}
          </div>
        )}

        {data.feedType === "video" && data.objectList && data.objectList.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.objectList.map((o) => (
              <span key={o.id} className="inline-flex items-center gap-0.5 rounded bg-white/5 px-1 py-0.5 text-[9px] text-nexus-text-muted">
                <Target size={7} className={o.dispositionLabel === "敌方" ? "text-red-400" : "text-sky-400"} />
                {o.name} {o.distance_km}km
              </span>
            ))}
          </div>
        )}

        {data.feedType === "sonar" && data.contacts && data.contacts.length > 0 && (
          <div className="space-y-0.5">
            {data.contacts.slice(0, 4).map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-[10px]">
                <Waves size={8} className={c.dispositionLabel === "敌方" ? "text-red-400" : "text-cyan-400"} />
                <span className="text-nexus-text-primary">{c.name}</span>
                <span className="text-nexus-text-muted">
                  {c.bearing.toFixed(0)}° · {c.distance_km}km
                  {c.depthEstimate ? ` · ${c.depthEstimate}m` : ""}
                </span>
                {c.signalStrength != null && (
                  <span className="ml-auto font-mono text-[9px] text-cyan-400/60">{c.signalStrength}%</span>
                )}
              </div>
            ))}
          </div>
        )}

        {data.feedType === "radar" && data.blips && data.blips.length > 0 && (
          <div className="space-y-0.5">
            {data.blips.slice(0, 4).map((b) => (
              <div key={b.id} className="flex items-center gap-2 text-[10px]">
                <Zap size={8} className={b.dispositionLabel === "敌方" ? "text-red-400" : "text-green-400"} />
                <span className="text-nexus-text-primary">{b.name}</span>
                <span className="text-nexus-text-muted">
                  {b.bearing.toFixed(0)}° · {b.distance_km}km
                  {b.altitude ? ` · ${b.altitude}m` : ""}
                </span>
                {b.rcs != null && (
                  <span className="ml-auto font-mono text-[9px] text-green-400/60">RCS {b.rcs}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {data.message && (
        <p className="mt-1.5 text-[10px] text-nexus-text-muted">{data.message}</p>
      )}
    </NxCard>
  );
}
