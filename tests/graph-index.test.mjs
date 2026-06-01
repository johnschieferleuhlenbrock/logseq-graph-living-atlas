import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSnapshot,
  connectorCandidates,
  budgetSnapshot,
  diffSnapshots,
  focusSnapshot,
  nodeDetail,
  pathSnapshot,
  searchSnapshot,
} from "../server/graph-index.mjs";
import { extractTypedRelations, extractWikilinks, parsePageRecord, slugify } from "../server/logseq/parser.mjs";
import { readGraphManifest, readPageRecords } from "../server/logseq/source-adapter.mjs";

test("slugify matches Logseq namespace page convention", () => {
  assert.equal(slugify("schema/properties"), "schema___properties");
  assert.equal(slugify("Nexus Fundraise.md"), "nexus fundraise");
});

test("pathSnapshot returns an evidence-backed route between concepts", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const snapshot = buildSnapshot(
    [
      page("Orion", "type:: organization\n- [[Bridge]]", now),
      page("Bridge", "type:: project\n- [[Pipeline]]", now),
      page("Pipeline", "type:: infrastructure\n- [[Atlas]]", now),
      page("Atlas", "type:: project\n", now)
    ],
    { now }
  );
  const path = pathSnapshot(snapshot, "Orion", "Atlas", 4);
  assert.equal(path.ok, true);
  assert.equal(path.depth, 3);
  assert.deepEqual(path.nodes.map((node) => node.name), ["Orion", "Bridge", "Pipeline", "Atlas"]);
  assert.equal(path.steps.length, 3);
  assert.match(path.steps[0].evidence, /Orion links to Bridge/);
});

test("pathSnapshot returns scored alternate bounded routes", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const snapshot = buildSnapshot(
    [
      page("A", "type:: project\nsource:: fixture\nstatus:: active\nconfidence:: high\n- [[B]] [[C]]", now),
      page("B", "type:: project\nsource:: fixture\nstatus:: active\nconfidence:: high\n- [[D]]", now),
      page("C", "type:: project\nsource:: fixture\nstatus:: active\nconfidence:: high\n- [[D]]", now),
      page("D", "type:: project\nsource:: fixture\nstatus:: active\nconfidence:: high\n", now)
    ],
    { now }
  );
  const path = pathSnapshot(snapshot, "A", "D", 3);
  assert.equal(path.ok, true);
  assert.deepEqual(path.nodes.map((node) => node.name), ["A", "B", "D"]);
  assert.ok(path.alternateRoutes.length >= 1);
  assert.deepEqual(path.alternateRoutes[0].nodes, ["A", "C", "D"]);
  assert.equal(typeof path.alternateRoutes[0].score.score, "number");
});

test("pathSnapshot reports missing endpoints and bounded searches", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const snapshot = buildSnapshot(
    [
      page("A", "type:: project\n- [[B]]", now),
      page("B", "type:: project\n", now),
      page("C", "type:: project\n", now)
    ],
    { now }
  );
  assert.equal(pathSnapshot(snapshot, "A", "Missing").ok, false);
  const unresolved = pathSnapshot(snapshot, "A", "C", 2);
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.error, "no path within depth");
});

test("searchSnapshot searches the full graph and reports omitted matches", () => {
  const now = "2026-05-31T12:00:00.000Z";
  const snapshot = buildSnapshot([
    page("Atlas", "type:: project\ntags:: [[visual search]]\n- [[Project Orion]]", now),
    page("Atlas Search Archive", "type:: project\n- [[Atlas]]", now),
    page("Operations", "type:: service\ntags:: atlas\n- [[Atlas]]", now)
  ], { now });
  const result = searchSnapshot(snapshot, "atlas", 2);
  assert.equal(result.ok, true);
  assert.equal(result.totalMatches, 3);
  assert.equal(result.omitted, 1);
  assert.deepEqual(result.results.map((node) => node.name), ["Atlas", "Atlas Search Archive"]);
});

