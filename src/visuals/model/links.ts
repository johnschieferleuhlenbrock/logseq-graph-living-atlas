import type { AtlasLink, AtlasMode, AtlasNode } from "../../types";

export type EdgeDensity = "sparse" | "balanced" | "dense";
export type LinkDirectionFilter = "all" | "outbound" | "inbound" | "cross-cluster";

export type ClusterConnectorStat = {
  fromId: string;
  toId: string;
  count: number;
  weight: number;
};

export function selectVisibleLinks(
  links: AtlasLink[],
  nodes: AtlasNode[],
  nodeIds: Set<string>,
  selectedId: string | null,
  mode: AtlasMode,
  emphasisLinkIds?: Set<string>,
  filters: { edgeDensity: EdgeDensity; linkDirection: LinkDirectionFilter; minLinkWeight: number } = {
    edgeDensity: "sparse",
    linkDirection: "all",
    minLinkWeight: 0
  }
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const degree = new Map(nodes.map((node) => [node.id, node.total]));
  return links.filter((link) => {
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) return false;
    if (emphasisLinkIds?.has(link.id)) return true;
    if ((link.weight || 0) < filters.minLinkWeight) return false;
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (!source || !target) return false;
    if (filters.linkDirection === "cross-cluster" && source.cluster === target.cluster) return false;
    if (selectedId && filters.linkDirection === "outbound" && link.source !== selectedId) return false;
    if (selectedId && filters.linkDirection === "inbound" && link.target !== selectedId) return false;
    if (selectedId) return link.source === selectedId || link.target === selectedId;
    if (filters.linkDirection === "outbound" || filters.linkDirection === "inbound") return false;
    if (filters.edgeDensity === "dense") return true;
    const densityOffset = filters.edgeDensity === "balanced" ? -18 : 0;
    if (mode === "Radar") return (degree.get(link.source) || 0) <= 2 || (degree.get(link.target) || 0) <= 2 || filters.edgeDensity === "balanced";
    if (mode === "Today") return (degree.get(link.source) || 0) > Math.max(4, 8 + densityOffset) || (degree.get(link.target) || 0) > Math.max(4, 8 + densityOffset);
    const sourceDegree = degree.get(link.source) || 0;
    const targetDegree = degree.get(link.target) || 0;
    if (filters.edgeDensity === "balanced") {
      return (sourceDegree > 24 && targetDegree > 10) || (sourceDegree + targetDegree > 42 && pseudo(link.id, 19) > 0.64);
    }
    return (sourceDegree > 44 && targetDegree > 18) || (sourceDegree + targetDegree > 72 && pseudo(link.id, 19) > 0.82);
  });
}

export function buildClusterConnectorStats(links: AtlasLink[], nodes: AtlasNode[], nodeIds: Set<string>): ClusterConnectorStat[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const counts = new Map<string, ClusterConnectorStat>();
  for (const link of links) {
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) continue;
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (!source || !target || source.cluster === target.cluster) continue;
    const [fromId, toId] = [source.cluster, target.cluster].sort();
    const key = `${fromId}:${toId}`;
    const current = counts.get(key) || { fromId, toId, count: 0, weight: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  const stats = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  const max = Math.max(1, ...stats.map((stat) => stat.count));
  return stats.map((stat) => ({ ...stat, weight: Math.sqrt(stat.count / max) }));
}

function pseudo(seed: string, salt: number) {
  let h = 2166136261 + salt * 1013;
  for (let index = 0; index < seed.length; index += 1) {
    h ^= seed.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

