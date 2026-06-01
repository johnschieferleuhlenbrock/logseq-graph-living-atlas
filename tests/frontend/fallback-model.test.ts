import assert from "node:assert/strict";
import test from "node:test";
import { fallbackInsightActions, fallbackTopClusters, fallbackTopNodes } from "../../src/graph/fallbackModel";
import type { AtlasCluster, AtlasInsight, AtlasLink, AtlasNode } from "../../src/types";

test("fallback model ranks useful nodes by visible edges before global degree", () => {
  const nodes = [
    node("quiet-hub", "Quiet Hub", 20, 0.1),
    node("visible-core", "Visible Core", 6, 0.2),
    node("visible-leaf", "Visible Leaf", 1, 0.9)
  ];
  const links: AtlasLink[] = [
    { id: "a", source: "visible-core", target: "visible-leaf", kind: "wikilink" },
    { id: "b", source: "visible-core", target: "quiet-hub", kind: "wikilink" }
  ];
  const ranked = fallbackTopNodes(nodes, links, 2);
  assert.deepEqual(ranked.map((item) => item.id), ["visible-core", "quiet-hub"]);
  assert.equal(ranked[0].visibleEdges, 2);
});

test("fallback model exposes top clusters and actionable insights", () => {
  const clusters: AtlasCluster[] = [
    cluster("small", "Small", 3, 30),
    cluster("large", "Large", 20, 2),
    cluster("dense", "Dense", 8, 80)
  ];
  assert.deepEqual(fallbackTopClusters(clusters, 2).map((item) => item.id), ["dense", "large"]);

  const insights: AtlasInsight[] = [
    insight("context", "context", 99, "Inspect"),
    insight("live", "live", 3, "Open"),
    insight("empty", "attention", 100)
  ];
  assert.deepEqual(fallbackInsightActions(insights, 2).map((item) => item.id), ["live", "context"]);
});

function node(id: string, name: string, total: number, heat: number): AtlasNode {
  return {
    id,
    name,
    type: "project",
    tags: [],
    status: "active",
    source: "fixture",
    confidence: "high",
    updatedAt: "2026-05-31T00:00:00.000Z",
    in: 0,
    out: total,
    total,
    cluster: "projects",
    clusterLabel: "Projects",
    x: 0,
    y: 0,
    z: 0,
    size: 1,
    heat,
    color: "#fff"
  };
}

function cluster(id: string, label: string, count: number, degree: number): AtlasCluster {
  return { id, label, count, degree, heat: 0.5, bridges: 0, color: "#fff" };
}

function insight(id: string, severity: AtlasInsight["severity"], metric: number, label?: string): AtlasInsight {
  return {
    id,
    severity,
    title: id,
    detail: id,
    metric,
    nodeIds: [],
    action: label ? { kind: id, label, target: id, rationale: id, nextStep: id } : undefined,
    provenance: []
  };
}
