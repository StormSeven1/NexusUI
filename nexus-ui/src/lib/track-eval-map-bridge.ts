import type maplibregl from "maplibre-gl";
import {
  TrackEvalRegionDrawMaplibre,
  type TrackEvalRegionKind,
  type TrackEvalRegionResult,
} from "@/components/map/modules/track-eval-region-draw-maplibre";

export type TrackEvalMapHandlers = {
  startRegionDraw: (kind: "rect" | "polygon") => void;
  clearRegion: () => void;
  cancelRegionDraw: () => void;
};

let map: maplibregl.Map | null = null;
let drawer: TrackEvalRegionDrawMaplibre | null = null;
let onRegionComplete: ((r: TrackEvalRegionResult) => void) | null = null;
let onRegionCancel: (() => void) | null = null;

export function registerTrackEvalMap(
  m: maplibregl.Map | null,
  callbacks?: {
    onRegionComplete?: (r: TrackEvalRegionResult) => void;
    onRegionCancel?: () => void;
  },
) {
  map = m;
  onRegionComplete = callbacks?.onRegionComplete ?? null;
  onRegionCancel = callbacks?.onRegionCancel ?? null;
  if (!m) {
    drawer?.deactivate();
    drawer = null;
    return;
  }
  if (!drawer) {
    drawer = new TrackEvalRegionDrawMaplibre(m, {
      onComplete: (r) => onRegionComplete?.(r),
      onCancel: () => onRegionCancel?.(),
    });
    drawer.initLayers();
  }
}

export function getTrackEvalMapHandlers(): TrackEvalMapHandlers | null {
  if (!map || !drawer) return null;
  return {
    startRegionDraw(kind) {
      if (kind === "rect") drawer!.startRect();
      else drawer!.startPolygon();
    },
    clearRegion() {
      drawer?.deactivate();
      drawer?.clearDisplay();
    },
    cancelRegionDraw() {
      drawer?.deactivate();
      drawer?.clearDisplay();
    },
  };
}

export function getTrackEvalActiveDrawKind(): TrackEvalRegionKind {
  return "";
}
