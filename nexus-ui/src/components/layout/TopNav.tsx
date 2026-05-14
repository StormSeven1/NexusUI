"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useAppStore } from "@/stores/app-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import {
  Map,
  Package,
  ClipboardList,
  BarChart3,
  FolderOpen,
  Search,
  Settings,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EoVideoTopLauncher } from "@/components/eo-video/EoVideoTopLauncher";
import { TopNavQuickActions } from "@/components/layout/TopNavQuickActions";
import { getHttpConfig } from "@/lib/map-app-config";

// 顶部Tab配置
const TOP_TABS = [
  {
    id: "situation" as const,
    label: "态势",
    icon: Map,
    description: "战场态势与目标监控"
  },
  {
    id: "assets" as const,
    label: "资产",
    icon: Package,
    description: "物资与装备管理"
  },
  {
    id: "tasks" as const,
    label: "任务",
    icon: ClipboardList,
    description: "任务规划与执行"
  },
  {
    id: "layers" as const,
    label: "图层",
    icon: FolderOpen,
    description: "图层管理与显示"
  },
  {
    id: "analytics" as const,
    label: "分析",
    icon: BarChart3,
    description: "数据分析与可视化"
  },
  {
    id: "search" as const,
    label: "搜索",
    icon: Search,
    description: "全局搜索功能"
  },
  {
    id: "settings" as const,
    label: "设置",
    icon: Settings,
    description: "系统设置与配置"
  },
] as const;

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
  const { topTab, setTopTab } = useAppStore();

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

  // 点击Tab的处理函数
  const handleTabClick = (tabId: typeof topTab) => {
    setTopTab(tabId);
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

      {/* 主要导航标签 - 4个主要tab */}
      <nav className="flex h-full flex-1 items-center gap-0.5 px-2">
        {TOP_TABS.slice(0, 4).map((tab) => {
          const isActive = topTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "group relative flex h-full items-center gap-2 px-4 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-nexus-accent-glow text-nexus-text-primary border-b-2 border-nexus-accent"
                  : "text-nexus-text-muted hover:bg-white/5 hover:text-nexus-text-secondary"
              )}
              title={tab.description}
            >
              <tab.icon size={16} />
              <span>{tab.label}</span>

            </button>
          );
        })}
      </nav>

      {/* 3个图标tab */}
      <div className="flex h-full items-center gap-2 px-3">
        {TOP_TABS.slice(4).map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              topTab === tab.id
                ? "bg-nexus-accent-glow text-nexus-text-primary"
                : "text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-secondary"
            )}
            title={tab.description}
          >
            <tab.icon size={14} />
          </button>
        ))}
      </div>

      {/* 右侧功能区 */}
      <div className="flex h-full shrink-0 items-center justify-end gap-2 border-l border-nexus-border px-2 sm:px-3">
        <TopNavQuickActions />
        <div className="hidden h-4 w-px shrink-0 bg-nexus-border md:block" aria-hidden />
        <label className="flex min-w-0 items-center gap-2 text-[11px] text-nexus-text-secondary whitespace-nowrap">
          <span className="hidden sm:inline">系统模式</span>
          <SystemWorkModeDropdown
            value={workMode}
            posting={workModePosting}
            onPick={(m) => void onWorkModeChange(m)}
          />
        </label>

        <EoVideoTopLauncher />
        {/* 时间显示 */}
        <div
          className="font-mono text-xs text-nexus-text-secondary"
          aria-label="local-time"
        >
          {nowLabel || "--:--:--"}
        </div>

        {/* 通知和用户 */}
        <div className="h-4 w-px bg-nexus-border" />
        <button className="relative flex h-7 w-7 items-center justify-center rounded text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-primary transition-colors">
          <BarChart3 size={15} />
        </button>
        <button className="flex h-7 w-7 items-center justify-center rounded-full border border-nexus-border bg-nexus-glass text-nexus-text-muted hover:bg-nexus-accent hover:text-nexus-text-primary transition-all">
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
}
