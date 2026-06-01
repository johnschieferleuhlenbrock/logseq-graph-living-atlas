import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  buildSnapshot,
  connectorCandidates,
  createSnapshotRuntime,
  DEFAULT_NODE_EDGE_LIMIT,
  budgetSnapshot,
  diffSnapshots,
  focusSnapshot,
  nodeDetail,
  pathSnapshot,
  searchSnapshot
} from "./graph-index.mjs";
import { createLogseqSourceAdapter } from "./logseq/source-adapter.mjs";
import {
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
} from "./contracts.mjs";
import { redactPayload } from "./redaction.mjs";

export const DEFAULT_SNAPSHOT_NODE_BUDGET = 7200;
export const DEFAULT_SNAPSHOT_LINK_BUDGET = 18000;
const CACHE_PROPERTY_KEYS = new Set([
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
const CACHE_RELATION_KINDS = new Set([
  ...CACHE_PROPERTY_KEYS,
  "org",
  "parent org",
  "reports to",
  "customer of",
  "part of"
]);

export function createBrainService(options) {
  const root = path.resolve(requiredOption(options.root, "root"));
  const sourceAdapter = options.sourceAdapter || createLogseqSourceAdapter(root);
  const cachePath = path.resolve(requiredOption(options.cachePath, "cachePath"));
  const staticDir = options.staticDir ? path.resolve(options.staticDir) : null;
  const port = Number(options.port ?? 8787);
  const bindHost = options.bindHost || "127.0.0.1";
  const debugPaths = Boolean(options.debugPaths);
  const localToken = String(options.token || "");
  const allowUnauthenticatedRead = Boolean(options.allowUnauthenticatedRead);
  if (options.requireToken === false && !allowUnauthenticatedRead) {
    throw new Error("createBrainService({ requireToken: false }) requires allowUnauthenticatedRead: true.");
  }
  let requireToken;
  if (options.requireToken === undefined) {
    requireToken = !allowUnauthenticatedRead;
  } else {
    requireToken = Boolean(options.requireToken);
  }
  const allowUnauthenticatedReindex = Boolean(options.allowUnauthenticatedReindex);
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
  const watch = Boolean(options.watch);
  const logger = options.logger || console;

  if (!isLocalHostname(bindHost)) throw new Error("Living Atlas only binds to localhost. Use 127.0.0.1, localhost, or ::1.");
  if (requireToken && !localToken) throw new Error("LIVING_ATLAS_REQUIRE_TOKEN requires LIVING_ATLAS_TOKEN or --token.");
  assertCacheOutsideGraph(cachePath, root);

  let state = loadState();
  let snapshot = state.snapshot;
  let runtime = createSnapshotRuntime(snapshot, state.records);
  let previousSnapshot = null;
  let eventSeq = 0;
  const sseClients = new Set();
  const watchers = [];
  let watchTimer = null;
  let watchedFingerprint = null;

  const server = http.createServer(async (req, res) => {
    try {
      if (!isAllowedLocalRequest(req)) return forbidden(res);
      if (req.method === "OPTIONS") return noContent(req, res);
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/") && !isAuthorizedRead(req, url)) return unauthorized(req, res, "Living Atlas API token required.");
      if (url.pathname === "/api/health") return sendJson(req, res, validateHealth(healthPayload()));
      if (url.pathname === "/api/snapshot") {
        const nodeBudget = snapshotBudgetParam(url, "nodeBudget", {
          defaultValue: DEFAULT_SNAPSHOT_NODE_BUDGET,
          min: 0,
          max: 25000
        });
        const linkBudget = snapshotBudgetParam(url, "linkBudget", {
          defaultValue: DEFAULT_SNAPSHOT_LINK_BUDGET,
          min: 0,
          max: 100000
        });
        return sendJson(req, res, validateApiSnapshot(budgetSnapshot(snapshot, {
          nodeBudget,
          linkBudget
        }), "api.snapshot"));
      }
      if (url.pathname === "/api/delta") return sendJson(req, res, validateDelta(diffSnapshots(previousSnapshot || snapshot, snapshot)));
      if (url.pathname === "/api/search") {
        return sendJson(req, res, validateSearchResult(searchSnapshot(
          snapshot,
          url.searchParams.get("q") || "",
          integerParam(url, "limit", { defaultValue: 8, min: 1, max: 50 }),
          runtime
        )));
      }
      if (url.pathname === "/api/focus") {
        return sendJson(req, res, validateFocusResult(focusSnapshot(
          snapshot,
          url.searchParams.get("q") || "",
          integerParam(url, "radius", { defaultValue: 2, min: 0, max: 8 }),
          integerParam(url, "limit", { defaultValue: 1800, min: 1, max: 10000 }),
          runtime
        )));
      }
      if (url.pathname === "/api/node") {
        return sendJson(req, res, validateNodeDetail(nodeDetail(snapshot, state.records, url.searchParams.get("q") || "", root, runtime, {
          edgeLimit: integerParam(url, "edgeLimit", { defaultValue: DEFAULT_NODE_EDGE_LIMIT, min: 1, max: 1000 })
        })));
      }
      if (url.pathname === "/api/bridges" || url.pathname === "/api/connectors") {
        const headers = url.pathname === "/api/bridges" ? bridgeDeprecationHeaders() : {};
        return sendJson(req, res, validateConnectorResult({
          ok: true,
          generatedAt: snapshot.generatedAt,
          candidates: connectorCandidates(snapshot, integerParam(url, "limit", { defaultValue: 12, min: 1, max: 100 }))
        }), 200, headers);
      }
      if (url.pathname === "/api/path") {
        return sendJson(req, res, validatePathResult(pathSnapshot(
          snapshot,
          url.searchParams.get("from") || "",
          url.searchParams.get("to") || "",
          integerParam(url, "maxDepth", { defaultValue: 7, min: 1, max: 12 }),
          runtime
        )));
      }
      if (url.pathname === "/api/events") return attachSse(req, res);
      if (url.pathname === "/api/reindex" && req.method === "POST") {
        if (!isAuthorizedStateChange(req)) return unauthorized(req, res);
        reindex("manual");
        return sendJson(req, res, validateHealth(healthPayload()));
      }
      if (staticDir) return serveStatic(staticDir, url.pathname, res);
      return notFound(res);
    } catch (error) {
      if (error instanceof RequestParamError) return badRequest(req, res, error.message);
      logger.error("[living-atlas] request failed", error?.stack || error);
      sendJson(req, res, {
        ok: false,
        error: debugPaths ? String(error?.stack || error) : "Internal server error"
      }, 500);
    }
  });

  function listen() {
    return new Promise((resolve, reject) => {
      const fail = (error) => {
        server.off("listening", ready);
        reject(error);
      };
      const ready = () => {
        server.off("error", fail);
        if (watch) startWatchers();
        resolve({
          bindHost,
          port: server.address()?.port || port,
          root,
          staticDir,
          snapshot
        });
      };
      server.once("error", fail);
      server.once("listening", ready);
      server.listen(port, bindHost);
    });
  }

  function close() {
    if (watchTimer) clearTimeout(watchTimer);
    watchers.splice(0).forEach((watcher) => watcher.close());
    for (const client of sseClients) client.end();
    sseClients.clear();
    return new Promise((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  function startWatchers() {
    watchedFingerprint = state.manifest.fingerprint;
    const watchDirs = typeof sourceAdapter.watchDirectories === "function"
      ? sourceAdapter.watchDirectories()
      : [{ sourceDir: "pages", path: path.join(root, "pages") }, { sourceDir: "journals", path: path.join(root, "journals") }].filter((entry) => fs.existsSync(entry.path));
    for (const entry of watchDirs) {
      watchers.push(fs.watch(entry.path, { persistent: true }, (_event, fileName) => {
        if (!fileName || !String(fileName).endsWith(".md")) return;
        scheduleWatchedReindex(`file:${entry.sourceDir || path.basename(entry.path)}/${fileName}`);
      }));
    }
    const pollIntervalMs = watchPollIntervalMs(state.manifest.pages);
    const poll = setInterval(() => {
      try {
        const manifest = sourceAdapter.readManifest();
        if (manifest.fingerprint === watchedFingerprint) return;
        watchedFingerprint = manifest.fingerprint;
        scheduleWatchedReindex("file:manifest");
      } catch (error) {
        logger.error("[living-atlas] watch poll failed", error?.message || error);
      }
    }, pollIntervalMs);
    watchers.push({ close: () => clearInterval(poll) });
  }

  function scheduleWatchedReindex(reason) {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => reindex(reason), 350);
  }

  function loadSnapshot() {
    return loadState().snapshot;
  }

  function loadState() {
    const manifest = sourceAdapter.readManifest();
    const cached = readCache(cachePath);
    if (cached?.manifest?.fingerprint === manifest.fingerprint) {
      return {
        snapshot: withGraphMetadata(cached.snapshot, manifest),
        records: rehydrateCacheRecords(cached.records, root),
        manifest,
        cache: { configured: true, hit: true }
      };
    }
    const records = sourceAdapter.readRecords();
    const built = {
      snapshot: withGraphMetadata(buildSnapshot(records), manifest),
      records,
      manifest,
      cache: { configured: true, hit: false }
    };
    writeCache(cachePath, built, root);
    return built;
  }

  function reindex(reason) {
    previousSnapshot = snapshot;
    state = rebuildState();
    snapshot = state.snapshot;
    runtime = createSnapshotRuntime(snapshot, state.records);
    watchedFingerprint = state.manifest.fingerprint;
    const delta = validateDelta(diffSnapshots(previousSnapshot, snapshot));
    const { events, eventsOmitted } = renderEventsFromDelta(delta, reason);
    const eventSeqEnd = events.at(-1)?.seq || eventSeq;
    broadcast({
      ...compactDeltaForStream(delta),
      eventSeq: eventSeqEnd,
      events,
      eventsOmitted,
      reason
    });
    logger.log(
      `[living-atlas] reindexed ${snapshot.totals.nodes} nodes / ${snapshot.totals.links} links (${reason})`
    );
  }

  function rebuildState() {
    const manifest = sourceAdapter.readManifest();
    const records = sourceAdapter.readRecords();
    const built = {
      snapshot: withGraphMetadata(buildSnapshot(records), manifest),
      records,
      manifest,
      cache: { configured: true, hit: false }
    };
    writeCache(cachePath, built, root);
    return built;
  }

  function withGraphMetadata(snapshotPayload, manifest) {
    return validateApiSnapshot({
      ...snapshotPayload,
      graph: {
        id: manifest.graphId,
        fingerprint: manifest.fingerprint,
        pages: manifest.pages
      }
    }, "api.snapshot");
  }

  function attachSse(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...corsHeaders(req)
    });
    res.write(`id: ${eventSeq}\n`);
    res.write("event: snapshot\n");
    res.write(`data: ${JSON.stringify({ generatedAt: snapshot.generatedAt, totals: snapshot.totals })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  }

  function broadcast(payload) {
    const body = `id: ${payload.eventSeq || eventSeq}\nevent: graph_delta\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) client.write(body);
  }

  function compactDeltaForStream(delta) {
    return {
      type: delta.type,
      generatedAt: delta.generatedAt,
      changeCounts: {
        addedNodes: delta.addedNodes?.length || 0,
        changedNodes: delta.changedNodes?.length || 0,
        removedNodes: delta.removedNodes?.length || 0,
        addedLinks: delta.addedLinks?.length || 0,
        removedLinks: delta.removedLinks?.length || 0
      },
      addedNodes: [],
      changedNodes: [],
      removedNodes: [],
      addedLinks: [],
      removedLinks: [],
      insights: delta.insights,
      totals: delta.totals
    };
  }

  function renderEventsFromDelta(delta, reason) {
    const observedAt = delta.generatedAt || new Date().toISOString();
    const actor = reason === "manual" ? "manual_reindex" : reason?.startsWith("file:") ? "filesystem_watch" : "brain_service";
    const next = (kind, payload) => ({
      id: `${Date.now().toString(36)}-${eventSeq + 1}-${kind}`,
      seq: ++eventSeq,
      kind,
      reason,
      observedAt,
      actor,
      ...payload
    });
    const specs = [
      ["node.created", delta.addedNodes || [], 160, nodeEventPayload],
      ["node.updated", delta.changedNodes || [], 220, nodeEventPayload],
      ["node.removed", delta.removedNodes || [], 160, nodeEventPayload],
      ["link.created", delta.addedLinks || [], 260, linkEventPayload],
      ["link.removed", delta.removedLinks || [], 260, linkEventPayload]
    ];
    let eventsOmitted = 0;
    const events = [];
    for (const [kind, items, limit, payloadFor] of specs) {
      eventsOmitted += Math.max(0, items.length - limit);
      events.push(...items.slice(0, limit).map((item) => next(kind, payloadFor(item))));
    }
    return { events, eventsOmitted };
  }

  function healthPayload() {
    const payload = {
      ok: true,
      generatedAt: snapshot.generatedAt,
      totals: snapshot.totals,
      cache: state.cache,
      manifest: state.manifest,
      watch,
      bindHost,
      localOnly: true,
      requireToken
    };
    if (debugPaths) {
      payload.root = root;
      payload.cache.path = cachePath;
      payload.staticDir = staticDir;
    }
    return payload;
  }

  function sendJson(req, res, payload, status = 200, extraHeaders = {}) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const responsePayload = url.searchParams.get("redact") === "1" ? redactPayload(payload) : payload;
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Headers": "content-type,authorization,x-living-atlas-token,x-brain-atlas-token",
      ...corsHeaders(req),
      ...extraHeaders
    });
    res.end(JSON.stringify(responsePayload));
  }

  function noContent(req, res) {
    res.writeHead(204, {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Headers": "content-type,authorization,x-living-atlas-token,x-brain-atlas-token",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      ...corsHeaders(req)
    });
    res.end();
  }

  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !isAllowedCorsOrigin(origin, req)) return {};
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin"
    };
  }

  function isAllowedLocalRequest(req) {
    return isLocalRemoteAddress(req.socket?.remoteAddress) && isLocalHostHeader(req.headers.host) && isAllowedOriginHeader(req.headers.origin, req.headers.host);
  }

  function isAllowedOriginHeader(origin, host) {
    if (!origin) return true;
    return isAllowedCorsOrigin(origin, { headers: { host } });
  }

  function isAllowedCorsOrigin(origin, req = null) {
    if (!isLocalUrl(origin)) return false;
    if (allowedOrigins.has(origin)) return true;
    if (req && isSameOrigin(origin, req.headers.host)) return true;
    return false;
  }

  function isAuthorizedStateChange(req) {
    if (allowUnauthenticatedReindex) return true;
    if (!localToken) return false;
    return requestToken(req) === localToken;
  }

  function isAuthorizedRead(req, url) {
    if (!requireToken) return true;
    return requestToken(req, { url, allowQuery: url.pathname === "/api/events" }) === localToken;
  }

  return {
    server,
    listen,
    close,
    reindex,
    loadSnapshot,
    healthPayload,
    get root() {
      return root;
    },
    get staticDir() {
      return staticDir;
    },
    get snapshot() {
      return snapshot;
    }
  };
}

