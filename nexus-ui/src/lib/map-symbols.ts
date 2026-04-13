import { FORCE_COLORS, type ForceDisposition } from "./colors.ts";
import type { Track } from "./mock-data.ts";

export type TrackType = Track["type"];

const ICON_PATHS: Record<TrackType, string> = {
  air: "M32 8 L37 21 L47 24 L37 27 L33 39 L38 51 L34 51 L32 43 L30 51 L26 51 L31 39 L27 27 L17 24 L27 21 Z",
  sea: "M13 35 L18 27 L46 27 L52 35 L48 41 L17 41 Z M22 24 L30 18 L37 18 L42 24 Z M29 14 L34 14 L34 18 L29 18 Z",
  underwater: "M18 20 L32 42 L46 20 L39 22 L32 34 L25 22 Z M29 13 L35 13 L35 20 L29 20 Z",
};

const SILHOUETTE_CLASS: Record<TrackType, string> = {
  air: "M32 5 L39 19 L52 23 L39 28 L35 40 L41 54 L35 54 L32 46 L29 54 L23 54 L29 40 L25 28 L12 23 L25 19 Z",
  sea: "M10 36 L17 25 L47 25 L55 36 L49 44 L15 44 Z M20 22 L30 15 L38 15 L45 22 Z",
  underwater: "M14 18 L32 46 L50 18 L41 20 L32 35 L23 20 Z",
};

export function getMarkerSymbolId(type: TrackType, disposition: ForceDisposition): string {
  return `track-${type}-${disposition}`;
}

function getMarkerColor(disposition: ForceDisposition): string {
  return FORCE_COLORS[disposition];
}

export function buildMarkerSymbolSvg(type: TrackType, disposition: ForceDisposition): string {
  const color = getMarkerColor(disposition);
  const silhouette = SILHOUETTE_CLASS[type];
  const icon = ICON_PATHS[type];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`,
    `<defs><filter id="glow"><feDropShadow dx="0" dy="0" stdDeviation="1.6" flood-color="${color}" flood-opacity="0.45"/></filter></defs>`,
    `<path d="${silhouette}" fill="rgba(9,9,11,0.9)" stroke="${color}" stroke-width="3" stroke-linejoin="round" filter="url(#glow)"/>`,
    `<path d="${icon}" fill="${color}" stroke="#09090b" stroke-width="1.6" stroke-linejoin="round"/>`,
    `</svg>`,
  ].join("");
}

export function buildMarkerSymbolDataUrl(type: TrackType, disposition: ForceDisposition): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildMarkerSymbolSvg(type, disposition))}`;
}

export function getAllMarkerSymbolKeys(): Array<{ id: string; type: TrackType; disposition: ForceDisposition }> {
  const types: TrackType[] = ["air", "sea", "underwater"];
  const dispositions: ForceDisposition[] = ["hostile", "friendly", "neutral"];

  return types.flatMap((type) =>
    dispositions.map((disposition) => ({
      id: getMarkerSymbolId(type, disposition),
      type,
      disposition,
    }))
  );
}