test("extractWikilinks ignores code and normalizes targets", () => {
  const links = extractWikilinks("Link [[Nexus]] `[[Ignored]]`\n```md\n[[Also Ignored]]\n```\n[[schema/properties]]");
  assert.deepEqual(links, ["nexus", "schema___properties"]);
});

test("extractTypedRelations reads Logseq properties and markdown labels", () => {
  const relations = extractTypedRelations("company:: [[Nexus]]\n- **Owner:** [[Person One]]\n- Company: [[Duplicate Ignored]]", {
    company: "[[Nexus]]"
  });
  assert.ok(relations.some((relation) => relation.kind === "company" && relation.target === "nexus"));
  assert.ok(relations.some((relation) => relation.kind === "owner" && relation.target === "person one"));
});

test("buildSnapshot produces nodes, links, clusters, insights, and stable focus", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const records = [
    page("Person One", "type:: person\ntags:: [[Nexus]]\n- [[Nexus]] [[Atlas]]", now),
    page("Nexus", "type:: organization\n- [[Person One]] [[Atlas]]", now),
    page("Atlas", "type:: project\n- [[Nexus]]", now),
    page("Loose Note", "type:: project\n- [[Missing Thing]]", "2025-01-01T00:00:00.000Z")
  ];
  const snapshot = buildSnapshot(records, { now });
  assert.equal(snapshot.totals.nodes, 4);
  assert.equal(snapshot.totals.links, 5);
  assert.ok(snapshot.links.every((link) => typeof link.weight === "number" && link.weight > 0), "links expose topology weight");
  assert.equal(snapshot.totals.dangling, 1);
  assert.ok(snapshot.clusters.some((cluster) => cluster.label === "Nexus"));
  assert.ok(snapshot.insights.some((insight) => insight.id === "dangling-filaments"));
  assert.ok(snapshot.insights.every((insight) => insight.action?.kind && insight.action?.nextStep), "insights expose explicit action contracts");

  const focus = focusSnapshot(snapshot, "Atlas", 1);
  assert.equal(focus.ok, true);
  assert.equal(focus.seed.name, "Atlas");
  assert.ok(focus.nodes.some((node) => node.name === "Nexus"));
});

test("nodeDetail returns every direct edge for a selected node", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const records = [
    page("Hub", "type:: project\n- [[Leaf 1]] [[Leaf 2]] [[Leaf 3]] [[Leaf 4]] [[Leaf 5]] [[Leaf 6]] [[Leaf 7]]\n", now),
    ...Array.from({ length: 7 }, (_, index) => page(`Leaf ${index + 1}`, `type:: project\n- [[Hub]]\n`, now))
  ];
  const snapshot = buildSnapshot(records, { now });
  const detail = nodeDetail(snapshot, records, "Hub", "/tmp");
  assert.equal(detail.ok, true);
  assert.equal(detail.outlinks.length, 7);
  assert.equal(detail.backlinks.length, 7);
  assert.ok(detail.outlinks.every((entry) => typeof entry.weight === "number"));
});

test("nodeDetail caps hub edge samples while preserving totals", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const leafCount = 320;
  const records = [
    page("Hub", `type:: project\n- ${Array.from({ length: leafCount }, (_, index) => `[[Leaf ${index + 1}]]`).join(" ")}\n`, now),
    ...Array.from({ length: leafCount }, (_, index) => page(`Leaf ${index + 1}`, "type:: project\n- [[Hub]]\n", now))
  ];
  const snapshot = buildSnapshot(records, { now });
  const detail = nodeDetail(snapshot, records, "Hub", "/tmp", null, { edgeLimit: 25 });
  assert.equal(detail.ok, true);
  assert.equal(detail.outlinks.length, 25);
  assert.equal(detail.backlinks.length, 25);
  assert.equal(detail.outlinksTotal, leafCount);
  assert.equal(detail.backlinksTotal, leafCount);
  assert.equal(detail.edgeLimit, 25);
});