function watchPollIntervalMs(pageCount) {
  const pages = Math.max(0, Number(pageCount) || 0);
  if (pages >= 50000) return 15000;
  if (pages >= 10000) return 7500;
  if (pages >= 1000) return 3000;
  return 1000;
}

export function assertCacheOutsideGraph(filePath, graphRoot) {
  if (!isInsideDirectory(graphRoot, filePath) && !isRealpathInsideDirectory(graphRoot, path.dirname(filePath))) return;
  throw new Error("Refusing to write cache inside LOGSEQ_ROOT. Set LIVING_ATLAS_CACHE to a path outside the graph.");
}

export function serveStatic(baseDir, requestPath, res) {
  let clean = "";
  try {
    clean = decodeURIComponent(requestPath).replace(/^\/+/, "");
  } catch {
    return notFound(res);
  }
  let filePath = path.resolve(baseDir, clean || "index.html");
  if (!isInsideDirectory(baseDir, filePath)) return notFound(res);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(baseDir, "index.html");
  }
  const safePath = resolveStaticFile(baseDir, filePath);
  if (!safePath) return notFound(res);
  const ext = path.extname(safePath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json"
  }[ext] || "application/octet-stream";
  res.writeHead(200, staticHeaders(ext, type));
  fs.createReadStream(safePath).pipe(res);
}

