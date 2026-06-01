import type { AtlasNode } from "../types";
import { confidenceGroupId, proofDebtLabel, sourceGroupId, statusGroupId } from "./filterGroups";

export type AtlasViewPreset = "everything" | "core" | "active" | "bridges" | "gaps" | "review";

export function emptyViewPresetCounts(): Record<AtlasViewPreset, number> {
  return {
    everything: 0,
    core: 0,
    active: 0,
    bridges: 0,
    gaps: 0,
    review: 0
  };
}

export function countViewPresets(
  nodes: AtlasNode[],
  enabledClusterIds: string[],
  statusFilter: string,
  confidenceFilter: string,
  sourceFilter: string,
  connectorNodeIds: Set<string>,
  reviewFlagNodeIds: Set<string>,
): Record<AtlasViewPreset, number> {
  const counts = emptyViewPresetCounts();
  const clusterFilter = new Set(enabledClusterIds);
  for (const node of nodes) {
    if (!clusterFilter.has(node.cluster)) continue;
    if (statusFilter !== "all" && statusGroupId(node.status) !== statusFilter) continue;
    if (confidenceFilter !== "all" && confidenceGroupId(node.confidence) !== confidenceFilter) continue;
    if (sourceFilter !== "all" && sourceGroupId(node.source) !== sourceFilter) continue;
    counts.everything += 1;
    if (allowViewPreset(node, "core", connectorNodeIds, reviewFlagNodeIds)) counts.core += 1;
    if (allowViewPreset(node, "active", connectorNodeIds, reviewFlagNodeIds)) counts.active += 1;
    if (allowViewPreset(node, "bridges", connectorNodeIds, reviewFlagNodeIds)) counts.bridges += 1;
    if (allowViewPreset(node, "gaps", connectorNodeIds, reviewFlagNodeIds)) counts.gaps += 1;
    if (allowViewPreset(node, "review", connectorNodeIds, reviewFlagNodeIds)) counts.review += 1;
  }
  return counts;
}

export function allowViewPreset(node: AtlasNode, preset: AtlasViewPreset, connectorNodeIds: Set<string>, reviewFlagNodeIds: Set<string>) {
  if (preset === "everything") return true;
  if (preset === "core") return node.id === node.cluster || node.heat > 0.2 || node.total > 2;
  if (preset === "active") return node.heat > 0.35;
  if (preset === "bridges") return connectorNodeIds.has(node.id);
  if (preset === "gaps") return proofDebtLabel(node) !== "clear";
  if (preset === "review") return reviewFlagNodeIds.has(node.id);
  return true;
}

export function viewPresetLabel(preset: AtlasViewPreset) {
  const labels: Record<AtlasViewPreset, string> = {
    everything: "All",
    core: "Core",
    active: "Active",
    bridges: "Connectors",
    gaps: "Gaps",
    review: "Review"
  };
  return labels[preset];
}

export function viewPresetDescription(preset: AtlasViewPreset) {
  const descriptions: Record<AtlasViewPreset, string> = {
    everything: "showing the whole atlas",
    core: "showing the primary knowledge regions",
    active: "showing recently warm pages",
    bridges: "showing pages that connect regions",
    gaps: "showing pages with proof or metadata gaps",
    review: "showing flagged pages with direct context"
  };
  return descriptions[preset];
}
