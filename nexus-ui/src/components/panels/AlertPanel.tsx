"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, ArrowUpDown, Info, Send, X } from "lucide-react";
import { toast } from "sonner";

import { useAppStore } from "@/stores/app-store";
import { useAssetStore, type AssetData } from "@/stores/asset-store";
import { type Track, normalizeAssetType } from "@/lib/map-entity-model";
import { useTrackStore, getRenderCache } from "@/stores/track-store";
import { useDisposedStore } from "@/stores/disposed-store";
import { useDisposalPlanStore } from "@/stores/disposal-plan-store";
import { useTaskProgressStore } from "@/stores/task-progress-store";
import { useTrackAliasStore, resolveAliasKey } from "@/stores/track-alias-store";
import { cn } from "@/lib/utils";
import { runAlertDestroyHttp } from "@/lib/disposal/alert-destroy";
import { toastDroneReturnHomeSummary } from "@/lib/drone/drone-return-home";
import { postEngagementStartCommand, type EngagementKind } from "@/lib/engagement/engagement-finish";

type PanelAlertItem = {
  id: string;
  severity: SeverityKey;
  timestamp: string;
  external_target_id?: string;
  targetID?: string;
  lat?: number;
  lng?: number;
  type?: string;
  alarmLevel?: number;
  areaName?: string;
  detail?: string;
  imageUrl?: string;
  suppressDestroy?: boolean;
};

const SEVERITY_STYLES = {
  critical: {
    icon: AlertTriangle,
    border: "border-l-red-500",
    bg: "bg-red-500/5",
    iconColor: "text-red-400",
    label: "严重",
    labelColor: "text-red-400",
  },
  warning: {
    icon: AlertCircle,
    border: "border-l-amber-500",
    bg: "bg-amber-500/5",
    iconColor: "text-amber-400",
    label: "告警",
    labelColor: "text-amber-400",
  },
  info: {
    icon: Info,
    border: "border-l-zinc-500",
    bg: "bg-zinc-500/5",
    iconColor: "text-zinc-400",
    label: "信息",
    labelColor: "text-zinc-400",
  },
};

type SeverityKey = keyof typeof SEVERITY_STYLES;
const SEVERITY_SCORE: Record<SeverityKey, number> = { critical: 3, warning: 2, info: 1 };

type SortMode = "name" | "time" | "level" | "severity";
const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: "name", label: "名称" },
  { id: "time", label: "时间" },
  { id: "level", label: "等级" },
  { id: "severity", label: "严重度" },
];

type AlertContextMenuState = {
  alert: PanelAlertItem;
  x: number;
  y: number;
} | null;

type EngagementDeviceItem = {
  id: string;
  name: string;
  kind: EngagementKind;
  deviceState: number;
};

const ENGAGEMENT_DEVICE_GROUPS: { kind: EngagementKind; label: string }[] = [
  { kind: "tdoa", label: "TDOA" },
  { kind: "laser", label: "激光" },
  { kind: "munition", label: "巡飞弹" },
];

