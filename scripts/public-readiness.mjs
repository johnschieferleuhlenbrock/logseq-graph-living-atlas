#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const blockedPathParts = new Set(["node_modules", ".cache", ".git", "docs/qa", "coverage", "playwright-report", "test-results", ".public-readiness.local.json"]);
const generatedPathParts = new Set(["dist", ".cache", "docs/qa", "coverage", "playwright-report", "test-results"]);
const localConfigPath = path.join(root, ".public-readiness.local.json");
const expectedBinaryHashes = new Map([
  ["docs/assets/living-atlas-demo.png", "3f947b0011504f18c506f1f54edb00f40610759c9d79d4a4703faf431b4be5f2"],
  ["docs/assets/living-atlas-pathfinder.png", "189c145d5c332b6fdc1e22466d624bb8313e22f6c8ec4ffff23c98a1c0d72851"],
  ["docs/assets/living-atlas-radar.png", "129b3bd2cd2b909696ad8adfa1466690b32b89524d27ebc0681427932a586129"],
  ["docs/assets/living-atlas-source-detail.png", "bf4f05ef2e0dfeba40abcaf226fcd810763fea7a76de2bfc761f94c12ec07416"]
]);
const forbiddenLocalArtifacts = [".cache", "docs/qa", ".env", ".env.local"];
const sensitivePatterns = [
  /\/Users\/[A-Za-z0-9._-]+/i,
  /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/i,
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_./+-]{12,}/i,
  /secret\s*[:=]\s*["']?[A-Za-z0-9_./+-]{12,}/i,
  /token\s*[:=]\s*["']?[A-Za-z0-9_./+-]{16,}/i,
  /password\s*[:=]\s*["']?[A-Za-z0-9_./+-]{8,}/i,
  /private[_-]?key/i
];

const findings = [];
loadLocalPatterns();
checkGitShape();
checkPackageMetadata();
checkPublicRepoScaffolding();
checkLocalApiBuildTarget();
checkForbiddenLocalArtifacts();
checkTrackedGeneratedArtifacts();
checkExpectedBinaryArtifacts();
checkUnexpectedDocsBinaries();
walk(root);

if (findings.length) {
  console.error("Public readiness check failed:");
  for (const finding of findings.slice(0, 80)) console.error(`- ${finding}`);
  if (findings.length > 80) console.error(`- ... ${findings.length - 80} more`);
  process.exit(1);
}

console.log("Public readiness check passed.");

function loadLocalPatterns() {
  if (!fs.existsSync(localConfigPath)) return;
  const config = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
  for (const term of config.terms || []) {
    if (typeof term === "string" && term.trim()) sensitivePatterns.push(new RegExp(escapeRegExp(term.trim()), "i"));
  }
  for (const pattern of config.patterns || []) {
    if (typeof pattern === "string" && pattern.trim()) sensitivePatterns.push(new RegExp(pattern, "i"));
  }
}

function checkGitShape() {
  if (!fs.existsSync(path.join(root, ".git"))) {
    findings.push("git: repository is not initialized; initialize with the public branch named main");
    return;
  }
  if (isTrustedPullRequestCheckout()) return;
  const branch = git(["branch", "--show-current"]).trim();
  if (branch === "main") return;
  if (!branch && isTrustedReleaseTagCheckout()) return;
  findings.push(`git: current branch must be main, found ${branch || "(detached)"}`);
}

function isTrustedPullRequestCheckout() {
  return process.env.GITHUB_ACTIONS === "true" &&
    process.env.GITHUB_EVENT_NAME === "pull_request" &&
    process.env.GITHUB_BASE_REF === "main";
}

function checkPackageMetadata() {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) return;
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  for (const key of ["name", "version", "description", "license", "repository", "bugs", "homepage", "packageManager"]) {
    if (!pkg[key]) findings.push(`package.json: missing public metadata field "${key}"`);
  }
  if (pkg.private === true) findings.push("package.json: private must be removed before public release");
  if (!pkg.engines?.node) findings.push("package.json: missing engines.node");
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) findings.push("package.json: missing files allowlist for package publishing");
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
    findings.push("package.json: production dependencies must stay empty until the packaged CLI needs runtime npm modules");
  }
  for (const generatedKey of ["main", "directories"]) {
    if (pkg[generatedKey]) findings.push(`package.json: remove npm-init generated field "${generatedKey}"`);
  }
}

