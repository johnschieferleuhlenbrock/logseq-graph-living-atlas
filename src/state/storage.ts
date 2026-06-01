import type { AtlasSnapshot } from "../types";

export type EdgeDensity = "sparse" | "balanced" | "dense";
export type LinkDirectionFilter = "all" | "outbound" | "inbound" | "cross-cluster";
export type LayoutMode = "adaptive" | "atlas" | "compact";
export type MotionMode = "cinematic" | "quiet";

export type AtlasDisplaySettings = {
  showGroupNames: boolean;
  edgeDensity: EdgeDensity;
  linkDirection: LinkDirectionFilter;
  minLinkWeight: number;
  layoutMode: LayoutMode;
  motionMode: MotionMode;
  topLevelClusterIds: string[] | null;
};

export type ReviewFlag = {
  id: string;
  nodeRef?: string;
  nodeId?: string;
  name?: string;
  relativePath?: string;
  createdAt: string;
  role?: string;
  why?: string;
  next?: string;
};

const reviewFlagStorageKey = "living-atlas-review-flags";
const displaySettingsStorageKey = "living-atlas-display-settings";
const firstRunStorageKey = "living-atlas-first-run-dismissed";
const apiTokenStorageKey = "living-atlas-api-token";

export const defaultDisplaySettings: AtlasDisplaySettings = {
  showGroupNames: true,
  edgeDensity: "sparse",
  linkDirection: "all",
  minLinkWeight: 0,
  layoutMode: "adaptive",
  motionMode: "cinematic",
  topLevelClusterIds: null
};

export function reviewStorageGraphKey(snapshot: AtlasSnapshot | null) {
  if (snapshot?.graph?.id) return `graph:${snapshot.graph.id}`;
  if (snapshot?.nodes?.length) return `nodes:${stableHash(snapshot.nodes.map((node) => node.id).sort().join("\n"))}`;
  if (!snapshot) return "";
  return `${snapshot.totals.pages}:${snapshot.totals.links}:${snapshot.totals.clusters}`;
}

export function reviewStorageMigrationKeys(snapshot: AtlasSnapshot | null, primaryKey = reviewStorageGraphKey(snapshot)) {
  const keys = new Set<string>();
  if (snapshot?.graph?.fingerprint) keys.add(snapshot.graph.fingerprint);
  if (snapshot?.totals) keys.add(`${snapshot.totals.pages}:${snapshot.totals.links}:${snapshot.totals.clusters}`);
  keys.delete(primaryKey);
  return [...keys];
}

export function readReviewFlags(graphKey: string, migrationKeys: string[] = []): Record<string, ReviewFlag> {
  const primary = readReviewFlagsByKey(graphKey);
  const merged = { ...primary };
  let shouldPersist = false;
  for (const key of migrationKeys) {
    if (!key || key === graphKey) continue;
    const legacy = readReviewFlagsByKey(key);
    for (const [id, flag] of Object.entries(legacy)) {
      if (!merged[id]) {
        merged[id] = flag;
        shouldPersist = true;
      }
    }
  }
  const sanitized = sanitizeReviewFlagsForStorage(merged, graphKey);
  if (JSON.stringify(sanitized) !== JSON.stringify(merged)) shouldPersist = true;
  if (shouldPersist) persistReviewFlags(sanitized, graphKey);
  return sanitized;
}

