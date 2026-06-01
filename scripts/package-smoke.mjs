#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = process.cwd();
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "living-atlas-package-smoke-"));
const packDir = path.join(workRoot, "pack");
const installDir = path.join(workRoot, "install");
const sensitivePatterns = [
  /\/Users\/[A-Za-z0-9._-]+/i,
  /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/i,
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_./+-]{12,}/i,
  /secret\s*[:=]\s*["']?[A-Za-z0-9_./+-]{12,}/i,
  /token\s*[:=]\s*["']?[A-Za-z0-9_./+-]{16,}/i,
  /password\s*[:=]\s*["']?[A-Za-z0-9_./+-]{8,}/i,
  /private[_-]?key/i
];
const forbiddenPackagePrefixes = [
  ".cache/",
  ".git/",
  ".github/",
  "coverage/",
  "docs/qa/",
  "node_modules/",
  "playwright-report/",
  "scripts/",
  "src/",
  "test-results/",
  "tests/"
];
const forbiddenPackageFiles = new Set([
  ".env",
  ".env.local",
  ".public-readiness.local.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts"
]);
fs.mkdirSync(packDir, { recursive: true });
fs.mkdirSync(installDir, { recursive: true });

try {
  assertLocalApiBuildTarget();
  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", packDir], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });
  const packResult = parsePackJson(packOutput);
  assertPackageContents(packResult);
  scanPackagePayload(packResult);
  const tarballName = packResult.filename;
  const tarballPath = path.join(packDir, tarballName);

  execFileSync("npm", ["init", "-y"], { cwd: installDir, stdio: "ignore" });
  execFileSync("npm", ["install", "--omit=dev", tarballPath], { cwd: installDir, stdio: "inherit" });

  const binPath = path.join(installDir, "node_modules", ".bin", process.platform === "win32" ? "living-atlas.cmd" : "living-atlas");
  const packageBinPath = path.join(installDir, "node_modules", ".bin", process.platform === "win32" ? "logseq-graph-living-atlas.cmd" : "logseq-graph-living-atlas");
  const version = execFileSync(binPath, ["--version"], { cwd: installDir, encoding: "utf8" }).trim();
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`unexpected version output: ${version}`);
  const packageVersion = execFileSync(packageBinPath, ["--version"], { cwd: installDir, encoding: "utf8" }).trim();
  if (packageVersion !== version) throw new Error(`package-name bin version mismatch: ${packageVersion} !== ${version}`);
  const help = execFileSync(binPath, ["--help"], { cwd: installDir, encoding: "utf8" });
  if (!help.includes("Usage:")) throw new Error("help output did not include usage text");

  const port = await getFreePort();
  const service = spawn(binPath, ["--demo", "--port", String(port)], {
    cwd: installDir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  service.stderr.on("data", (chunk) => (stderr += chunk.toString()));

  try {
    const health = await waitForHealth(port, () => stdout, () => stderr);
    if (!health.ok || health.root !== undefined) {
      throw new Error(`unexpected health payload: ${JSON.stringify(health)}`);
    }
    const app = await fetchText(`http://127.0.0.1:${port}/`);
    if (!app.includes("<title>Living Atlas</title>") || !app.includes('id="root"')) {
      throw new Error("packaged service did not serve the built Living Atlas UI");
    }
  } finally {
    service.kill();
  }

  const securePort = await getFreePort();
  const packageSmokeCredential = "package-smoke-credential";
  const secureService = spawn(binPath, ["--demo", "--port", String(securePort), "--token", packageSmokeCredential, "--require-token"], {
    cwd: installDir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let secureStdout = "";
  let secureStderr = "";
  secureService.stdout.on("data", (chunk) => (secureStdout += chunk.toString()));
  secureService.stderr.on("data", (chunk) => (secureStderr += chunk.toString()));

  try {
    await waitForStaticApp(securePort, () => secureStdout, () => secureStderr);
    const denied = await fetch(`http://127.0.0.1:${securePort}/api/health`);
    if (denied.status !== 401) throw new Error(`secure package API should reject unauthenticated reads, saw ${denied.status}`);
    const allowed = await fetch(`http://127.0.0.1:${securePort}/api/health`, {
      headers: { Authorization: `Bearer ${packageSmokeCredential}` }
    });
    if (!allowed.ok) throw new Error(`secure package API should accept bearer auth, saw ${allowed.status}`);
    const health = await allowed.json();
    if (health.requireToken !== true || health.root !== undefined) {
      throw new Error(`unexpected secure health payload: ${JSON.stringify(health)}`);
    }
  } finally {
    secureService.kill();
  }

  console.log(`Package smoke passed for ${tarballName}`);
} finally {
  fs.rmSync(workRoot, { recursive: true, force: true });
}

function assertLocalApiBuildTarget() {
  const value = process.env.VITE_BRAIN_API || "";
  if (!value) return;
  try {
    const url = new URL(value);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return;
  } catch {
    // fall through to fail with the raw value
  }
  throw new Error(`VITE_BRAIN_API must not point at a non-local API during package smoke: ${value}`);
}

function parsePackJson(output) {
  const match = output.match(/(\[\s*\{[\s\S]*\])\s*$/);
  if (!match) throw new Error(`npm pack did not report JSON package metadata:\n${output}`);
  const [entry] = JSON.parse(match[1]);
  if (!entry?.filename || !Array.isArray(entry.files)) {
    throw new Error(`npm pack JSON was missing filename or files:\n${match[1]}`);
  }
  return entry;
}

function assertPackageContents(packResult) {
  const files = packResult.files.map((file) => file.path).sort();
  const forbidden = files.filter((filePath) => (
    forbiddenPackageFiles.has(filePath) ||
    forbiddenPackagePrefixes.some((prefix) => filePath === prefix.slice(0, -1) || filePath.startsWith(prefix))
  ));
  if (forbidden.length) {
    throw new Error(`package includes files that should remain source-only:\n${forbidden.join("\n")}`);
  }
  for (const requiredPath of [
    "dist/index.html",
    "server/brain-service.mjs",
    "server/service.mjs",
    "server/source-adapter-contract.d.ts",
    "docs/ADAPTERS.md",
    "docs/API.md",
    "docs/ARCHITECTURE.md",
    "docs/CONCEPTS.md",
    "docs/TROUBLESHOOTING.md",
    "docs/assets/living-atlas-demo.png",
    "docs/assets/living-atlas-pathfinder.png",
    "docs/assets/living-atlas-radar.png",
    "docs/assets/living-atlas-source-detail.png",
    "README.md",
    "SECURITY.md",
    "SUPPORT.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "MAINTAINERS.md",
    "GOVERNANCE.md",
    "ROADMAP.md",
    "LICENSE"
  ]) {
    if (!files.includes(requiredPath)) throw new Error(`package is missing required file: ${requiredPath}`);
  }
  if (packResult.entryCount !== files.length) {
    throw new Error(`package entryCount mismatch: ${packResult.entryCount} !== ${files.length}`);
  }
}

function scanPackagePayload(packResult) {
  const findings = [];
  for (const file of packResult.files) {
    const filePath = file.path;
    if (isBinaryLike(filePath)) continue;
    const absolutePath = path.join(repoRoot, filePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
    const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (sensitivePatterns.some((pattern) => pattern.test(line))) {
        findings.push(`${filePath}:${index + 1}: ${line.trim().slice(0, 160)}`);
      }
    });
  }
  if (findings.length) {
    throw new Error(`package payload includes sensitive-looking content:\n${findings.slice(0, 40).join("\n")}`);
  }
}

function isBinaryLike(fileName) {
  return /\.(png|jpg|jpeg|webp|gif|ico|zip|gz|pdf|mp4|mov|wasm)$/i.test(fileName);
}

async function waitForHealth(port, stdout, stderr) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // keep waiting
    }
    await delay(100);
  }
  throw new Error(`packaged service did not start\nstdout=${stdout()}\nstderr=${stderr()}`);
}

async function waitForStaticApp(port, stdout, stderr) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await delay(100);
  }
  throw new Error(`packaged secure service did not start\nstdout=${stdout()}\nstderr=${stderr()}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`unexpected response ${response.status} for ${url}`);
  return response.text();
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