function checkPublicRepoScaffolding() {
  const requiredFiles = [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".github/dependabot.yml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    "package-lock.json",
    ".node-version",
    ".nvmrc",
    "SECURITY.md",
    "SUPPORT.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "MAINTAINERS.md",
    "GOVERNANCE.md",
    "ROADMAP.md",
    "docs/ADAPTERS.md"
  ];
  for (const filePath of requiredFiles) {
    if (!fs.existsSync(path.join(root, filePath))) findings.push(`repo: missing public scaffolding file ${filePath}`);
  }
  const ci = readText(".github/workflows/ci.yml");
  if (ci) {
    for (const command of ["npm ci", "npm run validate", "npm audit --audit-level=moderate", "npm run smoke:package"]) {
      if (!ci.includes(command)) findings.push(`ci: missing required command "${command}"`);
    }
    if (!ci.includes("npx playwright install --with-deps chromium")) findings.push("ci: missing Playwright browser installation");
  }
  const release = readText(".github/workflows/release.yml");
  if (release) {
    for (const command of ["npm run validate", "npm run smoke:package", "npm run check:release", "npm install -g npm@latest", "npm publish --access public"]) {
      if (!release.includes(command)) findings.push(`release: missing required command "${command}"`);
    }
    if (!release.includes("id-token: write")) findings.push("release: missing id-token permission for npm provenance");
  }
  const prTemplate = readText(".github/PULL_REQUEST_TEMPLATE.md");
  if (prTemplate && !prTemplate.includes("No real Logseq graph data")) {
    findings.push("pr template: missing real-graph data safety checklist");
  }
  const bugTemplate = readText(".github/ISSUE_TEMPLATE/bug_report.yml");
  if (bugTemplate && !bugTemplate.includes("Do not attach real Logseq graph files")) {
    findings.push("bug template: missing private graph warning");
  }
  const featureTemplate = readText(".github/ISSUE_TEMPLATE/feature_request.yml");
  if (featureTemplate && !featureTemplate.includes("Public-safety checklist")) {
    findings.push("feature template: missing public-safety checklist");
  }
  const contributing = readText("CONTRIBUTING.md");
  if (contributing && !contributing.includes("Use `main` as the only default branch target")) {
    findings.push("contributing: missing main-only branch guidance");
  }
}

function checkLocalApiBuildTarget() {
  const value = process.env.VITE_BRAIN_API || "";
  if (!value) return;
  try {
    const url = new URL(value);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return;
  } catch {
    findings.push(`VITE_BRAIN_API must be empty or local for public builds, found ${value}`);
    return;
  }
  findings.push(`VITE_BRAIN_API must not point at a non-local API for public builds, found ${value}`);
}

function checkForbiddenLocalArtifacts() {
  for (const relativePath of forbiddenLocalArtifacts) {
    if (fs.existsSync(path.join(root, relativePath))) {
      findings.push(`local artifact must be removed before public release: ${relativePath}`);
    }
  }
}

function checkTrackedGeneratedArtifacts() {
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const staged = git(["diff", "--cached", "--name-only", "-z"]).split("\0").filter(Boolean);
  for (const filePath of new Set([...tracked, ...staged])) {
    if (isGeneratedPath(filePath)) findings.push(`git: generated/private artifact is tracked or staged: ${filePath}`);
  }
}

function checkExpectedBinaryArtifacts() {
  for (const [filePath, expectedHash] of expectedBinaryHashes) {
    const absolutePath = path.join(root, filePath);
    if (!fs.existsSync(absolutePath)) {
      findings.push(`binary artifact missing: ${filePath}`);
      continue;
    }
    const actualHash = crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
    if (actualHash !== expectedHash) {
      findings.push(`binary artifact changed without review: ${filePath}`);
    }
  }
}

function checkUnexpectedDocsBinaries() {
  const docsRoot = path.join(root, "docs");
  if (!fs.existsSync(docsRoot)) return;
  for (const filePath of listFiles(docsRoot)) {
    const relativePath = path.relative(root, filePath);
    if (isBinaryLike(relativePath) && !expectedBinaryHashes.has(relativePath)) {
      findings.push(`docs: unexpected binary artifact needs explicit public review: ${relativePath}`);
    }
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(root, fullPath);
    if ([...blockedPathParts].some((part) => relativePath === part || relativePath.startsWith(`${part}${path.sep}`))) continue;
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || isBinaryLike(entry.name)) continue;
    const text = fs.readFileSync(fullPath, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (sensitivePatterns.some((pattern) => pattern.test(line))) {
        findings.push(`${relativePath}:${index + 1}: ${line.trim().slice(0, 160)}`);
      }
    });
  }
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function readText(filePath) {
  const absolutePath = path.join(root, filePath);
  if (!fs.existsSync(absolutePath)) return "";
  return fs.readFileSync(absolutePath, "utf8");
}

function isTrustedReleaseTagCheckout() {
  const tag = releaseTagName();
  if (!/^v\d+\.\d+\.\d+/.test(tag)) return false;
  if (tag !== `v${readPackageJson().version}`) return false;

  const head = git(["rev-parse", "HEAD"]).trim();
  const remoteMain = remoteMainSha();
  return Boolean(head && remoteMain && head === remoteMain);
}

function releaseTagName() {
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  return git(["describe", "--tags", "--exact-match", "HEAD"]).trim();
}

function remoteMainSha() {
  const remoteHead = git(["ls-remote", "--heads", "origin", "main"]).trim();
  return remoteHead.split(/\s+/)[0] || "";
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}

function isGeneratedPath(filePath) {
  return [...generatedPathParts].some((part) => filePath === part || filePath.startsWith(`${part}/`));
}

function isBinaryLike(fileName) {
  return /\.(png|jpg|jpeg|webp|gif|ico|zip|gz|pdf|mp4|mov|wasm)$/i.test(fileName);
}

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
