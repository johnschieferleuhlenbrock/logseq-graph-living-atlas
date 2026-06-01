import type { AtlasNode, AtlasSnapshot } from "../types";

export type DataFilterOption = {
  id: string;
  label: string;
  count: number;
};

export function buildFilterOptions(snapshot: AtlasSnapshot | null) {
  return {
    status: statusFilterOptions(snapshot),
    confidence: confidenceFilterOptions(snapshot),
    source: sourceFilterOptions(snapshot)
  };
}

export function filterOptionLabel(options: DataFilterOption[], id: string) {
  return options.find((option) => option.id === id)?.label || id;
}

export function proofDebtLabel(node: AtlasNode) {
  if (!node.source) return "no source";
  if (["unknown", "low", "mixed"].includes(confidenceGroupId(node.confidence))) return "low confidence";
  if (statusGroupId(node.status) === "unknown") return "no status";
  if (node.total <= 1) return "few links";
  return "clear";
}

export function proofDebtScore(node: AtlasNode) {
  return (!node.source ? 10 : 0) +
    (["unknown", "low", "mixed"].includes(confidenceGroupId(node.confidence)) ? 6 : 0) +
    (statusGroupId(node.status) === "unknown" ? 4 : 0) +
    (node.total <= 1 ? 3 : 0);
}

export function statusGroupId(status?: string) {
  return statusGroup(status).id;
}

export function statusGroupLabel(status?: string) {
  return statusGroup(status).label;
}

export function confidenceGroupId(confidence?: string) {
  return confidenceGroup(confidence).id;
}

export function confidenceGroupLabel(confidence?: string) {
  return confidenceGroup(confidence).label;
}

export function sourceGroupId(source?: string) {
  return sourceGroup(source).id;
}

export function sourceGroupLabel(source?: string) {
  return sourceGroup(source).label;
}

function statusFilterOptions(snapshot: AtlasSnapshot | null): DataFilterOption[] {
  if (!snapshot) return [];
  const counts = new Map<string, DataFilterOption>();
  for (const node of snapshot.nodes) {
    const id = statusGroupId(node.status);
    const current = counts.get(id) || { id, label: statusGroupLabel(node.status), count: 0 };
    current.count += 1;
    counts.set(id, current);
  }
  return [...counts.values()].sort((a, b) => statusRank(a.id) - statusRank(b.id) || b.count - a.count);
}

function statusGroup(status?: string) {
  const value = (status || "").trim().toLowerCase();
  if (!value || value === "unknown") return { id: "unknown", label: "Unknown" };
  if (value.includes("active") || value === "open" || value.includes("forward-watch")) return { id: "active", label: "Active" };
  if (value.includes("dormant") || value.includes("passive")) return { id: "dormant", label: "Dormant" };
  if (value.includes("archive") || value.includes("retired") || value.includes("deprecated") || value.includes("acquired") || value.includes("not-at")) return { id: "archived", label: "Archived" };
  if (value.includes("resolved") || value.includes("merge-candidate")) return { id: "resolved", label: "Resolved" };
  if (value.includes("prospect")) return { id: "prospect", label: "Prospect" };
  if (value.includes("alum")) return { id: "alumni", label: "Alumni" };
  if (value.includes("decline")) return { id: "declined", label: "Declined" };
  return { id: "declared", label: "Declared" };
}

function statusRank(id: string) {
  return ["active", "dormant", "prospect", "resolved", "archived", "declined", "alumni", "unknown", "declared"].indexOf(id);
}

function confidenceFilterOptions(snapshot: AtlasSnapshot | null): DataFilterOption[] {
  if (!snapshot) return [];
  const counts = new Map<string, DataFilterOption>();
  for (const node of snapshot.nodes) {
    const id = confidenceGroupId(node.confidence);
    const current = counts.get(id) || { id, label: confidenceGroupLabel(node.confidence), count: 0 };
    current.count += 1;
    counts.set(id, current);
  }
  return [...counts.values()].sort((a, b) => confidenceRank(a.id) - confidenceRank(b.id) || b.count - a.count);
}

function confidenceGroup(confidence?: string) {
  const value = (confidence || "").trim().toLowerCase();
  if (!value || value === "unknown") return { id: "unknown", label: "Unknown" };
  const hasHigh = /\bhigh\b/.test(value);
  const hasMedium = /\bmedium\b|\bmed\b/.test(value);
  const hasLow = /\blow\b/.test(value);
  if (value.includes("resolved")) return { id: "resolved", label: "Resolved" };
  if ((hasHigh && hasMedium) || (hasHigh && hasLow) || (hasMedium && hasLow) || value.includes("mixed")) return { id: "mixed", label: "Mixed" };
  if (hasHigh) return { id: "high", label: "High" };
  if (hasMedium) return { id: "medium", label: "Medium" };
  if (hasLow) return { id: "low", label: "Low" };
  return { id: "declared", label: "Declared" };
}

function confidenceRank(id: string) {
  return ["high", "medium", "mixed", "low", "unknown", "resolved", "declared"].indexOf(id);
}

function sourceFilterOptions(snapshot: AtlasSnapshot | null): DataFilterOption[] {
  if (!snapshot) return [];
  const counts = new Map<string, DataFilterOption>();
  for (const node of snapshot.nodes) {
    const id = sourceGroupId(node.source);
    const current = counts.get(id) || { id, label: sourceGroupLabel(node.source), count: 0 };
    current.count += 1;
    counts.set(id, current);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 10);
}

function sourceGroup(source?: string) {
  const value = (source || "").trim().toLowerCase();
  if (!value) return { id: "missing", label: "No source metadata" };
  if (value === "page") return { id: "page", label: "Page metadata" };
  if (value.includes("graph hygiene") || value.includes("connector") || value.includes("bridge") || value.includes("logseq")) return { id: "graph", label: "Graph maintenance" };
  if (value.includes("manual") || value.includes("confirmed") || value.includes("confirmation")) return { id: "manual", label: "Manual confirmation" };
  if (value.includes("email") || value.includes("message") || value.includes("inbox") || value.includes("correspondence")) return { id: "correspondence", label: "Correspondence" };
  if (value.includes("meeting") || value.includes("transcript") || value.includes("call")) return { id: "meeting", label: "Conversation notes" };
  if (value.includes("web") || value.includes("research") || value.includes("browser")) return { id: "research", label: "Web research" };
  if (value.includes("record") || value.includes("roster") || value.includes("directory")) return { id: "records", label: "Structured records" };
  if (value.includes("import") || value.includes("migration") || value.includes("ingest")) return { id: "import", label: "Imported data" };
  const first = value.split(/[/:>,-]/)[0]?.trim();
  if (first && first.length >= 2 && first.length <= 24) {
    return { id: `declared:${slugGroup(first)}`, label: labelGroup(first) };
  }
  return { id: "declared", label: "Declared source" };
}

function slugGroup(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "source";
}

function labelGroup(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