function staticHeaders(ext, type) {
  const headers = {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable"
  };
  if (ext === ".html") {
    headers["Content-Security-Policy"] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "img-src 'self' data:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join("; ");
  }
  return headers;
}

function readCache(filePath) {
  try {
    return validateCacheEnvelope(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

function writeCache(filePath, payload, root = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(createCacheEnvelope(serializeCachePayload(payload, root))), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, 0o600);
}

function serializeCachePayload(payload, root) {
  return {
    ...payload,
    records: (payload.records || []).map((record) => sanitizeCacheRecord(record, root))
  };
}

function sanitizeCacheRecord(record, root) {
  return {
    id: record.id,
    name: record.name,
    path: path.relative(root, record.path),
    type: record.type,
    tags: record.tags || [],
    status: record.status || "",
    source: record.source || "",
    confidence: record.confidence || "",
    lastContacted: record.lastContacted || "",
    updatedAt: record.updatedAt,
    mtimeMs: record.mtimeMs,
    out: record.out || [],
    relations: (record.relations || [])
      .filter((relation) => CACHE_RELATION_KINDS.has(relation.kind))
      .map((relation) => ({
        kind: relation.kind,
        target: relation.target,
        evidence: relation.evidence
      })),
    props: publicCacheProperties(record.props || {})
  };
}

function publicCacheProperties(props) {
  const publicProps = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (CACHE_PROPERTY_KEYS.has(key)) publicProps[key] = value;
  }
  return publicProps;
}

function rehydrateCacheRecords(records, root) {
  return (records || []).map((record) => ({
    ...record,
    path: path.isAbsolute(record.path) ? record.path : path.join(root, record.path)
  }));
}

function nodeEventPayload(node) {
  return {
    nodeId: node.id,
    nodeName: node.name,
    cluster: node.cluster,
    color: node.color,
    x: node.x,
    y: node.y,
    z: node.z,
    weight: node.heat
  };
}

function linkEventPayload(link) {
  return {
    linkId: link.id,
    sourceId: link.source,
    targetId: link.target,
    weight: link.weight
  };
}

function forbidden(res) {
  res.writeHead(403, errorJsonHeaders());
  res.end(JSON.stringify({ ok: false, error: "Living Atlas only accepts localhost requests." }));
}

function unauthorized(req, res, message = "Living Atlas reindex token required.") {
  res.writeHead(401, errorJsonHeaders(req));
  res.end(JSON.stringify({ ok: false, error: message }));
}

function badRequest(req, res, message) {
  res.writeHead(400, errorJsonHeaders(req));
  res.end(JSON.stringify({ ok: false, error: message }));
}

function notFound(res) {
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end("Not found");
}

function errorJsonHeaders(req = null) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(req ? corsHeadersForRequest(req) : {})
  };
}

