"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { captureStackedCanvasesToPngBlob } from "@/lib/eo-video/eoVideoCapture";
import { getVideoContentRect } from "@/lib/eo-video/videoContentRect";
import { cn } from "@/lib/utils";

/** 与 C++ `HsDetectionBox` / `BinaryRect` 一致：图像像素坐标系下的矩形 */
export type EoHighSpeedBox = { x: number; y: number; w: number; h: number };

export interface EoHighSpeedYuvStackProps {
  className?: string;
  /** 视频帧宽度（与 YUV 布局一致）；UDP 未接入时仍用于 letterbox 与框映射 */
  videoWidth: number;
  videoHeight: number;
  /** Y 平面行字节数，默认等于 `videoWidth` */
  strideY?: number;
  /**
   * 紧凑 I420：Y 区 `strideY * videoHeight`，再 U、V 各 `(strideY/2)*(videoHeight/2)`。
   * `null` 表示无帧（占位）。
   */
  yuv420: Uint8Array | null;
  /** 图像坐标系检测框；线宽 2px 绿色，与 `OpenGLWidget::DrawSysTag` 语义一致 */
  boxes: EoHighSpeedBox[];
  /**
   * 广角母相机：子机在全景画面中的观测矩形（与 `boxes` 同像素坐标系；琥珀色虚线，来自 UDP 0x1001 JSON 等）。
   */
  fovOverlayBoxes?: EoHighSpeedBox[];
  /** 无帧时在角落显示的说明 */
  placeholderHint?: string;
}

export type EoHighSpeedYuvStackHandle = {
  /** 合成 WebGL + 检测框层 → PNG */
  captureToPng: () => Promise<Blob>;
  /** 录制用：WebGL 画布（`canvas.captureStream`） */
  getRecordCanvas: () => HTMLCanvasElement | null;
  /**
   * WebSocket 高频帧：直接写入 GPU，不经 React setState（避免 5fps+ 被压成每秒数次重绘）。
   * 会拷贝 `yuv420` 到内部缓冲（上一帧可被覆盖）。
   */
  applyLiveFrame: (p: {
    yuv420: Uint8Array;
    videoWidth: number;
    videoHeight: number;
    strideY: number;
    boxes: EoHighSpeedBox[];
  }) => void;
  /**
   * 切换相机时调用：清除上一路的帧缓存并将 `livePresent` 归零，
   * 使占位提示（「等待 UDP 帧」）重新可见，避免黑屏且无任何提示。
   */
  clearLiveFrame: () => void;
};

export type EoHighSpeedLiveFrame = Parameters<EoHighSpeedYuvStackHandle["applyLiveFrame"]>[0];

