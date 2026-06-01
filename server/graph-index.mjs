import path from "node:path";
import { slugify } from "./logseq/parser.mjs";
import { META_TYPES, proofDebtFor } from "./graph/quality.mjs";
import { buildAdjacency, findNode, round } from "./graph/utils.mjs";
export { pathSnapshot } from "./graph/pathfinding.mjs";

const PARENT_RELATIONS = new Set(["company", "org", "organization", "owner", "parent", "parent org", "reports to", "customer of", "part of"]);
const PUBLIC_PROPERTY_KEYS = new Set([
  "type",
  "tags",
  "status",
  "source",
  "confidence",
  "last-contacted",
  "company",
  "organization",
  "owner",
  "parent"
]);
export function buildSnapshot(records, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const byId = new Map(records.map((record) => [record.id, record]));
  const inDegree = new Map();
  const outDegree = new Map();
  const links = [];
  const dangling = new Map();

  for (const record of records) {
    const uniqueOut = [...new Set(record.out || [])];
    outDegree.set(record.id, 0);
    for (const target of uniqueOut) {
      if (!byId.has(target)) {
        const item = dangling.get(target) || { target, refs: 0, sources: [] };
        item.refs += 1;
        item.sources.push(record.name);
        dangling.set(target, item);
        continue;
      }
      links.push({
        id: `${record.id}->${target}`,
        source: record.id,
        target,
        kind: "wikilink"
      });
      outDegree.set(record.id, (outDegree.get(record.id) || 0) + 1);
      inDegree.set(target, (inDegree.get(target) || 0) + 1);
    }
  }

  const degreeMax = Math.max(
    1,
    ...records.map((record) => (inDegree.get(record.id) || 0) + (outDegree.get(record.id) || 0))
  );
  const clusterMap = buildClusters(records);
  const nodes = records.map((record) => {
    const inCount = inDegree.get(record.id) || 0;
    const outCount = outDegree.get(record.id) || 0;
    const total = inCount + outCount;
    const cluster = clusterMap.get(record.id);
    const position = stablePosition(record, cluster, total, degreeMax);
    const activity = activityScore(record.mtimeMs, now);
    return {
      id: record.id,
      name: record.name,
      type: record.type,
      tags: record.tags,
      status: record.status,
      source: record.source,
      confidence: record.confidence,
      updatedAt: record.updatedAt,
      in: inCount,
      out: outCount,
      total,
      cluster: cluster.id,
      clusterLabel: cluster.label,
      x: round(position.x),
      y: round(position.y),
      z: round(position.z),
      size: round(3 + Math.sqrt(total + 1) * 1.9 + activity * 3),
      heat: round(activity),
      color: colorFor(record, cluster)
    };
  });
  const nodeTotals = new Map(nodes.map((node) => [node.id, node.total]));
  for (const link of links) {
    link.weight = linkWeight(nodeTotals.get(link.source) || 0, nodeTotals.get(link.target) || 0);
  }

  const clusters = summarizeClusters(nodes, links);
  const insights = buildInsights(nodes, links, [...dangling.values()], now);
  const totals = {
    pages: records.length,
    nodes: nodes.length,
    links: links.length,
    dangling: dangling.size,
    clusters: clusters.length,
    active24h: nodes.filter((node) => node.heat > 0.7).length,
    active7d: nodes.filter((node) => node.heat > 0.35).length
  };

  return {
    generatedAt: now.toISOString(),
    version: 1,
    totals,
    clusters,
    nodes,
    links,
    insights,
    health: {
      source: "logseq-markdown",
      layout: "stable-hybrid-topology-activity",
      edgePolicy: "sparse by default; focus/path modes reveal detail"
    }
  };
}

