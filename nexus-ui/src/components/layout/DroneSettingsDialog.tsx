"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DRONE_FLIGHT_HEIGHT_MAX,
  DRONE_FLIGHT_HEIGHT_MIN,
  DRONE_FLIGHT_SPEED_MAX,
  DRONE_FLIGHT_SPEED_MIN,
  clampDroneFlightHeight,
  clampDroneFlightSpeed,
} from "@/lib/drone-task-settings";
import { useDroneTaskSettingsStore } from "@/stores/drone-task-settings-store";
export type DroneSettingsPanelAnchor = { top: number; right: number };

interface Props {
  open: boolean;
  onClose: () => void;
  anchor?: DroneSettingsPanelAnchor | null;
}

function panelBtnClass(primary?: boolean) {
  return cn(
    "h-8 rounded-md border px-3 text-[11px] font-medium transition-colors",
    primary
      ? "border-nexus-accent/60 bg-nexus-accent/15 text-nexus-accent hover:bg-nexus-accent/25"
      : "border-nexus-border bg-nexus-bg-elevated text-nexus-text-secondary hover:border-nexus-accent/40 hover:text-nexus-text-primary",
  );
}

/**
 * 非模态浮动面板：不遮挡整页，地图与其它 UI 仍可操作。
 */
export function DroneSettingsDialog({ open, onClose, anchor }: Props) {
  const savedSpeed = useDroneTaskSettingsStore((s) => s.flightSpeed);
  const savedHeight = useDroneTaskSettingsStore((s) => s.flightHeight);
  const applySettings = useDroneTaskSettingsStore((s) => s.applySettings);

  const [speedInput, setSpeedInput] = useState(String(savedSpeed));
  const [heightInput, setHeightInput] = useState(String(savedHeight));
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setSpeedInput(String(savedSpeed));
    setHeightInput(String(savedHeight));
  }, [open, savedSpeed, savedHeight]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const pos = anchor ?? { top: 48, right: 12 };

  const onSave = () => {
    const speed = clampDroneFlightSpeed(speedInput);
    const height = clampDroneFlightHeight(heightInput);
    applySettings({ flightSpeed: speed, flightHeight: height });
    toast.success(`已保存：速度 ${speed} m/s，高度 ${height} m`);
    onClose();
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="无人机设置"
      className="fixed z-[600] w-[min(320px,calc(100vw-1.5rem))] rounded-lg border border-nexus-border bg-nexus-bg-elevated shadow-xl"
      style={{ top: pos.top, right: pos.right }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-nexus-border px-3 py-2.5">
        <div>
          <h2 className="text-xs font-semibold text-nexus-text-primary">无人机设置</h2>
          <p className="mt-0.5 text-[10px] text-nexus-text-muted">任务下发速度与高度</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-primary"
          aria-label="关闭"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3 px-3 py-3">
        <Field
          label="飞行速度"
          unit="m/s"
          hint={`${DRONE_FLIGHT_SPEED_MIN}–${DRONE_FLIGHT_SPEED_MAX}`}
          value={speedInput}
          onChange={setSpeedInput}
          min={DRONE_FLIGHT_SPEED_MIN}
          max={DRONE_FLIGHT_SPEED_MAX}
        />
        <Field
          label="飞行高度"
          unit="m"
          hint={`${DRONE_FLIGHT_HEIGHT_MIN}–${DRONE_FLIGHT_HEIGHT_MAX}`}
          value={heightInput}
          onChange={setHeightInput}
          min={DRONE_FLIGHT_HEIGHT_MIN}
          max={DRONE_FLIGHT_HEIGHT_MAX}
        />
        <p className="text-[10px] leading-relaxed text-nexus-text-muted">
          用于地图右键「无人机侦察 / 跟踪」等任务；关闭本面板后可继续操作地图。
        </p>
      </div>

      <div className="flex justify-end gap-1.5 border-t border-nexus-border px-3 py-2.5">
        <button type="button" onClick={onClose} className={panelBtnClass(false)}>
          取消
        </button>
        <button type="button" onClick={onSave} className={panelBtnClass(true)}>
          保存
        </button>
      </div>
    </div>,
    document.body,
  );
}

function Field(props: {
  label: string;
  unit: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
}) {
  const { label, unit, hint, value, onChange, min, max } = props;
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-nexus-text-primary">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-md border border-nexus-border bg-nexus-bg-elevated px-2.5 text-xs text-nexus-text-primary outline-none focus:border-nexus-accent focus:ring-1 focus:ring-nexus-accent/40"
      />
      <span className="text-[10px] text-nexus-text-muted">
        {hint} {unit}
      </span>
    </label>
  );
}
