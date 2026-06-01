#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LOGSEQ_ROOT } from "./logseq/source-adapter.mjs";
import { createBrainService } from "./service.mjs";
import { createFixtureGraph } from "./fixture/create-fixture-graph.mjs";
import { parseMaintenanceArgs, runDoctor, runUpdate } from "./cli-maintenance.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}

export async function main(argv = []) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    console.log(packageJson.version);
    return;
  }
  if (args.command === "doctor") {
    process.exitCode = runDoctor({
      packageJson,
      packageRoot: path.resolve(__dirname, ".."),
      modulePath: fileURLToPath(import.meta.url),
      options: args.maintenance
    });
    return;
  }
  if (args.command === "update") {
    process.exitCode = runUpdate({
      packageJson,
      packageRoot: path.resolve(__dirname, ".."),
      modulePath: fileURLToPath(import.meta.url),
      options: args.maintenance
    });
    return;
  }

  const port = Number(args.port || process.env.LIVING_ATLAS_PORT || process.env.BRAIN_ATLAS_PORT || 8787);
  const demoMode = Boolean(args.demo);
  const rootInput = demoMode
    ? createDemoGraphRoot()
    : args.root || process.env.LOGSEQ_ROOT || DEFAULT_LOGSEQ_ROOT;
  if (!rootInput) {
    console.error("[living-atlas] LOGSEQ_ROOT or --root is required. Point it at a Logseq graph folder containing pages/.");
    console.error("[living-atlas] Example: npx logseq-graph-living-atlas --root /path/to/logseq");
    console.error("[living-atlas] Or try a public fixture: npx logseq-graph-living-atlas --demo");
    console.error("[living-atlas] Run living-atlas --help for options.");
    process.exitCode = 1;
    return;
  }

  const root = path.resolve(rootInput);
  const packagedStaticDir = path.resolve(__dirname, "..", "dist");
  const staticDir = args["no-static"]
    ? null
    : args.static
      ? path.resolve(__dirname, "..", args.static)
      : fs.existsSync(path.join(packagedStaticDir, "index.html"))
        ? packagedStaticDir
        : null;
  const cachePath = path.resolve(args.cache || process.env.LIVING_ATLAS_CACHE || process.env.BRAIN_ATLAS_CACHE || path.join(defaultCacheDirectory(), "snapshot.json"));
  const debugPaths = Boolean(args["debug-paths"] || process.env.LIVING_ATLAS_DEBUG_PATHS === "1" || process.env.BRAIN_ATLAS_DEBUG_PATHS === "1");
  const allowUnauthenticatedRead = Boolean(args["allow-unauthenticated-read"] || process.env.LIVING_ATLAS_ALLOW_UNAUTHENTICATED_READ === "1");
  const configuredToken = args.token || process.env.LIVING_ATLAS_TOKEN || process.env.BRAIN_ATLAS_TOKEN || "";
  const requireToken = Boolean(
    args["require-token"] ||
    process.env.LIVING_ATLAS_REQUIRE_TOKEN === "1" ||
    (!demoMode && !allowUnauthenticatedRead)
  );
  if (requireToken && configuredToken && configuredToken.length < 16) {
    console.error("[living-atlas] LIVING_ATLAS_TOKEN / --token must be at least 16 characters when read-token mode is enabled.");
    process.exitCode = 1;
    return;
  }
  const localToken = requireToken ? configuredToken || crypto.randomBytes(18).toString("base64url") : configuredToken;

  let service;
  try {
    service = createBrainService({
      root,
      cachePath,
      staticDir,
      port,
      watch: Boolean(args.watch),
      debugPaths,
      token: localToken,
      requireToken,
      allowUnauthenticatedRead: demoMode || allowUnauthenticatedRead,
      allowUnauthenticatedReindex: Boolean(args["allow-unauthenticated-reindex"] || process.env.LIVING_ATLAS_ALLOW_UNAUTHENTICATED_REINDEX === "1"),
      allowedOrigins: args["allowed-origin"] || process.env.LIVING_ATLAS_ALLOWED_ORIGINS || process.env.BRAIN_ATLAS_ALLOWED_ORIGINS || ""
    });
    const started = await service.listen();
    console.log(`[living-atlas] root = ${debugPaths ? root : "configured Logseq graph"}`);
    if (demoMode) console.log("[living-atlas] demo = public fixture graph");
    console.log(`[living-atlas] snapshot = ${started.snapshot.totals.nodes} nodes / ${started.snapshot.totals.links} links`);
    console.log(`[living-atlas] api = http://${started.bindHost}:${started.port}/api/snapshot`);
    if (requireToken) {
      const appPort = staticDir ? started.port : 5177;
      console.log(`[living-atlas] token-protected reads = enabled`);
      if (!configuredToken) console.log(`[living-atlas] session token = ${localToken}`);
      console.log(`[living-atlas] app token URL = http://${started.bindHost}:${appPort}/#token=${encodeURIComponent(localToken)}`);
    }
    if (staticDir) console.log(`[living-atlas] app = http://${started.bindHost}:${started.port}/`);
  } catch (error) {
    failStartup(error, debugPaths);
    return;
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await service.close();
      process.exit(0);
    });
  }
}

