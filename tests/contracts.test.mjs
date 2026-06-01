import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHE_VERSION,
  ContractError,
  SNAPSHOT_VERSION,
  createCacheEnvelope,
  validateApiSnapshot,
  validateCacheEnvelope,
  validateConnectorResult,
  validateDelta,
  validateFocusResult,
  validateHealth,
  validateNodeDetail,
  validatePathResult,
  validateSearchResult,
  validateSnapshot
} from "../server/contracts.mjs";
import { buildSnapshot, connectorCandidates, diffSnapshots, focusSnapshot, nodeDetail, pathSnapshot, searchSnapshot } from "../server/graph-index.mjs";
import { parsePageRecord } from "../server/logseq/parser.mjs";

test("contract validator accepts current snapshot and cache envelope shape", () => {
  const records = [
    parsePageRecord("/tmp/pages/Alpha.md", "type:: project\n- [[Beta]]\n", { mtimeMs: Date.parse("2026-05-30T00:00:00.000Z") }),
    parsePageRecord("/tmp/pages/Beta.md", "type:: person\n", { mtimeMs: Date.parse("2026-05-30T00:00:00.000Z") })
  ];
  const snapshot = buildSnapshot(records, { now: "2026-05-30T12:00:00.000Z" });
  assert.equal(validateSnapshot(snapshot), snapshot);
  assert.throws(() => validateApiSnapshot(snapshot), /api\.snapshot\.graph/);
  assert.equal(validateApiSnapshot({
    ...snapshot,
    graph: { id: "fixture-graph", fingerprint: "fixture", pages: records.length }
  }).graph.id, "fixture-graph");
  const manifest = { pages: records.length, graphId: "fixture-graph", fingerprint: "fixture", maxMtimeMs: Date.parse("2026-05-30T00:00:00.000Z") };
  const envelope = createCacheEnvelope({ manifest, snapshot, records });
  assert.equal(envelope.version, CACHE_VERSION);
  assert.equal(envelope.snapshot.version, SNAPSHOT_VERSION);
  assert.equal(validateCacheEnvelope(envelope, manifest), envelope);
});

test("contract validator rejects stale or malformed cache envelopes", () => {
  const malformed = {
    version: CACHE_VERSION,
    writtenAt: "2026-05-30T00:00:00.000Z",
    manifest: { pages: 1, fingerprint: "old", maxMtimeMs: 1 },
    snapshot: { version: SNAPSHOT_VERSION },
    records: []
  };
  assert.throws(
    () => validateCacheEnvelope(malformed, { pages: 1, fingerprint: "new", maxMtimeMs: 2 }),
    ContractError
  );
  assert.throws(
    () => validateSnapshot({ version: SNAPSHOT_VERSION, generatedAt: "now", totals: {}, nodes: [], links: [], clusters: [], insights: [], health: {} }),
    /totals.pages/
  );
});

test("contract validators accept public API payload shapes", () => {
  const records = [
    parsePageRecord("/tmp/pages/Alpha.md", "type:: project\nsource:: fixture\n- [[Beta]]\n", { mtimeMs: Date.parse("2026-05-30T00:00:00.000Z") }),
    parsePageRecord("/tmp/pages/Beta.md", "type:: person\nsource:: fixture\n- [[Alpha]]\n", { mtimeMs: Date.parse("2026-05-30T00:00:00.000Z") })
  ];
  const snapshot = buildSnapshot(records, { now: "2026-05-30T12:00:00.000Z" });
  assert.equal(validateHealth({
    ok: true,
    generatedAt: snapshot.generatedAt,
    totals: snapshot.totals,
    cache: { configured: true, hit: false },
    manifest: { pages: records.length, graphId: "fixture-graph", fingerprint: "fixture", maxMtimeMs: Date.parse("2026-05-30T00:00:00.000Z") },
    watch: false,
    bindHost: "127.0.0.1",
    localOnly: true,
    requireToken: false
  }).ok, true);
  assert.equal(validateDelta({ ...diffSnapshots(snapshot, snapshot), eventsOmitted: 0 }).type, "graph_delta");
  assert.equal(validateFocusResult(focusSnapshot(snapshot, "Alpha")).ok, true);
  assert.equal(validateNodeDetail(nodeDetail(snapshot, records, "Alpha", "/tmp")).ok, true);
  assert.equal(validatePathResult(pathSnapshot(snapshot, "Alpha", "Beta")).ok, true);
  assert.equal(validateSearchResult(searchSnapshot(snapshot, "Alpha")).ok, true);
  assert.equal(validateConnectorResult({
    ok: true,
    generatedAt: snapshot.generatedAt,
    candidates: connectorCandidates(snapshot)
  }).ok, true);
});

test("contract validators reject malformed API payloads", () => {
  assert.throws(() => validatePathResult({ ok: true, from: {}, to: {}, depth: "1" }), ContractError);
  assert.throws(() => validateConnectorResult({ ok: true, generatedAt: "now", candidates: [{ id: "bad" }] }), /fromCluster/);
  assert.throws(() => validateFocusResult({ ok: false, error: "not found" }), /focus.query/);
  assert.throws(() => validateSearchResult({ ok: true, generatedAt: "now", query: "a", totalMatches: 1, omitted: 0, results: [{}] }), /results\[0\].id/);
});