const VS = `#version 300 es
in vec2 a_pos;
void main() {
  vec2 ndc = a_pos * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_texY;
uniform sampler2D u_texU;
uniform sampler2D u_texV;
uniform vec2 u_resolution;
uniform vec4 u_content;
uniform vec2 u_videoSize;
uniform float u_strideY;

out vec4 oColor;

vec2 canvasPixTL() {
  return vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
}

void main() {
  vec2 pix = canvasPixTL();
  vec2 origin = u_content.xy;
  vec2 csize = u_content.zw;
  if (pix.x < origin.x || pix.y < origin.y || pix.x > origin.x + csize.x || pix.y > origin.y + csize.y) {
    oColor = vec4(0.06, 0.06, 0.07, 1.0);
    return;
  }
  vec2 rel = (pix - origin) / csize;
  vec2 vid = vec2(rel.x * u_videoSize.x, rel.y * u_videoSize.y);
  float sx = max(u_strideY, 1.0);
  float sy = max(u_videoSize.y, 1.0);
  vec2 uvY = vec2((vid.x + 0.5) / sx, (vid.y + 0.5) / sy);
  vec2 uvC = vec2((vid.x * 0.5 + 0.5) / (sx * 0.5), (vid.y * 0.5 + 0.5) / (sy * 0.5));
  float Y = texture(u_texY, uvY).r;
  float U = texture(u_texU, uvC).r - 0.5;
  float V = texture(u_texV, uvC).r - 0.5;
  float R = Y + 1.402 * V;
  float G = Y - 0.344136 * U - 0.714136 * V;
  float B = Y + 1.772 * U;
  oColor = vec4(clamp(vec3(R, G, B), 0.0, 1.0), 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function createR8Texture(gl: WebGL2RenderingContext): WebGLTexture | null {
  const t = gl.createTexture();
  if (!t) return null;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return t;
}

function uploadR8(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  w: number,
  h: number,
  data: ArrayBufferView,
): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function drawPlaceholder(gl: WebGL2RenderingContext, w: number, h: number): void {
  gl.viewport(0, 0, w, h);
  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0.07, 0.07, 0.08, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

export const EoHighSpeedYuvStack = forwardRef<EoHighSpeedYuvStackHandle, EoHighSpeedYuvStackProps>(function EoHighSpeedYuvStack(
  {
    className,
    videoWidth,
    videoHeight,
    strideY: strideYProp,
    yuv420,
    boxes,
    fovOverlayBoxes = [],
    placeholderHint = "UDP 帧源接入后显示 YUV（当前为占位）",
  },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const olRef = useRef<HTMLCanvasElement>(null);
  /** `applyLiveFrame` 写入；优先于 props 的 `yuv420` / `boxes` 参与绘制 */
  const liveFrameRef = useRef<{
    yuv420: Uint8Array;
    videoWidth: number;
    videoHeight: number;
    strideY: number;
    boxes: EoHighSpeedBox[];
  } | null>(null);
  const liveCopyRef = useRef<Uint8Array | null>(null);
  const livePresentRef = useRef(false);
  const [livePresent, setLivePresent] = useState(false);
  const progRef = useRef<WebGLProgram | null>(null);
  const texYRef = useRef<WebGLTexture | null>(null);
  const texURef = useRef<WebGLTexture | null>(null);
  const texVRef = useRef<WebGLTexture | null>(null);
  const glCtxRef = useRef<WebGL2RenderingContext | null>(null);
  const vboRef = useRef<WebGLBuffer | null>(null);
  const locRef = useRef<{
    a_pos: GLint;
    u_resolution: WebGLUniformLocation | null;
    u_content: WebGLUniformLocation | null;
    u_videoSize: WebGLUniformLocation | null;
    u_strideY: WebGLUniformLocation | null;
    u_texY: WebGLUniformLocation | null;
    u_texU: WebGLUniformLocation | null;
    u_texV: WebGLUniformLocation | null;
  } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      captureToPng: async () => {
        const gl = glRef.current;
        const ol = olRef.current;
        if (!gl) throw new Error("画布不可用");
        return captureStackedCanvasesToPngBlob(gl, ol);
      },
      getRecordCanvas: () => glRef.current,
      applyLiveFrame: (f) => {
        let buf = liveCopyRef.current;
        if (!buf || buf.byteLength !== f.yuv420.byteLength) {
          buf = new Uint8Array(f.yuv420.byteLength);
          liveCopyRef.current = buf;
        }
        buf.set(f.yuv420);
        liveFrameRef.current = {
          yuv420: buf,
          videoWidth: f.videoWidth,
          videoHeight: f.videoHeight,
          strideY: f.strideY,
          boxes: f.boxes,
        };
        if (!livePresentRef.current) {
          livePresentRef.current = true;
          setLivePresent(true);
        }
        paintWebGLRef.current?.();
      },
      clearLiveFrame: () => {
        liveFrameRef.current = null;
        liveCopyRef.current = null;
        if (livePresentRef.current) {
          livePresentRef.current = false;
          setLivePresent(false);
        }
        paintWebGLRef.current?.();
      },
    }),
    [],
  );

  const paintOverlay = useCallback(
    (detectionBoxes: EoHighSpeedBox[], wideFovBoxes: EoHighSpeedBox[], vw: number, vh: number) => {
      const wrap = wrapRef.current;
      const ol = olRef.current;
      if (!wrap || !ol) return;
      const w = ol.width;
      const h = ol.height;
      const ctx = ol.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      if (!detectionBoxes.length && !wideFovBoxes.length) return;
      const content = getVideoContentRect(w, h, vw, vh, "contain");
      const sx = content.w / vw;
      const sy = content.h / vh;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeStyle = "#00ff00";
      for (const b of detectionBoxes) {
        if (b.w <= 0 || b.h <= 0) continue;
        const x0 = content.x + b.x * sx;
        const y0 = content.y + b.y * sy;
        const bw = b.w * sx;
        const bh = b.h * sy;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw, bh);
      }
      if (wideFovBoxes.length) {
        ctx.strokeStyle = "#fbbf24";
        ctx.setLineDash([5, 4]);
        for (const b of wideFovBoxes) {
          if (b.w <= 0 || b.h <= 0) continue;
          const x0 = content.x + b.x * sx;
          const y0 = content.y + b.y * sy;
          const bw = b.w * sx;
          const bh = b.h * sy;
          ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw, bh);
        }
        ctx.setLineDash([]);
      }
    },
    [],
  );

  const paintWebGLRef = useRef<() => void>(() => {});

  const paintWebGL = useCallback(() => {
    const live = liveFrameRef.current;
    const detectionBoxes = live?.boxes ?? boxes;
    const wideFov = fovOverlayBoxes;
    const vw = Math.max(1, Math.floor(live?.videoWidth ?? videoWidth));
    const vh = Math.max(1, Math.floor(live?.videoHeight ?? videoHeight));
    const strideY = Math.max(vw, Math.floor(live?.strideY ?? strideYProp ?? vw));
    const frameYuv = live?.yuv420 ?? yuv420;

    const wrap = wrapRef.current;
    const canvas = glRef.current;
    if (!wrap || !canvas) {
      paintOverlay(detectionBoxes, wideFov, vw, vh);
      return;
    }
    let gl = glCtxRef.current;
    if (!gl) {
      gl = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "high-performance" });
      if (!gl) {
        paintOverlay(detectionBoxes, wideFov, vw, vh);
        return;
      }
      glCtxRef.current = gl;
    }

    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW <= 0 || cssH <= 0) {
      paintOverlay(detectionBoxes, wideFov, vw, vh);
      return;
    }
    const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const bufW = Math.max(1, Math.floor(cssW * dpr));
    const bufH = Math.max(1, Math.floor(cssH * dpr));
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }
    const ol = olRef.current;
    if (ol && (ol.width !== bufW || ol.height !== bufH)) {
      ol.width = bufW;
      ol.height = bufH;
    }

    if (!progRef.current) {
      const prog = createProgram(gl);
      if (!prog) {
        drawPlaceholder(gl, bufW, bufH);
        paintOverlay(detectionBoxes, wideFov, vw, vh);
        return;
      }
      progRef.current = prog;
      texYRef.current = createR8Texture(gl);
      texURef.current = createR8Texture(gl);
      texVRef.current = createR8Texture(gl);
      locRef.current = {
        a_pos: gl.getAttribLocation(prog, "a_pos"),
        u_resolution: gl.getUniformLocation(prog, "u_resolution"),
        u_content: gl.getUniformLocation(prog, "u_content"),
        u_videoSize: gl.getUniformLocation(prog, "u_videoSize"),
        u_strideY: gl.getUniformLocation(prog, "u_strideY"),
        u_texY: gl.getUniformLocation(prog, "u_texY"),
        u_texU: gl.getUniformLocation(prog, "u_texU"),
        u_texV: gl.getUniformLocation(prog, "u_texV"),
      };
      if (!vboRef.current) {
        const b = gl.createBuffer();
        if (b) {
          vboRef.current = b;
          const quad = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
          gl.bindBuffer(gl.ARRAY_BUFFER, b);
          gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
        }
      }
    }

    const prog = progRef.current;
    const texY = texYRef.current;
    const texU = texURef.current;
    const texV = texVRef.current;
    const loc = locRef.current;
    if (!prog || !texY || !texU || !texV || !loc) {
      drawPlaceholder(gl, bufW, bufH);
      paintOverlay(detectionBoxes, wideFov, vw, vh);
      return;
    }

    gl.viewport(0, 0, bufW, bufH);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    if (!frameYuv) {
      drawPlaceholder(gl, bufW, bufH);
      paintOverlay(detectionBoxes, wideFov, vw, vh);
      return;
    }

    const ySize = strideY * vh;
    const uvW = Math.floor(strideY / 2);
    const uvH = Math.floor(vh / 2);
    const uvSize = uvW * uvH;
    const need = ySize + uvSize * 2;
    if (frameYuv.byteLength < need) {
      drawPlaceholder(gl, bufW, bufH);
      paintOverlay(detectionBoxes, wideFov, vw, vh);
      return;
    }

    const yView = frameYuv.subarray(0, ySize);
    const uView = frameYuv.subarray(ySize, ySize + uvSize);
    const vView = frameYuv.subarray(ySize + uvSize, ySize + uvSize * 2);

    uploadR8(gl, texY, strideY, vh, yView);
    uploadR8(gl, texU, uvW, uvH, uView);
    uploadR8(gl, texV, uvW, uvH, vView);

    const content = getVideoContentRect(bufW, bufH, vw, vh, "contain");

    gl.useProgram(prog);
    gl.uniform2f(loc.u_resolution, bufW, bufH);
    gl.uniform4f(loc.u_content, content.x, content.y, content.w, content.h);
    gl.uniform2f(loc.u_videoSize, vw, vh);
    gl.uniform1f(loc.u_strideY, strideY);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texY);
    gl.uniform1i(loc.u_texY, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texU);
    gl.uniform1i(loc.u_texU, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texV);
    gl.uniform1i(loc.u_texV, 2);

    const vbo = vboRef.current;
    if (!vbo) {
      drawPlaceholder(gl, bufW, bufH);
      paintOverlay(detectionBoxes, wideFov, vw, vh);
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    if (loc.a_pos < 0) {
      drawPlaceholder(gl, bufW, bufH);
      paintOverlay(detectionBoxes, wideFov, vw, vh);
      return;
    }
    gl.enableVertexAttribArray(loc.a_pos);
    gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);

    paintOverlay(detectionBoxes, wideFov, vw, vh);
  }, [paintOverlay, strideYProp, videoHeight, videoWidth, yuv420, boxes, fovOverlayBoxes]);

  useEffect(() => {
    paintWebGLRef.current = paintWebGL;
  }, [paintWebGL]);

  useEffect(() => {
    paintWebGL();
  }, [paintWebGL]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      paintWebGLRef.current?.();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      const gl = glCtxRef.current;
      if (!gl) return;
      if (vboRef.current) {
        gl.deleteBuffer(vboRef.current);
        vboRef.current = null;
      }
      if (texYRef.current) gl.deleteTexture(texYRef.current);
      if (texURef.current) gl.deleteTexture(texURef.current);
      if (texVRef.current) gl.deleteTexture(texVRef.current);
      if (progRef.current) gl.deleteProgram(progRef.current);
      texYRef.current = null;
      texURef.current = null;
      texVRef.current = null;
      progRef.current = null;
      locRef.current = null;
      glCtxRef.current = null;
    };
  }, []);

  return (
    <div ref={wrapRef} className={cn("relative h-full w-full min-h-0 bg-black", className)}>
      <canvas ref={glRef} className="absolute inset-0 block h-full w-full" aria-hidden />
      <canvas ref={olRef} className="pointer-events-none absolute inset-0 block h-full w-full" aria-hidden />
      {!yuv420 && !livePresent ? (
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[min(100%,22rem)] rounded bg-black/55 px-2 py-1.5 text-[10px] leading-snug text-white/75">
          {placeholderHint}
        </div>
      ) : null}
    </div>
  );
});

EoHighSpeedYuvStack.displayName = "EoHighSpeedYuvStack";
