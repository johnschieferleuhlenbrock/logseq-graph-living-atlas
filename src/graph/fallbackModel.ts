import type { AtlasCluster, AtlasInsight, AtlasLink, AtlasNode } from "../types";

export type FallbackNodeSummary = AtlasNode & {
  visibleEdges: number;
};

export function fallbackTopNodes(nodes: AtlasNode[], links: AtlasLink[], limit = 8): FallbackNodeSummary[] {
  const visibleDegree = new Map<string, number>();
  const ids = new Set(nodes.map((node) => node.id));
  for (const link of links) {
    if (!ids.has(link.source) || !ids.has(link.target)) continue;
    visibleDegree.set(link.source, (visibleDegree.get(link.source) || 0) + 1);
    visibleDegree.set(link.target, (visibleDegree.get(link.target) || 0) + 1);
  }
  return [...nodes]
    .map((node) => ({
      ...node,
      visibleEdges: visibleDegree.get(node.id) || 0
    }))
    .sort((a, b) => (
      b.visibleEdges - a.visibleEdges ||
      b.total + b.heat * 20 - (a.total + a.heat * 20) ||
      a.name.localeCompare(b.name)
    ))
    .slice(0, limit);
}

export function fallbackTopClusters(clusters: AtlasCluster[], limit = 7) {
  return [...clusters]
    .sort((a, b) => b.count + b.degree * 0.2 - (a.count + a.degree * 0.2) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export function fallbackInsightActions(insights: AtlasInsight[], limit = 4) {
  return [...insights]
    .filter((insight) => insight.action?.label)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.metric - a.metric || a.title.localeCompare(b.title))
    .slice(0, limit);
}

function severityRank(severity: AtlasInsight["severity"]) {
  if (severity === "live") return 0;
  if (severity === "attention") return 1;
  if (severity === "watch") return 2;
  return 3;
}
