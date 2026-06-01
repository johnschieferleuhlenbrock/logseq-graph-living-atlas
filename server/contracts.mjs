export const SNAPSHOT_VERSION = 1;
export const CACHE_VERSION = 1;

export function validateSnapshot(snapshot, context = "snapshot") {
  assertObject(snapshot, context);
  assertEqual(snapshot.version, SNAPSHOT_VERSION, `${context}.version`);
  assertString(snapshot.generatedAt, `${context}.generatedAt`);
  assertObject(snapshot.totals, `${context}.totals`);
  for (const key of ["pages", "nodes", "links", "dangling", "clusters", "active24h", "active7d"]) {
    assertNumber(snapshot.totals[key], `${context}.totals.${key}`);
  }
  assertArray(snapshot.nodes, `${context}.nodes`);
  assertArray(snapshot.links, `${context}.links`);
  assertArray(snapshot.clusters, `${context}.clusters`);
  assertArray(snapshot.insights, `${context}.insights`);
  assertObject(snapshot.health, `${context}.health`);
  for (const [index, node] of snapshot.nodes.entries()) validateNode(node, `${context}.nodes[${index}]`);
  for (const [index, link] of snapshot.links.entries()) validateLink(link, `${context}.links[${index}]`);
  for (const [index, cluster] of snapshot.clusters.entries()) validateCluster(cluster, `${context}.clusters[${index}]`);
  for (const [index, insight] of snapshot.insights.entries()) validateInsight(insight, `${context}.insights[${index}]`);
  return snapshot;
}

export function validateApiSnapshot(snapshot, context = "api.snapshot") {
  validateSnapshot(snapshot, context);
  assertObject(snapshot.graph, `${context}.graph`);
  assertString(snapshot.graph.id, `${context}.graph.id`);
  assertString(snapshot.graph.fingerprint, `${context}.graph.fingerprint`);
  assertNumber(snapshot.graph.pages, `${context}.graph.pages`);
  return snapshot;
}

export function validateHealth(payload, context = "health") {
  assertObject(payload, context);
  assertBoolean(payload.ok, `${context}.ok`);
  assertString(payload.generatedAt, `${context}.generatedAt`);
  assertObject(payload.totals, `${context}.totals`);
  assertObject(payload.cache, `${context}.cache`);
  assertBoolean(payload.cache.configured, `${context}.cache.configured`);
  assertBoolean(payload.cache.hit, `${context}.cache.hit`);
  validateManifest(payload.manifest, `${context}.manifest`);
  assertBoolean(payload.watch, `${context}.watch`);
  assertString(payload.bindHost, `${context}.bindHost`);
  assertBoolean(payload.localOnly, `${context}.localOnly`);
  if (payload.requireToken !== undefined) assertBoolean(payload.requireToken, `${context}.requireToken`);
  return payload;
}

export function validateDelta(delta, context = "delta") {
  assertObject(delta, context);
  assertEqual(delta.type, "graph_delta", `${context}.type`);
  assertString(delta.generatedAt, `${context}.generatedAt`);
  for (const key of ["addedNodes", "changedNodes", "removedNodes"]) {
    assertArray(delta[key], `${context}.${key}`);
    delta[key].forEach((node, index) => validateNode(node, `${context}.${key}[${index}]`));
  }
  for (const key of ["addedLinks", "removedLinks"]) {
    assertArray(delta[key], `${context}.${key}`);
    delta[key].forEach((link, index) => validateLink(link, `${context}.${key}[${index}]`));
  }
  assertArray(delta.insights, `${context}.insights`);
  assertObject(delta.totals, `${context}.totals`);
  if (delta.changeCounts !== undefined) {
    assertObject(delta.changeCounts, `${context}.changeCounts`);
    for (const key of ["addedNodes", "changedNodes", "removedNodes", "addedLinks", "removedLinks"]) {
      assertNumber(delta.changeCounts[key], `${context}.changeCounts.${key}`);
    }
  }
  if (delta.events !== undefined) {
    assertArray(delta.events, `${context}.events`);
    delta.events.forEach((event, index) => validateLiveEvent(event, `${context}.events[${index}]`));
  }
  if (delta.eventSeq !== undefined) assertNumber(delta.eventSeq, `${context}.eventSeq`);
  if (delta.eventsOmitted !== undefined) assertNumber(delta.eventsOmitted, `${context}.eventsOmitted`);
  if (delta.reason !== undefined) assertString(delta.reason, `${context}.reason`);
  return delta;
}

