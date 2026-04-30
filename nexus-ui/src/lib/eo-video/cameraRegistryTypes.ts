export interface EoCameraRegistryRow {
  entityId: string;
  label: string;
}

export interface EoCameraRegistryFile {
  syncedAt: string;
  sourceUrl: string;
  cameras: EoCameraRegistryRow[];
}
