"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type NxButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type NxButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<NxButtonVariant, string> = {
  primary:
    "border-white/[0.12] bg-white/[0.08] text-nexus-text-primary hover:bg-white/[0.12] active:bg-white/[0.15]",
  secondary:
    "border-white/[0.06] bg-white/[0.03] text-nexus-text-secondary hover:bg-white/[0.06] hover:text-nexus-text-primary active:bg-white/[0.08]",
  ghost:
    "border-transparent bg-transparent text-nexus-text-muted hover:bg-white/[0.04] hover:text-nexus-text-secondary active:bg-white/[0.06]",
  danger:
    "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/15 active:bg-red-500/20",
  outline:
    "border-white/[0.10] bg-transparent text-nexus-text-secondary hover:bg-white/[0.04] hover:text-nexus-text-primary active:bg-white/[0.06]",
};

const SIZE_CLASSES: Record<NxButtonSize, string> = {
  xs: "h-6 gap-1 px-1.5 text-[10px]",
  sm: "h-7 gap-1.5 px-2 text-[11px]",
  md: "h-8 gap-1.5 px-3 text-xs",
  lg: "h-9 gap-2 px-4 text-sm",
};

export interface NxButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: NxButtonVariant;
  size?: NxButtonSize;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const NxButton = forwardRef<HTMLButtonElement, NxButtonProps>(
  ({ variant = "secondary", size = "sm", icon, iconRight, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-md border font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  )
);

NxButton.displayName = "NxButton";

export interface NxIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: NxButtonVariant;
  size?: NxButtonSize;
}

export const NxIconButton = forwardRef<HTMLButtonElement, NxIconButtonProps>(
  ({ variant = "ghost", size = "sm", className, children, ...props }, ref) => {
    const iconSizes: Record<NxButtonSize, string> = {
      xs: "h-5 w-5",
      sm: "h-6 w-6",
      md: "h-7 w-7",
      lg: "h-8 w-8",
    };
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
          "disabled:pointer-events-none disabled:opacity-40",
          VARIANT_CLASSES[variant],
          "border-0 px-0",
          iconSizes[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

NxIconButton.displayName = "NxIconButton";
