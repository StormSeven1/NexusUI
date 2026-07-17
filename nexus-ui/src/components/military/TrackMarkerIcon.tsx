"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Track } from "@/lib/map-entity-model";
import {
  buildMarkerSymbolDataUrl,
  getFusionTrackMarkerFill,
  isAirTrackBirdGlyph,
  isSeaTrackBuoyGlyph,
  isSeaTrackReefGlyph,
} from "@/lib/map-icons";
import { getTrackRenderingConfig } from "@/lib/map-app-config";
import { resolveTrackLayerKey } from "@/lib/track-layer-visibility";
import { getTrackDispositionForRendering } from "@/stores/track-store";
import { isTrackVirtualTroop } from "@/lib/track-reality-type";
import { isTrackCoasting } from "@/lib/track-target-state";
import { shouldApplyVerifiedTrackYellow } from "@/lib/verified-track-color";
import { shouldApplySuspiciousTrackGreen } from "@/lib/track-map-highlight-color";

/** 与 GIS 左键标牌、地图军标同源：{@link buildMarkerSymbolDataUrl} */
export function useTrackMarkerSymbolUrl(track: Track | null | undefined): string | null {
  return useMemo(() => {
    if (!track) return null;
    const tr = getTrackRenderingConfig();
    const ts = tr.trackTypeStyles[track.type] ?? tr.trackTypeStyles.sea;
    const eff = getTrackDispositionForRendering(track);
    const friendlyFill = eff === "friendly" ? ts.idColor : undefined;
    const seaFuse = resolveTrackLayerKey(track) === "fuse_sea" && track.type === "sea";
    return buildMarkerSymbolDataUrl(
      track.type,
      eff,
      undefined,
      isTrackVirtualTroop(track),
      friendlyFill,
      eff === "neutral" ? getFusionTrackMarkerFill(track) : undefined,
      isAirTrackBirdGlyph(track),
      resolveTrackLayerKey(track) === "fuse_air" && isAirTrackBirdGlyph(track),
      shouldApplyVerifiedTrackYellow(track),
      seaFuse,
      seaFuse && isSeaTrackBuoyGlyph(track),
      seaFuse && isSeaTrackReefGlyph(track),
      shouldApplySuspiciousTrackGreen(track),
      isTrackCoasting(track),
    );
  }, [track]);
}

/** 航迹军标（与 TargetPlacard 左上角、地图符号一致） */
export function TrackMarkerIcon({
  track,
  size = 28,
  className,
}: {
  track: Track;
  size?: number;
  className?: string;
}) {
  const url = useTrackMarkerSymbolUrl(track);
  if (!url) {
    return (
      <span
        className={cn("shrink-0 rounded-md bg-white/5", className)}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 select-none", className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
