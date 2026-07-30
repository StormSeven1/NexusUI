"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useAppConfigStore } from "@/stores/app-config-store";
import {
  Map,
  ChevronDown,
  User,
  LogOut,
  CircleUser,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TopNavCategoryMenu } from "@/components/layout/TopNavCategoryMenu";
import { TopNavQuickActions } from "@/components/layout/TopNavQuickActions";
import { TopNavWeatherStrip } from "@/components/layout/TopNavWeatherStrip";
import { getHttpConfig } from "@/lib/map-app-config";
import { useAuth } from "@/components/auth/AuthProvider";
import { UserProfileDialog } from "@/components/auth/UserProfileDialog";

const WORK_MODE_STORAGE_KEY = "nexus-system-work-mode";

const WORK_MODE_OPTIONS = [
  { value: "normal" as const, label: "平时" },
  { value: "emergency" as const, label: "紧急" },
  { value: "debug" as const, label: "调试" },
  { value: "wartime" as const, label: "战时" },
];

export type SystemWorkModeValue = (typeof WORK_MODE_OPTIONS)[number]["value"];

const WORK_MODE_FETCH_MS = 18_000;

/**
 * 顶栏系统模式：不用原生 &lt;select&gt;（易被 overflow/层级/主题挡住或只能看到当前项），
 * 用 portal + fixed 菜单保证可点、可选四项。
 */