export function diffSnapshots(previous, next) {
  const prevNodes = new Map((previous?.nodes || []).map((node) => [node.id, node]));
  const nextNodes = new Map((next?.nodes || []).map((node) => [node.id, node]));
  const prevLinks = new Map((previous?.links || []).map((link) => [link.id, link]));
  const nextLinks = new Map((next?.links || []).map((link) => [link.id, link]));
  const changedNodes = [];
  const addedNodes = [];
  for (const node of next.nodes) {
    const prev = prevNodes.get(node.id);
    if (!prev) {
      addedNodes.push(node);
      continue;
    }
    if (
      prev.updatedAt !== node.updatedAt ||
      prev.total !== node.total ||
      prev.cluster !== node.cluster ||
      prev.status !== node.status
    ) {
      changedNodes.push(node);
    }
  }
  const removedNodes = [...prevNodes.values()].filter((node) => !nextNodes.has(node.id));
  const addedLinks = next.links.filter((link) => !prevLinks.has(link.id));
  const removedLinks = [...prevLinks.values()].filter((link) => !nextLinks.has(link.id));
  return {
    type: "graph_delta",
    generatedAt: next.generatedAt,
    addedNodes,
    changedNodes,
    removedNodes,
    addedLinks,
    removedLinks,
    insights: next.insights.slice(0, 8),
    totals: next.totals
  };
}

export function budgetSnapshot(snapshot, options = {}) {
  const nodeBudget = Math.max(0, Math.floor(Number(options.nodeBudget || 0)));
  if (!nodeBudget || snapshot.nodes.length <= nodeBudget) return snapshot;

  const linkBudget = Math.max(nodeBudget, Math.floor(Number(options.linkBudget || nodeBudget * 3)));
  const insightIds = new Set((snapshot.insights || []).flatMap((insight) => insight.nodeIds || []));
  const selected = new Set();
  const score = (node) =>
    node.total + node.heat * 42 + (insightIds.has(node.id) ? 900 : 0) + (node.id === node.cluster ? 450 : 0);
  const add = (node) => {
    if (node && selected.size < nodeBudget) selected.add(node.id);
  };

  const grouped = new Map();
  for (const node of snapshot.nodes) grouped.set(node.cluster, [...(grouped.get(node.cluster) || []), node]);
  const perCluster = Math.max(1, Math.floor(nodeBudget * 0.58 / Math.max(1, grouped.size)));
  for (const clusterNodes of grouped.values()) {
    clusterNodes
      .sort((a, b) => score(b) - score(a))
      .slice(0, perCluster)
      .forEach(add);
  }

  snapshot.nodes
    .filter((node) => insightIds.has(node.id))
    .sort((a, b) => score(b) - score(a))
    .forEach(add);

  [...snapshot.nodes]
    .sort((a, b) => score(b) - score(a))
    .some((node) => {
      add(node);
      return selected.size >= nodeBudget;
    });

  const nodes = snapshot.nodes.filter((node) => selected.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = snapshot.links
    .filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target))
    .sort((a, b) => {
      const aScore = (nodeIds.has(a.source) ? 1 : 0) + (nodeIds.has(a.target) ? 1 : 0);
      const bScore = (nodeIds.has(b.source) ? 1 : 0) + (nodeIds.has(b.target) ? 1 : 0);
      return bScore - aScore || a.id.localeCompare(b.id);
    })
    .slice(0, linkBudget);

  return {
    ...snapshot,
    nodes,
    links,
    health: {
      ...snapshot.health,
      renderPolicy: `overview-budget:${nodeBudget}`,
      fullNodes: snapshot.totals.nodes,
      fullLinks: snapshot.totals.links
    }
  };
}

export function createSnapshotRuntime(snapshot, records = []) {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const recordById = new Map((records || []).map((record) => [record.id, record]));
  const { adjacency, edgeLookup } = buildAdjacency(snapshot.links);
  const incomingLinksById = new Map();
  const outgoingLinksById = new Map();
  const nodesByCluster = new Map();
  for (const node of snapshot.nodes) {
    nodesByCluster.set(node.cluster, [...(nodesByCluster.get(node.cluster) || []), node]);
  }
  for (const link of snapshot.links) {
    incomingLinksById.set(link.target, [...(incomingLinksById.get(link.target) || []), link]);
    outgoingLinksById.set(link.source, [...(outgoingLinksById.get(link.source) || []), link]);
  }
  const searchRows = snapshot.nodes.map((node) => ({
    node,
    name: node.name.toLowerCase(),
    type: node.type.toLowerCase(),
    cluster: node.clusterLabel.toLowerCase(),
    tags: node.tags.map((tag) => tag.toLowerCase()),
    status: node.status.toLowerCase(),
    source: node.source.toLowerCase(),
    confidence: node.confidence.toLowerCase()
  }));
  return {
    adjacency,
    edgeLookup,
    incomingLinksById,
    nodeById,
    nodesByCluster,
    outgoingLinksById,
    recordById,
    searchRows
  };
}

