/** 告警服务根地址（不含路径），如 `http://192.168.18.141:8019` */
const DEFAULT_ALARM_SERVER_URL = "http://192.168.18.141:8019";

/** Node 侧读取 `NEXUS_ALARM_SERVER_URL`（见 `.env.local`） */
export function getAlarmServerBaseUrl(): string {
  const raw = process.env.NEXUS_ALARM_SERVER_URL?.trim();
  if (!raw) return DEFAULT_ALARM_SERVER_URL;
  return raw.replace(/\/+$/, "");
}

export function getAlarmFilterApiUrl(): string {
  return `${getAlarmServerBaseUrl()}/api/alarm_filter`;
}

export function getAlarmConfirmApiUrl(): string {
  return `${getAlarmServerBaseUrl()}/api/alarm_confirm`;
}
