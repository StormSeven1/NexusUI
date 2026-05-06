"use client";

import { cn } from "@/lib/utils";
import { PanelId } from "@/stores/dock-store";

interface DockIconProps {
  panelId: PanelId;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  isActive: boolean;
  isMinimized: boolean;
  hasNotification?: boolean;
  isHighlighted?: boolean; // 新增：是否高亮显示
  onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function DockIcon({
  icon: Icon,
  label,
  isActive,
  isMinimized,
  hasNotification = false,
  isHighlighted = false,
  onToggle,
  onContextMenu
}: DockIconProps) {
  return (
    <button
      data-dock-icon="true"
      onClick={onToggle}
      onContextMenu={onContextMenu}
      className={cn(
        "group relative flex h-9 w-9 items-center justify-center rounded-md transition-all duration-200",
        // 高亮状态：白色图标
        isHighlighted
          ? "bg-white/20 text-white"
          : isActive && !isMinimized
          ? "bg-nexus-accent-glow text-nexus-text-primary border border-nexus-border-accent"
          : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary"
      )}
      style={{
        backgroundColor: isHighlighted
          ? "rgba(255, 255, 255, 0.2)"
          : isActive && !isMinimized
          ? "rgba(34, 211, 238, 0.1)"
          : "transparent",
        border: isHighlighted
          ? "1px solid rgba(255, 255, 255, 0.5)"
          : isActive && !isMinimized
          ? "1px solid rgba(34, 211, 238, 0.5)"
          : "none"
      }}
      title={label}
    >
      <Icon size={18} />

      {/* 激活指示器 - 左侧青色条 */}
      {isActive && !isMinimized && (
        <span
          className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r"
          style={{ backgroundColor: "#22d3ee" }}
        />
      )}

      {/* 最小化指示器 - 右下角小圆点 */}
      {isMinimized && (
        <span
          className="absolute bottom-0 right-0 h-2 w-2 rounded-full"
          style={{ backgroundColor: "#22d3ee" }}
        />
      )}

      {/* 通知指示器 */}
      {hasNotification && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-nexus-text-inverse"
          style={{ backgroundColor: "#ef4444", color: "white" }}
        >
          !
        </span>
      )}
    </button>
  );
}
