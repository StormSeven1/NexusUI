"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";
import type { AuthPublicConfig } from "@/lib/auth/auth-config";
import {
  buildKeycloakAccountUrl,
  type AuthUserInfo,
} from "@/lib/auth/keycloak-client";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  user: AuthUserInfo | null;
  config: AuthPublicConfig | null;
};

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-nexus-text-secondary">{label}</dt>
      <dd className="break-all text-nexus-text-primary">{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

export function UserProfileDialog({ open, onClose, user, config }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const accountUrl = buildKeycloakAccountUrl(config);

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-[20000] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-profile-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-nexus-border bg-nexus-bg-elevated text-nexus-text-primary shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-nexus-border px-4 py-3">
          <h2 id="user-profile-title" className="text-sm font-medium">
            个人信息
          </h2>
          <button
            type="button"
            className="rounded p-1 text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-primary"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <dl className="space-y-2.5">
            <Field label="用户名" value={user?.username} />
            <Field label="显示名称" value={user?.name} />
            <Field label="邮箱" value={user?.email} />
            <Field label="用户 ID" value={user?.id} />
          </dl>

          <div className="rounded-md border border-nexus-border/80 bg-nexus-bg-base/80 px-3 py-2.5">
            <p className="text-[11px] leading-relaxed text-nexus-text-secondary">
              如需修改密码、邮箱或个人资料，请前往 Keycloak 账户中心。
            </p>
            {accountUrl ? (
              <a
                href={accountUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "mt-2 inline-flex items-center gap-1.5 text-xs text-nexus-accent",
                  "hover:underline",
                )}
              >
                在 Keycloak 中修改
                <ExternalLink size={12} className="shrink-0 opacity-80" />
              </a>
            ) : (
              <p className="mt-2 text-[11px] text-nexus-text-muted">暂无可用的 Keycloak 账户链接。</p>
            )}
            {accountUrl ? (
              <p className="mt-1.5 break-all font-mono text-[10px] text-nexus-text-muted">{accountUrl}</p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end border-t border-nexus-border px-4 py-3">
          <button
            type="button"
            className="h-8 rounded-md border border-nexus-border px-3 text-xs text-nexus-text-secondary hover:border-nexus-accent/40 hover:text-nexus-text-primary"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
