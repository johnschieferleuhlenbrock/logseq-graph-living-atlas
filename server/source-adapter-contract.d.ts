export type LivingAtlasSourceManifest = {
  pages: number;
  graphId: string;
  /**
   * Must change whenever indexed source identity or content changes.
   * Size/mtime-only fingerprints are not sufficient for cache correctness.
   */
  fingerprint: string;
  maxMtimeMs: number;
};

export type LivingAtlasSourceRelation = {
  kind: string;
  target: string;
  evidence?: string;
};

export type LivingAtlasSourceRecord = {
  id: string;
  name: string;
  path: string;
  type: string;
  tags: string[];
  status: string;
  source: string;
  confidence: string;
  lastContacted: string;
  updatedAt: string;
  mtimeMs: number;
  out: string[];
  relations: LivingAtlasSourceRelation[];
  props: Record<string, string>;
};

export type LivingAtlasWatchDirectory = {
  sourceDir: string;
  path: string;
};

export type LivingAtlasSourceAdapter = {
  kind: string;
  root: string;
  readManifest(): LivingAtlasSourceManifest;
  readRecords(): LivingAtlasSourceRecord[];
  watchDirectories?(): LivingAtlasWatchDirectory[];
};