function corsHeadersForRequest(req) {
  const origin = req?.headers?.origin;
  if (!origin || !isLocalUrl(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin"
  };
}

function isLocalHostHeader(host) {
  if (!host) return true;
  return isLocalUrl(`http://${host}`);
}

function isLocalRemoteAddress(address) {
  if (!address) return true;
  const normalized = String(address).toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

function isSameOrigin(origin, host) {
  if (!host) return false;
  try {
    const url = new URL(origin);
    return url.host === host;
  } catch {
    return false;
  }
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function requestToken(req, options = {}) {
  const headerToken = req.headers["x-living-atlas-token"] || req.headers["x-brain-atlas-token"];
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  if (headerToken) return headerToken;
  return options.allowQuery ? options.url?.searchParams.get("token") || "" : "";
}

class RequestParamError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestParamError";
  }
}

function integerParam(url, name, { defaultValue, min, max }) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return defaultValue;
  if (!/^-?\d+$/.test(raw)) {
    throw new RequestParamError(`${name} must be an integer from ${min} to ${max}.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RequestParamError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function snapshotBudgetParam(url, name, options) {
  const value = integerParam(url, name, options);
  return value === 0 ? options.defaultValue : value;
}

function bridgeDeprecationHeaders() {
  return {
    Deprecation: "true",
    Link: '</api/connectors>; rel="successor-version"'
  };
}

function isInsideDirectory(directory, targetPath) {
  const relative = path.relative(path.resolve(directory), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRealpathInsideDirectory(directory, targetDirectory) {
  try {
    fs.mkdirSync(targetDirectory, { recursive: true });
    const realDirectory = fs.realpathSync(directory);
    const realTarget = fs.realpathSync(targetDirectory);
    return isInsideDirectory(realDirectory, realTarget);
  } catch {
    return false;
  }
}

function resolveStaticFile(baseDir, filePath) {
  try {
    const realBase = fs.realpathSync(baseDir);
    const realFile = fs.realpathSync(filePath);
    if (!isInsideDirectory(realBase, realFile)) return null;
    if (!fs.statSync(realFile).isFile()) return null;
    return realFile;
  } catch {
    return null;
  }
}

function normalizeAllowedOrigins(value) {
  if (value instanceof Set) return value;
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

function requiredOption(value, name) {
  if (value) return value;
  throw new Error(`createBrainService requires ${name}`);
}
