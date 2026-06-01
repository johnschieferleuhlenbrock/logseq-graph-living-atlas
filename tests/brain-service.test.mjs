import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createFixtureGraph } from "../server/fixture/create-fixture-graph.mjs";
import { parsePageRecord } from "../server/logseq/parser.mjs";
import { createBrainService, DEFAULT_SNAPSHOT_NODE_BUDGET } from "../server/service.mjs";

test("brain service CLI exposes help and version without requiring a graph root", () => {
  const help = execFileSync(process.execPath, ["server/brain-service.mjs", "--help"], { encoding: "utf8" });
  assert.match(help, /Usage:/);
  assert.match(help, /npx logseq-graph-living-atlas --root/);
  const version = execFileSync(process.execPath, ["server/brain-service.mjs", "--version"], { encoding: "utf8" }).trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
});

test("brain service prints a concise startup error for invalid graph roots", () => {
  const result = spawnSync(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    path.join(os.tmpdir(), "definitely-not-a-logseq-graph")
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected --root to point at a Logseq graph folder containing pages\//);
  assert.doesNotMatch(result.stderr, /at readLogseqMarkdownFiles/);
});

test("brain service CLI protects real graph reads with a generated local token by default", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-token-default-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-token-default-cache-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\n", "utf8");
  const port = await getFreePort();
  const service = spawn(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    root,
    "--cache",
    path.join(cacheRoot, "snapshot.json"),
    "--no-static",
    "--port",
    String(port)
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  service.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  try {
    await waitForServer(port, stdout, stderr);
    const denied = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(denied.status, 401);
    const token = await waitForStdoutMatch(() => stdout, /session token = ([A-Za-z0-9_-]+)/);
    const allowed = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(allowed.ok, true);
    const health = await allowed.json();
    assert.equal(health.requireToken, true);
  } finally {
    service.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service factory requires read-token mode unless unauthenticated reads are explicit", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-factory-auth-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-factory-auth-cache-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\n", "utf8");
  assert.throws(
    () => createBrainService({
      root,
      cachePath: path.join(cacheRoot, "snapshot.json"),
      port: 0,
      staticDir: null,
      logger: { log() {}, error() {} }
    }),
    /requires LIVING_ATLAS_TOKEN|requires.*token/i
  );
  const credential = ["factory", "read", "credential"].join("-");
  const service = createBrainService({
    root,
    cachePath: path.join(cacheRoot, "snapshot.json"),
    port: 0,
    staticDir: null,
    token: credential,
    logger: { log() {}, error() {} }
  });
  try {
    const started = await service.listen();
    const denied = await fetch(`http://127.0.0.1:${started.port}/api/health`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`http://127.0.0.1:${started.port}/api/health`, {
      headers: { Authorization: `Bearer ${credential}` }
    });
    assert.equal(allowed.ok, true);
    const health = await allowed.json();
    assert.equal(health.requireToken, true);
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service factory can be imported, started, queried, and closed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-factory-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-factory-cache-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\ntags:: [[RedactedTag]]\ncompany:: [[Beta]]\n- [[Beta]]\n", "utf8");
  fs.writeFileSync(path.join(root, "pages", "Beta.md"), "type:: person\n- [[Alpha]]\n", "utf8");
  const service = createBrainService({
    root,
    cachePath: path.join(cacheRoot, "snapshot.json"),
    port: 0,
    staticDir: null,
    allowUnauthenticatedRead: true,
    allowUnauthenticatedReindex: true,
    logger: { log() {}, error() {} }
  });
  try {
    const started = await service.listen();
    assert.equal(started.bindHost, "127.0.0.1");
    const health = await getJson(started.port, "/api/health");
    assert.equal(health.totals.nodes, 2);
    const route = await getJson(started.port, "/api/path?from=Alpha&to=Beta");
    assert.equal(route.ok, true);
    assert.equal(route.depth, 1);
    const redacted = await getJson(started.port, "/api/snapshot?redact=1");
    const redactedText = JSON.stringify(redacted);
    assert.doesNotMatch(redactedText, /Alpha|Beta|pages\/Alpha/i);
    assert.ok(redacted.nodes.every((node) => /^entity-\d{4}$/.test(node.id) && /^entity-\d{4}$/.test(node.name)));
    const redactedDetail = await getJson(started.port, "/api/node?q=Alpha&redact=1");
    const redactedDetailText = JSON.stringify(redactedDetail);
    assert.doesNotMatch(redactedDetailText, /RedactedTag|company::|Beta/i);
    fs.writeFileSync(path.join(root, "pages", "Gamma.md"), "type:: project\n- [[Alpha]]\n", "utf8");
    const reindex = await fetch(`http://127.0.0.1:${started.port}/api/reindex`, { method: "POST" });
    assert.equal(reindex.ok, true);
    assert.equal(service.snapshot.totals.nodes, 3);
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service can run against an injected graph source adapter", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-adapter-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-adapter-cache-"));
  const port = await getFreePort();
  let manifestReads = 0;
  let recordReads = 0;
  const records = [
    parsePageRecord(path.join(root, "pages", "Adapter Alpha.md"), "type:: project\n- [[Adapter Beta]]\n", { mtimeMs: Date.now() }, { root }),
    parsePageRecord(path.join(root, "pages", "Adapter Beta.md"), "type:: person\n", { mtimeMs: Date.now() }, { root })
  ];
  const sourceAdapter = {
    kind: "test-adapter",
    root,
    readManifest() {
      manifestReads += 1;
      return { pages: records.length, graphId: "adapter-fixture", fingerprint: "adapter-v1", maxMtimeMs: Date.now() };
    },
    readRecords() {
      recordReads += 1;
      return records;
    },
    watchDirectories() {
      return [];
    }
  };
  const service = createBrainService({
    root,
    sourceAdapter,
    cachePath: path.join(cacheRoot, "snapshot.json"),
    port,
    allowUnauthenticatedRead: true,
    allowUnauthenticatedReindex: true
  });

  try {
    await service.listen();
    const snapshot = await getJson(port, "/api/snapshot");
    assert.equal(snapshot.graph.id, "adapter-fixture");
    assert.equal(snapshot.totals.nodes, 2);
    assert.ok(snapshot.links.some((link) => link.id === "adapter alpha->adapter beta"));
    assert.ok(manifestReads >= 1);
    assert.equal(recordReads, 1);
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service watch mode detects nested Logseq namespace changes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-watch-nested-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-watch-nested-cache-"));
  fs.mkdirSync(path.join(root, "pages", "schema"), { recursive: true });
  fs.writeFileSync(path.join(root, "pages", "schema", "properties.md"), "type:: project\n", "utf8");
  const service = createBrainService({
    root,
    cachePath: path.join(cacheRoot, "snapshot.json"),
    port: 0,
    staticDir: null,
    watch: true,
    allowUnauthenticatedRead: true,
    logger: { log() {}, error() {} }
  });
  try {
    await service.listen();
    assert.equal(service.snapshot.nodes.some((node) => node.name === "schema/properties"), true);
    fs.writeFileSync(path.join(root, "pages", "schema", "relations.md"), "type:: project\n- [[schema/properties]]\n", "utf8");
    await waitForCondition(() => service.snapshot.totals.nodes === 2);
    assert.equal(service.snapshot.nodes.some((node) => node.name === "schema/relations"), true);
    assert.ok(service.snapshot.links.some((link) => link.id === "schema___relations->schema___properties"));
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service applies default snapshot render budgets to large graphs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-large-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-large-cache-"));
  const pages = path.join(root, "pages");
  fs.mkdirSync(pages);
  for (let index = 0; index < DEFAULT_SNAPSHOT_NODE_BUDGET + 5; index += 1) {
    fs.writeFileSync(path.join(pages, `Node ${index}.md`), `type:: project\n- [[Node ${Math.max(0, index - 1)}]]\n`, "utf8");
  }
  const service = createBrainService({
    root,
    cachePath: path.join(cacheRoot, "snapshot.json"),
    port: 0,
    staticDir: null,
    allowUnauthenticatedRead: true,
    logger: { log() {}, error() {} }
  });
  try {
    const started = await service.listen();
    const health = await getJson(started.port, "/api/health");
    assert.equal(health.totals.nodes, DEFAULT_SNAPSHOT_NODE_BUDGET + 5);

    const defaultSnapshot = await getJson(started.port, "/api/snapshot");
    assert.equal(defaultSnapshot.totals.nodes, DEFAULT_SNAPSHOT_NODE_BUDGET + 5);
    assert.equal(defaultSnapshot.nodes.length, DEFAULT_SNAPSHOT_NODE_BUDGET);
    assert.equal(defaultSnapshot.health.fullNodes, DEFAULT_SNAPSHOT_NODE_BUDGET + 5);

    const zeroBudgetSnapshot = await getJson(started.port, "/api/snapshot?nodeBudget=0&linkBudget=0");
    assert.equal(zeroBudgetSnapshot.nodes.length, DEFAULT_SNAPSHOT_NODE_BUDGET);

    const explicitSnapshot = await getJson(started.port, `/api/snapshot?nodeBudget=${DEFAULT_SNAPSHOT_NODE_BUDGET + 5}&linkBudget=25000`);
    assert.equal(explicitSnapshot.nodes.length, DEFAULT_SNAPSHOT_NODE_BUDGET + 5);
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service reindexes changed Logseq pages and streams graph deltas", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-cache-"));
  const pages = path.join(root, "pages");
  fs.mkdirSync(pages);
  fs.writeFileSync(path.join(pages, "Alpha.md"), "type:: project\n- [[Beta]]\n", "utf8");
  fs.writeFileSync(path.join(pages, "Beta.md"), "type:: person\n", "utf8");

  const port = await getFreePort();
  const service = spawn(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    root,
    "--cache",
    path.join(cacheRoot, "snapshot.json"),
    "--no-static",
    "--allow-unauthenticated-read",
    "--allow-unauthenticated-reindex",
    "--port",
    String(port)
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  service.stderr.on("data", (chunk) => (stderr += chunk.toString()));

  try {
    await waitForHealth(port, stdout, stderr);
    const health = await getJson(port, "/api/health");
    assert.equal(health.bindHost, "127.0.0.1");
    assert.equal(health.localOnly, true);
    assert.equal(health.root, undefined);
    assert.equal(health.cache.path, undefined);
    assert.equal(health.cache.configured, true);
    assert.ok(health.manifest.graphId);
    const beforeResponse = await fetch(`http://127.0.0.1:${port}/api/snapshot`);
    assert.equal(beforeResponse.headers.get("cache-control"), "no-store");
    assert.equal(beforeResponse.headers.get("x-content-type-options"), "nosniff");
    const before = await beforeResponse.json();
    assert.equal(before.graph.id, health.manifest.graphId);
    assert.equal(before.totals.nodes, 2);
    const blockedHost = await requestMeta(port, "/api/snapshot", { Host: "example.com" });
    assert.equal(blockedHost.status, 403);
    assert.equal(blockedHost.headers["cache-control"], "no-store");
    assert.equal(blockedHost.headers["x-content-type-options"], "nosniff");
    const blocked = await fetch(`http://127.0.0.1:${port}/api/snapshot`, {
      headers: { Origin: "https://example.com" }
    });
    assert.equal(blocked.status, 403);
    const devOrigin = await fetch(`http://127.0.0.1:${port}/api/snapshot`, {
      headers: { Origin: "http://localhost:5177" }
    });
    assert.equal(devOrigin.status, 403);
    assert.equal(devOrigin.headers.get("access-control-allow-origin"), null);
    const bridges = await getJson(port, "/api/bridges?limit=2");
    assert.equal(bridges.ok, true);
    assert.ok(Array.isArray(bridges.candidates));
    assert.ok(bridges.candidates.length <= 2);
    const bridgeResponse = await fetch(`http://127.0.0.1:${port}/api/bridges?limit=2`);
    assert.equal(bridgeResponse.headers.get("deprecation"), "true");
    const connectors = await getJson(port, "/api/connectors?limit=2");
    assert.equal(connectors.ok, true);
    assert.ok(Array.isArray(connectors.candidates));
    const search = await getJson(port, "/api/search?q=Alpha&limit=3");
    assert.equal(search.ok, true);
    assert.equal(search.totalMatches, 1);
    assert.equal(search.results[0].name, "Alpha");
    const badRequest = await fetch(`http://127.0.0.1:${port}/api/focus?q=Alpha&radius=Infinity`);
    assert.equal(badRequest.status, 400);
    assert.equal(badRequest.headers.get("cache-control"), "no-store");
    assert.equal(badRequest.headers.get("x-content-type-options"), "nosniff");
    const badCorsRequest = await fetch(`http://127.0.0.1:${port}/api/focus?q=Alpha&radius=Infinity`, {
      headers: { Origin: "http://localhost:5177" }
    });
    assert.equal(badCorsRequest.status, 403);
    assert.equal(badCorsRequest.headers.get("access-control-allow-origin"), null);
    const preflight = await fetch(`http://127.0.0.1:${port}/api/snapshot`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5177" }
    });
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers.get("cache-control"), "no-store");
    assert.equal(preflight.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await requestStatus(port, "/api/connectors?limit=1000000"), 400);
    assert.equal(await requestStatus(port, "/api/search?q=Alpha&limit=0"), 400);

    const stream = openGraphDeltaStream(port);
    await stream.ready;
    fs.writeFileSync(path.join(pages, "Gamma.md"), "type:: project\n- [[Alpha]] [[Beta]]\n", "utf8");
    const reindex = await fetch(`http://127.0.0.1:${port}/api/reindex`, { method: "POST" });
    assert.equal(reindex.ok, true);

    const delta = await stream.delta;
    assert.equal(delta.changeCounts.addedNodes, 1);
    assert.equal(delta.changeCounts.addedLinks, 2);
    assert.equal(delta.addedNodes.length, 0);
    assert.equal(delta.addedLinks.length, 0);
    assert.ok(delta.events.some((event) => event.kind === "node.created" && event.nodeName === "Gamma"));
    assert.ok(delta.events.some((event) => event.kind === "link.created" && event.linkId === "gamma->alpha"));
    assert.equal(typeof delta.eventSeq, "number");

    const after = await getJson(port, "/api/snapshot");
    assert.equal(after.totals.nodes, 3);
    assert.ok(after.nodes.some((node) => node.name === "Gamma"));
    const detail = await getJson(port, "/api/node?q=Alpha");
    assert.equal(detail.source.path, undefined);
    assert.equal(detail.source.relativePath, "pages/Alpha.md");
  } finally {
    service.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service reports omitted live events for large reindex bursts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-event-cap-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-event-cap-cache-"));
  const port = await getFreePort();
  let revision = 1;
  let records = [
    parsePageRecord(path.join(root, "pages", "Seed.md"), "type:: project\n", { mtimeMs: Date.now() }, { root })
  ];
  const sourceAdapter = {
    kind: "test-adapter",
    root,
    readManifest() {
      return { pages: records.length, graphId: "event-cap-fixture", fingerprint: `event-cap-${revision}`, maxMtimeMs: Date.now() };
    },
    readRecords() {
      return records;
    },
    watchDirectories() {
      return [];
    }
  };
  const service = createBrainService({
    root,
    sourceAdapter,
    cachePath: path.join(cacheRoot, "snapshot.json"),
    port,
    allowUnauthenticatedRead: true,
    allowUnauthenticatedReindex: true
  });

  try {
    await service.listen();
    const stream = openGraphDeltaStream(port);
    await stream.ready;
    revision += 1;
    records = Array.from({ length: 500 }, (_, index) =>
      parsePageRecord(
        path.join(root, "pages", `Burst ${index}.md`),
        `type:: project\n- [[Burst ${Math.max(0, index - 1)}]]\n`,
        { mtimeMs: Date.now() + index },
        { root }
      )
    );
    service.reindex("manual");
    const delta = await stream.delta;
    assert.equal(delta.events.length, 421);
    assert.ok(delta.eventsOmitted > 0);
    assert.equal(delta.changeCounts.addedNodes, 500);
    assert.equal(delta.addedNodes.length, 0);
    assert.equal(delta.addedLinks.length, 0);
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service refuses cache writes inside the Logseq graph", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\n", "utf8");
  const service = spawn(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    root,
    "--cache",
    path.join(root, ".cache", "snapshot.json"),
    "--port",
    String(await getFreePort())
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  service.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  try {
    const code = await new Promise((resolve) => service.on("exit", resolve));
    assert.equal(code, 1);
    assert.match(stderr, /Refusing to write cache inside LOGSEQ_ROOT/);
  } finally {
    service.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("brain service rejects static traversal and sibling-prefix paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-cache-"));
  const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-static-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\n", "utf8");
  fs.writeFileSync(path.join(staticRoot, "index.html"), "<main>Living Atlas</main>", "utf8");
  fs.writeFileSync(`${staticRoot}-private`, "private", "utf8");
  fs.symlinkSync(`${staticRoot}-private`, path.join(staticRoot, "private-link.txt"));
  const port = await getFreePort();
  const service = spawn(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    root,
    "--cache",
    path.join(cacheRoot, "snapshot.json"),
    "--static",
    staticRoot,
    "--allow-unauthenticated-read",
    "--port",
    String(port)
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  service.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  try {
    await waitForHealth(port, stdout, stderr);
    const staticIndex = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(staticIndex.ok, true);
    assert.equal(staticIndex.headers.get("x-content-type-options"), "nosniff");
    assert.equal(staticIndex.headers.get("referrer-policy"), "no-referrer");
    assert.equal(staticIndex.headers.get("cache-control"), "no-store");
    assert.match(staticIndex.headers.get("content-type") || "", /^text\/html;\s*charset=utf-8/);
    const missingStatic = await fetch(`http://127.0.0.1:${port}/${encodeURIComponent("../package.json")}`);
    assert.equal(missingStatic.status, 404);
    assert.equal(missingStatic.headers.get("cache-control"), "no-store");
    assert.equal(missingStatic.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await requestStatus(port, `/${encodeURIComponent(`../${path.basename(staticRoot)}-private`)}`), 404);
    assert.equal(await requestStatus(port, "/private-link.txt"), 404);
    assert.equal(
      await requestStatus(port, "/api/snapshot", { Origin: "http://localhost:5177" }),
      403,
      "packaged static server should not allow unrelated local origins by default"
    );
  } finally {
    service.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    fs.rmSync(staticRoot, { recursive: true, force: true });
    fs.rmSync(`${staticRoot}-private`, { force: true });
  }
});

test("brain service uses the user cache directory by default instead of repo .cache", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-"));
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-user-cache-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\n", "utf8");
  const port = await getFreePort();
  const service = spawn(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    root,
    "--no-static",
    "--allow-unauthenticated-read",
    "--port",
    String(port)
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      XDG_CACHE_HOME: cacheHome,
      LIVING_ATLAS_CACHE: "",
      BRAIN_ATLAS_CACHE: ""
    }
  });
  let stdout = "";
  let stderr = "";
  service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  service.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  try {
    await waitForHealth(port, stdout, stderr);
    assert.equal(fs.existsSync(path.join(cacheHome, "logseq-graph-living-atlas", "snapshot.json")), true);
  } finally {
    service.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheHome, { recursive: true, force: true });
  }
});