function naturalNameCompare(a: string, b: string): number {
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

function getAssetProps(asset: AssetData): Record<string, unknown> {
  return asset.properties && typeof asset.properties === "object"
    ? (asset.properties as Record<string, unknown>)
    : {};
}

function engagementKindFromAsset(asset: AssetData): EngagementKind | null {
  const type = normalizeAssetType(asset.asset_type);
  if (type === "tdoa") return "tdoa";
  if (type === "laser") return "laser";
  if (type === "missile") return "munition";
  return null;
}

function engagementEntityId(asset: AssetData): string {
  const props = getAssetProps(asset);
  return String(props.entityId ?? props.entity_id ?? props.deviceSn ?? props.device_sn ?? asset.id).trim();
}

function engagementDeviceState(asset: AssetData): number {
  const props = getAssetProps(asset);
  const n = Number(props.deviceState ?? props.device_state ?? props.devicestate ?? props.DeviceState ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function engagementDeviceName(asset: AssetData, entityId: string): string {
  const props = getAssetProps(asset);
  const name = String(props.displayName ?? props.name ?? asset.name ?? "").trim();
  return name || entityId || asset.id;
}

function alertAlias(alert: PanelAlertItem, aliases: Record<string, string>): string {
  const key = resolveAliasKey({
    external_target_id: alert.external_target_id,
    targetID: alert.targetID,
    isAirTrack: undefined,
  });
  return key ? (aliases[key] ?? alert.targetID ?? "") : (alert.targetID ?? "");
}

export function AlertPanel() {
  const { selectTrack, selectedTrackId, requestFlyTo } = useAppStore();
  const tracks = useTrackStore((s) => s.tracks);
  const assets = useAssetStore((s) => s.assets);
  const addDisposedTrack = useDisposedStore((s) => s.addDisposedTrack);
  const cleanupEffectsForMissingTargets = useDisposalPlanStore((s) => s.cleanupEffectsForMissingTargets);
  const aliases = useTrackAliasStore((s) => s.aliases);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [contextMenu, setContextMenu] = useState<AlertContextMenuState>(null);

  const engagementDevices = useMemo(() => {
    const out: EngagementDeviceItem[] = [];
    for (const asset of assets) {
      const kind = engagementKindFromAsset(asset);
      if (!kind) continue;
      const id = engagementEntityId(asset);
      if (!id) continue;
      out.push({
        id,
        name: engagementDeviceName(asset, id),
        kind,
        deviceState: engagementDeviceState(asset),
      });
    }
    out.sort((a, b) => {
      const g =
        ENGAGEMENT_DEVICE_GROUPS.findIndex((item) => item.kind === a.kind) -
        ENGAGEMENT_DEVICE_GROUPS.findIndex((item) => item.kind === b.kind);
      if (g !== 0) return g;
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" });
    });
    return out;
  }, [assets]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    const aliasStore = useTrackAliasStore.getState();
    for (const track of tracks) {
      const key = resolveAliasKey({
        external_target_id: track.external_target_id,
        targetID: track.targetID,
        isAirTrack: track.isAirTrack,
      });
      if (key) aliasStore.getOrCreate(key);
    }
  }, [tracks]);

  const alertImageMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const track of tracks) {
      if (track.external_target_id && track.verificationImage) {
        map.set(track.external_target_id, track.verificationImage);
      }
    }
    return map;
  }, [tracks]);

  const allAlerts = useMemo(() => {
    const mapped: PanelAlertItem[] = tracks
      .map((track: Track) => {
        const alarm =
          Array.isArray(track.alarms) && track.alarms.length > 0
            ? (track.alarms[0] as Record<string, unknown>)
            : null;
        if (!alarm) return null;

        const levelRaw = alarm.level;
        const alarmLevel = levelRaw != null && Number.isFinite(Number(levelRaw)) ? Number(levelRaw) : undefined;
        const severity: SeverityKey =
          alarmLevel != null && alarmLevel >= 2 ? "critical" : alarmLevel === 1 ? "warning" : "info";
        const area = alarm.area && typeof alarm.area === "object" ? (alarm.area as Record<string, unknown>) : null;
        const detail = typeof alarm.content === "string" ? alarm.content : undefined;

        return {
          id: `${track.targetID}:${String(alarm.alarm_id)}`,
          severity,
          timestamp: track.lastUpdate,
          external_target_id: track.external_target_id,
          targetID: track.targetID,
          lat: track.lat,
          lng: track.lng,
          type: Array.isArray(alarm.categories) ? String(alarm.categories.join(",")) : undefined,
          alarmLevel,
          areaName: area ? String(area.name ?? area.area_name ?? "") || undefined : undefined,
          detail,
          imageUrl: track.external_target_id ? alertImageMap.get(track.external_target_id) : undefined,
        } as PanelAlertItem;
      })
      .filter((item): item is PanelAlertItem => item != null);

    if (sortMode === "name") {
      mapped.sort((a, b) => naturalNameCompare(alertAlias(a, aliases), alertAlias(b, aliases)));
    } else if (sortMode === "level") {
      mapped.sort((a, b) => (b.alarmLevel ?? 0) - (a.alarmLevel ?? 0));
    } else if (sortMode === "severity") {
      mapped.sort((a, b) => SEVERITY_SCORE[b.severity] - SEVERITY_SCORE[a.severity]);
    }

    return mapped;
  }, [tracks, alertImageMap, aliases, sortMode]);

  const criticalCount = allAlerts.filter((item) => item.severity === "critical").length;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1.5 border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">告警中心</span>
          <span className="text-[10px] font-medium text-red-400">{criticalCount} 条严重</span>
        </div>
        <div className="flex items-center gap-1">
          <ArrowUpDown size={10} className="shrink-0 text-nexus-text-muted" />
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.id}
              onClick={() => setSortMode(option.id)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                sortMode === option.id
                  ? "bg-white/[0.08] text-nexus-text-primary"
                  : "text-nexus-text-muted hover:text-nexus-text-secondary",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {allAlerts.map((alert) => {
          const style = SEVERITY_STYLES[alert.severity];
          const Icon = style.icon;

          return (
            <div
              key={alert.id}
              className={cn(
                "cursor-pointer border-b border-l-2 border-white/[0.03] px-3 py-3 transition-colors hover:bg-white/[0.03]",
                style.border,
                style.bg,
              )}
              onClick={() => {
                const targetID = alert.targetID;
                if (!targetID) return;
                selectTrack(targetID);
                const track = getRenderCache().get(targetID);
                if (track) requestFlyTo(track.lat, track.lng, 14);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu({ alert, x: event.clientX, y: event.clientY });
              }}
            >
              <div className="flex items-start gap-2">
                <Icon size={14} className={cn("mt-0.5 shrink-0", style.iconColor)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[10px] font-bold", style.labelColor)}>{style.label}</span>
                    <span className="font-mono text-[10px] text-nexus-text-muted">{alert.timestamp}</span>
                  </div>
                  {alert.targetID && (
                    <p className="mt-0.5 text-[12px] font-bold text-nexus-text-primary">
                      {alertAlias(alert, aliases)}
                    </p>
                  )}
                  <div className="mt-1 space-y-0.5 text-[10px] text-nexus-text-muted">
                    {alert.lat != null && alert.lng != null && Number.isFinite(alert.lat) && Number.isFinite(alert.lng) && (
                      <div>
                        <span className="text-nexus-text-secondary">坐标: </span>
                        {alert.lng.toFixed(4)}, {alert.lat.toFixed(4)}
                      </div>
                    )}
                    {alert.areaName && (
                      <div>
                        <span className="text-nexus-text-secondary">区域: </span>
                        {alert.areaName}
                      </div>
                    )}
                  </div>
                  {alert.imageUrl && (
                    <div className="mt-1.5 overflow-hidden rounded border border-white/[0.06]">
                      <Image
                        src={alert.imageUrl}
                        alt="核验图片"
                        width={640}
                        height={360}
                        className="h-auto w-full object-cover"
                        unoptimized
                      />
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    {alert.targetID && !alert.suppressDestroy && (
                      <button
                        onClick={async (event) => {
                          event.stopPropagation();
                          const externalTargetId = alert.external_target_id ?? "";
                          const targetID = alert.targetID;
                          if (!targetID) {
                            toast.error("消灭失败: 告警缺少 targetID");
                            return;
                          }

                          try {
                            const http = await runAlertDestroyHttp(externalTargetId, targetID);
                            const publishOk = http.publishOk;

                            addDisposedTrack(targetID, externalTargetId);
                            useTrackStore.getState().removeDisposedTracks(targetID, externalTargetId);

                            if (selectedTrackId && selectedTrackId === targetID) {
                              selectTrack(null);
                            }

                            cleanupEffectsForMissingTargets();
                            useTaskProgressStore.getState().endByTarget(targetID);

                            const devHint =
                              http.deviceEntityIds.length > 0
                                ? `设备 ${http.deviceEntityIds.join(",")}`
                                : "无执行中处置设备";
                            const grpcHint = `gRPC 客户端 ${http.connectedClients} 个`;
                            toast.success(
                              publishOk
                                ? `已消灭目标 ${targetID}，${devHint}；${grpcHint}`
                                : `已消灭目标 ${targetID}，但后端发布可能未成功；${devHint}；${grpcHint}`,
                            );
                            toastDroneReturnHomeSummary(http.droneReturnHomeResults, "目标消灭后");
                          } catch (error) {
                            console.error("[AlertPanel] 消灭操作失败:", error);
                            toast.error(`消灭失败: ${error instanceof Error ? error.message : "未知错误"}`);
                          }
                        }}
                        className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/20"
                      >
                        <X size={10} />
                        消灭
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <div
          className="fixed z-[1000] min-w-[220px] overflow-hidden rounded border border-white/10 bg-[#17171b] py-1 shadow-2xl shadow-black/50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="border-b border-white/[0.06] px-2.5 py-1.5 text-[10px] font-medium text-nexus-text-muted">
            下发处置任务: {contextMenu.alert.targetID ?? "未知目标"}
          </div>
          {ENGAGEMENT_DEVICE_GROUPS.map((group) => {
            const devices = engagementDevices.filter((device) => device.kind === group.kind);
            return (
              <div key={group.kind} className="py-1">
                <div className="px-2.5 py-1 text-[10px] font-semibold text-nexus-text-secondary">{group.label}</div>
                {devices.length === 0 ? (
                  <div className="px-2.5 py-1 text-[10px] text-nexus-text-muted">无设备</div>
                ) : (
                  devices.map((device) => {
                    const executing = device.deviceState === 2;
                    const powered = device.deviceState === 1;
                    const enabled = powered && !executing;
                    return (
                      <button
                        key={`${device.kind}:${device.id}`}
                        disabled={!enabled}
                        onClick={async () => {
                          const targetId = String(contextMenu.alert.targetID ?? "").trim();
                          if (!targetId) {
                            toast.error("目标 ID 为空，无法下发任务");
                            return;
                          }
                          const result = await postEngagementStartCommand(device.kind, targetId, device.id);
                          if (!result.ok) {
                            toast.error(group.label + "任务下发失败", {
                              description: result.status
                                ? "HTTP " + result.status + (result.text ? ": " + result.text : "")
                                : result.text || "网络错误",
                            });
                            return;
                          }
                          useTaskProgressStore.getState().addEntries([
                            {
                              targetId,
                              targetAlias: alertAlias(contextMenu.alert, aliases) || targetId,
                              deviceId: device.id,
                              deviceName: device.name,
                              schemeId: `manual_${device.kind}`,
                              blockId: `manual_${targetId}`,
                            },
                          ]);
                          toast.success("已下发" + group.label + "任务", {
                            description: `${device.name} -> ${targetId}`,
                          });
                          setContextMenu(null);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors",
                          enabled
                            ? "text-nexus-text-primary hover:bg-white/[0.06]"
                            : "cursor-not-allowed text-nexus-text-muted opacity-45",
                        )}
                      >
                        <span className="min-w-0 truncate">{device.name}</span>
                        <span className="flex shrink-0 items-center gap-1 text-[10px]">
                          {enabled && <Send size={10} />}
                          {device.deviceState === 2 ? "执行" : device.deviceState === 1 ? "上电" : "不可用"}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
