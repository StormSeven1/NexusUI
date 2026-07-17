"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

type SplitAxis = "horizontal" | "vertical";

type UseDragSplitOptions = {
  enabled: boolean;
  axis: SplitAxis;
  containerRef: RefObject<HTMLElement | null>;
  /** 返回 0–1，表示 leading 区域占比 */
  onRatio: (ratio: number) => void;
};

/** 在容器边缘拖拽以调整 leading/trailing 区域比例 */
export function useDragSplit({ enabled, axis, containerRef, onRatio }: UseDragSplitOptions) {
  const [dragging, setDragging] = useState(false);

  const startDrag = useCallback(() => {
    if (enabled) setDragging(true);
  }, [enabled]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (axis === "horizontal") {
        if (rect.width <= 0) return;
        onRatio((e.clientX - rect.left) / rect.width);
      } else {
        if (rect.height <= 0) return;
        onRatio((e.clientY - rect.top) / rect.height);
      }
    };
    const onUp = () => setDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [axis, containerRef, dragging, onRatio]);

  return { dragging, startDrag };
}
