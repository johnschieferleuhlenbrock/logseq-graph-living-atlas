#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { buildSnapshot, budgetSnapshot } from "../server/graph-index.mjs";
import { parsePageRecord } from "../server/logseq/parser.mjs";

const sizes = [1000, 10000, 100000];
const results = [];

for (const size of sizes) {
  const records = makeRecords(size);
  const start = performance.now();
  const snapshot = buildSnapshot(records, { now: "2026-05-30T12:00:00.000Z" });
  const renderSnapshot = budgetSnapshot(snapshot, { nodeBudget: 7200, linkBudget: 18000 });
  const elapsedMs = performance.now() - start;
  const approxPayloadMb = Buffer.byteLength(JSON.stringify({
    nodes: snapshot.nodes,
    links: snapshot.links.slice(0, Math.min(snapshot.links.length, size * 3)),
    clusters: snapshot.clusters,
    insights: snapshot.insights
  })) / 1024 / 1024;
  results.push({
    size,
    nodes: snapshot.totals.nodes,
    links: snapshot.totals.links,
    renderNodes: renderSnapshot.nodes.length,
    renderLinks: renderSnapshot.links.length,
    clusters: snapshot.totals.clusters,
    elapsedMs: Math.round(elapsedMs),
    approxPayloadMb: Math.round(approxPayloadMb * 100) / 100,
    approxRenderPayloadMb: Math.round(Buffer.byteLength(JSON.stringify({
      nodes: renderSnapshot.nodes,
      links: renderSnapshot.links,
      clusters: renderSnapshot.clusters,
      insights: renderSnapshot.insights
    })) / 1024 / 1024 * 100) / 100,
    verdict: verdict(size, elapsedMs, approxPayloadMb)
  });
}

console.table(results);

const failed = results.filter((row) => row.verdict !== "pass");
if (failed.length) {
  console.error("Scale evaluation failed", failed);
  process.exit(1);
}

function makeRecords(size) {
  const anchors = ["Atlas", "Nexus", "Orion", "Pipeline", "Bridge", "Ledger", "People", "Operations"];
  const records = anchors.map((name) => parsePageRecord(`/tmp/${name}.md`, `type:: project\n`, { mtimeMs: Date.now() }));
  for (let index = anchors.length; index < size; index += 1) {
    const type = index % 5 === 0 ? "person" : index % 7 === 0 ? "organization" : "project";
    const anchor = anchors[index % anchors.length];
    const prev = `Synthetic ${Math.max(0, index - 1)}`;
    const text = `type:: ${type}\ntags:: [[${anchor}]]\n- [[${anchor}]] [[${prev}]]\n`;
    records.push(parsePageRecord(`/tmp/Synthetic ${index}.md`, text, { mtimeMs: Date.now() - (index % 1000) * 36e5 }));
  }
  return records;
}

function verdict(size, elapsedMs, payloadMb) {
  if (size <= 1000) return elapsedMs < 500 && payloadMb < 8 ? "pass" : "fail";
  if (size <= 10000) return elapsedMs < 3500 && payloadMb < 65 ? "pass" : "fail";
  return elapsedMs < 18000 && payloadMb < 650 ? "pass" : "fail";
}