test("brain service writes only allowlisted source record fields to cache", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-cache-privacy-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-cache-privacy-store-"));
  const cachePath = path.join(cacheRoot, "snapshot.json");
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), [
    "type:: project",
    "status:: active",
    "company:: [[Beta]]",
    "private-note:: withheld-from-cache",
    "internal:: [[Beta]]",
    "- Internal: [[Beta]]",
    "- [[Beta]]"
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "pages", "Beta.md"), "type:: organization\n", "utf8");
  const service = createBrainService({
    root,
    cachePath,
    port: 0,
    staticDir: null,
    allowUnauthenticatedRead: true,
    logger: { log() {}, error() {} }
  });
  try {
    const started = await service.listen();
    const detail = await getJson(started.port, "/api/node?q=Alpha");
    assert.deepEqual(detail.source.properties, {
      type: "project",
      status: "active",
      company: "[[Beta]]"
    });

    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const alpha = cache.records.find((record) => record.id === "alpha");
    assert.ok(alpha, "expected Alpha record in cache");
    assert.equal(alpha.path, path.join("pages", "Alpha.md"));
    assert.equal(alpha.props.company, "[[Beta]]");
    assert.equal(alpha.props["private-note"], undefined);
    assert.equal(alpha.props.internal, undefined);
    assert.equal(alpha.relations.some((relation) => relation.kind === "company"), true);
    assert.equal(alpha.relations.some((relation) => relation.kind === "internal"), false);
    assert.doesNotMatch(JSON.stringify(cache.records), /withheld-from-cache|Internal:/);
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service refuses cache writes through symlinked paths inside the Logseq graph", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-cache-link-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.mkdirSync(path.join(root, ".cache-target"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\n", "utf8");
  const linkPath = path.join(outside, "linked-cache");
  fs.symlinkSync(path.join(root, ".cache-target"), linkPath, "dir");
  const service = spawn(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    root,
    "--cache",
    path.join(linkPath, "snapshot.json"),
    "--port",
    String(await getFreePort())
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  service.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  try {
    const code = await new Promise((resolve) => service.on("exit", resolve));
    assert.equal(code, 1);
    assert.match(stderr, /Refusing to write cache inside LOGSEQ_ROOT/);
  } finally {
    service.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("brain service can require a local token for manual reindex", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-cache-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\n", "utf8");
  const port = await getFreePort();
  const localCredential = "test-credential-123456";
  const service = spawn(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    root,
    "--cache",
    path.join(cacheRoot, "snapshot.json"),
    "--token",
    localCredential,
    "--allow-unauthenticated-read",
    "--port",
    String(port)
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  service.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  try {
    await waitForHealth(port, stdout, stderr);
    const denied = await fetch(`http://127.0.0.1:${port}/api/reindex`, { method: "POST" });
    assert.equal(denied.status, 401);
    const allowed = await fetch(`http://127.0.0.1:${port}/api/reindex`, {
      method: "POST",
      headers: { "x-living-atlas-token": localCredential }
    });
    assert.equal(allowed.ok, true);
  } finally {
    service.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service can require a local token for every API route", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-cache-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\n", "utf8");
  const port = await getFreePort();
  const localCredential = "test-credential-123456";
  const service = spawn(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    root,
    "--cache",
    path.join(cacheRoot, "snapshot.json"),
    "--token",
    localCredential,
    "--require-token",
    "--allowed-origin",
    "http://localhost:5177",
    "--port",
    String(port)
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  service.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  try {
    await waitForServer(port, stdout, stderr);
    const denied = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    assert.equal(denied.headers.get("x-content-type-options"), "nosniff");
    const deniedCors = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Origin: "http://localhost:5177" }
    });
    assert.equal(deniedCors.status, 401);
    assert.equal(deniedCors.headers.get("access-control-allow-origin"), "http://localhost:5177");
    assert.equal(await requestStatus(port, `/api/health?token=${localCredential}`), 401);
    const allowed = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Authorization: `Bearer ${localCredential}` }
    });
    assert.equal(allowed.ok, true);
    const sse = await fetch(`http://127.0.0.1:${port}/api/events?token=${localCredential}`);
    assert.equal(sse.ok, true);
    await sse.body.cancel();
  } finally {
    service.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("brain service ignores malformed cache and rebuilds from source", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-service-cache-"));
  const cachePath = path.join(cacheRoot, "snapshot.json");
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "Alpha.md"), "type:: project\n", "utf8");
  fs.writeFileSync(cachePath, JSON.stringify({
    version: 1,
    writtenAt: "2026-05-30T00:00:00.000Z",
    manifest: { pages: 1, fingerprint: "invalid", maxMtimeMs: 1 },
    snapshot: { version: 1 },
    records: []
  }), "utf8");
  const port = await getFreePort();
  const service = spawn(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    root,
    "--cache",
    cachePath,
    "--allow-unauthenticated-read",
    "--port",
    String(port)
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  service.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  try {
    await waitForHealth(port, stdout, stderr);
    const health = await getJson(port, "/api/health");
    assert.equal(health.cache.hit, false);
    const snapshot = await getJson(port, "/api/snapshot");
    assert.equal(snapshot.totals.nodes, 1);
    assert.equal(snapshot.graph.fingerprint, health.manifest.fingerprint);
  } finally {
    service.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("fixture graph generation refuses to delete unmarked directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "living-atlas-unmarked-fixture-"));
  fs.writeFileSync(path.join(root, "keep.txt"), "do not delete", "utf8");
  try {
    assert.throws(() => createFixtureGraph({ out: root }), /missing \.living-atlas-fixture marker/);
    assert.equal(fs.readFileSync(path.join(root, "keep.txt"), "utf8"), "do not delete");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function waitForHealth(port, stdout, stderr) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await delay(100);
  }
  throw new Error(`service did not start\nstdout=${stdout}\nstderr=${stderr}`);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(port, stdout, stderr) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.status > 0) return;
    } catch {
      // keep waiting
    }
    await delay(100);
  }
  throw new Error(`service did not start\nstdout=${stdout}\nstderr=${stderr}`);
}