export function searchSnapshot(snapshot, query, limit = 8, runtime = null) {
  const needle = String(query || "").trim().toLowerCase();
  const slugNeedle = slugify(needle);
  const max = Math.max(1, Math.floor(Number(limit || 8)));
  if (needle.length < 2) {
    return {
      ok: true,
      generatedAt: snapshot.generatedAt,
      query: String(query || ""),
      totalMatches: 0,
      omitted: 0,
      results: []
    };
  }
  const rows = runtime?.searchRows || createSnapshotRuntime(snapshot).searchRows;
  const scored = rows
    .map((row) => {
      const { node, name, type, cluster, status, source, confidence } = row;
      const tagHit = row.tags.some((tag) => tag.includes(needle));
      const statusHit = status.includes(needle);
      const sourceHit = source.includes(needle);
      const confidenceHit = confidence.includes(needle);
      const score =
        (node.id === slugNeedle ? 1600 : 0) +
        (name === needle ? 1400 : 0) +
        (name.startsWith(needle) ? 850 : 0) +
        (name.includes(needle) ? 420 : 0) +
        (type === needle ? 260 : 0) +
        (type.includes(needle) ? 140 : 0) +
        (cluster.includes(needle) ? 180 : 0) +
        (tagHit ? 150 : 0) +
        (statusHit ? 80 : 0) +
        (sourceHit ? 70 : 0) +
        (confidenceHit ? 50 : 0) +
        node.total +
        node.heat * 60;
      return { node, score };
    })
    .filter((entry) => entry.score > entry.node.total + entry.node.heat * 60)
    .sort((a, b) => b.score - a.score || b.node.total - a.node.total || a.node.name.localeCompare(b.node.name));
  return {
    ok: true,
    generatedAt: snapshot.generatedAt,
    query: String(query || ""),
    totalMatches: scored.length,
    omitted: Math.max(0, scored.length - max),
    results: scored.slice(0, max).map((entry) => entry.node)
  };
}

export function focusSnapshot(snapshot, query, radius = 2, limit = 1800, runtime = null) {
  const lookup = runtime || createSnapshotRuntime(snapshot);
  const q = slugify(query);
  const exactSeed = lookup.nodeById.get(q) || snapshot.nodes.find((node) => slugify(node.name) === q);
  const cluster = snapshot.clusters.find((item) => item.id === q || slugify(item.label) === q);
  const seed = exactSeed || (cluster ? null : findNode(snapshot.nodes, query));
  if (!seed) {
    if (cluster) return clusterFocusSnapshot(snapshot, cluster, limit, lookup);
    return { ok: false, error: "not found", query };
  }

  const selected = new Set([seed.id]);
  let frontier = new Set([seed.id]);
  const maxNodes = Math.max(1, Math.floor(Number(limit || 1800)));
  for (let depth = 0; depth < radius; depth += 1) {
    const next = new Set();
    for (const nodeId of frontier) {
      const neighbors = [...(lookup.adjacency.get(nodeId) || [])].sort((a, b) => (lookup.nodeById.get(b)?.total || 0) - (lookup.nodeById.get(a)?.total || 0));
      for (const neighbor of neighbors) {
        if (selected.size + next.size >= maxNodes) break;
        if (!selected.has(neighbor)) next.add(neighbor);
      }
    }
    for (const nodeId of next) selected.add(nodeId);
    frontier = next;
    if (selected.size >= maxNodes) break;
  }
  const nodes = snapshot.nodes.filter((node) => selected.has(node.id));
  const links = snapshot.links.filter((link) => selected.has(link.source) && selected.has(link.target)).slice(0, maxNodes * 3);
  return {
    ok: true,
    focusKind: "page",
    seed,
    radius,
    nodes,
    links,
    limited: selected.size >= maxNodes,
    totalMatches: nodes.length,
    insights: snapshot.insights.filter((insight) => insight.nodeIds?.includes(seed.id)).slice(0, 5)
  };
}