test("budgetSnapshot keeps full totals while capping render payload", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const records = [];
  for (let index = 0; index < 80; index += 1) {
    const anchor = index % 2 === 0 ? "Atlas" : "Nexus";
    const prev = index > 0 ? `[[Node ${index - 1}]]` : "";
    records.push(page(`Node ${index}`, `type:: project\ntags:: [[${anchor}]]\n- [[${anchor}]] ${prev}\n`, now));
  }
  records.push(page("Atlas", "type:: project\n", now));
  records.push(page("Nexus", "type:: organization\n- [[Atlas]]\n", now));
  const snapshot = buildSnapshot(records, { now });
  const budgeted = budgetSnapshot(snapshot, { nodeBudget: 24, linkBudget: 48 });
  assert.equal(budgeted.totals.nodes, 82);
  assert.equal(budgeted.nodes.length, 24);
  assert.ok(budgeted.links.length <= 48);
  assert.equal(budgeted.health.fullNodes, 82);
  assert.match(budgeted.health.renderPolicy, /overview-budget/);
  assert.ok(budgeted.nodes.some((node) => node.name === "Atlas"));
});

test("focusSnapshot supports bounded cluster slices", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const records = Array.from({ length: 40 }, (_, index) =>
    page(`Nexus Synthetic ${index}`, `type:: project\ntags:: [[Nexus]]\n- [[Nexus Synthetic ${Math.max(0, index - 1)}]]\n`, now)
  );
  const snapshot = buildSnapshot(records, { now });
  const focus = focusSnapshot(snapshot, "Nexus", 2, 12);
  assert.equal(focus.ok, true);
  assert.equal(focus.focusKind, "cluster");
  assert.equal(focus.nodes.length, 12);
  assert.equal(focus.limited, true);
  assert.equal(focus.totalMatches, 40);
});

test("diffSnapshots reports added and changed render entities", () => {
  const oldSnapshot = buildSnapshot(
    [page("A", "type:: project\n- [[B]]", "2026-05-29T00:00:00.000Z"), page("B", "type:: project", "2026-05-29T00:00:00.000Z")],
    { now: "2026-05-30T00:00:00.000Z" }
  );
  const newSnapshot = buildSnapshot(
    [
      page("A", "type:: project\n- [[B]] [[C]]", "2026-05-30T00:00:00.000Z"),
      page("B", "type:: project", "2026-05-29T00:00:00.000Z"),
      page("C", "type:: person\n- [[A]]", "2026-05-30T00:00:00.000Z")
    ],
    { now: "2026-05-30T00:00:00.000Z" }
  );
  const diff = diffSnapshots(oldSnapshot, newSnapshot);
  assert.equal(diff.addedNodes.length, 1);
  assert.equal(diff.removedNodes.length, 0);
  assert.ok(diff.changedNodes.some((node) => node.name === "A"));
  assert.ok(diff.addedLinks.some((link) => link.id === "a->c"));
  assert.equal(diff.removedLinks.length, 0);

  const deletionSnapshot = buildSnapshot(
    [page("A", "type:: project\n", "2026-05-30T00:00:00.000Z")],
    { now: "2026-05-30T00:00:00.000Z" }
  );
  const deletion = diffSnapshots(newSnapshot, deletionSnapshot);
  assert.ok(deletion.removedNodes.some((node) => node.name === "B"));
  assert.ok(deletion.removedLinks.some((link) => link.id === "a->b"));
});