async function waitForStdoutMatch(stdout, pattern) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const match = stdout().match(pattern);
    if (match) return match[1] || match[0];
    await delay(100);
  }
  throw new Error(`stdout did not match ${pattern}: ${stdout()}`);
}

async function waitForCondition(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await delay(100);
  }
  throw new Error("condition did not become true");
}

async function getJson(port, route) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`);
  assert.equal(response.ok, true);
  return response.json();
}

function requestStatus(port, route, headers = {}) {
  return requestMeta(port, route, headers).then((response) => response.status);
}

function requestMeta(port, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method: "GET",
      headers
    }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

function openGraphDeltaStream(port) {
  let resolveReady;
  let rejectReady;
  const req = http.request({
    hostname: "127.0.0.1",
    port,
    path: "/api/events",
    method: "GET",
    headers: { Accept: "text/event-stream" }
  });
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const delta = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error("timed out waiting for graph_delta SSE event"));
    }, 5000);
    let buffer = "";
    req.on("response", (res) => {
      resolveReady();
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          if (!event.includes("event: graph_delta")) continue;
          const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          clearTimeout(timeout);
          req.destroy();
          resolve(JSON.parse(dataLine.slice("data: ".length)));
        }
      });
    });
    req.on("error", (error) => {
      clearTimeout(timeout);
      rejectReady(error);
      reject(error);
    });
    req.end();
  });
  return { ready, delta };
}
