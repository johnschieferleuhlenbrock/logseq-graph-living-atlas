import assert from "node:assert/strict";
import test from "node:test";
import {
  clearLivingAtlasLocalData,
  clearLivingAtlasSessionToken,
  persistReviewFlags,
  readReviewFlags,
  reviewFlagRefForNode,
  reviewStorageGraphKey,
  reviewStorageMigrationKeys,
  type ReviewFlag
} from "../../src/state/storage";
import type { AtlasSnapshot } from "../../src/types";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) || null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  key(index: number) {
    return [...this.values.keys()][index] || null;
  }

  get length() {
    return this.values.size;
  }

  keys() {
    return [...this.values.keys()];
  }
}

test("review storage uses stable graph id instead of edit fingerprint", () => {
  const before = snapshot("graph-a", "fingerprint-before");
  const after = snapshot("graph-a", "fingerprint-after");
  assert.equal(reviewStorageGraphKey(before), "graph:graph-a");
  assert.equal(reviewStorageGraphKey(after), "graph:graph-a");
  assert.deepEqual(reviewStorageMigrationKeys(after, "graph:graph-a"), ["fingerprint-after", "2:1:1"]);
});

test("review storage migrates legacy fingerprint buckets into the stable graph key", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  withWindow(localStorage, sessionStorage, () => {
    const flag = reviewFlag("pages/Project Orion.md");
    persistReviewFlags({ [flag.id]: flag }, "legacy-fingerprint");
    const migrated = readReviewFlags("graph:stable", ["legacy-fingerprint"]);
    const [migratedFlag] = Object.values(migrated);
    assert.ok(migratedFlag.nodeRef?.startsWith("node:"));
    assert.equal(migratedFlag.relativePath, undefined);
    assert.equal(migratedFlag.name, undefined);
    const storedText = localStorage.getItem("living-atlas-review-flags:graph:stable") || "{}";
    assert.doesNotMatch(storedText, /Project Orion|pages\/Project Orion/);
  });
});

test("new review flags persist only hashed node references and handoff context", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  withWindow(localStorage, sessionStorage, () => {
    const graphKey = "graph:stable";
    const nodeRef = reviewFlagRefForNode(graphKey, "project orion");
    persistReviewFlags({
      [nodeRef]: {
        id: nodeRef,
        nodeRef,
        nodeId: "project orion",
        name: "Project Orion",
        relativePath: "pages/Project Orion.md",
        createdAt: "2026-05-31T00:00:00.000Z",
        role: "Connector",
        why: "Fixture",
        next: "Review"
      }
    }, graphKey);
    const stored = JSON.parse(localStorage.getItem("living-atlas-review-flags:graph:stable") || "{}");
    assert.equal(stored[nodeRef].nodeRef, nodeRef);
    assert.equal(stored[nodeRef].role, "Connector");
    assert.equal(stored[nodeRef].name, undefined);
    assert.equal(stored[nodeRef].relativePath, undefined);
    assert.equal(stored[nodeRef].nodeId, undefined);
  });
});

test("clear local atlas data removes graph-derived browser state and session token", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  withWindow(localStorage, sessionStorage, () => {
    localStorage.setItem("living-atlas-review-flags:graph:a", "{}");
    localStorage.setItem("living-atlas-display-settings", "{}");
    localStorage.setItem("living-atlas-first-run-dismissed", "1");
    localStorage.setItem("unrelated", "keep");
    sessionStorage.setItem("living-atlas-api-token", "token");

    clearLivingAtlasLocalData("graph:a");
    clearLivingAtlasSessionToken();

    assert.deepEqual(localStorage.keys(), ["unrelated"]);
    assert.equal(sessionStorage.getItem("living-atlas-api-token"), null);
  });
});

function snapshot(graphId: string, fingerprint: string): AtlasSnapshot {
  return {
    generatedAt: "2026-05-31T00:00:00.000Z",
    version: 1,
    totals: { pages: 2, nodes: 2, links: 1, dangling: 0, clusters: 1, active24h: 0, active7d: 0 },
    clusters: [],
    nodes: [
      node("atlas", "Atlas"),
      node("project orion", "Project Orion")
    ],
    links: [],
    insights: [],
    graph: { id: graphId, fingerprint, pages: 2 },
    health: { source: "logseq-markdown", layout: "stable", edgePolicy: "sparse" }
  };
}

function node(id: string, name: string) {
  return {
    id,
    name,
    type: "project",
    tags: [],
    status: "",
    source: "",
    confidence: "",
    updatedAt: "2026-05-31T00:00:00.000Z",
    in: 0,
    out: 0,
    total: 0,
    cluster: "projects",
    clusterLabel: "Projects",
    x: 0,
    y: 0,
    z: 0,
    size: 1,
    heat: 0,
    color: "#fff"
  };
}

function reviewFlag(relativePath: string): ReviewFlag {
  return {
    id: relativePath,
    nodeId: "project orion",
    name: "Project Orion",
    relativePath,
    createdAt: "2026-05-31T00:00:00.000Z",
    role: "Connector",
    why: "Fixture",
    next: "Review"
  };
}

function withWindow(localStorage: MemoryStorage, sessionStorage: MemoryStorage, callback: () => void) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage }
  });
  try {
    callback();
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
}
