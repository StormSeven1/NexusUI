/**
 * 浏览器内截图 / 录屏。
 * - 文件名可带用户在设置里填的“路径”前缀（非法字符会替换为下划线）。
 * - 若提供 FileSystemDirectoryHandle（用户已选本机文件夹），则直接写入该目录；否则触发下载。
 */

function slugForFilename(s: string, fallback: string): string {
  const t = s.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 80);
  return t || fallback;
}

export function buildEoCaptureFilename(opts: {
  /** 用户在设置里填的“保存路径”（用作文件名前缀） */
  configuredPath: string;
  /** 流名称，便于区分多路 */
  streamLabel?: string;
  kind: "snapshot" | "record";
  ext: string;
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawPath = opts.configuredPath?.trim() ?? "";
  const pathPrefix = rawPath ? slugForFilename(rawPath, "path") : "";
  const label = slugForFilename(opts.streamLabel ?? "", "stream");
  const mid = pathPrefix ? `${pathPrefix}_${label}` : label;
  return `${mid}_${opts.kind}_${stamp}.${opts.ext}`;
}

export function pickWebmMimeType(): string | undefined {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}

/** 优先 MP4（H.264），否则 WebM；返回的 mimeType 用于 MediaRecorder，ext 用于文件名 */
export function pickRecordMimeAndExtension(): { mimeType?: string; ext: "mp4" | "webm" } {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return { ext: "webm" };
  }
  const mp4Candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=avc3.42E01E",
    "video/mp4;codecs=avc1.640028",
    "video/mp4;codecs=avc1.4D401E",
    "video/mp4;codecs=h264",
    "video/mp4",
  ];
  for (const c of mp4Candidates) {
    if (MediaRecorder.isTypeSupported(c)) return { mimeType: c, ext: "mp4" };
  }
  return { mimeType: pickWebmMimeType(), ext: "webm" };
}

export function captureVideoToPngBlob(video: HTMLVideoElement): Promise<Blob> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return Promise.reject(new Error("视频尚未就绪，无法截图"));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas 不可用"));
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("截图编码失败"));
        else resolve(blob);
      },
      "image/png",
      0.95,
    );
  });
}

/**
 * 光电截图：优先从 `<video>` 取帧；WebCodecs 模式下面显示在 Canvas 上、video 无尺寸时改从 Canvas 取帧。
 */
export function captureEoPlaybackToPngBlob(
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
): Promise<Blob> {
  const vw = video?.videoWidth ?? 0;
  const vh = video?.videoHeight ?? 0;
  if (vw > 0 && vh > 0 && video) {
    return captureVideoToPngBlob(video);
  }
  const cw = canvas?.width ?? 0;
  const ch = canvas?.height ?? 0;
  if (cw > 0 && ch > 0 && canvas) {
    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    const ctx = out.getContext("2d");
    if (!ctx) return Promise.reject(new Error("Canvas 不可用"));
    ctx.drawImage(canvas, 0, 0);
    return new Promise((resolve, reject) => {
      out.toBlob(
        (blob) => {
          if (!blob) reject(new Error("截图编码失败"));
          else resolve(blob);
        },
        "image/png",
        0.95,
      );
    });
  }
  return Promise.reject(new Error("视频尚未就绪，无法截图"));
}

type DirectoryHandleWithPerm = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

/** 写入用户选定目录，失败或未选目录则走下载 */
export async function saveCaptureBlob(
  blob: Blob,
  fileName: string,
  directoryHandle: FileSystemDirectoryHandle | null | undefined,
): Promise<"directory" | "download"> {
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 200);
  if (directoryHandle && typeof directoryHandle.getFileHandle === "function") {
    try {
      const dh = directoryHandle as DirectoryHandleWithPerm;
      if (typeof dh.queryPermission === "function" && typeof dh.requestPermission === "function") {
        const q = await dh.queryPermission({ mode: "readwrite" });
        if (q !== "granted") {
          const r = await dh.requestPermission({ mode: "readwrite" });
          if (r !== "granted") throw new Error("未授予文件夹写入权限");
        }
      }
      const fh = await directoryHandle.getFileHandle(safeName, { create: true });
      const writable = await fh.createWritable();
      await writable.write(blob);
      await writable.close();
      return "directory";
    } catch {
      /* 回退下载 */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return "download";
}

export type EoVideoRecordController = {
  start: () => void;
  stop: () => void;
  isRecording: () => boolean;
};

export function createEoVideoRecorder(opts: {
  video: HTMLVideoElement;
  /** 完整文件名（含 .mp4 / .webm），应与容器格式一致 */
  fileName: string;
  mimeType?: string;
  onSaveBlob: (blob: Blob, fileName: string) => void | Promise<void>;
  onError?: (msg: string) => void;
  onStarted?: () => void;
  onStopped?: () => void;
}): EoVideoRecordController {
  const cap = (opts.video as HTMLVideoElement & { captureStream?: (frameRate?: number) => MediaStream }).captureStream;
  if (typeof cap !== "function") {
    opts.onError?.("当前浏览器不支持 video.captureStream，无法录屏");
    return {
      start: () => opts.onError?.("不支持录屏"),
      stop: () => {},
      isRecording: () => false,
    };
  }

  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let capturedStream: MediaStream | null = null;

  const stopInternal = () => {
    const r = recorder;
    if (!r || r.state === "inactive") return;
    try {
      r.stop();
    } catch {
      recorder = null;
    }
  };

  return {
    start: () => {
      if (recorder && recorder.state === "recording") return;
      if (!opts.video.videoWidth || !opts.video.videoHeight) {
        opts.onError?.("视频尚未就绪，无法开始录制");
        return;
      }
      chunks = [];
      let stream: MediaStream;
      try {
        stream = cap.call(opts.video, 30);
      } catch (e) {
        opts.onError?.(e instanceof Error ? e.message : String(e));
        return;
      }
      capturedStream = stream;
      const vTracks = stream.getVideoTracks();
      if (!vTracks.length) {
        opts.onError?.("未获取到视频轨道，无法录制");
        /* 勿对 captureStream 的轨道调用 stop()，否则 Chromium 上会导致 <video> 黑屏 */
        capturedStream = null;
        return;
      }
      try {
        recorder = new MediaRecorder(stream, opts.mimeType ? { mimeType: opts.mimeType } : undefined);
      } catch (e) {
        opts.onError?.(e instanceof Error ? e.message : String(e));
        capturedStream = null;
        return;
      }
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onerror = (ev) => {
        const err = (ev as { error?: DOMException }).error;
        opts.onError?.(err?.message || "MediaRecorder 错误");
        try {
          recorder?.stop();
        } catch {
          /* ignore */
        }
        recorder = null;
      };
      recorder.onstop = () => {
        const type = recorder?.mimeType || opts.mimeType || "video/webm";
        recorder = null;
        const blob = new Blob(chunks, { type });
        chunks = [];
        /* 勿 stop(captureStream) 的轨道：会断开与 video 的捕获链路，画面永久黑直到重载/重连 */
        capturedStream = null;
        void Promise.resolve(opts.onSaveBlob(blob, opts.fileName)).finally(() => {
          opts.onStopped?.();
        });
      };
      try {
        recorder.start(250);
        opts.onStarted?.();
      } catch (e) {
        opts.onError?.(e instanceof Error ? e.message : String(e));
        recorder = null;
        capturedStream = null;
      }
    },
    stop: () => {
      stopInternal();
    },
    isRecording: () => Boolean(recorder && recorder.state === "recording"),
  };
}
