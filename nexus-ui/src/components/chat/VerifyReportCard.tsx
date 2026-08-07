"use client";

import {
  buildVerifyReportFooterText,
  formatVerifyTargetFoundLabel,
  isPathishVerifyDisplayText,
  type VerifyReportViewModel,
} from "@/lib/task-status-verify-report-model";
import { STABLE_TARGET_ID_THRESHOLD } from "@/lib/task-status-verify-target-id";
import { cn } from "@/lib/utils";
/** 查证标题栏：在原色相基础上去饱和、压暗，避免刺眼 */
const COLOR_TOP = "#3B6580";
const COLOR_JUDGMENT = "#876038";

function FieldRow({ label, value }: { label: string; value?: string | number | null }) {
  const text =
    value != null && String(value).trim() !== "" ? String(value) : "";
  return (
    <div className="flex min-h-[22px] items-start gap-0.5 text-[11px] leading-[22px]">
      <span className="shrink-0 whitespace-nowrap text-white/75">{label}：</span>
      <span className="min-w-0 break-words text-white">{text}</span>
    </div>
  );
}

function PanelHeader({
  title,
  color,
  className,
}: {
  title: string;
  color: string;
  className?: string;
}) {
  return (
    <div
      className={cn("px-2.5 py-1 text-[11px] font-medium text-white", className)}
      style={{ backgroundColor: color }}
    >
      {title}
    </div>
  );
}

function JudgmentPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-sm"
      style={{ border: `1px solid ${COLOR_JUDGMENT}` }}
    >
      <PanelHeader title={title} color={COLOR_JUDGMENT} />
      <div className="space-y-0 bg-[#1a2332]/90 px-2.5 py-2">{children}</div>
    </div>
  );
}

function fmtPosition(lon?: number, lat?: number): string {
  if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    return "";
  }
  return `东经 ${lon.toFixed(4)}, 北纬 ${lat.toFixed(4)}`;
}

export function VerifyReportCard({ report }: { report: VerifyReportViewModel }) {
  const title = report.entityKind === "uav" ? "无人机查证" : "相机查证";
  const env = report.environment ?? {};
  const tgt = report.target ?? {};
  const targetFoundLabel = formatVerifyTargetFoundLabel(report.targetFound);
  const featureTarget = report.featureTarget?.trim();
  const showFeatureTarget =
    report.targetFound != null &&
    featureTarget &&
    !isPathishVerifyDisplayText(featureTarget)
      ? featureTarget
      : "";
  const judgmentBasis = buildVerifyReportFooterText(report);

  return (
    <div className="my-1 w-full max-w-full space-y-2">
      {/* 上框：航迹信息 + 图片 */}
      <div
        className="overflow-hidden rounded-sm"
        style={{ border: `1px solid ${COLOR_TOP}` }}
      >
        <PanelHeader title={title} color={COLOR_TOP} />
        <div className="flex flex-col gap-2 bg-[#1a2332]/90 p-2 sm:flex-row sm:items-stretch">
          <div className="min-w-0 flex-1 space-y-0 sm:pr-2">
            <FieldRow
              label="航迹信息"
              value={
                report.trackId != null &&
                Number.isFinite(report.trackId) &&
                report.trackId > 0 &&
                report.trackId < STABLE_TARGET_ID_THRESHOLD &&
                Boolean(report.shipArchiveInfo?.includes("自报位"))
                  ? `自报位 ${report.trackId}`
                  : report.trackId
              }
            />
            <FieldRow label="实体" value={report.entityId} />
            <FieldRow
              label="位置"
              value={fmtPosition(report.longitudeDeg, report.latitudeDeg)}
            />
            <FieldRow
              label="距离"
              value={
                report.distanceNm != null && Number.isFinite(report.distanceNm)
                  ? `${report.distanceNm.toFixed(1)}海里`
                  : ""
              }
            />
            <FieldRow
              label="方位"
              value={
                report.azimuthDegrees != null && Number.isFinite(report.azimuthDegrees)
                  ? `${report.azimuthDegrees.toFixed(1)}°`
                  : ""
              }
            />
            <FieldRow
              label="速度"
              value={
                report.speedMps != null && Number.isFinite(report.speedMps)
                  ? `${report.speedMps.toFixed(1)}m/s`
                  : ""
              }
            />
            <FieldRow label="船舶档案" value={report.shipArchiveInfo} />
          </div>
          <div
            className="flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-black/30 sm:w-[46%]"
            style={{ border: `1px solid ${COLOR_TOP}` }}
          >
            {report.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={report.imageUrl}
                alt={report.imageFileName ?? "verify snapshot"}
                className="max-h-[180px] w-full object-contain"
              />
            ) : (
              <div className="flex h-[120px] w-full items-center justify-center text-[10px] text-white/35 sm:h-[160px]">
                暂无图片
              </div>
            )}
          </div>
        </div>
        {report.analyzing && (
          <p className="border-t border-white/[0.06] px-2.5 py-1.5 text-[10px] text-white/55">
            目标图片如下，正在调用大模型进行研判
          </p>
        )}
      </div>

      {/* 下框：环境研判 + 目标研判 */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <JudgmentPanel title="环境研判">
          <FieldRow label="天气" value={env.weather} />
          <FieldRow label="波浪类型" value={env.wave} />
          <FieldRow label="海况等级" value={env.seaState} />
          <FieldRow label="能见度" value={env.visibility} />
        </JudgmentPanel>
        <JudgmentPanel title="目标研判">
          <FieldRow label="目标名称" value={tgt.name ?? ""} />
          <FieldRow label="目标尺寸" value={tgt.size} />
          <FieldRow label="目标清晰度" value={tgt.clarity} />
          <FieldRow label="目标类型" value={tgt.type} />
          <FieldRow label="目标颜色" value={tgt.color} />
          <FieldRow label="目标行为" value={tgt.behavior} />
          {targetFoundLabel ? <FieldRow label="找到目标" value={targetFoundLabel} /> : null}
        </JudgmentPanel>
      </div>

      {report.visitHistory?.trim() ? (
        <div
          className="overflow-hidden rounded-sm"
          style={{ border: `1px solid ${COLOR_JUDGMENT}` }}
        >
          <PanelHeader title="来访记录" color={COLOR_JUDGMENT} />
          <p className="whitespace-pre-wrap bg-[#1a2332]/90 px-2.5 py-2 text-[11px] leading-relaxed text-white/90">
            {report.visitHistory.trim()}
          </p>
        </div>
      ) : null}

      {showFeatureTarget ? (
        <p className="px-0.5 text-[11px] leading-relaxed text-white/90">
          <span className="text-white/75">特征目标：</span>
          {showFeatureTarget}
        </p>
      ) : null}
      {judgmentBasis ? (
        <p className="px-0.5 text-[11px] leading-relaxed text-white/90">{judgmentBasis}</p>
      ) : null}
    </div>
  );
}
