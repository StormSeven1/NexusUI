"use client";

export function EvalPlaceholderSection({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-xs font-medium text-nexus-text-secondary">{title}</p>
      <p className="max-w-[240px] text-[10px] leading-relaxed text-nexus-text-muted">{description}</p>
    </div>
  );
}