export function validateFocusResult(result, context = "focus") {
  assertObject(result, context);
  assertBoolean(result.ok, `${context}.ok`);
  if (!result.ok) {
    assertString(result.error, `${context}.error`);
    assertString(result.query, `${context}.query`);
    return result;
  }
  assertString(result.focusKind, `${context}.focusKind`);
  if (result.seed !== null) validateNode(result.seed, `${context}.seed`);
  if (result.cluster !== undefined) validateCluster(result.cluster, `${context}.cluster`);
  assertNumber(result.radius, `${context}.radius`);
  assertArray(result.nodes, `${context}.nodes`);
  assertArray(result.links, `${context}.links`);
  assertBoolean(result.limited, `${context}.limited`);
  assertNumber(result.totalMatches, `${context}.totalMatches`);
  assertArray(result.insights, `${context}.insights`);
  result.nodes.forEach((node, index) => validateNode(node, `${context}.nodes[${index}]`));
  result.links.forEach((link, index) => validateLink(link, `${context}.links[${index}]`));
  return result;
}

export function validatePathResult(result, context = "path") {
  assertObject(result, context);
  assertBoolean(result.ok, `${context}.ok`);
  if (!result.ok) {
    assertString(result.error, `${context}.error`);
    if (result.missing !== undefined) assertArray(result.missing, `${context}.missing`);
    if (result.maxDepth !== undefined) assertNumber(result.maxDepth, `${context}.maxDepth`);
    if (result.explored !== undefined) assertNumber(result.explored, `${context}.explored`);
    return result;
  }
  validateNode(result.from, `${context}.from`);
  validateNode(result.to, `${context}.to`);
  assertNumber(result.depth, `${context}.depth`);
  assertArray(result.nodes, `${context}.nodes`);
  assertArray(result.links, `${context}.links`);
  assertArray(result.steps, `${context}.steps`);
  assertString(result.summary, `${context}.summary`);
  result.nodes.forEach((node, index) => validateNode(node, `${context}.nodes[${index}]`));
  result.links.forEach((link, index) => validateLink(link, `${context}.links[${index}]`));
  result.steps.forEach((step, index) => validatePathStep(step, `${context}.steps[${index}]`));
  if (result.routeScore !== undefined) validateRouteScore(result.routeScore, `${context}.routeScore`);
  if (result.alternateRoutes !== undefined) assertArray(result.alternateRoutes, `${context}.alternateRoutes`);
  return result;
}

export function validateNodeDetail(result, context = "nodeDetail") {
  assertObject(result, context);
  assertBoolean(result.ok, `${context}.ok`);
  if (!result.ok) {
    assertString(result.error, `${context}.error`);
    assertString(result.query, `${context}.query`);
    return result;
  }
  validateNode(result.node, `${context}.node`);
  assertObject(result.source, `${context}.source`);
  assertString(result.source.relativePath, `${context}.source.relativePath`);
  assertString(result.source.updatedAt, `${context}.source.updatedAt`);
  assertObject(result.source.properties, `${context}.source.properties`);
  assertString(result.source.preview, `${context}.source.preview`);
  for (const key of ["backlinks", "outlinks"]) {
    assertArray(result[key], `${context}.${key}`);
    result[key].forEach((entry, index) => validateNodeEdge(entry, `${context}.${key}[${index}]`));
  }
  for (const key of ["backlinksTotal", "outlinksTotal", "edgeLimit"]) {
    if (result[key] !== undefined) assertNumber(result[key], `${context}.${key}`);
  }
  assertArray(result.insights, `${context}.insights`);
  assertObject(result.xray, `${context}.xray`);
  assertString(result.xray.kind, `${context}.xray.kind`);
  if (result.xray.parent !== null) assertObject(result.xray.parent, `${context}.xray.parent`);
  if (result.xray.cluster !== null) validateCluster(result.xray.cluster, `${context}.xray.cluster`);
  assertNumber(result.xray.staleDays, `${context}.xray.staleDays`);
  assertArray(result.xray.proofDebt, `${context}.xray.proofDebt`);
  assertArray(result.xray.strongest, `${context}.xray.strongest`);
  assertArray(result.xray.signalSummary, `${context}.xray.signalSummary`);
  return result;
}

