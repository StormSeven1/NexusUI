"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCommandStore } from "@/stores/command-store";
import {
  THREAT_GROUPS,
  CMD_ASSETS,
  GEO_ZONES,
  COAS,
  MAP_CENTER,
  MAP_ZOOM,
  KEY_AREA,
  type BeamPoint,
  type CoaTask,
} from "@/lib/command-data";
import { FORCE_COLORS } from "@/lib/colors";

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/* 处置动作的地图短动词（已执行时显示） */
const COA_TASK_VERB: Record<CoaTask["action"], string> = {
  intercept: "▸ 拦截中",
  illuminate: "▸ 照射中",
  recon: "▸ 确认中",
  reposition: "▸ 已补位",
};

type Pt = { x: number; y: number };

/* ── 在 beam 上按时间分数取位置 ── */
function beamPosAt(beam: BeamPoint[], t: number): { lng: number; lat: number } {
  if (t <= 0) return beam[0];
  if (t >= 1) return beam[beam.length - 1];
  for (let i = 0; i < beam.length - 1; i++) {
    const a = beam[i];
    const b = beam[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t || 1);
      return { lng: a.lng + (b.lng - a.lng) * f, lat: a.lat + (b.lat - a.lat) * f };
    }
  }
  return beam[beam.length - 1];
}

/* ── 我方资产沿编排路径定位：actAtT 前匀速到位，之后驻留终点 ── */
function pathPosAt(path: [number, number][], actAtT: number, t: number): { lng: number; lat: number } {
  if (path.length === 1) return { lng: path[0][0], lat: path[0][1] };
  const prog = actAtT <= 0 ? 1 : Math.min(1, t / actAtT); // 0..1 沿全路径
  if (prog >= 1) return { lng: path[path.length - 1][0], lat: path[path.length - 1][1] };
  const seg = prog * (path.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = path[i];
  const b = path[Math.min(i + 1, path.length - 1)];
  return { lng: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f };
}

/* ── Catmull-Rom 平滑路径 ── */
function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function polyPath(pts: Pt[]): string {
  if (!pts.length) return "";
  return "M " + pts.map((p) => `${p.x} ${p.y}`).join(" L ") + " Z";
}

/* 群成员散点（确定性伪随机） */
function scatter(lng: number, lat: number, n: number, seed: number) {
  const out: { lng: number; lat: number }[] = [];
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < n; i++) {
    out.push({ lng: lng + (rnd() - 0.5) * 0.13, lat: lat + (rnd() - 0.5) * 0.08 });
  }
  return out;
}

