"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  EMPTY_CAMERA_PID,
  fetchEoPid,
  postEoPidUpdate,
  type CameraPidParams,
} from "@/lib/eo-video/eoPidClient";
import { toast } from "sonner";

export type EoPidSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  entityId: string;
  backendBaseUrl?: string;
  cameraName?: string;
  onClientLog?: (line: string) => void;
};

type PidFieldKey = keyof CameraPidParams;

/** 对齐 WatchSys_Widget：三列 = 对海 / 对空 / 近距(低速) */
const PID_COLUMNS: { title: string; keys: { label: string; key: PidFieldKey }[] }[] = [
  {
    title: "对海",
    keys: [
      { label: "KPX", key: "px" },
      { label: "KIX", key: "ix" },
      { label: "KDX", key: "dx" },
      { label: "KPY", key: "py" },
      { label: "KIY", key: "iy" },
      { label: "KDY", key: "dy" },
    ],
  },
  {
    title: "对空",
    keys: [
      { label: "KPX1", key: "px1" },
      { label: "KIX1", key: "ix1" },
      { label: "KDX1", key: "dx1" },
      { label: "KPY1", key: "py1" },
      { label: "KIY1", key: "iy1" },
      { label: "KDY1", key: "dy1" },
    ],
  },
  {
    title: "近距",
    keys: [
      { label: "KPX2", key: "px2" },
      { label: "KIX2", key: "ix2" },
      { label: "KDX2", key: "dx2" },
      { label: "KPY2", key: "py2" },
      { label: "KIY2", key: "iy2" },
      { label: "KDY2", key: "dy2" },
    ],
  },
];

function formatPidValue(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // 去掉多余尾零，便于对照 Widget 显示
  return String(Number(n.toPrecision(8)));
}

/** 光电窗 PID 参数：打开时从 camServer 读取，保存走 PIDUpdate 热加载 */
export function EoPidSettingsDialog({
  open,
  onClose,
  entityId,
  backendBaseUrl,
  cameraName,
  onClientLog,
}: EoPidSettingsDialogProps) {
  const [pid, setPid] = useState<CameraPidParams>(EMPTY_CAMERA_PID);
  const [draft, setDraft] = useState<Record<PidFieldKey, string>>(() => {
    const d = {} as Record<PidFieldKey, string>;
    for (const k of Object.keys(EMPTY_CAMERA_PID) as PidFieldKey[]) {
      d[k] = formatPidValue(EMPTY_CAMERA_PID[k]);
    }
    return d;
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const syncDraftFromPid = useCallback((next: CameraPidParams) => {
    const d = {} as Record<PidFieldKey, string>;
    for (const k of Object.keys(next) as PidFieldKey[]) {
      d[k] = formatPidValue(next[k]);
    }
    setDraft(d);
  }, []);

  const log = useCallback(
    (line: string) => onClientLog?.(`${new Date().toLocaleTimeString()} ${line}`),
    [onClientLog],
  );

  const loadPid = useCallback(async () => {
    const id = entityId.trim();
    if (!id) {
      setLoadError("无相机 entityId");
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const { res, data } = await fetchEoPid({ entityId: id, backendBaseUrl });
      if (res.ok && data.ok && data.pid) {
        setPid(data.pid);
        syncDraftFromPid(data.pid);
        log(`已读取 PID（${id}）`);
      } else {
        const msg = data.detail ?? data.error ?? `HTTP ${res.status}`;
        setLoadError(msg);
        toast.error("读取 PID 失败", { description: msg.slice(0, 240) });
        log(`读取 PID 失败：${msg}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      toast.error("读取 PID 异常", { description: msg });
      log(`读取 PID 异常：${msg}`);
    } finally {
      setLoading(false);
    }
  }, [backendBaseUrl, entityId, log, syncDraftFromPid]);

  useEffect(() => {
    if (!open) return;
    void loadPid();
  }, [open, loadPid]);

  const setField = (key: PidFieldKey, raw: string) => {
    setDraft((prev) => ({ ...prev, [key]: raw }));
    const n = Number(raw);
    if (Number.isFinite(n)) {
      setPid((prev) => ({ ...prev, [key]: n }));
    }
  };

  const applyToCamServer = async () => {
    const id = entityId.trim();
    if (!id || saving) return;
    // 提交前再解析一次 draft，避免未失焦的非法输入残留
    const next = { ...pid };
    for (const k of Object.keys(draft) as PidFieldKey[]) {
      const n = Number(draft[k]);
      next[k] = Number.isFinite(n) ? n : 0;
    }
    setPid(next);
    setSaving(true);
    try {
      const { res, data } = await postEoPidUpdate({
        entityId: id,
        pid: next,
        backendBaseUrl,
      });
      const ok = res.ok && data.ok !== false;
      if (ok) {
        toast.success("PID 已写入 camServer（热加载）", {
          description: `${id} · ConfigPID.ini + SetPID`,
        });
        log(`更新 PID 成功：${id}`);
      } else {
        const msg =
          data.detail ?? data.error ?? data.message ?? `HTTP ${res.status}`;
        toast.error("更新 PID 失败", { description: String(msg).slice(0, 240) });
        log(`更新 PID 失败：${msg}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("更新 PID 异常", { description: msg });
      log(`更新 PID 异常：${msg}`);
    } finally {
      setSaving(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  const titleName = cameraName?.trim() || entityId;

  const panel = (
    <div
      className="pointer-events-auto fixed inset-0 z-[20000] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eo-pid-settings-title"
    >
      <div className="w-full max-w-[720px] rounded-lg border border-white/10 bg-[#1a1f26] text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <h2 id="eo-pid-settings-title" className="text-sm font-medium">
              PID 参数设置
            </h2>
            <p className="mt-0.5 text-[11px] text-white/55">
              {titleName}
              {cameraName?.trim() ? ` · ${entityId}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 text-sm">
          {loadError ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
              {loadError}
              <span className="mt-1 block text-white/50">
                若 camServer 尚未包含 GET /api/v1/pid，请重新编译并重启后再试。
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {PID_COLUMNS.map((col) => (
              <div
                key={col.title}
                className="rounded-md border border-white/10 bg-black/25 p-2.5"
              >
                <div className="mb-2 text-center text-xs font-medium text-sky-200/90">
                  {col.title}
                </div>
                <div className="space-y-1.5">
                  {col.keys.map((row) => (
                    <label
                      key={row.key}
                      className="grid grid-cols-[52px_1fr] items-center gap-2"
                    >
                      <span className="font-mono text-[11px] text-white/65">{row.label}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={loading || saving}
                        value={draft[row.key] ?? ""}
                        onChange={(e) => setField(row.key, e.target.value)}
                        className={cn(
                          "h-8 rounded border border-white/15 bg-black/40 px-2 font-mono text-[12px] text-white/90",
                          "focus:border-sky-500/50 focus:outline-none disabled:opacity-50",
                        )}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || saving}
              onClick={() => void loadPid()}
            >
              {loading ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="mr-1.5 size-3.5" aria-hidden />
              )}
              从 camServer 刷新
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={loading || saving || !entityId.trim()}
              onClick={() => void applyToCamServer()}
            >
              {saving ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
              ) : null}
              应用到 camServer
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