export function validateConnectorResult(result, context = "connectors") {
  assertObject(result, context);
  assertBoolean(result.ok, `${context}.ok`);
  assertString(result.generatedAt, `${context}.generatedAt`);
  assertArray(result.candidates, `${context}.candidates`);
  result.candidates.forEach((candidate, index) => validateConnectorCandidate(candidate, `${context}.candidates[${index}]`));
  return result;
}

export function validateSearchResult(result, context = "search") {
  assertObject(result, context);
  assertBoolean(result.ok, `${context}.ok`);
  assertString(result.generatedAt, `${context}.generatedAt`);
  assertString(result.query, `${context}.query`);
  assertNumber(result.totalMatches, `${context}.totalMatches`);
  assertNumber(result.omitted, `${context}.omitted`);
  assertArray(result.results, `${context}.results`);
  result.results.forEach((node, index) => validateNode(node, `${context}.results[${index}]`));
  return result;
}

export function validateRecords(records, context = "records") {
  assertArray(records, context);
  for (const [index, record] of records.entries()) {
    const pointer = `${context}[${index}]`;
    assertObject(record, pointer);
    assertString(record.id, `${pointer}.id`);
    assertString(record.name, `${pointer}.name`);
    assertString(record.path, `${pointer}.path`);
    assertArray(record.out, `${pointer}.out`);
    assertObject(record.props, `${pointer}.props`);
  }
  return records;
}

export function validateManifest(manifest, context = "manifest") {
  assertObject(manifest, context);
  assertNumber(manifest.pages, `${context}.pages`);
  if (manifest.graphId !== undefined) assertString(manifest.graphId, `${context}.graphId`);
  assertString(manifest.fingerprint, `${context}.fingerprint`);
  assertNumber(manifest.maxMtimeMs, `${context}.maxMtimeMs`);
  return manifest;
}

export function validateCacheEnvelope(envelope, expectedManifest = null) {
  assertObject(envelope, "cache");
  assertEqual(envelope.version, CACHE_VERSION, "cache.version");
  assertString(envelope.writtenAt, "cache.writtenAt");
  validateManifest(envelope.manifest, "cache.manifest");
  if (expectedManifest && envelope.manifest.fingerprint !== expectedManifest.fingerprint) {
    throw new ContractError("cache.manifest.fingerprint does not match current graph fingerprint");
  }
  validateSnapshot(envelope.snapshot, "cache.snapshot");
  validateRecords(envelope.records, "cache.records");
  return envelope;
}

export function createCacheEnvelope(payload) {
  validateManifest(payload.manifest);
  validateSnapshot(payload.snapshot);
  validateRecords(payload.records);
  return {
    version: CACHE_VERSION,
    writtenAt: new Date().toISOString(),
    manifest: payload.manifest,
    snapshot: payload.snapshot,
    records: payload.records
  };
}

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
}

function validateNode(node, context) {
  assertObject(node, context);
  for (const key of ["id", "name", "type", "status", "source", "confidence", "updatedAt", "cluster", "clusterLabel", "color"]) {
    assertString(node[key], `${context}.${key}`);
  }
  for (const key of ["in", "out", "total", "x", "y", "z", "size", "heat"]) {
    assertNumber(node[key], `${context}.${key}`);
  }
  assertArray(node.tags, `${context}.tags`);
}

function validateLink(link, context) {
  assertObject(link, context);
  for (const key of ["id", "source", "target", "kind"]) assertString(link[key], `${context}.${key}`);
  if (link.weight !== undefined) assertNumber(link.weight, `${context}.weight`);
}