export function defaultCacheDirectory() {
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, "logseq-graph-living-atlas");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "logseq-graph-living-atlas");
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "logseq-graph-living-atlas");
  }
  return path.join(os.homedir(), ".cache", "logseq-graph-living-atlas");
}

function createDemoGraphRoot() {
  const cacheDirectory = defaultCacheDirectory();
  fs.mkdirSync(cacheDirectory, { recursive: true });
  return createFixtureGraph({ out: fs.mkdtempSync(path.join(cacheDirectory, "demo-logseq-graph-")) });
}

function failStartup(error, debugPaths) {
  const message = String(error?.message || error || "Startup failed");
  console.error(`[living-atlas] ${message}`);
  console.error("[living-atlas] Expected --root to point at a Logseq graph folder containing pages/.");
  console.error("[living-atlas] Try: logseq-graph-living-atlas --root /path/to/logseq");
  console.error("[living-atlas] Or run the public fixture: logseq-graph-living-atlas --demo");
  if (debugPaths) console.error(error?.stack || error);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {};
  if (argv[0] === "doctor" || argv[0] === "update") {
    return { command: argv[0], maintenance: parseMaintenanceArgs(argv) };
  }
  const valueFlags = new Set(["root", "cache", "port", "static", "token", "allowed-origin"]);
  const booleanFlags = new Set([
    "watch",
    "help",
    "version",
    "debug-paths",
    "no-static",
    "demo",
    "require-token",
    "allow-unauthenticated-read",
    "allow-unauthenticated-reindex"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const inline = arg.match(/^--([^=]+)=(.*)$/);
    if (inline) {
      parsed[inline[1]] = inline[2];
      continue;
    }
    const key = arg.slice(2);
    if (booleanFlags.has(key)) {
      parsed[key] = true;
      continue;
    }
    if (valueFlags.has(key)) {
      parsed[key] = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`logseq-graph-living-atlas ${packageJson.version}

Usage:
  logseq-graph-living-atlas --root /path/to/logseq [options]
  npx logseq-graph-living-atlas --root /path/to/logseq
  npx logseq-graph-living-atlas --demo
  logseq-graph-living-atlas doctor [--root /path/to/logseq] [--json]
  logseq-graph-living-atlas update [--check|--dry-run|--apply] [--channel latest] [--json]

Options:
  --root <path>             Logseq graph folder containing pages/. journals/ is optional.
  --demo                    Run a public fixture graph without needing Logseq data.
  --port <number>           Local port. Defaults to 8787.
  --cache <path>            Snapshot cache path outside the graph.
  --static <path>           Static UI directory. Defaults to packaged dist/ when present.
  --no-static               Serve API only.
  --watch                   Watch pages/ and journals/ for markdown changes.
  --token <value>           Local API token. Required for reads when token mode is enabled.
  --require-token           Require the token for every /api/* read and write route.
  --allow-unauthenticated-read
                            Allow local API reads without a token for trusted development.
  --allow-unauthenticated-reindex
                            Allow POST /api/reindex without a token for local development.
  --allowed-origin <origin> Add a local browser origin for split dev CORS.
  --debug-paths             Include absolute diagnostic paths and detailed errors.
  --version                 Print version.
  --help                    Print this help.

Maintenance:
  doctor                    Validate Node, package metadata, install mode, static build, and optional graph root.
  update                    Check the npm release channel and print install-mode-aware update guidance.
  update --apply            Apply only when the install mode is mutable and LOGSEQ_UPDATE_ALLOW_APPLY=1 is set.

Examples:
  npx logseq-graph-living-atlas --demo
  npx logseq-graph-living-atlas --root ~/Documents/Logseq
  logseq-graph-living-atlas --root ~/Documents/Logseq --port 8787 --watch
  logseq-graph-living-atlas doctor --root ~/Documents/Logseq
  logseq-graph-living-atlas update --check
  LIVING_ATLAS_TOKEN=<random-local-token> LIVING_ATLAS_ALLOWED_ORIGINS=http://127.0.0.1:5177 npm run dev:api -- --root ~/Documents/Logseq
`);
}
