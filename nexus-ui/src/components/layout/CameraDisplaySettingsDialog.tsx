"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/asset-store";
import { Camera, Eye, EyeOff, Target, RefreshCw, ChevronDown } from "lucide-react";
import { DraggableModal } from "@/components/ui/DraggableModal";
import {
  MODAL_BUTTONS,
  MODAL_FOOTER,
  MODAL_SPACING,
  MODAL_TEXT,
  MODAL_INPUTS,
  MODAL_TOGGLES,
} from "@/lib/modal-styles";

interface CameraDisplaySettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 光电渲染属性键 → 默认值 */
const CAM_PROP_DEFAULTS = {
  fov_sector_visible:  true,
  center_name_visible: true,
  fov_fill_color:      "#9333ea",
  fov_fill_opacity:    0.15,
} as const;

type CamProps = typeof CAM_PROP_DEFAULTS;

function getCamProp<K extends keyof CamProps>(
  assetProps: Record<string, unknown> | null | undefined,
  overrides: Record<string, unknown> | undefined,
  key: K,
): CamProps[K] {
  if (overrides?.[key] !== undefined) return overrides[key] as CamProps[K];
  if (assetProps?.[key] !== undefined) return assetProps[key] as CamProps[K];
  return CAM_PROP_DEFAULTS[key];
}

export function CameraDisplaySettingsDialog({ open, onClose }: CameraDisplaySettingsDialogProps) {
  const assets = useAssetStore((s) => s.assets);
  const displayOverrides = useAssetStore((s) => s.displayOverrides);
  const setDisplayOverride = useAssetStore((s) => s.setDisplayOverride);
  const clearDisplayOverride = useAssetStore((s) => s.clearDisplayOverride);

  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const cameraAssets = assets.filter((a) => a.asset_type === "camera");

  useEffect(() => {
    if (open && cameraAssets.length > 0 && !selectedCameraId) {
      setSelectedCameraId(cameraAssets[0]!.id);
    }
  }, [open, cameraAssets.length, selectedCameraId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) setSelectedCameraId("");
  }, [open]);

  const selectedCamera = cameraAssets.find((c) => c.id === selectedCameraId);
  const assetProps = selectedCamera?.properties as Record<string, unknown> | null | undefined;
  const overrides = displayOverrides[selectedCameraId];

  const get = <K extends keyof CamProps>(key: K) =>
    getCamProp(assetProps, overrides, key);

  const update = (patch: Partial<Record<keyof CamProps, unknown>>) => {
    if (!selectedCameraId) return;
    setDisplayOverride(selectedCameraId, patch as Record<string, unknown>);
  };

  const handleReset = () => {
    if (!selectedCameraId) return;
    clearDisplayOverride(selectedCameraId);
  };

  const footer = (
    <>
      <button
        onClick={handleReset}
        disabled={!selectedCamera}
        className={cn(MODAL_BUTTONS.auxiliary, !selectedCamera && MODAL_BUTTONS.disabled)}
      >
        <RefreshCw size={12} />
        重置
      </button>
      <div className={MODAL_FOOTER.rightGroup}>
        <button onClick={onClose} className={MODAL_BUTTONS.secondary}>取消</button>
        <button
          onClick={onClose}
          disabled={!selectedCamera}
          className={cn(MODAL_BUTTONS.primary, !selectedCamera && MODAL_BUTTONS.disabled)}
        >
          确定
        </button>
      </div>
    </>
  );

  return (
    <DraggableModal open={open} onClose={onClose} title="光电显示设置" icon={Camera} size="medium" footer={footer}>
      <div className={MODAL_SPACING.main}>
        {/* 光电选择 */}
        <div className={MODAL_SPACING.group}>
          <label className={MODAL_TEXT.label}>选择光电</label>
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={MODAL_INPUTS.selectTrigger}
            >
              <span className="flex items-center gap-2 truncate">
                <Camera size={14} className="text-nexus-accent shrink-0" />
                {selectedCamera ? selectedCamera.name : "请选择光电"}
              </span>
              <ChevronDown
                size={14}
                className={cn("transition-transform duration-200 shrink-0", dropdownOpen && "rotate-180")}
              />
            </button>

            {dropdownOpen && (
              <div className={MODAL_INPUTS.dropdownMenu} style={{ backgroundColor: "#19191D" }}>
                {cameraAssets.map((cam) => (
                  <button
                    key={cam.id}
                    onClick={() => { setSelectedCameraId(cam.id); setDropdownOpen(false); }}
                    className={cn(
                      MODAL_INPUTS.dropdownItem,
                      selectedCameraId === cam.id && MODAL_INPUTS.dropdownItemSelected,
                    )}
                  >
                    <Camera size={12} className="shrink-0" />
                    <span className="truncate">{cam.name}</span>
                  </button>
                ))}
                {cameraAssets.length === 0 && (
                  <div className="px-3 py-2 text-xs text-nexus-text-muted">暂无光电资产</div>
                )}
              </div>
            )}
          </div>
        </div>

        {selectedCamera && (
          <>
            {/* 显示选项 */}
            <div className={MODAL_SPACING.group}>
              <h4 className={MODAL_TEXT.sectionTitle}>显示选项</h4>

              <label className={MODAL_TOGGLES.container}>
                <div className={MODAL_TOGGLES.leftContainer}>
                  <Target size={14} className={MODAL_TOGGLES.icon} />
                  <span className={MODAL_TEXT.option}>显示视场角扇区</span>
                </div>
                <button
                  onClick={() => update({ fov_sector_visible: !get("fov_sector_visible") })}
                  className={cn(
                    MODAL_BUTTONS.iconButton,
                    get("fov_sector_visible") ? MODAL_TOGGLES.buttonEnabled : MODAL_TOGGLES.buttonDisabled,
                  )}
                >
                  {get("fov_sector_visible") ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </label>

              <label className={MODAL_TOGGLES.container}>
                <div className={MODAL_TOGGLES.leftContainer}>
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
                  <label className={MODAL_TEXT.label}>FOV 填充透明度</label>
                  <input
                    type="number"
                    value={get("fov_fill_opacity")}
                    onChange={(e) => update({ fov_fill_opacity: Number(e.target.value) })}
                    className={MODAL_INPUTS.base}
                    min="0"
                    max="1"
                    step="0.05"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <label className={MODAL_TEXT.label}>FOV 填充颜色</label>
                  <div className="flex items-center gap-2 pl-1">
                    <input
                      type="color"
                      value={get("fov_fill_color")}
                      onChange={(e) => update({ fov_fill_color: e.target.value })}
                      className="h-7 w-10 rounded cursor-pointer border border-nexus-border bg-[#19191D] p-0.5"
                    />
                    <span className="text-xs text-nexus-text-muted">{get("fov_fill_color")}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {!selectedCamera && cameraAssets.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-nexus-text-muted">
            暂无光电资产，请等待数据接入
          </div>
        )}
      </div>
    </DraggableModal>
  );
}
