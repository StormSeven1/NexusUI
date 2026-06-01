/**
 * 爆炸特效：2D 使用 public/img/boom.gif（MapLibre Marker），3D 使用 Cesium 粒子爆发。
 */

import maplibregl from "maplibre-gl";

const EXPLOSION_GIF = "/img/boom.gif";
const DURATION_MS = 1500;
/** 2D 爆炸 GIF 边长（像素）；boom.gif 光效在画面中心，与飞弹 anchor 对齐 */
const GIF_SIZE_PX = 60;

function publicAssetUrl(path: string): string {
  const base =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_PATH
      ? String(process.env.NEXT_PUBLIC_BASE_PATH).replace(/\/$/, "")
      : "";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

let map2d: maplibregl.Map | null = null;
const markers2d: maplibregl.Marker[] = [];

type CesiumViewer = import("cesium").Viewer;
let viewer3d: CesiumViewer | null = null;

export function registerExplosionMap2D(map: maplibregl.Map): void {
  map2d = map;
}

export function unregisterExplosionMap2D(): void {
  for (const m of markers2d) {
    try {
      m.remove();
    } catch {
      /* ignore */
    }
  }
  markers2d.length = 0;
  map2d = null;
}

export function registerExplosionViewer3D(viewer: CesiumViewer): void {
  viewer3d = viewer;
}

export function unregisterExplosionViewer3D(): void {
  viewer3d = null;
}

function buildExplosionGifElement(): { wrap: HTMLDivElement; img: HTMLImageElement } {
  const wrap = document.createElement("div");
  wrap.style.pointerEvents = "none";
  wrap.style.width = `${GIF_SIZE_PX}px`;
  wrap.style.height = `${GIF_SIZE_PX}px`;
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.justifyContent = "center";
  wrap.style.zIndex = "12";

  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
  img.style.userSelect = "none";
  wrap.appendChild(img);
  return { wrap, img };
}

function restartExplosionGif(img: HTMLImageElement): void {
  const url = publicAssetUrl(EXPLOSION_GIF);
  const bust = `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`;
  img.src = "";
  img.src = bust;
}

function playExplosion2D(lng: number, lat: number): void {
  const map = map2d;
  if (!map) return;

  const { wrap, img } = buildExplosionGifElement();
  restartExplosionGif(img);

  const marker = new maplibregl.Marker({ element: wrap, anchor: "center" })
    .setLngLat([lng, lat])
    .addTo(map);

  markers2d.push(marker);
  window.setTimeout(() => {
    try {
      marker.remove();
    } catch {
      /* ignore */
    }
    const idx = markers2d.indexOf(marker);
    if (idx >= 0) markers2d.splice(idx, 1);
  }, DURATION_MS);
}

async function playExplosion3D(lng: number, lat: number): Promise<void> {
  const viewer = viewer3d;
  if (!viewer || viewer.isDestroyed?.()) return;

  try {
    const Cesium = await import("cesium");
    const position = Cesium.Cartesian3.fromDegrees(lng, lat, 30);
    const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const gifUrl = publicAssetUrl(EXPLOSION_GIF);

    const particleSystem = viewer.scene.primitives.add(
      new Cesium.ParticleSystem({
        image: gifUrl,
        startColor: Cesium.Color.WHITE.withAlpha(1),
        endColor: Cesium.Color.ORANGE.withAlpha(0),
        startScale: 2.5,
        endScale: 14,
        minimumParticleLife: 0.4,
        maximumParticleLife: 1.2,
        minimumSpeed: 16,
        maximumSpeed: 36,
        imageSize: new Cesium.Cartesian2(80, 80),
        emissionRate: 0,
        bursts: [
          { time: 0.0, minimum: 80, maximum: 140 },
          { time: 0.15, minimum: 50, maximum: 90 },
          { time: 0.35, minimum: 30, maximum: 55 },
        ],
        lifetime: 2.2,
        emitter: new Cesium.SphereEmitter(18),
        modelMatrix,
      }),
    );

    window.setTimeout(() => {
      try {
        if (!viewer.isDestroyed()) {
          viewer.scene.primitives.remove(particleSystem);
        }
      } catch {
        /* ignore */
      }
    }, DURATION_MS + 400);
  } catch (e) {
    console.warn("[explosion-effect] 3D 粒子爆炸失败:", e);
  }
}

/** 在指定坐标播放爆炸（2D gif + 3D 粒子） */
export function playExplosionAt(lng: number, lat: number): void {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  playExplosion2D(lng, lat);
  void playExplosion3D(lng, lat);
}
