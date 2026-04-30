/**
 * EO/IR WebRTC 视频：静态配置与叠加层类型。
 */

export interface EoVideoIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** 无人机 WebRTC：舱内/舱外切换由 MQTT `drone_in_dock` + 两套实体播放地址驱动 */
export interface EoVideoStreamUavMeta {
  entityId: string;
  deviceSN: string;
  airportSN: string;
  vendor: "dji" | "jouav";
  dockPlaybackEntityId: string;
  airPlaybackEntityId: string;
}

export interface EoVideoStreamEntry {
  id: string;
  label: string;
  /** 完整信令 URL（如 ZLM /index/api/webrtc?...），由前端 POST SDP；无人机占位可为 about:blank，由面板动态解析 */
  signalingUrl: string;
  /**
   * 可选：与 base-vue 一致的 `webrtc://host:port/app/stream`；
   * 若 JSON 未写 `signalingUrl` 则由此字段自动展开。
   */
  webrtcUrl?: string;
  /** 来自实体注册表合并的相机/无人机条目（用于剔除与延迟拉流） */
  registrySource?: "camera" | "uav";
  /** 若存在，表示该路为无人机流（右键「无人机」子菜单） */
  uav?: EoVideoStreamUavMeta;
}

export interface EoVideoContextMenuGroup {
  label: string;
  streamIds: string[];
}

export type EoVideoContextMenuLayout = "flat" | "nested";

export interface EoVideoContextMenuConfig {
  title?: string;
  /**
   * `nested`：一级仅显示分组名（光电 / 无人机），悬停展开子菜单；
   * `flat`：平铺所有流（旧行为）。
   */
  menuLayout?: EoVideoContextMenuLayout;
  groups: EoVideoContextMenuGroup[];
}

export interface EoVideoStreamsConfig {
  defaultStreamId: string;
  iceServers: EoVideoIceServer[];
  streams: EoVideoStreamEntry[];
  contextMenu: EoVideoContextMenuConfig;
}

/** 归一化检测框：相对「视频内容矩形」0–1，不含 letterbox */
export interface EoDetectionBox {
  id: string;
  /** WS videoRect 第 5 列等来源的相机/融合 rectID；缺省时 id 后缀仅为缓冲区内序号，可能与 m_nTrackID 不一致 */
  trackId?: number;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  score?: number;
  /** 语义色：friendly | hostile | neutral | accent */
  colorToken?: "friendly" | "hostile" | "neutral" | "accent";
  /**
   * `singleTrack`：单目标跟踪框，叠加层用角标样式（与多目标矩形填充区分）。
   * 缺省为普通多目标检测框。
   */
  variant?: "default" | "singleTrack";
}
