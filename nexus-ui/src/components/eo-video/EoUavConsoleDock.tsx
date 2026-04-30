"use client";

import {
  Battery,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CloudRain,
  Gauge,
  Home,
  Plane,
  RadioTower,
  RotateCcw,
  RotateCw,
  Timer,
  Wind,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EoUavCompassRose, formatEoUavHeading3 } from "./EoUavCompassRose";
import type { UavControlAction } from "@/lib/eo-video/uavControlClient";
import type { UavMqttTelemetry } from "@/hooks/useUavMqttDockState";

export interface EoUavConsoleDockProps {
  /** 当前流名称（对应 Qt m_pLabelUavName） */
  streamLabel: string;
  mqttConnected: boolean;
  /** 舱内/外，null 未知 */
  droneInDock: boolean | null;
  onClientLog?: (line: string) => void;
  /** 与视频区上下拼接时可去掉顶圆角与上浮阴影 */
  className?: string;
  /** 航向角，对应 uavcompass::setAttitudeHead / m_dBow；未传视为 0 */
  attitudeHeadDeg?: number | null;
  /** 云台相对机头方位（度），对应 m_dCamBow；未传不画外缘相机游标 */
  cameraBowDeg?: number | null;
  /** 叠在视频上：无整块黑底，仅细边线（便于看清画面） */
  transparent?: boolean;
  /** 返航点距离（米），未传显示占位 */
  homeDistanceM?: number | null;
  onAction?: (action: UavControlAction) => void;
  actionBusy?: Partial<Record<UavControlAction, boolean>>;
  /** 从 MQTT 实时解析的遥测数据 */
  telemetry?: UavMqttTelemetry | null;
  /** 键盘手控按键状态（用于高亮 QWEASDZC） */
  keyPressed?: Partial<Record<"Q" | "W" | "E" | "A" | "S" | "D" | "Z" | "C", boolean>>;
}

const STATUS_ICON = "shrink-0 text-white/90";
const AIRPORT_MODE = ["作业准备中", "飞行作业中", "作业后状态恢复", "自定义飞行区更新中", "地形障碍物更新中", "任务空闲"] as const;
const AIRPORT_DEBUG_MODE = ["空闲中", "现场调试", "远程调试", "固件升级中", "作业中", "待标定"] as const;

function KeyCap({
  k,
  transparent,
  compact,
  active,
}: {
  k: string;
  transparent?: boolean;
  compact?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded border font-sans font-semibold tracking-wide",
        compact ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-[10px]",
        active
          ? "border-emerald-400/90 bg-emerald-600/30 text-emerald-100"
          : transparent
            ? "border-white/35 bg-black/60 text-nexus-text-primary"
            : "border-white/20 bg-black/50 text-nexus-text-primary",
      )}
    >
      {k}
    </div>
  );
}

function ActionBtn({
  label,
  danger,
  transparent,
  busy,
  onClick,
}: {
  label: string;
  danger?: boolean;
  transparent?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "rounded border px-1.5 py-1 text-[10px] font-medium transition",
        danger && transparent
          ? "h-6 border-red-500/60 bg-red-950/75 px-1 text-[9px] text-red-100 hover:bg-red-900/85"
          : danger
            ? "border-red-500/50 bg-red-950/70 text-red-100 hover:bg-red-900/80"
            : transparent
              ? "h-6 border-white/35 bg-black/55 px-1 text-[9px] text-nexus-text-primary hover:border-white/50 hover:bg-black/70"
              : "border-white/15 bg-white/5 text-nexus-text-secondary hover:border-white/25 hover:bg-white/10 hover:text-nexus-text-primary",
        busy ? "cursor-wait opacity-70" : "",
      )}
    >
      {label}
    </button>
  );
}

function CtrlHintIcon({ children }: { children: React.ReactNode }) {
  return <div className="flex h-3 items-center justify-center text-white/90">{children}</div>;
}

