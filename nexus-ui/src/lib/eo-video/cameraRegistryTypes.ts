export interface EoCameraRegistryRow {
  entityId: string;
  label: string;
  /** 8090 `ontology.specificType` 原文（如 ThirdPartyUdpCameraImage） */
  ontologySpecificType?: string;
  /** 解析后的播放方式（由 specificType 推导） */
  thirdPartyPlayback?: "udp" | "webrtc";
}

export interface EoCameraRegistryFile {
  syncedAt: string;
  sourceUrl: string;
  cameras: EoCameraRegistryRow[];
}
