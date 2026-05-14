/**
 * 光电 dock 放大浮动窗标题前缀（与 `windowRegistry` 中实例对应，格式「多光电显示1」无空格）。
 * 独立文件，避免 `EoVideoPanel` ↔ `windowRegistry` 循环依赖。
 */
export function getEoVideoExpandDockBaseTitle(panelId: string | undefined): string {
  const id = panelId?.trim() ?? "";
  if (!id.startsWith("electro-optical")) return "";
  if (id === "electro-optical") return "多光电显示";
  const m = id.match(/^electro-optical-(\d+)$/);
  if (m) return `多光电显示${m[1]}`;
  return "";
}
