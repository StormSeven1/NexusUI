export interface EoVideoIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface EoDetectionBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  classId?: number | null;
  colorToken?: "friendly" | "hostile" | "neutral" | "accent";
}

export interface EoRuntimeStream {
  id: string;
  label: string;
  entityId: string;
  sensorVideoUrl: string;
}