function readReviewFlagsByKey(graphKey: string): Record<string, ReviewFlag> {
  try {
    const raw = window.localStorage.getItem(reviewFlagStorageKeyFor(graphKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, ReviewFlag>;
  } catch {
    return {};
  }
}

export function persistReviewFlags(flags: Record<string, ReviewFlag>, graphKey: string) {
  try {
    window.localStorage.setItem(reviewFlagStorageKeyFor(graphKey), JSON.stringify(sanitizeReviewFlagsForStorage(flags, graphKey)));
  } catch {
    // Local review flags are best-effort until this is promoted to guarded MCP writeback.
  }
}

export function reviewFlagRefForNode(graphKey: string, nodeId: string) {
  return `node:${stableHash(`${graphKey || "unknown"}:${nodeId}`)}`;
}

export function readAtlasDisplaySettings(): AtlasDisplaySettings {
  try {
    const raw = window.localStorage.getItem(displaySettingsStorageKey);
    if (!raw) return defaultDisplaySettings;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultDisplaySettings;
    return normalizeAtlasDisplaySettings(parsed as Record<string, unknown>);
  } catch {
    return defaultDisplaySettings;
  }
}

export function persistAtlasDisplaySettings(settings: AtlasDisplaySettings) {
  try {
    window.localStorage.setItem(displaySettingsStorageKey, JSON.stringify({
      version: 1,
      ...normalizeAtlasDisplaySettings(settings as unknown as Record<string, unknown>)
    }));
  } catch {
    // Display preferences are non-critical; the atlas should keep running if storage is unavailable.
  }
}

export function readFirstRunDismissed() {
  try {
    return window.localStorage.getItem(firstRunStorageKey) === "1";
  } catch {
    return false;
  }
}

export function persistFirstRunDismissed() {
  try {
    window.localStorage.setItem(firstRunStorageKey, "1");
  } catch {
    // First-run hints are best-effort and should never block the atlas.
  }
}

export function clearLivingAtlasLocalData(graphKey = "") {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(`${reviewFlagStorageKey}:`)) window.localStorage.removeItem(key);
    }
    if (graphKey) window.localStorage.removeItem(reviewFlagStorageKeyFor(graphKey));
    window.localStorage.removeItem(displaySettingsStorageKey);
    window.localStorage.removeItem(firstRunStorageKey);
  } catch {
    // Local privacy reset is best-effort; rendering should continue if browser storage is unavailable.
  }
}

export function clearLivingAtlasSessionToken() {
  try {
    window.sessionStorage.removeItem(apiTokenStorageKey);
  } catch {
    // Session token cleanup is best-effort.
  }
}

function reviewFlagStorageKeyFor(graphKey: string) {
  return `${reviewFlagStorageKey}:${graphKey || "unknown"}`;
}

function sanitizeReviewFlagsForStorage(flags: Record<string, ReviewFlag>, graphKey = "") {
  const sanitized: Record<string, ReviewFlag> = {};
  for (const [id, flag] of Object.entries(flags)) {
    if (!flag) continue;
    const nodeRef = flag.nodeRef || reviewFlagRefForNode(graphKey, flag.nodeId || flag.id || flag.relativePath || flag.name || flag.createdAt || id);
    sanitized[nodeRef] = {
      id: nodeRef,
      nodeRef,
      createdAt: flag.createdAt,
      role: flag.role,
      why: flag.why,
      next: flag.next
    };
  }
  return sanitized;
}

function stableHash(input: string) {
  let h = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    h ^= input.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function normalizeAtlasDisplaySettings(raw: Record<string, unknown>): AtlasDisplaySettings {
  return {
    showGroupNames: typeof raw.showGroupNames === "boolean" ? raw.showGroupNames : defaultDisplaySettings.showGroupNames,
    edgeDensity: isEdgeDensity(raw.edgeDensity) ? raw.edgeDensity : defaultDisplaySettings.edgeDensity,
    linkDirection: isLinkDirection(raw.linkDirection) ? raw.linkDirection : defaultDisplaySettings.linkDirection,
    minLinkWeight: clampNumber(raw.minLinkWeight, 0, 1, defaultDisplaySettings.minLinkWeight),
    layoutMode: isLayoutMode(raw.layoutMode) ? raw.layoutMode : defaultDisplaySettings.layoutMode,
    motionMode: isMotionMode(raw.motionMode) ? raw.motionMode : defaultDisplaySettings.motionMode,
    topLevelClusterIds: Array.isArray(raw.topLevelClusterIds)
      ? raw.topLevelClusterIds.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 40)
      : null
  };
}

function isEdgeDensity(value: unknown): value is EdgeDensity {
  return value === "sparse" || value === "balanced" || value === "dense";
}

function isLinkDirection(value: unknown): value is LinkDirectionFilter {
  return value === "all" || value === "outbound" || value === "inbound" || value === "cross-cluster";
}

function isLayoutMode(value: unknown): value is LayoutMode {
  return value === "adaptive" || value === "atlas" || value === "compact";
}

function isMotionMode(value: unknown): value is MotionMode {
  return value === "cinematic" || value === "quiet";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