test("readPageRecords parses Logseq pages and journals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "living-atlas-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.mkdirSync(path.join(root, "journals"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\n- [[Beta]]\n", "utf8");
  fs.writeFileSync(path.join(root, "pages", "Beta.md"), "type:: person\n", "utf8");
  fs.writeFileSync(path.join(root, "journals", "2026_05_31.md"), "- [[Alpha]] daily note\n", "utf8");
  const records = readPageRecords(root);
  assert.equal(records.length, 3);
  assert.ok(records.some((record) => record.name === "Alpha" && record.out.includes("beta")));
  assert.ok(records.some((record) => record.name === "2026_05_31" && record.out.includes("alpha")));
  const manifest = readGraphManifest(root);
  assert.equal(manifest.pages, 3);
  assert.ok(manifest.graphId);
  assert.ok(manifest.fingerprint);
});

test("readGraphManifest fingerprint changes for same-size timestamp-preserving rewrites", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "living-atlas-manifest-content-"));
  try {
    fs.mkdirSync(path.join(root, "pages"));
    const pagePath = path.join(root, "pages", "Alpha.md");
    fs.writeFileSync(pagePath, "type:: project\n- [[Beta]]\n", "utf8");
    const initialStat = fs.statSync(pagePath);
    const before = readGraphManifest(root);
    fs.writeFileSync(pagePath, "type:: project\n- [[Zeta]]\n", "utf8");
    fs.utimesSync(pagePath, initialStat.atime, initialStat.mtime);
    const after = readGraphManifest(root);
    assert.equal(after.pages, before.pages);
    assert.notEqual(after.fingerprint, before.fingerprint);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readPageRecords preserves nested Logseq namespace identity and rejects duplicate page ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "living-atlas-namespace-"));
  try {
    fs.mkdirSync(path.join(root, "pages", "schema"), { recursive: true });
    fs.writeFileSync(path.join(root, "pages", "schema", "properties.md"), "type:: project\n- [[schema/properties]]\n", "utf8");
    const records = readPageRecords(root);
    assert.equal(records[0].name, "schema/properties");
    assert.equal(records[0].id, "schema___properties");

    fs.writeFileSync(path.join(root, "pages", "schema___properties.md"), "type:: project\n", "utf8");
    assert.throws(() => readPageRecords(root), /Duplicate Logseq page identities/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("nodeDetail returns source path, properties, links in, and links out", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const records = [
    page("Alpha", "type:: project\nstatus:: active\nsource:: fixture\nprivate-note:: should-not-appear\naccount:: should-not-appear\n- [[Beta]]\n", now),
    page("Beta", "type:: person\n- [[Alpha]]\n", now)
  ];
  const snapshot = buildSnapshot(records, { now });
  const detail = nodeDetail(snapshot, records, "Alpha", "/tmp");
  assert.equal(detail.ok, true);
  assert.equal(detail.node.name, "Alpha");
  assert.equal(detail.source.relativePath, "Alpha.md");
  assert.equal(detail.source.properties.status, "active");
  assert.equal(detail.source.properties["private-note"], undefined);
  assert.equal(detail.source.properties.account, undefined);
  assert.match(detail.source.preview, /status: active/);
  assert.doesNotMatch(detail.source.preview, /should-not-appear/);
  assert.equal(detail.backlinks.length, 1);
  assert.equal(detail.outlinks.length, 1);
  assert.equal(detail.xray.kind, "source_page_node");
  assert.ok(detail.xray.signalSummary.some((item) => item.includes("total links")));
  assert.ok(detail.xray.strongest.some((item) => item.name === "Beta"));
});

test("nodeDetail xray reports review context and parent anchor", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const records = [
    page("Nexus", "type:: organization\nsource:: fixture\nstatus:: active\nconfidence:: high\n- [[Atlas]]\n", now),
    page("Atlas", "type:: project\ncompany:: [[Nexus]]\n- [[Nexus]]\n", now)
  ];
  const snapshot = buildSnapshot(records, { now });
  const detail = nodeDetail(snapshot, records, "Atlas", "/tmp");
  assert.equal(detail.ok, true);
  assert.equal(detail.xray.parent.name, "Nexus");
  assert.equal(detail.xray.parent.relation, "explicit company");
  assert.ok(detail.xray.proofDebt.some((item) => item.label === "missing source"));
  assert.ok(detail.xray.proofDebt.some((item) => item.label === "confidence missing"));
});

