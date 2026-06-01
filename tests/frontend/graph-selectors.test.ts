import assert from "node:assert/strict";
import test from "node:test";
import { buildFilterOptions, confidenceGroupId, proofDebtLabel, sourceGroupId, statusGroupId } from "../../src/graph/filterGroups";
import { countViewPresets, viewPresetDescription, viewPresetLabel } from "../../src/graph/viewPresets";
import { selectVisibleNodes } from "../../src/graph/visibleNodes";
import type { AtlasLink, AtlasNode, AtlasSnapshot } from "../../src/types";

test("filter groups normalize public metadata into compact options", () => {
  const snapshot = snapshotOf([
    node("atlas", { status: "active", confidence: "high", source: "manual confirmation", total: 4 }),
    node("signal", { status: "prospect", confidence: "medium", source: "meeting notes", total: 2 }),
    node("gap", { status: "", confidence: "low", source: "", total: 1 })
  ]);

  const options = buildFilterOptions(snapshot);
  assert.deepEqual(options.status.map((item) => item.id), ["active", "prospect", "unknown"]);
  assert.equal(statusGroupId("forward-watch"), "active");
  assert.equal(confidenceGroupId("high / medium"), "mixed");
  assert.equal(sourceGroupId("message archive"), "correspondence");
  assert.equal(sourceGroupId("field notes"), "declared:field-notes");
  assert.equal(proofDebtLabel(snapshot.nodes[2]), "no source");
});

test("view presets count connectors, gaps, active pages, and review context", () => {
  const nodes = [
    node("atlas", { cluster: "projects", heat: 0.7, total: 5, source: "fixture", confidence: "high", status: "active" }),
    node("person", { cluster: "people", heat: 0.1, total: 1, source: "", confidence: "unknown", status: "" }),
    node("ops", { cluster: "operations", heat: 0.2, total: 2, source: "fixture", confidence: "medium", status: "dormant" })
  ];
  const counts = countViewPresets(nodes, ["projects", "people", "operations"], "all", "all", "all", new Set(["atlas"]), new Set(["person"]));

  assert.equal(counts.everything, 3);
  assert.equal(counts.active, 1);
  assert.equal(counts.bridges, 1);
  assert.equal(counts.gaps, 1);
  assert.equal(counts.review, 1);
  assert.equal(viewPresetLabel("bridges"), "Connectors");
  assert.match(viewPresetDescription("review"), /flagged pages/);
});

test("visible node selector applies filters and preserves path context", () => {
  const nodes = [
    node("atlas", { cluster: "projects", heat: 0.7, total: 4, source: "fixture", confidence: "high", status: "active" }),
    node("signal", { cluster: "operations", heat: 0.3, total: 3, source: "fixture", confidence: "medium", status: "active" }),
    node("person", { cluster: "people", heat: 0.1, total: 1, source: "", confidence: "unknown", status: "" })
  ];
  const snapshot = snapshotOf(nodes, [link("atlas->signal", "atlas", "signal"), link("person->atlas", "person", "atlas")]);
  const base = {
    activeNodeIds: new Set<string>(),
    atlasView: "everything" as const,
    connectorNodeIds: new Set<string>(),
    confidenceFilter: "all",
    enabledClusterIds: ["projects", "operations"],
    focusResult: null,
    mode: "Whole Mind" as const,
    pathResult: null,
    query: "",
    replayCutoff: "",
    reviewContextNodeIds: new Set<string>(),
    selectedNode: null,
    snapshot,
    sourceFilter: "all",
    statusFilter: "active"
  };

  assert.deepEqual(selectVisibleNodes(base).map((item) => item.id), ["atlas", "signal"]);
  assert.deepEqual(
    selectVisibleNodes({ ...base, enabledClusterIds: ["projects"], query: "atlas" }).map((item) => item.id),
    ["atlas"]
  );
  assert.deepEqual(
    selectVisibleNodes({
      ...base,
      pathResult: {
        ok: true,
        from: nodes[2],
        to: nodes[1],
        nodes: [nodes[2], nodes[0], nodes[1]],
        links: [snapshot.links[1], snapshot.links[0]],
        steps: [],
        depth: 2,
        summary: "Person connects to Signal",
        alternateRoutes: []
      }
    }).map((item) => item.id).sort(),
    ["atlas", "person", "signal"]
  );
});

function node(id: string, overrides: Partial<AtlasNode> = {}): AtlasNode {
  return {
    id,
    name: title(id),
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

function link(id: string, source: string, target: string): AtlasLink {
  return { id, source, target, weight: 1, kind: "link" };
}

function snapshotOf(nodes: AtlasNode[], links: AtlasLink[] = []): AtlasSnapshot {
  return {
    version: 1,
    generatedAt: "2026-05-31T00:00:00.000Z",
    totals: {
      nodes: nodes.length,
      links: links.length,
      pages: nodes.length,
      clusters: 1,
      dangling: 0,
      active24h: 0,
      active7d: 0
    },
    graph: {
      id: "fixture-graph",
      fingerprint: "fixture",
      pages: nodes.length
    },
    nodes,
    links,
    clusters: [],
    insights: [],
    health: {
      source: "fixture",
      layout: "fixture",
      edgePolicy: "fixture"
    }
  };
}

function title(value: string) {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
