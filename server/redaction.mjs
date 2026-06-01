const SENSITIVE_KEYS = new Set([
  "id",
  "name",
  "label",
  "title",
  "detail",
  "target",
  "source",
  "cluster",
  "clusterLabel",
  "nodeId",
  "nodeIds",
  "graphId",
  "fingerprint",
  "nodeName",
  "sourceId",
  "targetId",
  "linkId",
  "tags",
  "relativePath",
  "preview",
  "query",
  "evidence",
  "rationale",
  "nextStep"
]);

const PRESERVED_KEYS = new Set([
  "type",
  "kind",
  "severity",
  "status",
  "confidence",
  "updatedAt",
  "generatedAt",
  "observedAt",
  "actor",
  "reason",
  "ok",
  "version"
]);

export function redactPayload(payload) {
  const labels = new Map();
  let next = 0;
  const labelFor = (value, parentKey = "") => {
    if (!labels.has(value)) {
      next += 1;
      const prefix = parentKey.toLowerCase().includes("path") ? "path" : "entity";
      labels.set(value, `${prefix}-${String(next).padStart(4, "0")}`);
    }
    return labels.get(value);
  };

  const visit = (value, parentKey = "") => {
    if (Array.isArray(value)) return value.map((item) => visit(item, parentKey));
    if (!value || typeof value !== "object") {
      if (typeof value === "string" && SENSITIVE_KEYS.has(parentKey)) return labelFor(value, parentKey);
      return value;
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (PRESERVED_KEYS.has(key)) {
        output[key] = item;
      } else if (SENSITIVE_KEYS.has(key)) {
        output[key] = typeof item === "string" ? labelFor(item, key) : visit(item, key);
      } else if (key === "properties" || key === "provenance" || key === "action") {
        output[key] = redactPropertyBag(item, labelFor);
      } else {
        output[key] = visit(item, key);
      }
    }
    return output;
  };

  return visit(payload);
}

function redactPropertyBag(value, labelFor) {
  if (Array.isArray(value)) return value.map((item) => redactPropertyBag(item, labelFor));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? labelFor(value) : value;
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = redactPropertyBag(item, labelFor);
  }
  return output;
}