function clusterFocusSnapshot(snapshot, cluster, limit = 1800, runtime = null) {
  const maxNodes = Math.max(1, Math.floor(Number(limit || 1800)));
  const matches = [...(runtime?.nodesByCluster?.get(cluster.id) || snapshot.nodes.filter((node) => node.cluster === cluster.id))]
    .sort((a, b) => b.total + b.heat * 42 - (a.total + a.heat * 42));
  const nodes = matches.slice(0, maxNodes);
  const ids = new Set(nodes.map((node) => node.id));
  const links = snapshot.links.filter((link) => ids.has(link.source) && ids.has(link.target)).slice(0, maxNodes * 3);
  const seed = nodes[0] || null;
  return {
    ok: true,
    focusKind: "cluster",
    seed,
    cluster,
    radius: 0,
    nodes,
    links,
    limited: matches.length > nodes.length,
    totalMatches: matches.length,
    insights: snapshot.insights.filter((insight) => insight.nodeIds?.some((id) => ids.has(id))).slice(0, 5)
  };
}

export function connectorCandidates(snapshot, limit = 12) {
  const max = Math.max(1, Math.floor(Number(limit || 12)));
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const clusterById = new Map(snapshot.clusters.map((cluster) => [cluster.id, cluster]));
  const clusterPairLinks = new Map();
  const nodeNeighborClusters = new Map();

  for (const link of snapshot.links) {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (!source || !target || source.cluster === target.cluster) continue;
    const key = clusterPairKey(source.cluster, target.cluster);
    clusterPairLinks.set(key, (clusterPairLinks.get(key) || 0) + 1);
    addNeighborCluster(nodeNeighborClusters, source.id, target.cluster);
    addNeighborCluster(nodeNeighborClusters, target.id, source.cluster);
  }

  const candidates = [];
  const clusters = snapshot.clusters.filter((cluster) => cluster.count > 0);
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const fromCluster = clusters[i];
      const toCluster = clusters[j];
      const pairKey = clusterPairKey(fromCluster.id, toCluster.id);
      const linkCount = clusterPairLinks.get(pairKey) || 0;
      const expected = Math.sqrt(fromCluster.count * toCluster.count) / 4.8;
      const pressure = Math.max(0, expected - linkCount);
      if (pressure <= 0.25) continue;
      const fromAnchors = bridgeAnchors(snapshot.nodes, fromCluster.id, toCluster.id, nodeNeighborClusters);
      const toAnchors = bridgeAnchors(snapshot.nodes, toCluster.id, fromCluster.id, nodeNeighborClusters);
      if (!fromAnchors.length && !toAnchors.length) continue;
      const hotness = (fromCluster.heat + toCluster.heat) / 2;
      const score = Math.round(Math.min(99, Math.max(1,
        pressure * 7 +
        hotness * 22 +
        (fromAnchors.length + toAnchors.length) * 4 +
        clusterBridgePriority(fromCluster.id) +
        clusterBridgePriority(toCluster.id)
      )));
      candidates.push({
        id: `${fromCluster.id}:${toCluster.id}`,
        fromCluster: clusterSummary(fromCluster),
        toCluster: clusterSummary(toCluster),
        linkCount,
        expected: round(expected),
        score,
        rationale: linkCount === 0
          ? "no explicit connector links despite nearby active regions"
          : `${linkCount} connector links under expected relationship pressure`,
        nodeIds: [...fromAnchors, ...toAnchors].slice(0, 8).map((node) => node.id),
        anchors: [...fromAnchors, ...toAnchors].slice(0, 8).map((node) => ({
          id: node.id,
          name: node.name,
          cluster: node.clusterLabel,
          degree: node.total,
          heat: node.heat,
          debt: proofDebtFor(node).length
        }))
      });
    }
  }
  return candidates
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, max);
}

export const bridgeCandidates = connectorCandidates;

export const DEFAULT_NODE_EDGE_LIMIT = 250;

