"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useMemo } from "react";
import type { EoVideoStreamsConfig } from "@/lib/eo-video/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export interface EoStreamContextMenuProps {
  config: EoVideoStreamsConfig;
  activeStreamId: string;
  onSelectStream: (streamId: string) => void;
  children: React.ReactNode;
}

export function EoStreamContextMenu({ config, activeStreamId, onSelectStream, children }: EoStreamContextMenuProps) {
  const streamById = useMemo(() => new Map(config.streams.map((s) => [s.id, s])), [config.streams]);
  const groups = config.contextMenu.groups;
  const nested = config.contextMenu.menuLayout === "nested";

  const renderItems = (streamIds: string[]) =>
    streamIds.map((id) => {
      const s = streamById.get(id);
      if (!s) return null;
      return (
        <ContextMenuItem
          key={id}
          disabled={id === activeStreamId}
          onSelect={() => onSelectStream(id)}
        >
          {s.label}
        </ContextMenuItem>
      );
    });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent collisionPadding={8} className="z-[520] max-h-[70vh] min-w-[9rem] overflow-y-auto p-1">
          {config.contextMenu.title ? (
            <ContextMenuLabel className="text-nexus-accent">{config.contextMenu.title}</ContextMenuLabel>
          ) : null}
          {nested
            ? groups.map((g, gi) => (
                <ContextMenuSub key={`${g.label}-${gi}`}>
                  <ContextMenuSubTrigger
                    className={cn(
                      "flex cursor-pointer select-none items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium outline-none",
                      "text-nexus-text-secondary focus:bg-white/10 focus:text-nexus-text-primary data-[state=open]:bg-white/10",
                    )}
                  >
                    <span className="flex-1">{g.label}</span>
                    <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent
                    className={cn(
                      "z-[530] max-h-[60vh] min-w-[10rem] overflow-y-auto rounded-md border border-white/[0.1] bg-nexus-bg-overlay p-1 shadow-xl backdrop-blur-sm",
                    )}
                  >
                    {renderItems(g.streamIds)}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ))
            : groups.map((g, gi) => (
                <Fragment key={`${g.label}-${gi}`}>
                  <ContextMenuLabel>{g.label}</ContextMenuLabel>
                  {renderItems(g.streamIds)}
                  {gi < groups.length - 1 ? <ContextMenuSeparator /> : null}
                </Fragment>
              ))}
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