test("nodeDetail xray prefers explicit company parent over high-degree anchors and dedupes strongest relations", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const records = [
    page("Nexus", "type:: organization\nstatus:: active\nsource:: fixture\nconfidence:: high\n- [[Atlas]]\n", now),
    page("Person One", "type:: person\nstatus:: active\nsource:: fixture\nconfidence:: high\n- [[Atlas]] [[Alpha]] [[Beta]] [[Gamma]]\n", now),
    page("Atlas", "type:: project\ncompany:: [[Nexus]]\n- [[Nexus]] [[Person One]]\n", now),
    page("Alpha", "type:: project\n- [[Person One]]\n", now),
    page("Beta", "type:: project\n- [[Person One]]\n", now),
    page("Gamma", "type:: project\n- [[Person One]]\n", now)
  ];
  const snapshot = buildSnapshot(records, { now });
  const detail = nodeDetail(snapshot, records, "Atlas", "/tmp");
  assert.equal(detail.ok, true);
  assert.equal(detail.xray.parent.name, "Nexus");
  assert.equal(detail.xray.strongest.filter((item) => item.name === "Nexus").length, 1);
  assert.ok(detail.xray.strongest.find((item) => item.name === "Nexus").directions.includes("inbound"));
  assert.ok(detail.xray.strongest.find((item) => item.name === "Nexus").directions.includes("outbound"));
  assert.ok(detail.xray.strongest.find((item) => item.name === "Nexus").relationKinds.includes("company"));
});

test("connectorCandidates ranks under-connected hot cluster pairs deterministically", () => {
  const hot = "2026-05-30T12:00:00.000Z";
  const cool = "2025-01-01T00:00:00.000Z";
  const records = [
    page("Atlas", "type:: project\nstatus:: active\nsource:: fixture\nconfidence:: high\n- [[Nexus]]\n", hot),
    page("Atlas Gap", "type:: project\ntags:: [[Atlas]]\n- [[Atlas]]\n", hot),
    page("Pipeline", "type:: infrastructure\nstatus:: active\nsource:: fixture\nconfidence:: high\n", hot),
    page("Pipeline Gap", "type:: project\ntags:: [[Pipeline]]\n- [[Pipeline]]\n", hot),
    page("Person One", "type:: person\n- [[Org One]]\n", cool),
    page("Person Two", "type:: person\n- [[Org Two]]\n", cool),
    page("Org One", "type:: organization\n- [[Person One]]\n", cool),
    page("Org Two", "type:: organization\n- [[Person Two]]\n", cool),
    page("Nexus", "type:: organization\n- [[Atlas]]\n", hot)
  ];
  const snapshot = buildSnapshot(records, { now: hot });
  const candidates = connectorCandidates(snapshot, 8);
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].id, "atlas:pipeline");
  assert.ok(candidates[0].anchors.some((anchor) => anchor.name === "Atlas"));
});

test("connectorCandidates suppresses adequately connected cluster pairs", () => {
  const now = "2026-05-30T12:00:00.000Z";
  const records = [
    page("Atlas", "type:: project\n- [[Pipeline]] [[Pipeline Work]] [[Nexus]]\n", now),
    page("Atlas Work", "type:: project\ntags:: [[Atlas]]\n- [[Pipeline]] [[Pipeline Work]]\n", now),
    page("Pipeline", "type:: infrastructure\n- [[Atlas]] [[Atlas Work]]\n", now),
    page("Pipeline Work", "type:: project\ntags:: [[Pipeline]]\n- [[Atlas]] [[Atlas Work]]\n", now),
    page("Nexus", "type:: organization\n- [[Atlas]]\n", now)
  ];
  const snapshot = buildSnapshot(records, { now });
  const candidates = connectorCandidates(snapshot, 8);
  assert.equal(candidates.some((candidate) => candidate.id === "atlas:pipeline"), false);
});

function page(name, text, isoTime) {
  return parsePageRecord(`/tmp/${name}.md`, text, { mtimeMs: Date.parse(isoTime) });
}
