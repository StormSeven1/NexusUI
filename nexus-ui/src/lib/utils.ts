import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 根级 `visibility` 与设备单项的布尔合并：**设备上显式 `true`/`false` 始终优先**；
 * 设备未写时采用根级；根级也未定义时与历史一致（`!== false` 视为显示）。
 */
export function mergeRootAndDeviceVisible(
  rootExplicit: boolean | undefined,
  deviceValue: unknown,
): boolean {
  if (typeof deviceValue === "boolean") return deviceValue;
  if (typeof rootExplicit === "boolean") return rootExplicit;
  return deviceValue !== false;
}
