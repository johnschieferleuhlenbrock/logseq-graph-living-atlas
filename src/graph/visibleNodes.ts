import type { AtlasFocusResult, AtlasMode, AtlasNode, AtlasPathResult, AtlasSnapshot } from "../types";
import { confidenceGroupId, sourceGroupId, statusGroupId } from "./filterGroups";
import { allowViewPreset, type AtlasViewPreset } from "./viewPresets";

const defaultVisibleNodeBudget = 7200;

export type VisibleNodeSelection = {
  activeNodeIds: Set<string>;
  atlasView: AtlasViewPreset;
  connectorNodeIds: Set<string>;
  confidenceFilter: string;
  enabledClusterIds: string[];
  focusResult: AtlasFocusResult | null;
  mode: AtlasMode;
  pathResult: AtlasPathResult | null;
  query: string;
  replayCutoff: string;
  reviewContextNodeIds: Set<string>;
  selectedNode: AtlasNode | null;
  snapshot: AtlasSnapshot | null;
  sourceFilter: string;
  statusFilter: string;
};

export function selectVisibleNodes(options: VisibleNodeSelection): AtlasNode[] {
  const {
    activeNodeIds,
    atlasView,
    connectorNodeIds,
    confidenceFilter,
    enabledClusterIds,
    focusResult,
    mode,
    pathResult,
    query,
    replayCutoff,
    reviewContextNodeIds,
    selectedNode,
    snapshot,
    sourceFilter,
    statusFilter
  } = options;
  if (!snapshot) return [];
  const clusterFilter = new Set(enabledClusterIds);
  const allowClusters = (node: AtlasNode) => clusterFilter.has(node.cluster);
  const allowNodeFilters = (node: AtlasNode) => (
    (statusFilter === "all" || statusGroupId(node.status) === statusFilter) &&
    (confidenceFilter === "all" || confidenceGroupId(node.confidence) === confidenceFilter) &&
    (sourceFilter === "all" || sourceGroupId(node.source) === sourceFilter)
  );
  const allowNode = (node: AtlasNode) => allowClusters(node) && allowNodeFilters(node) && allowViewPreset(node, atlasView, connectorNodeIds, reviewContextNodeIds);
  if (pathResult?.ok) return pathContextNodes(snapshot, pathResult.nodes);
  if ((selectedNode || query.trim()) && focusResult?.ok) return focusResult.nodes.filter(allowNode);
  if (!query.trim()) {
    const filteredSnapshotNodes = snapshot.nodes.filter(allowNode);
    if (mode === "Today") return budgetVisibleNodes(filteredSnapshotNodes.filter((node) => node.heat > 0.32), 5200);
    if (mode === "Radar") {
      const insightIds = activeNodeIds.size ? activeNodeIds : new Set(snapshot.insights.flatMap((insight) => insight.nodeIds || []));
      return budgetVisibleNodes(filteredSnapshotNodes.filter((node) => insightIds.has(node.id) || (!activeNodeIds.size && node.total <= 1)), 5200);
    }
    if (mode === "Replay" && replayCutoff) {
      return budgetVisibleNodes(filteredSnapshotNodes.filter((node) => Date.parse(node.updatedAt) <= Date.parse(replayCutoff)), 6200);
    }
    return budgetVisibleNodes(filteredSnapshotNodes);
  }
  const needle = query.trim().toLowerCase();
  return budgetVisibleNodes(snapshot.nodes.filter((node) => {
    return (
      allowNode(node) &&
      (
        node.name.toLowerCase().includes(needle) ||
        node.type.toLowerCase().includes(needle) ||
        node.clusterLabel.toLowerCase().includes(needle) ||
        node.tags.some((tag) => tag.toLowerCase().includes(needle))
      )
    );
  }), 4200);
}

function pathContextNodes(snapshot: AtlasSnapshot, routeNodes: AtlasNode[]) {
  const routeIds = new Set(routeNodes.map((node) => node.id));
  const contextIds = new Set(routeIds);
  const candidates = new Map<string, AtlasNode>();
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const link of snapshot.links) {
    const touchesRoute = routeIds.has(link.source) || routeIds.has(link.target);
    if (!touchesRoute) continue;
    const neighborId = routeIds.has(link.source) ? link.target : link.source;
    const neighbor = byId.get(neighborId);
    if (neighbor && !routeIds.has(neighbor.id)) candidates.set(neighbor.id, neighbor);
  }
  [...candidates.values()]
    .sort((a, b) => b.total + b.heat * 20 - (a.total + a.heat * 20))
    .slice(0, 72)
    .forEach((node) => contextIds.add(node.id));
  const merged = new Map(routeNodes.map((node) => [node.id, node]));
  for (const node of snapshot.nodes) {
    if (contextIds.has(node.id)) merged.set(node.id, node);
  }
  return [...merged.values()];
}

function budgetVisibleNodes(nodes: AtlasNode[], budget = defaultVisibleNodeBudget) {
  if (nodes.length <= budget) return nodes;
  const score = (node: AtlasNode) => node.total + node.heat * 35;
  const grouped = new Map<string, AtlasNode[]>();
  for (const node of nodes) grouped.set(node.cluster, [...(grouped.get(node.cluster) || []), node]);
  const perClusterFloor = Math.max(160, Math.floor(budget * 0.72 / Math.max(1, grouped.size)));
  const selected = new Map<string, AtlasNode>();
  for (const clusterNodes of grouped.values()) {
    clusterNodes
      .sort((a, b) => score(b) - score(a))
      .slice(0, perClusterFloor)
      .forEach((node) => selected.set(node.id, node));
  }
  [...nodes]
    .sort((a, b) => score(b) - score(a))
    .some((node) => {
      selected.set(node.id, node);
      return selected.size >= budget;
    });
  return [...selected.values()];
}