function SystemWorkModeDropdown(props: {
  value: SystemWorkModeValue;
  posting: boolean;
  onPick: (mode: SystemWorkModeValue) => void;
}) {
  const { value, posting, onPick } = props;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  /** 阻止 document mousedown 先关掉 portal，导致选项 click 丢失 */
  const menuRef = useRef<HTMLUListElement>(null);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const label =
    WORK_MODE_OPTIONS.find((o) => o.value === value)?.label ?? value;

  const updateAnchor = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({
      left: Math.max(8, r.right - 140),
      top: r.bottom + 4,
      width: Math.max(140, r.width),
    });
  };

  useEffect(() => {
    if (!open) return;
    updateAnchor();
    const onScroll = () => {
      setOpen(false);
    };
    const onResize = () => {
      updateAnchor();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menu =
    open &&
    anchor &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={menuRef}
        role="listbox"
        data-work-mode-menu
        className="fixed z-[600] max-h-[min(240px,70vh)] overflow-y-auto rounded-md border border-nexus-border bg-nexus-bg-elevated py-1 text-xs shadow-xl"
        style={{
          left: anchor.left,
          top: anchor.top,
          minWidth: anchor.width,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {WORK_MODE_OPTIONS.map((o) => (
          <li key={o.value} role="option" aria-selected={o.value === value}>
            <button
              type="button"
              className={cn(
                "flex w-full px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10",
                o.value === value && "bg-nexus-accent/15 text-nexus-accent",
              )}
              onClick={() => {
                setOpen(false);
                onPick(o.value);
              }}
            >
              {o.label}
            </button>
          </li>
        ))}
      </ul>,
      document.body,
    );

  return (
    <div className="relative flex items-center gap-1">
      <button
        ref={btnRef}
        type="button"
        disabled={posting}
        className={cn(
          "flex h-8 min-w-[6.5rem] items-center justify-between gap-1 rounded-md border border-nexus-border bg-nexus-bg-elevated px-2 text-xs text-nexus-text-primary",
          "outline-none hover:border-nexus-accent/50 focus:border-nexus-accent focus:ring-1 focus:ring-nexus-accent/40",
          posting && "cursor-wait opacity-70",
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (posting) return;
          if (open) setOpen(false);
          else {
            updateAnchor();
            setOpen(true);
          }
        }}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 opacity-70 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {menu}
    </div>
  );
}

/** 顶栏用户头像菜单：个人信息 / 退出（Keycloak） */
function UserAvatarMenu() {
  const { enabled, user, config, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const displayName = user?.name || user?.username || user?.email || "用户";

  const updateAnchor = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({
      left: Math.max(8, r.right - 148),
      top: r.bottom + 4,
      width: 148,
    });
  };

  useEffect(() => {
    if (!open) return;
    updateAnchor();
    const onScroll = () => setOpen(false);
    const onResize = () => updateAnchor();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menu =
    open &&
    anchor &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={menuRef}
        role="menu"
        className="fixed z-[600] overflow-hidden rounded-md border border-nexus-border bg-nexus-bg-elevated py-1 text-xs shadow-xl"
        style={{ left: anchor.left, top: anchor.top, minWidth: anchor.width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {enabled && user ? (
          <li role="none" className="border-b border-nexus-border px-3 py-2 text-[11px] text-nexus-text-secondary">
            <div className="truncate text-nexus-text-primary">{displayName}</div>
            {user.email ? <div className="truncate opacity-70">{user.email}</div> : null}
          </li>
        ) : null}
        <li role="none">
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10"
            onClick={() => {
              setOpen(false);
              setProfileOpen(true);
            }}
          >
            <CircleUser size={13} className="shrink-0 opacity-80" />
            个人信息
          </button>
        </li>
        <li role="none">
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10"
            onClick={() => {
              setOpen(false);
              if (enabled) void logout();
            }}
          >
            <LogOut size={13} className="shrink-0 opacity-80" />
            {enabled ? "退出登录" : "Log Out"}
          </button>
        </li>
      </ul>,
      document.body,
    );

  return (
    <div className="relative flex items-center">
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="用户菜单"
        title={enabled ? displayName : "用户"}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full border border-nexus-border bg-nexus-bg-elevated text-nexus-text-secondary transition-colors",
          "hover:border-nexus-accent/50 hover:text-nexus-text-primary",
          open && "border-nexus-accent/60 text-nexus-accent",
        )}
        onClick={() => {
          if (open) setOpen(false);
          else {
            updateAnchor();
            setOpen(true);
          }
        }}
      >
        <User size={15} />
      </button>
      {menu}
      <UserProfileDialog
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        config={config}
      />
    </div>
  );
}

/**
 * 获取当前时间的展示文本（本地时间 + 时区）。
 * Get a human-readable clock label (local time + timezone).
 *
 * @param now - 当前时间 / Current time
 * @param formatter - Intl 时间格式化器 / Intl time formatter
 * @returns 格式化后的时间字符串 / Formatted time string
 */
function formatNowLabel(now: Date, formatter: Intl.DateTimeFormat): string {
  return formatter.format(now);
}

export function TopNav() {
  const [workMode, setWorkMode] = useState<SystemWorkModeValue>("normal");
  const [workModePosting, setWorkModePosting] = useState(false);
  /** 用户已手动选过模式后，勿被异步 GET /system/work-mode 覆盖（否则会回到「平时」） */
  const workModeUserChosenRef = useRef(false);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "short",
      }),
    []
  );

  const [nowLabel, setNowLabel] = useState<string>("");

  useEffect(() => {
    // 避免 SSR/CSR 首屏时间不一致导致 hydration mismatch：
    // 首屏渲染时先输出占位符，挂载后再异步更新真实时间。
    // Avoid hydration mismatch by rendering a placeholder on first paint, then updating async after mount.
    const update = () => setNowLabel(formatNowLabel(new Date(), timeFormatter));

    const t0 = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(timer);
    };
  }, [timeFormatter]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(WORK_MODE_STORAGE_KEY);
      if (
        raw === "normal" ||
        raw === "emergency" ||
        raw === "debug" ||
        raw === "wartime"
      ) {
        setWorkMode(raw);
        workModeUserChosenRef.current = true;
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await useAppConfigStore.getState().ensureLoaded();
        const base = getHttpConfig().backendUrl?.replace(/\/$/, "") ?? "";
        if (!base || cancelled) return;
        const res = await fetch(`${base}/api/system/work-mode`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { last_mode?: string | null };
        if (cancelled || workModeUserChosenRef.current) return;
        const lm = json.last_mode;
        if (
          lm === "normal" ||
          lm === "emergency" ||
          lm === "debug" ||
          lm === "wartime"
        ) {
          setWorkMode(lm);
        }
      } catch {
        /* 离线或未部署接口时不打断 UI */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onWorkModeChange = async (next: SystemWorkModeValue) => {
    workModeUserChosenRef.current = true;
    setWorkMode(next);
    try {
      window.localStorage.setItem(WORK_MODE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }

    setWorkModePosting(true);
    try {
      await useAppConfigStore.getState().ensureLoaded();
      const base = getHttpConfig().backendUrl?.replace(/\/$/, "") ?? "";
      if (!base) {
        toast.error("系统模式下发失败", {
          description: "app-config 未提供 http.backendUrl，无法请求后端",
        });
        return;
      }
      const ac = new AbortController();
      const to = window.setTimeout(() => ac.abort(), WORK_MODE_FETCH_MS);
      let res: Response;
      try {
        res = await fetch(`${base}/api/system/work-mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: next }),
          signal: ac.signal,
        });
      } finally {
        window.clearTimeout(to);
      }
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        detail?: string;
      };
      if (!res.ok) {
        const msg =
          typeof data.detail === "string"
            ? data.detail
            : typeof data.message === "string"
              ? data.message
              : `HTTP ${res.status}`;
        toast.error("系统模式下发失败", { description: msg });
        return;
      }
      toast.success("系统模式已发布", {
        description: WORK_MODE_OPTIONS.find((o) => o.value === next)?.label ?? next,
      });
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      const aborted =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError");
      if (aborted) {
        const bu = getHttpConfig().backendUrl ?? "";
        msg = `请求超时（>${WORK_MODE_FETCH_MS / 1000}s）${bu ? ` · ${bu}` : ""}`;
      }
      toast.error("系统模式请求失败", { description: msg });
    } finally {
      setWorkModePosting(false);
    }
  };

  return (
    <header
      className="relative z-[100] flex h-12 shrink-0 items-center border-b border-nexus-border"
      style={{ backgroundColor: "#2F2F3A" }}
    >
      {/* Logo + 左侧折叠按钮 */}
      <div className="flex h-full items-center gap-2 border-r border-nexus-border px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md nexus-glass text-nexus-text-primary">
            <Map size={16} />
          </div>
          <span className="text-sm font-semibold tracking-wide nexus-text-gradient">
            多模态自主协同融合控制
            <span className="text-nexus-text-secondary">系统</span>
          </span>
        </div>
      </div>

      <TopNavCategoryMenu />

      {/* 右侧功能区：窄屏时可横向滚动，避免快捷按钮被裁切 */}
      <div className="flex h-full min-w-0 shrink items-center justify-end gap-3 overflow-x-auto border-l border-nexus-border px-2 sm:gap-4 sm:px-3">
        <TopNavQuickActions />
        <div className="hidden h-4 w-px shrink-0 bg-nexus-border md:block" aria-hidden />
        <label className="flex min-w-0 items-center gap-2 text-[11px] whitespace-nowrap">
          <span className="hidden sm:inline text-yellow-400">系统模式</span>
          <SystemWorkModeDropdown
            value={workMode}
            posting={workModePosting}
            onPick={(m) => void onWorkModeChange(m)}
          />
        </label>

        <div className="hidden lg:block h-4 w-px shrink-0 bg-nexus-border" aria-hidden />

        <TopNavWeatherStrip />

        <div className="hidden lg:block h-4 w-px shrink-0 bg-nexus-border" aria-hidden />

        {/* 时间显示 */}
        <div className="topnav-clock" aria-label="local-time">
          {nowLabel || "--:--:--"}
        </div>

        <div className="h-4 w-px shrink-0 bg-nexus-border" aria-hidden />
        <UserAvatarMenu />
      </div>
    </header>
  );
}
