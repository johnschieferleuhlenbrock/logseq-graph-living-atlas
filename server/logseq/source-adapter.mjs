import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { parsePageRecord } from "./parser.mjs";

export const DEFAULT_LOGSEQ_ROOT = process.env.LOGSEQ_ROOT || "";
const LOGSEQ_SOURCE_DIRS = ["pages", "journals"];
const DEFAULT_MAX_MARKDOWN_FILES = 250000;
const DEFAULT_MAX_MARKDOWN_FILE_BYTES = 2 * 1024 * 1024;

export function createLogseqSourceAdapter(root = DEFAULT_LOGSEQ_ROOT) {
  return {
    kind: "logseq-markdown",
    root,
    readManifest: () => readGraphManifest(root),
    readRecords: () => readPageRecords(root),
    watchDirectories: () => LOGSEQ_SOURCE_DIRS
      .map((sourceDir) => ({ sourceDir, path: path.join(root, sourceDir) }))
      .filter((entry) => fs.existsSync(entry.path))
  };
}

export function readPageRecords(root = DEFAULT_LOGSEQ_ROOT) {
  if (!root) throw new Error("LOGSEQ_ROOT or --root is required. Point it at a Logseq graph folder containing pages/.");
  const records = [];
  for (const filePath of readLogseqMarkdownFiles(root)) {
    const stat = fs.statSync(filePath);
    const text = fs.readFileSync(filePath, "utf8");
    records.push(parsePageRecord(filePath, text, stat, { root }));
  }
  assertUniqueRecordIds(records);
  records.sort((a, b) => a.name.localeCompare(b.name));
  return records;
}

export function readGraphManifest(root = DEFAULT_LOGSEQ_ROOT) {
  if (!root) throw new Error("LOGSEQ_ROOT or --root is required. Point it at a Logseq graph folder containing pages/.");
  const files = [];
  for (const filePath of readLogseqMarkdownFiles(root)) {
    const stat = fs.statSync(filePath);
    files.push({
      name: path.relative(root, filePath),
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
      contentHash: fileContentHash(filePath)
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return {
    pages: files.length,
    graphId: graphIdentity(root),
    fingerprint,
    maxMtimeMs: Math.max(0, ...files.map((file) => file.mtimeMs))
  };
}

export function readLogseqMarkdownFiles(root = DEFAULT_LOGSEQ_ROOT) {
  if (!root) throw new Error("LOGSEQ_ROOT or --root is required. Point it at a Logseq graph folder containing pages/.");
  const pagesDir = path.join(root, "pages");
  if (!fs.existsSync(pagesDir)) {
    throw new Error("Logseq pages directory not found under the configured graph root.");
  }
  const files = [];
  for (const sourceDir of LOGSEQ_SOURCE_DIRS) {
    const directory = path.join(root, sourceDir);
    if (!fs.existsSync(directory)) continue;
    collectMarkdownFiles(directory, files, root);
  }
  const maxFiles = positiveInteger(process.env.LIVING_ATLAS_MAX_FILES, DEFAULT_MAX_MARKDOWN_FILES);
  if (files.length > maxFiles) {
    throw new Error(`Logseq graph has ${files.length} markdown files, above LIVING_ATLAS_MAX_FILES=${maxFiles}.`);
  }
  files.sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));
  return files;
}

function collectMarkdownFiles(directory, files, root) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (entry.isDirectory()) {
      collectMarkdownFiles(filePath, files, root);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const maxBytes = positiveInteger(process.env.LIVING_ATLAS_MAX_FILE_BYTES, DEFAULT_MAX_MARKDOWN_FILE_BYTES);
      const stat = fs.statSync(filePath);
      if (stat.size > maxBytes) {
        throw new Error(`Logseq markdown file is too large for indexing: ${path.relative(root, filePath)}. Set LIVING_ATLAS_MAX_FILE_BYTES to override or use --debug-paths for full diagnostics.`);
      }
      files.push(filePath);
    }
  }
}

function assertUniqueRecordIds(records) {
  const seen = new Map();
  const duplicates = [];
  for (const record of records) {
    const previous = seen.get(record.id);
    if (previous) duplicates.push(`${previous.name} <-> ${record.name}`);
    seen.set(record.id, record);
  }
  if (duplicates.length) {
    throw new Error(`Duplicate Logseq page identities found: ${duplicates.slice(0, 5).join(", ")}. Rename or merge duplicate namespace pages before indexing.`);
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value || 0);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
}

function graphIdentity(root) {
  const realRoot = fs.realpathSync(root);
  const stat = fs.statSync(realRoot);
  return crypto
    .createHmac("sha256", installSecret())
    .update(`${realRoot}:${stat.dev}:${stat.ino}`)
    .digest("hex")
    .slice(0, 32);
}

function installSecret() {
  const secretPath = path.join(defaultCacheDirectory(), "install-secret");
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, "utf8").trim();
  fs.mkdirSync(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  const installKey = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, installKey, { mode: 0o600 });
  return installKey;
}

function defaultCacheDirectory() {
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, "logseq-graph-living-atlas");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "logseq-graph-living-atlas");
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "logseq-graph-living-atlas");
  }
  return path.join(os.homedir(), ".cache", "logseq-graph-living-atlas");
}

function fileContentHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
