"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

export interface NxInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  sizeVariant?: "sm" | "md";
}

export const NxInput = forwardRef<HTMLInputElement, NxInputProps>(
  ({ icon, sizeVariant = "sm", className, ...props }, ref) => (
    <div className="relative">
      {icon && (
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nexus-text-muted">
          {icon}
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          "w-full rounded-md border border-white/[0.06] bg-white/[0.03] text-nexus-text-primary placeholder:text-nexus-text-muted",
          "focus:border-white/[0.12] focus:outline-none focus:ring-1 focus:ring-white/[0.08]",
          "transition-colors",
          icon ? "pl-8" : "pl-3",
          "pr-3",
          sizeVariant === "sm" ? "h-7 text-[11px]" : "h-8 text-xs",
          className
        )}
        {...props}
      />
    </div>
  )
);

NxInput.displayName = "NxInput";

export function NxSearchInput(props: Omit<NxInputProps, "icon">) {
  return <NxInput icon={<Search size={12} />} {...props} />;
}
