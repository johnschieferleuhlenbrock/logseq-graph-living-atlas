import path from "node:path";

const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;
const PROP_RE = /^([a-zA-Z][\w-]*?)::\s*(.*?)\s*$/;
const TYPED_LINK_RE = /^\s*(?:[-*]\s*)?(?:\*\*)?([a-zA-Z][\w\s-]{1,40}?):(?:\*\*)?\s*\[\[([^\]]+?)\]\]/gm;
const CODE_FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;

export function slugify(name) {
  return String(name || "")
    .normalize("NFC")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/\//g, "___")
    .toLowerCase();
}

export function displayNameFromFile(filePath, root = "") {
  const normalizedRoot = root ? path.resolve(root) : "";
  const normalizedFile = path.resolve(filePath);
  if (!normalizedRoot) return path.basename(filePath, ".md").replace(/___/g, "/");
  const relative = path.relative(normalizedRoot, normalizedFile);
  const parts = relative.split(path.sep);
  if (parts[0] === "pages" || parts[0] === "journals") parts.shift();
  return parts.join("/").replace(/\.md$/i, "").replace(/___/g, "/");
}

export function stripCode(text) {
  return String(text || "").replace(CODE_FENCE_RE, "").replace(INLINE_CODE_RE, "");
}

export function extractWikilinks(text) {
  const clean = stripCode(text);
  const links = new Set();
  for (const match of clean.matchAll(WIKILINK_RE)) {
    const target = match[1].trim();
    if (!target || /^https?:/i.test(target)) continue;
    links.add(slugify(target));
  }
  return [...links];
}

export function parseProperties(text) {
  const props = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(PROP_RE);
    if (!match) continue;
    props[match[1].toLowerCase()] = match[2].trim();
  }
  return props;
}

export function parsePageRecord(filePath, text, stat = undefined, options = {}) {
  const root = typeof options === "string" ? options : options.root || "";
  const name = displayNameFromFile(filePath, root);
  const props = parseProperties(text);
  const type = props.type || "note";
  const tags = parseTags(props.tags || "");
  const out = extractWikilinks(text).filter((target) => target !== slugify(name));
  const mtimeMs = stat?.mtimeMs ?? Date.now();
  const relations = extractTypedRelations(text, props);
  return {
    id: slugify(name),
    name,
    path: filePath,
    type,
    tags,
    status: props.status || "",
    source: props.source || "",
    confidence: props.confidence || "",
    lastContacted: props["last-contacted"] || "",
    updatedAt: new Date(mtimeMs).toISOString(),
    mtimeMs,
    out,
    relations,
    props
  };
}

export function extractTypedRelations(text, props = {}) {
  const relations = [];
  for (const [key, value] of Object.entries(props || {})) {
    const links = extractWikilinks(String(value || ""));
    for (const target of links) {
      relations.push({ kind: normalizeRelationKind(key), target, evidence: `${key}:: ${value}` });
    }
  }
  const clean = stripCode(text);
  for (const match of clean.matchAll(TYPED_LINK_RE)) {
    const kind = normalizeRelationKind(match[1]);
    const target = slugify(match[2]);
    if (!kind || !target) continue;
    relations.push({ kind, target, evidence: match[0].trim() });
  }
  const seen = new Set();
  return relations.filter((relation) => {
    const key = `${relation.kind}:${relation.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseTags(raw) {
  if (!raw) return [];
  const tags = [];
  for (const wikilink of raw.matchAll(WIKILINK_RE)) tags.push(wikilink[1].trim());
  const cleaned = raw.replace(WIKILINK_RE, " ");
  for (const token of cleaned.split(/[\s,]+/)) {
    const value = token.trim();
    if (value) tags.push(value);
  }
  return [...new Set(tags)];
}

function normalizeRelationKind(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