export function nodeDetail(snapshot, records, query, root = "", runtime = null, options = {}) {
  const lookup = runtime || createSnapshotRuntime(snapshot, records);
  const node = findNode(snapshot.nodes, query);
  if (!node) return { ok: false, error: "node not found", query };
  const edgeLimit = boundedInteger(options.edgeLimit, DEFAULT_NODE_EDGE_LIMIT, 1, 1000);
  const record = lookup.recordById.get(node.id);
  const incoming = (lookup.incomingLinksById.get(node.id) || [])
    .map((link) => ({ linkId: link.id, weight: link.weight, node: lookup.nodeById.get(link.source) }))
    .filter((entry) => entry.node)
    .sort((a, b) => b.node.total - a.node.total);
  const outgoing = (lookup.outgoingLinksById.get(node.id) || [])
    .map((link) => ({ linkId: link.id, weight: link.weight, node: lookup.nodeById.get(link.target) }))
    .filter((entry) => entry.node)
    .sort((a, b) => b.node.total - a.node.total);
  const sourcePath = record?.path || "";
  return {
    ok: true,
    node,
    source: {
      relativePath: graphRelativePath(root, sourcePath),
      updatedAt: record?.updatedAt || node.updatedAt,
      properties: publicProperties(record?.props || {}),
      preview: record ? buildPreview(record) : ""
    },
    backlinks: incoming.slice(0, edgeLimit),
    outlinks: outgoing.slice(0, edgeLimit),
    backlinksTotal: incoming.length,
    outlinksTotal: outgoing.length,
    edgeLimit,
    insights: snapshot.insights.filter((insight) => insight.nodeIds?.includes(node.id)).slice(0, 8),
    xray: buildEntityXray(snapshot, record, node, incoming, outgoing)
  };
}

function boundedInteger(value, defaultValue, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}

function graphRelativePath(root, sourcePath) {
  if (!sourcePath) return "";
  return root ? path.relative(root, sourcePath) : sourcePath;
}

function publicProperties(props) {
  const publicProps = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (PUBLIC_PROPERTY_KEYS.has(key)) publicProps[key] = value;
  }
  return publicProps;
}

function buildEntityXray(snapshot, record, node, incoming, outgoing) {
  const cluster = snapshot.clusters.find((item) => item.id === node.cluster);
  const clusterRoot = snapshot.nodes.find((item) => item.id === node.cluster);
  const parent = inferParent(snapshot, record, node, incoming, outgoing, clusterRoot);
  const proofDebt = proofDebtFor(node);
  const strongestById = new Map();
  for (const entry of incoming) {
    const current = strongestById.get(entry.node.id) || { node: entry.node, directions: new Set(), relationKinds: new Set() };
    current.directions.add("inbound");
    strongestById.set(entry.node.id, current);
  }
  for (const entry of outgoing) {
    const current = strongestById.get(entry.node.id) || { node: entry.node, directions: new Set(), relationKinds: new Set() };
    current.directions.add("outbound");
    strongestById.set(entry.node.id, current);
  }
  for (const relation of record?.relations || []) {
    const current = strongestById.get(relation.target);
    if (current) current.relationKinds.add(relation.kind);
  }
  const strongest = [...strongestById.values()]
    .sort((a, b) => b.node.total + b.node.heat * 18 - (a.node.total + a.node.heat * 18))
    .slice(0, 5)
    .map((entry) => ({
      id: entry.node.id,
      name: entry.node.name,
      type: entry.node.type,
      cluster: entry.node.clusterLabel,
      degree: entry.node.total,
      heat: entry.node.heat,
      directions: [...entry.directions],
      relationKinds: [...entry.relationKinds]
    }));
  const staleDays = Math.max(0, Math.round((Date.now() - Date.parse(node.updatedAt || record?.updatedAt || new Date())) / 86400000));
  return {
    kind: "source_page_node",
    parent,
    cluster: cluster ? {
      id: cluster.id,
      label: cluster.label,
      count: cluster.count,
      degree: cluster.degree,
      bridges: cluster.bridges,
      heat: cluster.heat
    } : null,
    staleDays,
    proofDebt,
    strongest,
    signalSummary: [
      `${node.in} links in`,
      `${node.out} links out`,
      `${node.total} total links`,
      `${Math.round(node.heat * 100)} heat`
    ]
  };
}

