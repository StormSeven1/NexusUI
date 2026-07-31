"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowProgressData, WorkflowProgressNode } from "@/lib/langgraph-workflow-progress";

function NodeCircle({ status }: { status: WorkflowProgressNode["status"] }) {
  if (status === "done") {
    return (
      <span
        className="mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 border-emerald-400 bg-emerald-400"
        aria-hidden
      />
    );
  }
  if (status === "failed") {
    return (
      <span
        className="mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 border-red-400 bg-red-400/80"
        aria-hidden
      />
    );
  }
  return (
    <span
      className="mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 border-sky-400 bg-transparent shadow-[0_0_6px_rgba(56,189,248,0.45)] animate-pulse"
      aria-hidden
    />
  );
}

function ProgressNodeRow({ node }: { node: WorkflowProgressNode }) {
  const defaultOpen = node.status === "running";
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? defaultOpen;
  const hasDetails = node.details.length > 0;

  useEffect(() => {
    if (node.status === "running") {
      setManualOpen(null);
    }
  }, [node.status, node.id]);

  const titleRow = (
    <>
      <NodeCircle status={node.status} />
      <span
        className={cn(
          "min-w-0 flex-1 text-[12px] font-medium leading-snug",
          node.status === "failed" ? "text-red-300" : "text-nexus-text-primary",
          node.status === "done" && "text-nexus-text-secondary",
        )}
      >
        {node.title}
        {node.time ? (
          <span className="ml-2 font-normal text-[10px] text-nexus-text-muted">{node.time}</span>
        ) : null}
      </span>
    </>
  );

  if (!hasDetails) {
    return <div className="flex items-start gap-2 py-0.5">{titleRow}</div>;
  }

  return (
    <div className="py-0.5">
      <button
        type="button"
        className="flex w-full items-start gap-1.5 text-left"
        onClick={() => setManualOpen(!open)}
        aria-expanded={open}
      >
        <span className="mt-0.5 text-nexus-text-muted">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        {titleRow}
      </button>
      {open ? (
        <ul className="ml-[22px] mt-0.5 space-y-1 border-l border-white/[0.06] pl-2.5">
          {node.details.map((d, i) => (
            <li
              key={`${node.id}-d-${i}`}
              className="whitespace-pre-wrap text-[10px] leading-relaxed text-nexus-text-muted font-mono"
            >
              {d}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function WorkflowProgressTree({ data }: { data: WorkflowProgressData }) {
  if (!data.nodes.length) return null;
  return (
    <div className="my-1 space-y-0.5 rounded-md border border-white/[0.05] bg-white/[0.02] px-2 py-1.5">
      {data.nodes.map((n) => (
        <ProgressNodeRow key={n.id} node={n} />
      ))}
    </div>
  );
}
