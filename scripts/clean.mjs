#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
for (const relativePath of ["dist", ".cache", "docs/qa", "coverage", "playwright-report", "test-results"]) {
  fs.rmSync(path.join(root, relativePath), { recursive: true, force: true });
}

if (args.has("--user-cache") || args.has("--all")) {
  fs.rmSync(defaultCacheDirectory(), { recursive: true, force: true });
}

console.log(args.has("--user-cache") || args.has("--all")
  ? "Removed generated Living Atlas artifacts and user-cache demo data."
  : "Removed repo-local generated Living Atlas artifacts.");

function defaultCacheDirectory() {
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, "logseq-graph-living-atlas");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "logseq-graph-living-atlas");
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "logseq-graph-living-atlas");
  }
  return path.join(os.homedir(), ".cache", "logseq-graph-living-atlas");
}
