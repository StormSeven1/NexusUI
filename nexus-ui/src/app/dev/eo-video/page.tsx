"use client";

import { EoVideoPanel } from "@/components/eo-video/EoVideoPanel";

export default function DevEoVideoPage() {
  return (
    <div className="flex h-screen flex-col bg-nexus-bg-base p-4">
      <h1 className="mb-2 text-xs font-semibold tracking-wider text-nexus-text-muted">Dev / EO Video</h1>
      <EoVideoPanel className="min-h-0 flex-1" />
    </div>
  );
}
