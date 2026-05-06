/**
 * 将用户通过 showDirectoryPicker 选择的目录句柄持久化到 IndexedDB（Chrome / Edge 等）。
 * 刷新页面后仍可继续写入同一文件夹（需用户再次授权时由 requestPermission 处理）。
 */

const DB_NAME = "nexus-eo-capture";
const STORE = "kv";
const KEY_DIR_SNAPSHOT = "captureDir.snapshot";
const KEY_DIR_RECORD = "captureDir.record";

function keyByKind(kind: "snapshot" | "record"): string {
  return kind === "record" ? KEY_DIR_RECORD : KEY_DIR_SNAPSHOT;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB 不可用"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function loadCaptureDirHandle(kind: "snapshot" | "record" = "snapshot"): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(keyByKind(kind));
      r.onsuccess = () => resolve((r.result as FileSystemDirectoryHandle | undefined) ?? null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveCaptureDirHandle(
  handle: FileSystemDirectoryHandle,
  kind: "snapshot" | "record" = "snapshot",
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("save dir failed"));
    tx.objectStore(STORE).put(handle, keyByKind(kind));
  });
}

export async function clearCaptureDirHandle(kind?: "snapshot" | "record"): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("clear dir failed"));
      const store = tx.objectStore(STORE);
      if (kind) {
        store.delete(keyByKind(kind));
      } else {
        store.delete(KEY_DIR_SNAPSHOT);
        store.delete(KEY_DIR_RECORD);
      }
    });
  } catch {
    /* ignore */
  }
}

type WindowWithDirPicker = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
    id?: string;
    startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos" | FileSystemHandle;
  }) => Promise<FileSystemDirectoryHandle>;
};

function getWindowWithDirPicker(): WindowWithDirPicker | null {
  return typeof window !== "undefined" ? (window as WindowWithDirPicker) : null;
}

export function isShowDirectoryPickerSupported(): boolean {
  const w = getWindowWithDirPicker();
  return Boolean(w && typeof w.showDirectoryPicker === "function");
}

/** 需安全上下文（https 或 localhost）及 Chromium 系浏览器 */
export async function pickCaptureDirectoryHandle(
  kind: "snapshot" | "record" = "snapshot",
  startIn?: FileSystemHandle,
): Promise<FileSystemDirectoryHandle> {
  const w = getWindowWithDirPicker();
  const fn = w?.showDirectoryPicker;
  if (typeof fn !== "function") throw new Error("showDirectoryPicker 不可用");
  const startInDefault = kind === "record" ? "videos" : "pictures";
  const pickerId = kind === "record" ? "nexus-eo-capture-video" : "nexus-eo-capture-pic";
  return fn.call(w, { mode: "readwrite", id: pickerId, startIn: startIn ?? startInDefault });
}
