"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/asset-store";
import {
  Radio,
  Eye,
  EyeOff,
  Target,
  CircleDot,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { DraggableModal } from "@/components/ui/DraggableModal";
import {
  MODAL_BUTTONS,
  MODAL_FOOTER,
  MODAL_SPACING,
  MODAL_TEXT,
  MODAL_INPUTS,
  MODAL_TOGGLES,
} from "@/lib/modal-styles";

interface RadarDisplaySettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 渲染属性键 → 默认值（对应 radar-range-rings-maplibre 读取的 properties 字段） */
const RADAR_PROP_DEFAULTS = {
  showRings:           true,
  center_name_visible: true,
  ring_interval_m:     3000,
  ring_color:          "#6ee7b7",
  ring_fill_color:     "#6ee7b7",
  ring_fill_opacity:   0.15,
} as const;

type RadarProps = typeof RADAR_PROP_DEFAULTS;

function getRadarProp<K extends keyof RadarProps>(
  assetProps: Record<string, unknown> | null | undefined,
  overrides: Record<string, unknown> | undefined,
  key: K,
): RadarProps[K] {
  if (overrides?.[key] !== undefined) return overrides[key] as RadarProps[K];
  if (assetProps?.[key] !== undefined) return assetProps[key] as RadarProps[K];
  return RADAR_PROP_DEFAULTS[key];
}

export function RadarDisplaySettingsDialog({ open, onClose }: RadarDisplaySettingsDialogProps) {
  const assets = useAssetStore((s) => s.assets);
  const displayOverrides = useAssetStore((s) => s.displayOverrides);
  const setDisplayOverride = useAssetStore((s) => s.setDisplayOverride);
  const clearDisplayOverride = useAssetStore((s) => s.clearDisplayOverride);

  const [selectedRadarId, setSelectedRadarId] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const radarAssets = assets.filter((a) => a.asset_type === "radar");

  useEffect(() => {
    if (open && radarAssets.length > 0 && !selectedRadarId) {
      setSelectedRadarId(radarAssets[0]!.id);
    }
  }, [open, radarAssets.length, selectedRadarId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) setSelectedRadarId("");
  }, [open]);

  const selectedRadar = radarAssets.find((r) => r.id === selectedRadarId);
  const assetProps = selectedRadar?.properties as Record<string, unknown> | null | undefined;
  const overrides = displayOverrides[selectedRadarId];

  const get = <K extends keyof RadarProps>(key: K) =>
    getRadarProp(assetProps, overrides, key);

  const update = (patch: Partial<Record<keyof RadarProps, unknown>>) => {
    if (!selectedRadarId) return;
    setDisplayOverride(selectedRadarId, patch as Record<string, unknown>);
  };

  const handleReset = () => {
    if (!selectedRadarId) return;
    clearDisplayOverride(selectedRadarId);
  };

  const footer = (
    <>
      <button
        onClick={handleReset}
        disabled={!selectedRadar}
        className={cn(MODAL_BUTTONS.auxiliary, !selectedRadar && MODAL_BUTTONS.disabled)}
      >
        <RefreshCw size={12} />
        重置
      </button>
      <div className={MODAL_FOOTER.rightGroup}>
        <button onClick={onClose} className={MODAL_BUTTONS.secondary}>取消</button>
        <button
          onClick={onClose}
          disabled={!selectedRadar}
          className={cn(MODAL_BUTTONS.primary, !selectedRadar && MODAL_BUTTONS.disabled)}
        >
          确定
        </button>
      </div>
    </>
  );

  return (
    <DraggableModal open={open} onClose={onClose} title="雷达显示设置" icon={Radio} size="medium" footer={footer}>
      <div className={MODAL_SPACING.main}>
        {/* 雷达选择 */}
        <div className={MODAL_SPACING.group}>
          <label className={MODAL_TEXT.label}>选择雷达</label>
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={MODAL_INPUTS.selectTrigger}
            >
              <span className="flex items-center gap-2 truncate">
                <Radio size={14} className="text-nexus-accent shrink-0" />
                {selectedRadar ? selectedRadar.name : "请选择雷达"}
              </span>
              <ChevronDown
                size={14}
                className={cn("transition-transform duration-200 shrink-0", dropdownOpen && "rotate-180")}
              />
            </button>

            {dropdownOpen && (
              <div className={MODAL_INPUTS.dropdownMenu} style={{ backgroundColor: "#19191D" }}>
                {radarAssets.map((radar) => (
                  <button
                    key={radar.id}
                    onClick={() => { setSelectedRadarId(radar.id); setDropdownOpen(false); }}
                    className={cn(
                      MODAL_INPUTS.dropdownItem,
                      selectedRadarId === radar.id && MODAL_INPUTS.dropdownItemSelected,
                    )}
                  >
                    <Radio size={12} className="shrink-0" />
                    <span className="truncate">{radar.name}</span>
                  </button>
                ))}
                {radarAssets.length === 0 && (
                  <div className="px-3 py-2 text-xs text-nexus-text-muted">暂无雷达资产</div>
                )}
              </div>
            )}
          </div>
        </div>

        {selectedRadar && (
          <>
            {/* 显示选项 */}
            <div className={MODAL_SPACING.group}>
              <h4 className={MODAL_TEXT.sectionTitle}>显示选项</h4>

              <label className={MODAL_TOGGLES.container}>
                <div className={MODAL_TOGGLES.leftContainer}>
                  <Target size={14} className={MODAL_TOGGLES.icon} />
                  <span className={MODAL_TEXT.option}>显示距离环 / 覆盖</span>
                </div>
                <button
                  onClick={() => update({ showRings: !get("showRings") })}
                  className={cn(
                    MODAL_BUTTONS.iconButton,
                    get("showRings") ? MODAL_TOGGLES.buttonEnabled : MODAL_TOGGLES.buttonDisabled,
                  )}
                >
                  {get("showRings") ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </label>

              <label className={MODAL_TOGGLES.container}>
                <div className={MODAL_TOGGLES.leftContainer}>
                  <CircleDot size={14} className={MODAL_TOGGLES.icon} />
                  <span className={MODAL_TEXT.option}>显示中心标签</span>
                </div>
                <button
                  onClick={() => update({ center_name_visible: !get("center_name_visible") })}
                  className={cn(
                    MODAL_BUTTONS.iconButton,
                    get("center_name_visible") ? MODAL_TOGGLES.buttonEnabled : MODAL_TOGGLES.buttonDisabled,
                  )}
                >
                  {get("center_name_visible") ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </label>
            </div>

            {/* 参数设置 */}
            <div className={MODAL_SPACING.group}>
              <h4 className={MODAL_TEXT.sectionTitle}>参数设置</h4>

              <div className="flex items-center gap-4">
                <div className="flex-1 space-y-1.5">
                  <label className={MODAL_TEXT.label}>距离环间隔 (公里)</label>
                  <input
                    type="number"
                    value={Number((get("ring_interval_m") / 1000).toFixed(1))}
                    onChange={(e) =>
                      update({ ring_interval_m: Math.round(Number(e.target.value) * 1000) })
                    }
                    className={MODAL_INPUTS.base}
                    min="0.5"
                    max="50"
                    step="0.5"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <label className={MODAL_TEXT.label}>距离环颜色</label>
                  <div className="flex items-center gap-2 pl-1">
                    <input
                      type="color"
                      value={get("ring_color")}
                      onChange={(e) => update({ ring_color: e.target.value })}
                      className="h-7 w-10 rounded cursor-pointer border border-nexus-border bg-[#19191D] p-0.5"
                    />
                    <span className="text-xs text-nexus-text-muted">{get("ring_color")}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex-1 space-y-1.5">
                  <label className={MODAL_TEXT.label}>覆盖填充透明度</label>
                  <input
                    type="number"
                    value={get("ring_fill_opacity")}
                    onChange={(e) => update({ ring_fill_opacity: Number(e.target.value) })}
                    className={MODAL_INPUTS.base}
                    min="0"
                    max="1"
                    step="0.05"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <label className={MODAL_TEXT.label}>覆盖填充颜色</label>
                  <div className="flex items-center gap-2 pl-1">
                    <input
                      type="color"
                      value={get("ring_fill_color")}
                      onChange={(e) => update({ ring_fill_color: e.target.value })}
                      className="h-7 w-10 rounded cursor-pointer border border-nexus-border bg-[#19191D] p-0.5"
                    />
                    <span className="text-xs text-nexus-text-muted">{get("ring_fill_color")}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {!selectedRadar && radarAssets.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-nexus-text-muted">
            暂无雷达资产，请等待数据接入
          </div>
        )}
      </div>
    </DraggableModal>
  );
}