function inferParent(snapshot, record, node, incoming, outgoing, clusterRoot) {
  const nodeById = new Map(snapshot.nodes.map((item) => [item.id, item]));
  const explicit = (record?.relations || [])
    .filter((relation) => PARENT_RELATIONS.has(relation.kind))
    .map((relation) => ({ relation, target: nodeById.get(relation.target) }))
    .filter((entry) => entry.target && entry.target.id !== node.id)
    .sort((a, b) => b.target.total - a.target.total)[0];
  if (explicit) {
    return {
      id: explicit.target.id,
      name: explicit.target.name,
      relation: `explicit ${explicit.relation.kind}`,
      evidence: explicit.relation.evidence
    };
  }
  if (clusterRoot && clusterRoot.id !== node.id) {
    const linkedRoot = [...incoming, ...outgoing].find((entry) => entry.node?.id === clusterRoot.id);
    if (linkedRoot) {
      return {
        id: clusterRoot.id,
        name: clusterRoot.name,
        relation: "linked cluster root"
      };
    }
  }
  const parentCandidate = [...incoming, ...outgoing]
    .map((entry) => entry.node)
    .filter(Boolean)
    .filter((candidate) => candidate.id !== node.id)
    .sort((a, b) => b.total - a.total)[0];
  return parentCandidate ? {
    id: parentCandidate.id,
    name: parentCandidate.name,
    relation: parentCandidate.cluster === node.cluster ? "strongest local anchor" : "strongest linked anchor"
  } : null;
}

function linkWeight(sourceDegree, targetDegree) {
  const topology = Math.sqrt(Math.max(1, sourceDegree) * Math.max(1, targetDegree));
  return round(Math.max(0.18, Math.min(1, topology / 44)));
}

function clusterPairKey(a, b) {
  return [a, b].sort().join(":");
}

function addNeighborCluster(map, nodeId, clusterId) {
  const current = map.get(nodeId) || new Set();
  current.add(clusterId);
  map.set(nodeId, current);
}

function bridgeAnchors(nodes, sourceClusterId, targetClusterId, nodeNeighborClusters) {
  return nodes
    .filter((node) => node.cluster === sourceClusterId)
    .map((node) => ({
      node,
      linkedToTarget: nodeNeighborClusters.get(node.id)?.has(targetClusterId) ? 1 : 0,
      debt: proofDebtFor(node).length
    }))
    .filter((entry) => entry.linkedToTarget || entry.node.total <= 2 || entry.node.heat > 0.45)
    .sort((a, b) => {
      const aScore = a.linkedToTarget * 90 + a.node.heat * 25 + a.debt * 4 + Math.max(0, 6 - a.node.total);
      const bScore = b.linkedToTarget * 90 + b.node.heat * 25 + b.debt * 4 + Math.max(0, 6 - b.node.total);
      return bScore - aScore;
    })
    .slice(0, 4)
    .map((entry) => entry.node);
}

function clusterSummary(cluster) {
  return {
    id: cluster.id,
    label: cluster.label,
    count: cluster.count,
    heat: cluster.heat,
    degree: cluster.degree,
    bridges: cluster.bridges
  };
}

function clusterBridgePriority(clusterId) {
  if (clusterId === "people") return -42;
  if (clusterId === "organizations") return -32;
  if (clusterId === "projects") return 4;
  if (clusterId === "operations") return 2;
  return 18;
}

function buildPreview(record) {
  const useful = [];
  for (const [key, value] of Object.entries(publicProperties(record.props || {}))) {
    if (["type", "tags", "last-contacted"].includes(key)) continue;
    if (value) useful.push(`${key}: ${value}`);
  }
  return useful.slice(0, 5).join(" · ");
}

function buildClusters(records) {
  const anchors = buildClusterAnchors(records);
  const map = new Map();
  for (const record of records) {
    let found = null;
    if (record.type !== "person") {
      const tagIds = new Set((record.tags || []).map(slugify));
      found = anchors.find((anchor) => (
        anchor.dynamic &&
        (record.id === anchor.id || tagIds.has(anchor.id) || (record.out || []).includes(anchor.id))
      ));
    }
    if (!found) found = genericClusterFor(record);
    map.set(record.id, { id: found.id, label: found.label });
  }
  return map;
}

