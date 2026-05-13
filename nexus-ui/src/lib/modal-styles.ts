/**
 * 统一弹窗样式系统
 */

export const MODAL_SPACING = {
  main:  "space-y-2.5",
  group: "space-y-1.5",
} as const;

export const MODAL_TEXT = {
  sectionTitle: "text-xs font-bold text-nexus-text-muted/70 pl-1",
  label:   "text-xs font-normal text-nexus-text-secondary pl-1",
  option:  "text-xs font-normal text-nexus-text-primary",
  body:    "text-xs font-normal text-nexus-text-secondary",
} as const;

export const MODAL_ICONS = {
  medium: "size-[14px]",
  small:  "size-[12px]",
  withIconContainer: "flex items-center gap-2 pl-1",
} as const;

export const MODAL_INPUTS = {
  base: "w-full rounded-md border border-nexus-border bg-[#19191D] px-3 py-2 text-xs text-nexus-text-primary focus:border-nexus-border-accent focus:outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
  selectTrigger: "flex w-full items-center justify-between rounded-md border border-nexus-border bg-[#19191D] px-3 py-2 text-left text-xs text-nexus-text-primary hover:border-nexus-border-accent focus:border-nexus-border-accent focus:outline-none transition-colors",
  dropdownMenu: "absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-nexus-border shadow-lg",
  dropdownItem: "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-nexus-accent/10 text-nexus-text-secondary",
  dropdownItemSelected: "bg-nexus-accent/20 text-nexus-text-primary",
} as const;

export const MODAL_BUTTONS = {
  primary:   "rounded-md px-3 py-1.5 text-xs font-medium bg-nexus-accent text-white hover:bg-nexus-accent/80 transition-colors",
  secondary: "rounded-md px-3 py-1.5 text-xs font-medium text-nexus-text-secondary hover:bg-nexus-bg-hover hover:text-nexus-text-primary transition-colors",
  auxiliary: "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-nexus-text-secondary hover:bg-nexus-bg-hover hover:text-nexus-text-primary transition-colors",
  disabled:  "bg-nexus-text-muted cursor-not-allowed",
  iconButton: "rounded p-1 transition-colors",
} as const;

export const MODAL_TOGGLES = {
  container:     "flex items-center justify-between",
  leftContainer: "flex items-center gap-2 pl-1",
  icon:          "text-nexus-text-muted shrink-0",
  buttonEnabled:  "rounded p-1 transition-colors bg-nexus-accent/20 text-nexus-accent",
  buttonDisabled: "rounded p-1 transition-colors bg-nexus-bg-hover text-nexus-text-muted",
} as const;

export const MODAL_FOOTER = {
  container:  "flex items-center justify-between",
  rightGroup: "flex gap-1.5",
} as const;

export const MODAL_CARD = {
  container: "rounded-lg px-3 py-4 min-w-[180px] max-w-[280px]",
  containerStyle: {
    background: "linear-gradient(241deg, #2E2E3A 2%, #2A2A2E 60%)",
  } as const,
  header:    "mb-2 flex items-center gap-2 pl-1.5",
  title:     "text-sm font-semibold text-nexus-text-primary",
  count:     "text-[10px] text-nexus-text-muted",
  content:   "space-y-0",
  item:      "flex items-center gap-2 rounded px-2 py-0.5 hover:bg-[#4B9EFF]/20 transition-colors",
  itemLabel: "text-xs text-nexus-text-secondary flex-1 truncate",
  itemValue: "text-[10px] text-nexus-text-muted tabular-nums",
  itemTimeNormal:  "text-xs font-mono font-semibold tabular-nums text-emerald-400",
  itemTimeTimeout: "text-xs font-mono font-semibold tabular-nums text-red-400",
} as const;

export const MODAL_GRID = {
  twoColumns: "grid grid-cols-2 gap-3",
  autoFit:    "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3",
} as const;

export const MODAL_STYLES = {
  spacing: MODAL_SPACING,
  text:    MODAL_TEXT,
  icons:   MODAL_ICONS,
  inputs:  MODAL_INPUTS,
  buttons: MODAL_BUTTONS,
  toggles: MODAL_TOGGLES,
  footer:  MODAL_FOOTER,
  card:    MODAL_CARD,
  grid:    MODAL_GRID,
} as const;