export function CommandMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [, setTick] = useState(0);

  const mode = useCommandStore((s) => s.mode);
  const layers = useCommandStore((s) => s.layers);
  const selectedCoa = useCommandStore((s) => s.selectedCoa);
  const scrubT = useCommandStore((s) => s.scrubT);
  const selected = useCommandStore((s) => s.selected);
  const selectObject = useCommandStore((s) => s.selectObject);
  const selectCoa = useCommandStore((s) => s.selectCoa);

  /* 初始化 MapLibre */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      attributionControl: false,
    });
    map.on("load", () => setReady(true));
    const bump = () => setTick((n) => n + 1);
    map.on("move", bump);
    map.on("zoom", bump);
    map.on("resize", bump);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* 高压态自动聚焦主攻群分叉区域 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (mode === "highpressure") {
      map.flyTo({ center: [-2.02, 51.27], zoom: 9.3, duration: 600, essential: true });
    } else {
      map.flyTo({ center: MAP_CENTER, zoom: MAP_ZOOM, duration: 600, essential: true });
    }
  }, [mode, ready]);

  /* 左栏/列表选中 → 地图联动飞到目标 */
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || !selected) return;
    let coord: [number, number] | null = null;
    if (selected.kind === "group") {
      const g = THREAT_GROUPS.find((x) => x.id === selected.id);
      if (g) coord = [g.lng, g.lat];
    } else if (selected.kind === "asset") {
      const a = CMD_ASSETS.find((x) => x.id === selected.id);
      if (a) coord = [a.lng, a.lat];
    }
    if (coord) m.flyTo({ center: coord, zoom: Math.max(m.getZoom(), 9.5), duration: 650, essential: true });
  }, [selected, ready]);

  const proj = (lng: number, lat: number): Pt => {
    const m = mapRef.current!;
    const p = m.project([lng, lat]);
    return { x: p.x, y: p.y };
  };

  /* 成员散点（缓存） */
  const memberDots = useMemo(
    () => THREAT_GROUPS.map((g, i) => ({ id: g.id, color: FORCE_COLORS[g.disposition], pts: scatter(g.lng, g.lat, g.trackCount, i * 137 + 7) })),
    [],
  );

  const map = mapRef.current;
  const tPlus = Math.round(scrubT * 180);
  /* 主攻群当前推演位置（照射动作的目标点） */
  const primaryGroup = THREAT_GROUPS.find((g) => g.primary);
  const selCoaObj = COAS.find((c) => c.id === selectedCoa);
  const primaryGroupPt =
    ready && map && primaryGroup && selCoaObj
      ? (() => {
          const gp = beamPosAt(selCoaObj.beam, scrubT);
          return proj(gp.lng, gp.lat);
        })()
      : null;

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {ready && map && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
          <defs>
            <filter id="cmd-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* 地理约束 */}
          {layers.geo &&
            GEO_ZONES.map((z) => {
              const pts = z.polygon.map((c) => proj(c[0], c[1]));
              const isNoFire = z.kind === "no-fire";
              return (
                <g key={z.id}>
                  <path
                    d={polyPath(pts)}
                    fill={isNoFire ? "rgba(220,38,38,0.05)" : "rgba(91,155,213,0.03)"}
                    stroke={isNoFire ? "rgba(220,38,38,0.4)" : "rgba(91,155,213,0.25)"}
                    strokeWidth={1}
                    strokeDasharray={isNoFire ? "2 4" : "6 5"}
                  />
                  <text x={pts[0].x + 6} y={pts[0].y + 14} fill={isNoFire ? "#dc2626" : "#5b9bd5"} fontSize={9} opacity={0.7} fontFamily="var(--font-mono)">
                    {z.name}
                  </text>
                </g>
              );
            })}

          {/* 我方资产 */}
          {layers.assets &&
            CMD_ASSETS.map((a) => {
              const p = proj(a.lng, a.lat);
              const isKey = a.type === "key-area";
              const rangePx =
                a.rangeKm && map ? Math.abs(proj(a.lng + a.rangeKm / 111 / Math.cos((a.lat * Math.PI) / 180), a.lat).x - p.x) : 0;
              return (
                <g key={a.id} className="cursor-pointer" onClick={() => selectObject({ kind: "asset", id: a.id })}>
                  {rangePx > 0 && (
                    <circle cx={p.x} cy={p.y} r={rangePx} fill="rgba(91,155,213,0.025)" stroke="rgba(91,155,213,0.18)" strokeWidth={1} strokeDasharray="3 4" pointerEvents="none" />
                  )}
                  {/* 仅中心小热区可点，其余透传给地图（可拖拽/缩放） */}
                  <circle cx={p.x} cy={p.y} r={13} fill="transparent" className="pointer-events-auto" />
                  {isKey ? (
                    <>
                      <rect x={p.x - 7} y={p.y - 7} width={14} height={14} transform={`rotate(45 ${p.x} ${p.y})`} fill="rgba(59,184,122,0.15)" stroke="#3bb87a" strokeWidth={1.5} />
                      <text x={p.x + 12} y={p.y + 4} fill="#3bb87a" fontSize={10} fontWeight={600} fontFamily="var(--font-mono)">{a.name}</text>
                    </>
                  ) : (
                    <>
                      <circle cx={p.x} cy={p.y} r={a.type === "interceptor" ? 5 : 4} fill="rgba(91,155,213,0.2)" stroke={a.status === "degraded" ? "#d4932a" : "#5b9bd5"} strokeWidth={1.5} />
                      <text x={p.x + 8} y={p.y + 3} fill="#8b8b93" fontSize={8.5} fontFamily="var(--font-mono)">{a.name}</text>
                    </>
                  )}
                </g>
              );
            })}

          {/* 威胁群成员散点（监视态显示原始航迹密度） */}
          {layers.tracks &&
            mode === "monitor" &&
            memberDots.map((g) =>
              g.pts.map((pt, i) => {
                const p = proj(pt.lng, pt.lat);
                return <circle key={`${g.id}-${i}`} cx={p.x} cy={p.y} r={1.6} fill={g.color} opacity={0.55} />;
              }),
            )}

          {/* 威胁群轮廓 + 标签 */}
          {layers.groups &&
            THREAT_GROUPS.map((g) => {
              const hull = g.hull.map((c) => proj(c[0], c[1]));
              const c = proj(g.lng, g.lat);
              const color = FORCE_COLORS[g.disposition];
              const dim = mode === "highpressure" && !g.primary ? 0.3 : 1;
              const isSel = selected?.kind === "group" && selected.id === g.id;
              return (
                <g key={g.id} className="cursor-pointer" opacity={dim} onClick={() => selectObject({ kind: "group", id: g.id })}>
                  <path d={polyPath(hull)} fill={`${color}14`} stroke={color} strokeWidth={isSel ? 2 : 1.2} strokeDasharray={g.trust === "pending" ? "5 4" : undefined} pointerEvents="none" />
                  {/* 中心小热区可点，hull 面积透传给地图 */}
                  <circle cx={c.x} cy={c.y} r={16} fill="transparent" className="pointer-events-auto" />
                  <circle cx={c.x} cy={c.y} r={3} fill={color} pointerEvents="none" />
                  <text x={c.x} y={c.y - 10} fill={color} fontSize={11} fontWeight={700} textAnchor="middle" fontFamily="var(--font-mono)">{g.id}</text>
                  <text x={c.x} y={c.y + 18} fill="#8b8b93" fontSize={8} textAnchor="middle" fontFamily="var(--font-mono)">{g.trackCount} 迹 · 威胁 {(g.threat * 100).toFixed(0)}</text>
                  {g.decoy && (
                    <text x={c.x} y={c.y + 30} fill="#d4932a" fontSize={8} textAnchor="middle">判诱饵?</text>
                  )}
                </g>
              );
            })}

          {/* ── 高压态：分叉几何 ── */}
          {mode === "highpressure" && layers.prediction && (
            <g>
              {/* 分叉点 */}
              {(() => {
                const f = proj(COAS[0].beam[0].lng, COAS[0].beam[0].lat);
                return <circle cx={f.x} cy={f.y} r={4} fill="#e8724a" filter="url(#cmd-glow)" />;
              })()}

              {COAS.map((coa) => {
                const isSel = selectedCoa === coa.id;
                const ghost = selectedCoa && !isSel;
                const baseOp = ghost ? 0.18 : isSel ? 1 : 0.7;
                const pts = coa.beam.map((b) => proj(b.lng, b.lat));
                // scrubber 揭示：committed 后按 scrubT 截断显示行进
                const ip = proj(coa.intercept.lng, coa.intercept.lat);
                const interceptLit = isSel && scrubT >= coa.intercept.t;
                return (
                  <g key={coa.id} opacity={baseOp}>
                    {/* 预测轨迹束 */}
                    <path d={smoothPath(pts)} fill="none" stroke={coa.color} strokeWidth={isSel ? 3 : 2} strokeDasharray="7 5" opacity={0.85} filter={isSel ? "url(#cmd-glow)" : undefined} />
                    {/* 束宽阴影（半透明带感） */}
                    <path d={smoothPath(pts)} fill="none" stroke={coa.color} strokeWidth={isSel ? 14 : 9} opacity={0.07} strokeLinecap="round" />

                    {/* 暴露扇 */}
                    {!ghost && (
                      <path d={polyPath(coa.exposureFan.polygon.map((c) => proj(c[0], c[1])))} fill={`${coa.color}10`} stroke={coa.color} strokeWidth={0.8} strokeDasharray="2 3" opacity={isSel ? 0.6 : 0.3} />
                    )}

                    {/* 失败红锥 */}
                    {isSel && (
                      <path d={polyPath(coa.failCone.polygon.map((c) => proj(c[0], c[1])))} fill="rgba(220,38,38,0.12)" stroke="#dc2626" strokeWidth={1} strokeDasharray="3 3" opacity={scrubT > 0.85 ? 0.9 : 0.45} />
                    )}

                    {/* 我方资产编排：机动路径 + 处置动作（仅选定方案显示） */}
                    {isSel &&
                      coa.tasks.map((task) => {
                        const pos = pathPosAt(task.path, task.actAtT, scrubT);
                        const pp = proj(pos.lng, pos.lat);
                        const acted = scrubT >= task.actAtT;
                        const pathPts = task.path.map((c) => proj(c[0], c[1]));
                        const end = pathPts[pathPts.length - 1];
                        return (
                          <g key={`${coa.id}-${task.assetId}`}>
                            {/* 计划机动路径（多于 1 点才画） */}
                            {pathPts.length > 1 && (
                              <path d={smoothPath(pathPts)} fill="none" stroke="#5b9bd5" strokeWidth={1.4} strokeDasharray="4 4" opacity={0.55} />
                            )}
                            {/* 到位阵位标记 */}
                            <rect x={end.x - 4} y={end.y - 4} width={8} height={8} transform={`rotate(45 ${end.x} ${end.y})`} fill="none" stroke="#5b9bd5" strokeWidth={1} opacity={0.5} />

                            {/* 处置动作效果 */}
                            {acted && task.action === "illuminate" && primaryGroupPt && (
                              <line x1={pp.x} y1={pp.y} x2={primaryGroupPt.x} y2={primaryGroupPt.y} stroke="#5b9bd5" strokeWidth={0.8} strokeDasharray="2 3" opacity={0.5} />
                            )}
                            {acted && task.action === "recon" && (
                              <circle cx={pp.x} cy={pp.y} r={8} fill="none" stroke="#3bb87a" strokeWidth={1} opacity={0.5}>
                                <animate attributeName="r" values="4;14;4" dur="2s" repeatCount="indefinite" />
                                <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" />
                              </circle>
                            )}
                            {acted && task.action === "intercept" && (
                              <circle cx={pp.x} cy={pp.y} r={7} fill="none" stroke={coa.color} strokeWidth={1.4} opacity={0.8}>
                                <animate attributeName="r" values="5;12;5" dur="1s" repeatCount="indefinite" />
                              </circle>
                            )}

                            {/* 资产本体（移动中的友方蓝） */}
                            <circle cx={pp.x} cy={pp.y} r={4} fill="rgba(91,155,213,0.85)" stroke="#cfe2f3" strokeWidth={1} />
                            <text x={pp.x + 7} y={pp.y - 5} fill="#9ec5e8" fontSize={8} fontFamily="var(--font-mono)">
                              {task.assetName}
                            </text>
                            <text x={pp.x + 7} y={pp.y + 5} fill={acted ? coa.color : "#6b7280"} fontSize={7.5} fontFamily="var(--font-mono)">
                              {acted ? COA_TASK_VERB[task.action] : `就位 ${Math.round(task.actAtT * 180)}s`}
                            </text>
                          </g>
                        );
                      })}

                    {/* 建议拦截 ◇ + 倒计时 */}
                    <g className="pointer-events-auto cursor-pointer" onClick={() => selectCoa(coa.id)}>
                      <rect
                        x={ip.x - 8}
                        y={ip.y - 8}
                        width={16}
                        height={16}
                        transform={`rotate(45 ${ip.x} ${ip.y})`}
                        fill={interceptLit ? coa.color : `${coa.color}22`}
                        stroke={coa.color}
                        strokeWidth={1.6}
                        filter={interceptLit ? "url(#cmd-glow)" : undefined}
                      />
                      <text x={ip.x} y={ip.y - 14} fill={coa.color} fontSize={9} textAnchor="middle" fontWeight={600} fontFamily="var(--font-mono)">
                        T+{coa.intercept.countdownSec}s
                      </text>
                    </g>

                    {/* 推演行进目标点（选定即预演，签订后继续执行） */}
                    {isSel && scrubT > 0 && (() => {
                      const pos = beamPosAt(coa.beam, scrubT);
                      const pp = proj(pos.lng, pos.lat);
                      return (
                        <g>
                          <circle cx={pp.x} cy={pp.y} r={6} fill="none" stroke={coa.color} strokeWidth={1} opacity={0.5}>
                            <animate attributeName="r" values="6;11;6" dur="1.4s" repeatCount="indefinite" />
                          </circle>
                          <circle cx={pp.x} cy={pp.y} r={4} fill={coa.color} filter="url(#cmd-glow)" />
                        </g>
                      );
                    })()}

                    {/* COA 标签 */}
                    {(() => {
                      const mid = proj(coa.beam[2].lng, coa.beam[2].lat);
                      return (
                        <g className="pointer-events-auto cursor-pointer" onClick={() => selectCoa(coa.id)}>
                          <rect x={mid.x - 14} y={mid.y - 26} width={28} height={15} rx={3} fill="#111113" stroke={coa.color} strokeWidth={isSel ? 1.4 : 0.8} />
                          <text x={mid.x} y={mid.y - 15} fill={coa.color} fontSize={9.5} textAnchor="middle" fontWeight={700}>{coa.short}</text>
                        </g>
                      );
                    })()}
                  </g>
                );
              })}
            </g>
          )}
        </svg>
      )}

      {/* FUTURE 推演水印 */}
      {mode === "highpressure" && selectedCoa && scrubT > 0 && (
        <div className="pointer-events-none absolute right-3 top-1/2 z-20 -translate-y-1/2 rotate-90 select-none">
          <span className="rounded border border-[#dc2626]/50 bg-[#dc2626]/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-[#dc2626]">
            推演 T+{tPlus}秒 · 非现实
          </span>
        </div>
      )}

      {/* 比例尺 */}
      <div className="pointer-events-none absolute bottom-9 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
        <div className="flex items-center gap-1 rounded bg-nexus-bg-surface/70 px-2 py-1 backdrop-blur-sm">
          <div className="h-px w-12 bg-nexus-text-muted" />
          <span className="font-mono text-[9px] text-nexus-text-muted">10 公里 · {KEY_AREA.name}</span>
        </div>
      </div>

      <style jsx global>{`
        .maplibregl-ctrl-attrib,
        .maplibregl-ctrl-logo { display: none !important; }
        .maplibregl-canvas { outline: none !important; }
      `}</style>
    </div>
  );
}