function buildClusterAnchors(records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const scores = new Map();
  const add = (id, label, score) => {
    const normalized = slugify(id);
    if (!isUsefulDynamicClusterId(normalized)) return;
    const current = scores.get(normalized) || { id: normalized, label: labelFromSlug(label || normalized), score: 0 };
    current.score += score;
    scores.set(normalized, current);
  };

  for (const record of records) {
    if (["project", "organization", "infrastructure", "area", "initiative", "product"].includes(record.type)) {
      add(record.id, record.name, 4 + Math.min(8, (record.out || []).length));
    }
    for (const tag of record.tags || []) add(tag, tag, 3);
    for (const target of record.out || []) {
      const targetRecord = byId.get(target);
      if (targetRecord && ["project", "organization", "infrastructure", "area", "initiative", "product"].includes(targetRecord.type)) {
        add(targetRecord.id, targetRecord.name, 1.5);
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 8)
    .map((anchor) => ({ ...anchor, dynamic: true }));
}

function isUsefulDynamicClusterId(id) {
  if (!id || id.length < 2) return false;
  return !new Set([
    "people",
    "person",
    "organizations",
    "organization",
    "org",
    "projects",
    "project",
    "operations",
    "notes",
    "note",
    "todo",
    "doing",
    "done",
    "active",
    "archive"
  ]).has(id);
}

function genericClusterFor(record) {
  if (record.type === "person") return { id: "people", label: "People" };
  if (record.type === "organization") return { id: "organizations", label: "Organizations" };
  if (record.type === "project" || record.type === "initiative" || record.type === "product") return { id: "projects", label: "Projects" };
  if (record.type === "infrastructure" || record.type === "system" || record.type === "service") return { id: "infrastructure", label: "Infrastructure" };
  if (record.type === "event" || record.type === "meeting") return { id: "events", label: "Events" };
  if (record.type === "location" || record.type === "place") return { id: "locations", label: "Locations" };
  if (record.type === "operation" || record.type === "workflow" || record.type === "process") return { id: "workflows", label: "Workflows" };
  return { id: "topics", label: "Topics" };
}

function labelFromSlug(value) {
  return String(value || "")
    .replace(/___/g, "/")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function summarizeClusters(nodes, links) {
  const grouped = new Map();
  const nodeCluster = new Map(nodes.map((node) => [node.id, node.cluster]));
  for (const node of nodes) {
    const entry = grouped.get(node.cluster) || {
      id: node.cluster,
      label: node.clusterLabel,
      count: 0,
      heat: 0,
      degree: 0,
      color: node.color
    };
    entry.count += 1;
    entry.heat += node.heat;
    entry.degree += node.total;
    grouped.set(node.cluster, entry);
  }
  const linkCount = new Map();
  for (const link of links) {
    const sourceCluster = nodeCluster.get(link.source);
    const targetCluster = nodeCluster.get(link.target);
    if (!sourceCluster || !targetCluster || sourceCluster === targetCluster) continue;
    linkCount.set(sourceCluster, (linkCount.get(sourceCluster) || 0) + 1);
    linkCount.set(targetCluster, (linkCount.get(targetCluster) || 0) + 1);
  }
  return [...grouped.values()]
    .map((entry) => ({
      ...entry,
      bridges: linkCount.get(entry.id) || 0,
      heat: round(entry.heat / Math.max(1, entry.count)),
      degree: Math.round(entry.degree)
    }))
    .sort((a, b) => b.count - a.count);
}

function buildInsights(nodes, links, dangling, now) {
  const insights = [];
  const hot = nodes.filter((node) => node.heat > 0.7).sort((a, b) => b.heat - a.heat).slice(0, 12);
  if (hot.length) {
    insights.push({
      id: "recent-ignitions",
      severity: "live",
      title: `${hot.length} pages are actively pulsing`,
      detail: "Recently touched pages are emitting high-heat particles in Today mode.",
      metric: hot.length,
      nodeIds: hot.map((node) => node.id),
      action: {
        kind: "focus_hot_pages",
        label: "Open pulse",
        target: "Today",
        rationale: "recent file timestamps crossed the high-heat threshold",
        nextStep: "Switch to Today and inspect the hot source pages"
      },
      provenance: hot.slice(0, 5).map((node) => ({ name: node.name, updatedAt: node.updatedAt }))
    });
  }

  const weak = nodes
    .filter((node) => node.total <= 1 && !META_TYPES.has(node.type) && node.type !== "redirect")
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 12);
  if (weak.length) {
    insights.push({
      id: "weak-pressure-gaps",
      severity: "attention",
      title: `${weak.length} weakly connected pages need connector checks`,
      detail: "These pages are present in the knowledge field but have very few trusted links.",
      metric: weak.length,
      nodeIds: weak.map((node) => node.id),
      action: {
        kind: "review_weak_pages",
        label: "Check connectors",
        target: "Radar",
        rationale: "low-link pages are easy to lose at atlas scale",
        nextStep: "Review connector candidates or add explicit wikilinks"
      },
      provenance: weak.slice(0, 5).map((node) => ({ name: node.name, degree: node.total }))
    });
  }

  const hubs = [...nodes].sort((a, b) => b.total - a.total).slice(0, 8);
  if (hubs.length) {
    insights.push({
      id: "gravity-wells",
      severity: "context",
      title: `${hubs.length} hub pages anchor the atlas`,
      detail: "Large hubs shape the living terrain and should remain explainable.",
      metric: hubs[0].total,
      nodeIds: hubs.map((node) => node.id),
      action: {
        kind: "inspect_hubs",
        label: "Open hubs",
        target: "Cluster Command Deck",
        rationale: "high-link pages strongly shape the visual field",
        nextStep: "Inspect the strongest hubs for stale or unclear provenance"
      },
      provenance: hubs.slice(0, 5).map((node) => ({ name: node.name, degree: node.total }))
    });
  }

  if (dangling.length) {
    const top = dangling.sort((a, b) => b.refs - a.refs).slice(0, 8);
    insights.push({
      id: "dangling-filaments",
      severity: "attention",
      title: `${dangling.length} unresolved link targets create phantom matter`,
      detail: "Create stubs or rewrite references before trusting those filaments.",
      metric: dangling.length,
      nodeIds: [],
      action: {
        kind: "resolve_dangling_targets",
        label: "See targets",
        target: top[0]?.target || "dangling links",
        rationale: "unresolved wikilinks create phantom matter in the field",
        nextStep: "Create missing pages or rewrite the strongest unresolved refs"
      },
      provenance: top.map((item) => ({ target: item.target, refs: item.refs, sources: item.sources.slice(0, 3) }))
    });
  }

  const staleCutoff = now.getTime() - 45 * 24 * 60 * 60 * 1000;
  const staleProjects = nodes
    .filter((node) => node.type === "project" && Date.parse(node.updatedAt) < staleCutoff)
    .slice(0, 10);
  if (staleProjects.length) {
    insights.push({
      id: "cooling-projects",
      severity: "watch",
      title: `${staleProjects.length} project regions are cooling`,
      detail: "Projects dim when they have not changed in 45 days.",
      metric: staleProjects.length,
      nodeIds: staleProjects.map((node) => node.id),
      action: {
        kind: "review_project_drift",
        label: "Review drift",
        target: "Project pages",
        rationale: "old project timestamps indicate cooling knowledge regions",
        nextStep: "Review stale projects and update, archive, or reconnect them"
      },
      provenance: staleProjects.slice(0, 5).map((node) => ({ name: node.name, updatedAt: node.updatedAt }))
    });
  }

  return insights;
}

function stablePosition(record, cluster, degree, degreeMax) {
  const clusterHash = hash(cluster.id);
  const angle = (clusterHash % 6283) / 1000;
  const radius = 32 + (clusterHash % 19);
  const center = {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * 0.68,
    z: Math.sin(angle * 1.7) * 14
  };
  const h = hash(record.id);
  const localAngle = ((h >>> 4) % 6283) / 1000;
  const localRadius = 3 + (((h >>> 11) % 1000) / 1000) * (10 + Math.sqrt(Math.max(1, degree)) * 2.5);
  const gravity = Math.min(1, degree / degreeMax);
  return {
    x: center.x + Math.cos(localAngle) * localRadius * (1.25 - gravity * 0.45),
    y: center.y + Math.sin(localAngle) * localRadius * (0.9 - gravity * 0.25),
    z: center.z + (((h >>> 21) % 1000) / 1000 - 0.5) * 18
  };
}

function activityScore(mtimeMs, now) {
  const ageHours = Math.max(0, now.getTime() - Number(mtimeMs || 0)) / 36e5;
  if (ageHours <= 24) return 1;
  if (ageHours <= 168) return 0.58;
  if (ageHours <= 720) return 0.28;
  return 0.08;
}

function colorFor(record, cluster) {
  return paletteColor(cluster.id || record.type || "default");
}

function paletteColor(id) {
  const colors = ["#ffd66b", "#ff8b72", "#b276ff", "#62e7ff", "#6df0aa", "#e96dae", "#f4d57e", "#7de3ff"];
  return colors[Math.abs(hash(id)) % colors.length];
}

function hash(input) {
  let h = 2166136261;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
