#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createBrainService } from "../server/service.mjs";

const options = parseArgs(process.argv.slice(2));
const SIZE = options.size;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "living-atlas-service-scale-"));
const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "living-atlas-service-scale-cache-"));
const pages = path.join(root, "pages");
fs.mkdirSync(pages, { recursive: true });
let service = null;

try {
  const writeStart = performance.now();
  for (let index = 0; index < SIZE; index += 1) {
    const anchor = index % 9;
    const previous = Math.max(0, index - 1);
    fs.writeFileSync(
      path.join(pages, `Scale ${index}.md`),
      `type:: ${index % 7 === 0 ? "person" : "project"}\ntags:: [[Region ${anchor}]]\n- [[Scale ${previous}]] [[Region ${anchor}]]\n`,
      "utf8"
    );
  }
  const writeMs = performance.now() - writeStart;

  const port = await getFreePort();
  const start = performance.now();
  service = createBrainService({
    root,
    cachePath: path.join(cacheRoot, "snapshot.json"),
    port,
    watch: options.watch,
    allowUnauthenticatedRead: true,
    allowUnauthenticatedReindex: true
  });
  await service.listen();
  const startupMs = performance.now() - start;
  const snapshotStart = performance.now();
  const snapshot = await fetchJson(`http://127.0.0.1:${port}/api/snapshot`);
  const snapshotMs = performance.now() - snapshotStart;
  const reindexStart = performance.now();
  service.reindex("scale-eval");
  const reindexMs = performance.now() - reindexStart;
  let watchMs = null;
  if (options.watch) {
    const watchStart = performance.now();
    fs.writeFileSync(
      path.join(pages, "Scale Watch.md"),
      `type:: project\ntags:: [[Region watch]]\n- [[Scale ${Math.max(0, SIZE - 1)}]] [[Region watch]]\n`,
      "utf8"
    );
    await waitForCondition(() => service.snapshot.totals.nodes === SIZE + 1, options.watchTimeoutMs);
    watchMs = performance.now() - watchStart;
  }
  await service.close();
  service = null;

  const row = {
    files: SIZE,
    writeMs: Math.round(writeMs),
    startupMs: Math.round(startupMs),
    snapshotMs: Math.round(snapshotMs),
    reindexMs: Math.round(reindexMs),
    watchMs: watchMs === null ? "off" : Math.round(watchMs),
    renderNodes: snapshot.nodes.length,
    renderLinks: snapshot.links.length,
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
  };
  console.table([row]);

  const failures = [];
  if (snapshot.totals.nodes !== SIZE) failures.push(`expected ${SIZE} nodes, saw ${snapshot.totals.nodes}`);
  if (snapshot.nodes.length > 7200) failures.push(`render node budget exceeded: ${snapshot.nodes.length}`);
  if (startupMs > options.startupLimitMs) failures.push(`startup exceeded ${options.startupLimitMs}ms: ${Math.round(startupMs)}ms`);
  if (snapshotMs > options.snapshotLimitMs) failures.push(`snapshot API exceeded ${options.snapshotLimitMs}ms: ${Math.round(snapshotMs)}ms`);
  if (reindexMs > options.reindexLimitMs) failures.push(`manual reindex exceeded ${options.reindexLimitMs}ms: ${Math.round(reindexMs)}ms`);
  if (watchMs !== null && watchMs > options.watchTimeoutMs) failures.push(`watch update exceeded ${options.watchTimeoutMs}ms: ${Math.round(watchMs)}ms`);
  if (row.rssMb > options.rssLimitMb) failures.push(`RSS exceeded ${options.rssLimitMb}MB: ${row.rssMb}MB`);
  if (failures.length) {
    console.error("Service scale evaluation failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
} finally {
  if (service) await service.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(cacheRoot, { recursive: true, force: true });
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const [rawKey, rawValue] = item.slice(2).split("=");
    if (rawValue !== undefined) {
      args.set(rawKey, rawValue);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(rawKey, next);
      index += 1;
    } else {
      args.set(rawKey, true);
    }
  }
  const size = boundedInteger(args.get("size"), 10000, 1, 100000);
  const large = size >= 100000;
  return {
    size,
    watch: args.has("watch"),
    startupLimitMs: boundedInteger(args.get("startup-ms"), large ? 120000 : 15000, 1000, 300000),
    snapshotLimitMs: boundedInteger(args.get("snapshot-ms"), large ? 10000 : 2500, 100, 60000),
    reindexLimitMs: boundedInteger(args.get("reindex-ms"), large ? 120000 : 15000, 1000, 300000),
    watchTimeoutMs: boundedInteger(args.get("watch-ms"), large ? 60000 : 15000, 1000, 180000),
    rssLimitMb: boundedInteger(args.get("rss-mb"), large ? 2500 : 900, 128, 8192)
  };
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value || 0);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(max, parsed);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch failed ${response.status}: ${url}`);
  return response.json();
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForCondition(predicate, timeoutMs) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
