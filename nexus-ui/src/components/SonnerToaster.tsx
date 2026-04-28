"use client";

import { Toaster } from "sonner";

/** 全局 toast（如 `hooks/useUnifiedWsFeed` 内 `import { toast } from "sonner"`） */
export function SonnerToaster() {
  return (
    <Toaster
      className="nexus-sonner-list"
      position="top-right"
      theme="dark"
      richColors
      closeButton
      offset="4.5rem"
      toastOptions={{
        classNames: {
          toast: "font-sans text-[12px] border-white/10",
          title: "font-medium",
          description: "text-zinc-400",
        },
      }}
    />
  );
}
