import assert from "node:assert/strict";
import test from "node:test";
import { buildClusterConnectorStats, selectVisibleLinks } from "../../src/visuals/model/links";
import type { AtlasLink, AtlasNode } from "../../src/types";

test("visual link selector preserves selected-node edges and route emphasis", () => {
  const nodes = [
    node("atlas", { cluster: "projects", total: 50 }),
    node("signal", { cluster: "operations", total: 5 }),
    node("person", { cluster: "people", total: 2 }),
    node("quiet", { cluster: "projects", total: 1 })
  ];
  const links = [
    link("atlas->signal", "atlas", "signal", 3),
    link("person->atlas", "person", "atlas", 2),
    link("quiet->signal", "quiet", "signal", 1)
  ];
  const visible = selectVisibleLinks(
    links,
    nodes,
    new Set(nodes.map((item) => item.id)),
    "atlas",
    "Whole Mind",
    new Set(["quiet->signal"]),
    { edgeDensity: "sparse", linkDirection: "all", minLinkWeight: 2 }
  );

  assert.deepEqual(visible.map((item) => item.id).sort(), ["atlas->signal", "person->atlas", "quiet->signal"]);
});

test("cluster connector stats summarize cross-region visible links", () => {
  const nodes = [
    node("atlas", { cluster: "projects" }),
    node("signal", { cluster: "operations" }),
    node("person", { cluster: "people" })
  ];
  const stats = buildClusterConnectorStats(
    [
      link("atlas->signal", "atlas", "signal"),
      link("signal->person", "signal", "person"),
      link("atlas->person", "atlas", "person")
    ],
    nodes,
    new Set(["atlas", "signal", "person"])
  );

  assert.equal(stats.length, 3);
  assert.deepEqual(stats.map((item) => item.count), [1, 1, 1]);
  assert.ok(stats.every((item) => item.weight === 1));
});

function node(id: string, overrides: Partial<AtlasNode> = {}): AtlasNode {
  return {
    id,
    name: id,
    type: "project",
    cluster: "projects",
    clusterLabel: "Projects",
    color: "#fff",
    x: 0,
    y: 0,
    z: 0,
    size: 1,
    heat: 0,
    total: 0,
    in: 0,
    out: 0,
    tags: [],
    source: "fixture",
    status: "active",
    confidence: "high",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides
  };
}

function link(id: string, source: string, target: string, weight = 1): AtlasLink {
  return { id, source, target, weight, kind: "link" };
}