/**
 * 无人机视频底部控制台：对齐 PtzMainWidget 中 pUavLayout（状态 | 罗盘 | 控制）+ 上方工具条。
 * 遥测数值后续可接 MQTT/OSD；当前占位以不阻塞视频。
 */
/** 格式化秒数为 mm:ss */
function fmtSeconds(sec: number | null): string {
  if (sec === null) return "--:--";
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** 格式化速度/高度，1位小数 */
function fmtNum(v: number | null, fallback = "--"): string {
  if (v === null) return fallback;
  return v.toFixed(1);
}

/** 格式化整数（如电量%、距离m） */
function fmtInt(v: number | null, fallback = "--"): string {
  if (v === null) return fallback;
  return String(Math.round(v));
}

export function EoUavConsoleDock({
  streamLabel,
  mqttConnected,
  droneInDock,
  onClientLog,
  className,
  attitudeHeadDeg: attitudeHeadDegProp = null,
  cameraBowDeg = null,
  transparent = false,
  homeDistanceM: homeDistanceMProp = null,
  onAction,
  actionBusy,
  telemetry = null,
  keyPressed,
}: EoUavConsoleDockProps) {
  const log = (s: string) => onClientLog?.(s);
  const dockTxt = droneInDock === null ? "未知" : droneInDock ? "在舱" : "离舱";

  // 遥测值：prop 优先，其次来自 telemetry
  const attitudeHeadDeg = attitudeHeadDegProp ?? telemetry?.attitudeHeadDeg ?? null;
  const homeDistanceM = homeDistanceMProp ?? telemetry?.homeDistanceM ?? null;
  // 电量：在舱时优先用机场充电状态（对应 C++ ptzmainwidget.cpp 16707-16713）
  const batteryPct = droneInDock === true && telemetry?.airportDroneChargePercent !== null && telemetry?.airportDroneChargePercent !== undefined
    ? telemetry?.airportDroneChargePercent
    : telemetry?.batteryPercent ?? null;
  const remainSec = telemetry?.remainFlightTimeSec ?? null;
  const hSpeedMps = telemetry?.horizontalSpeedMps ?? null;
  const vSpeedMps = telemetry?.verticalSpeedMps ?? null;
  const elevM = telemetry?.elevationM ?? null;
  const heightM = telemetry?.heightM ?? null;
  const airWindMps = telemetry?.airportWindSpeedMps ?? null;
  const rainfall = telemetry?.rainfall ?? null;
  const airportStepCode = telemetry?.airportFlightTaskStepCode ?? null;
  const airportModeCode = telemetry?.airportModeCode ?? null;

  // 与 C++ uavstatusboard::setAirportStatus 映射一致：mode_code=1/2/3 优先显示 debug 状态，否则 flighttask_step_code
  const airportStatusTxt =
    airportModeCode !== null && [1, 2, 3].includes(airportModeCode)
      ? AIRPORT_DEBUG_MODE[airportModeCode] ?? "未知"
      : airportStepCode !== null && airportStepCode >= 0 && airportStepCode <= 5
        ? AIRPORT_MODE[airportStepCode] ?? "未知"
        : dockTxt;

  const rainfallTxt = rainfall === null ? "—" : rainfall === 0 ? "无雨" : `${rainfall}mm`;
  const batteryColor = batteryPct === null ? "text-nexus-text-muted"
    : batteryPct <= 20 ? "text-red-400" : batteryPct <= 40 ? "text-amber-400" : "text-emerald-300/90";

  return (
    <div
      className={cn(
        "w-full max-w-[100vw] select-none",
        transparent
          ? "pointer-events-none border-0 bg-transparent pl-2 pr-14 shadow-none [text-shadow:0_1px_2px_rgba(0,0,0,0.85)] max-sm:pl-2 max-sm:pr-3 max-sm:pb-2"
          : "rounded-t-md border border-white/12 bg-black/78 shadow-[0_-4px_24px_rgba(0,0,0,0.45)] backdrop-blur-md",
        className,
      )}
    >
      {transparent ? (
        <div className="relative flex max-h-[min(48vh,360px)] min-h-0 w-full flex-col gap-1.5 pb-0 pt-1.5 lg:min-h-[9rem] lg:flex-row lg:items-center lg:justify-between lg:gap-x-2">
          <section className="relative z-20 flex min-w-0 max-w-[min(100%,14rem)] shrink-0 flex-col justify-center gap-1.5 text-[10px] text-nexus-text-secondary max-lg:w-full lg:translate-y-5 lg:items-start lg:justify-center">
            <div className="w-full max-w-[14rem] rounded border border-white/25 bg-black/45 px-2 py-1.5">
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-white/15 pb-1">
                <span className="inline-flex items-center gap-1 font-semibold text-nexus-text-primary">
                  <RadioTower className={cn("size-3", STATUS_ICON)} aria-hidden />
                  机场
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <Wind className={cn("size-3", STATUS_ICON)} aria-hidden />
                  <span>{airWindMps === null ? "—" : fmtNum(airWindMps)} m/s</span>
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <CloudRain className={cn("size-3", STATUS_ICON)} aria-hidden />
                  <span>{rainfallTxt}</span>
                </span>
                <span className="inline-flex items-center gap-0.5 text-emerald-300/90">
                  <Gauge className={cn("size-3", STATUS_ICON)} aria-hidden />
                  <span>{airportStatusTxt}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1 font-semibold text-nexus-text-primary">
                  <Plane className={cn("size-3", STATUS_ICON)} aria-hidden />
                  飞行器
                </span>
                <span className="inline-flex items-center gap-1">
                  <Battery className={cn("size-3.5", STATUS_ICON)} aria-hidden />
                  <span className={batteryColor}>{batteryPct === null ? "—" : fmtInt(batteryPct)}%</span>
                </span>
                <span className="inline-flex items-center gap-1 text-nexus-text-muted">
                  <Timer className={cn("size-3.5", STATUS_ICON)} aria-hidden />
                  <span className="font-mono tabular-nums">{fmtSeconds(remainSec)}</span>
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <Home className={cn("size-3", STATUS_ICON)} aria-hidden />
                  <span className="font-mono text-[10px] text-emerald-300/90 tabular-nums">
                    {homeDistanceM == null ? "— m" : `${Math.max(0, Math.round(homeDistanceM))} m`}
                  </span>
                </span>
                {!mqttConnected ? <span className="text-amber-400/90">MQTT 未连接</span> : null}
              </div>
            </div>
          </section>

          <section
            className={cn(
              "flex shrink-0 flex-col items-center justify-center gap-0.5 max-lg:w-full",
              "lg:absolute lg:left-1/2 lg:top-1/2 lg:z-10 lg:w-max lg:max-w-none lg:-translate-y-1/2",
              // 父级 pl-2 pr-14 时，内容区中心比视频中心偏左 (pr-pl)/2，补偿到相对视频水平居中
              "lg:translate-x-[calc(-50%+1.5rem)]",
            )}
          >
            <div className="flex w-full min-w-0 items-stretch gap-x-1 sm:gap-x-2 lg:w-max lg:justify-center">
              {/* 大屏：整块 OSD+罗盘相对视频区水平居中；左/右侧栏仍贴边留 pr-14 给浮动工具 */}
              <div className="flex min-w-0 flex-1 flex-col items-end justify-center gap-1 pr-1 text-[12px] text-nexus-text-muted">
                <span className="inline-flex items-center gap-0.5">
                  <Wind className={cn("size-2.5 rotate-45", STATUS_ICON)} aria-hidden />
                  <span className="font-mono tabular-nums">{airWindMps === null ? "—" : fmtNum(airWindMps)}</span>
                  <span>m/s</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="text-right text-[12px] leading-tight text-emerald-400/80">
                    {"SPD"}
                    <br />
                    {"m/s"}
                  </span>
                  <span className="font-mono text-[19px] font-bold leading-none text-emerald-400 tabular-nums">
                    {fmtNum(hSpeedMps, "00.0")}
                  </span>
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-center gap-0">
                <span className="font-mono text-[16px] font-bold leading-none text-emerald-400 tabular-nums">
                  {formatEoUavHeading3(attitudeHeadDeg ?? 0)}
                </span>
                <div className="-mb-px h-1.5 w-0.5 shrink-0 bg-emerald-500" aria-hidden />
                <div className="relative h-[6.2rem] w-[6.2rem] shrink-0 overflow-hidden rounded-full">
                  <EoUavCompassRose
                    className="drop-shadow-sm"
                    attitudeDeg={attitudeHeadDeg ?? 0}
                    cameraBowDeg={cameraBowDeg}
                    inlineHeading={false}
                    inlineNorthTick={false}
                  />
                </div>
              </div>
              {/* 右侧：VS（小）→ ALT大绿 → ASL（小），对齐 uavcompass.ui verticalLayout_2 */}
              <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 pl-1 text-[12px] text-nexus-text-muted">
                <span className="inline-flex items-baseline gap-0.5">
                  <span className="font-mono tabular-nums">{fmtNum(vSpeedMps, "00.0")}</span>
                  <span>VS</span>
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <span className="font-mono text-[19px] font-bold leading-none text-emerald-400 tabular-nums">
                    {fmtNum(elevM, "00.0")}
                  </span>
                  <span className="text-left text-[12px] leading-tight text-emerald-400/80">
                    {"ALT"}
                    <br />
                    {"m"}
                  </span>
                </span>
                <span className="inline-flex items-baseline gap-0.5">
                  <span className="font-mono tabular-nums">{fmtNum(heightM, "00.0")}</span>
                  <span>ASL</span>
                </span>
              </div>
            </div>
          </section>

          <section className="relative z-20 flex min-w-0 shrink-0 justify-end max-lg:w-full lg:translate-y-5 lg:justify-end">
            <div className="pointer-events-none grid min-w-0 grid-cols-[auto_7.75rem] items-end gap-2">
            <div className="pointer-events-none flex min-w-0 flex-col justify-end gap-1">
              <div className="relative w-[6.75rem] pt-3 pb-3">
                <div className="pointer-events-none absolute inset-x-0 top-0 grid grid-cols-4 gap-1 px-0.5">
                  <CtrlHintIcon>
                    <RotateCcw className="size-2.5" />
                  </CtrlHintIcon>
                  <CtrlHintIcon>
                    <ChevronUp className="size-2.5" />
                  </CtrlHintIcon>
                  <CtrlHintIcon>
                    <RotateCw className="size-2.5" />
                  </CtrlHintIcon>
                  <CtrlHintIcon>
                    <ChevronUp className="size-2.5" />
                  </CtrlHintIcon>
                </div>
                <div className="grid w-[6.75rem] grid-cols-4 gap-1">
                  {(["Q", "W", "E", "C"] as const).map((k) => (
                    <KeyCap key={k} k={k} compact transparent={transparent} active={Boolean(keyPressed?.[k])} />
                  ))}
                  {(["A", "S", "D", "Z"] as const).map((k) => (
                    <KeyCap key={k} k={k} compact transparent={transparent} active={Boolean(keyPressed?.[k])} />
                  ))}
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 grid grid-cols-4 gap-1 px-0.5">
                  <CtrlHintIcon>
                    <ChevronLeft className="size-2.5" />
                  </CtrlHintIcon>
                  <CtrlHintIcon>
                    <ChevronDown className="size-2.5" />
                  </CtrlHintIcon>
                  <CtrlHintIcon>
                    <ChevronRight className="size-2.5" />
                  </CtrlHintIcon>
                  <CtrlHintIcon>
                    <ChevronDown className="size-2.5" />
                  </CtrlHintIcon>
                </div>
              </div>
            </div>
            <div className="pointer-events-auto grid w-[7.75rem] shrink-0 grid-cols-3 grid-rows-2 auto-rows-[1.5rem] gap-1 self-center">
              <ActionBtn
                label="起飞"
                transparent={transparent}
                busy={actionBusy?.takeoff}
                onClick={() => (onAction ? onAction("takeoff") : log("无人机控制台：起飞（占位，未接 MQTT 指令）"))}
              />
              <ActionBtn
                label="中止"
                transparent={transparent}
                busy={actionBusy?.stop}
                onClick={() => (onAction ? onAction("stop") : log("无人机控制台：中止（占位）"))}
              />
              <ActionBtn
                label="返航"
                transparent={transparent}
                busy={actionBusy?.back}
                onClick={() => (onAction ? onAction("back") : log("无人机控制台：返航（占位）"))}
              />
              <ActionBtn
                label="热备"
                transparent={transparent}
                busy={actionBusy?.hotback}
                onClick={() => (onAction ? onAction("hotback") : log("无人机控制台：热备（占位）"))}
              />
              <ActionBtn
                label="重连"
                transparent={transparent}
                busy={actionBusy?.reconnect}
                onClick={() => (onAction ? onAction("reconnect") : log("无人机控制台：重连（占位）"))}
              />
              <ActionBtn
                label="急停"
                danger
                busy={actionBusy?.emergency}
                onClick={() => (onAction ? onAction("emergency") : log("无人机控制台：急停（占位）"))}
              />
            </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="flex max-h-[min(38vh,340px)] min-h-0 w-full flex-col gap-2 p-2 lg:flex-row lg:items-stretch lg:gap-x-3">
          <section className="flex min-w-0 flex-[1_1_0] basis-0 flex-col justify-center gap-1.5 text-[10px] text-nexus-text-secondary lg:items-start lg:justify-center">
            <div className="w-full max-w-[14rem] rounded border border-white/10 bg-black/40 px-2 py-1.5">
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-white/10 pb-1 text-[10px]">
                <span className="inline-flex items-center gap-1 font-semibold text-nexus-text-primary">
                  <RadioTower className={cn("size-3", STATUS_ICON)} aria-hidden />
                  机场
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <Wind className={cn("size-3", STATUS_ICON)} aria-hidden />
                  <span>{airWindMps === null ? "—" : fmtNum(airWindMps)} m/s</span>
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <CloudRain className={cn("size-3", STATUS_ICON)} aria-hidden />
                  <span>{rainfallTxt}</span>
                </span>
                <span className="inline-flex items-center gap-0.5 text-emerald-300/90">
                  <Gauge className={cn("size-3", STATUS_ICON)} aria-hidden />
                  <span>{airportStatusTxt}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1 font-semibold text-nexus-text-primary">
                  <Plane className={cn("size-3", STATUS_ICON)} aria-hidden />
                  飞行器
                </span>
                <span className="inline-flex items-center gap-1">
                  <Battery className={cn("size-3.5", STATUS_ICON)} aria-hidden />
                  <span className={batteryColor}>{batteryPct === null ? "—" : fmtInt(batteryPct)}%</span>
                </span>
                <span className="inline-flex items-center gap-1 text-nexus-text-muted">
                  <Timer className={cn("size-3.5", STATUS_ICON)} aria-hidden />
                  <span className="font-mono tabular-nums">{fmtSeconds(remainSec)}</span>
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <Home className={cn("size-3", STATUS_ICON)} aria-hidden />
                  <span className="font-mono text-[10px] text-emerald-300/90 tabular-nums">
                    {homeDistanceM == null ? "— m" : `${Math.max(0, Math.round(homeDistanceM))} m`}
                  </span>
                </span>
                {!mqttConnected ? <span className="text-amber-400/90">MQTT 未连接</span> : null}
              </div>
            </div>
          </section>

          <section className="flex min-w-0 shrink-0 flex-col items-center justify-center gap-1">
            <div className="flex w-full min-w-0 max-w-[min(92vw,36rem)] items-stretch gap-x-2">
              {/* 上风速，下 SPD：与罗盘之间均分两侧空间 */}
              <div className="flex min-w-0 flex-1 flex-col items-end gap-1.5 text-[12px] text-nexus-text-muted">
                <span className="inline-flex items-center gap-0.5">
                  <Wind className={cn("size-3 rotate-45", STATUS_ICON)} aria-hidden />
                  <span className="font-mono tabular-nums">
                    {airWindMps === null ? "— m/s" : `${fmtNum(airWindMps)} m/s`}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="text-left text-[12px] leading-tight text-emerald-400/80">
                    {"SPD"}
                    <br />
                    {"m/s"}
                  </span>
                  <span className="font-mono text-xl font-bold leading-none text-emerald-400 tabular-nums">
                    {fmtNum(hSpeedMps, "00.0")}
                  </span>
                </span>
              </div>
              <div className="relative aspect-square w-[min(32vmin,13rem)] shrink-0">
                <EoUavCompassRose
                  className="drop-shadow-sm"
                  attitudeDeg={attitudeHeadDeg ?? 0}
                  cameraBowDeg={cameraBowDeg}
                />
              </div>
              {/* 右侧：VS / ALT / ASL */}
              <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-[12px] text-nexus-text-muted">
                <span className="inline-flex items-baseline gap-1">
                  <span className="font-mono tabular-nums">{fmtNum(vSpeedMps, "00.0")}</span>
                  <span>VS</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="font-mono text-xl font-bold leading-none text-emerald-400 tabular-nums">
                    {fmtNum(elevM, "00.0")}
                  </span>
                  <span className="text-left text-[12px] leading-tight text-emerald-400/80">
                    {"ALT"}
                    <br />
                    {"m"}
                  </span>
                </span>
                <span className="inline-flex items-baseline gap-1">
                  <span className="font-mono tabular-nums">{fmtNum(heightM, "00.0")}</span>
                  <span>ASL</span>
                </span>
              </div>
            </div>
          </section>

          <section className="flex min-w-0 flex-[1_1_0] basis-0 flex-col justify-center gap-1.5 lg:min-w-0 lg:justify-center">
            <div className="grid max-w-full grid-cols-4 gap-1">
              {(["Q", "W", "E", "C"] as const).map((k) => (
                <KeyCap key={k} k={k} transparent={transparent} active={Boolean(keyPressed?.[k])} />
              ))}
              {(["A", "S", "D", "Z"] as const).map((k) => (
                <KeyCap key={k} k={k} transparent={transparent} active={Boolean(keyPressed?.[k])} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1">
              <ActionBtn
                label="起飞"
                transparent={transparent}
                busy={actionBusy?.takeoff}
                onClick={() => (onAction ? onAction("takeoff") : log("无人机控制台：起飞（占位，未接 MQTT 指令）"))}
              />
              <ActionBtn
                label="中止"
                transparent={transparent}
                busy={actionBusy?.stop}
                onClick={() => (onAction ? onAction("stop") : log("无人机控制台：中止（占位）"))}
              />
              <ActionBtn
                label="返航"
                transparent={transparent}
                busy={actionBusy?.back}
                onClick={() => (onAction ? onAction("back") : log("无人机控制台：返航（占位）"))}
              />
              <ActionBtn
                label="热备"
                transparent={transparent}
                busy={actionBusy?.hotback}
                onClick={() => (onAction ? onAction("hotback") : log("无人机控制台：热备（占位）"))}
              />
              <ActionBtn
                label="重连"
                transparent={transparent}
                busy={actionBusy?.reconnect}
                onClick={() => (onAction ? onAction("reconnect") : log("无人机控制台：重连（占位）"))}
              />
              <ActionBtn
                label="急停"
                danger
                busy={actionBusy?.emergency}
                onClick={() => (onAction ? onAction("emergency") : log("无人机控制台：急停（占位）"))}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