function validateCluster(cluster, context) {
  assertObject(cluster, context);
  for (const key of ["id", "label"]) assertString(cluster[key], `${context}.${key}`);
  for (const key of ["count", "degree", "bridges", "heat"]) assertNumber(cluster[key], `${context}.${key}`);
}

function validateConnectorCandidate(candidate, context) {
  assertObject(candidate, context);
  assertString(candidate.id, `${context}.id`);
  validateCluster(candidate.fromCluster, `${context}.fromCluster`);
  validateCluster(candidate.toCluster, `${context}.toCluster`);
  for (const key of ["linkCount", "expected", "score"]) assertNumber(candidate[key], `${context}.${key}`);
  assertString(candidate.rationale, `${context}.rationale`);
  assertArray(candidate.nodeIds, `${context}.nodeIds`);
  assertArray(candidate.anchors, `${context}.anchors`);
  candidate.anchors.forEach((anchor, index) => {
    const pointer = `${context}.anchors[${index}]`;
    assertObject(anchor, pointer);
    for (const key of ["id", "name", "cluster"]) assertString(anchor[key], `${pointer}.${key}`);
    for (const key of ["degree", "heat", "debt"]) assertNumber(anchor[key], `${pointer}.${key}`);
  });
}

function validateInsight(insight, context) {
  assertObject(insight, context);
  for (const key of ["id", "severity", "title", "detail"]) assertString(insight[key], `${context}.${key}`);
  assertNumber(insight.metric, `${context}.metric`);
  assertArray(insight.nodeIds, `${context}.nodeIds`);
  assertArray(insight.provenance, `${context}.provenance`);
  if (insight.action !== undefined) {
    assertObject(insight.action, `${context}.action`);
    for (const key of ["kind", "label", "target", "rationale", "nextStep"]) assertString(insight.action[key], `${context}.action.${key}`);
  }
}

function validateLiveEvent(event, context) {
  assertObject(event, context);
  assertString(event.id, `${context}.id`);
  assertNumber(event.seq, `${context}.seq`);
  assertString(event.kind, `${context}.kind`);
  assertString(event.reason, `${context}.reason`);
  assertString(event.observedAt, `${context}.observedAt`);
  assertString(event.actor, `${context}.actor`);
  for (const key of ["nodeId", "nodeName", "sourceId", "targetId", "linkId", "cluster", "color"]) {
    if (event[key] !== undefined) assertString(event[key], `${context}.${key}`);
  }
  for (const key of ["x", "y", "z", "weight"]) {
    if (event[key] !== undefined) assertNumber(event[key], `${context}.${key}`);
  }
}

function validateNodeEdge(entry, context) {
  assertObject(entry, context);
  assertString(entry.linkId, `${context}.linkId`);
  if (entry.weight !== undefined) assertNumber(entry.weight, `${context}.weight`);
  validateNode(entry.node, `${context}.node`);
}

function validatePathStep(step, context) {
  assertObject(step, context);
  for (const key of ["from", "to", "linkId", "direction", "evidence"]) assertString(step[key], `${context}.${key}`);
}

function validateRouteScore(score, context) {
  assertObject(score, context);
  assertString(score.label, `${context}.label`);
  for (const key of ["score", "hops", "clusters", "freshness", "proofDebt", "linkEvidence"]) {
    assertNumber(score[key], `${context}.${key}`);
  }
}

function assertObject(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContractError(`${context} must be an object`);
}

function assertArray(value, context) {
  if (!Array.isArray(value)) throw new ContractError(`${context} must be an array`);
}

function assertString(value, context) {
  if (typeof value !== "string") throw new ContractError(`${context} must be a string`);
}

function assertNumber(value, context) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ContractError(`${context} must be a finite number`);
}

function assertBoolean(value, context) {
  if (typeof value !== "boolean") throw new ContractError(`${context} must be a boolean`);
}

function assertEqual(value, expected, context) {
  if (value !== expected) throw new ContractError(`${context} must be ${expected}`);
}
