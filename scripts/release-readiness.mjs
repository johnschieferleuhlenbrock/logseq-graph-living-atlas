#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const findings = [];

checkCleanReleaseRef();
checkPackageUrls();
checkRemoteReachable();
checkNpmPackageState();

if (findings.length) {
  console.error("Release readiness check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Release readiness check passed.");

function checkCleanReleaseRef() {
  const branch = git(["branch", "--show-current"]).trim();
  const status = git(["status", "--porcelain"]).trim();
  if (status) findings.push("git: worktree must be clean before release");
  const tag = releaseTagName();
  const allowUntagged = process.env.LIVING_ATLAS_ALLOW_UNTAGGED_RELEASE_CHECK === "1";
  if (!allowUntagged && !tag) {
    findings.push("git: release publishing requires an exact version tag");
  }
  if (tag && tag !== `v${readPackageJson().version}`) {
    findings.push(`git: release tag ${tag} must match package version v${readPackageJson().version}`);
  }
  if (branch === "main") return;
  if (branch) {
    findings.push(`git: release branch must be main, found ${branch}`);
    return;
  }
  const head = git(["rev-parse", "HEAD"]).trim();
  const remoteMain = remoteMainSha();
  if (remoteMain && head && remoteMain !== head) {
    findings.push("git: detached release checkout must point at origin/main");
  }
}

function checkPackageUrls() {
  const pkg = readPackageJson();
  const repositoryUrl = normalizeGitUrl(pkg.repository?.url || "");
  const homepageUrl = normalizeWebUrl(pkg.homepage || "");
  const bugsUrl = normalizeWebUrl(pkg.bugs?.url || "");
  const expected = "github.com/johnschieferleuhlenbrock/logseq-graph-living-atlas";
  if (!repositoryUrl.includes(expected)) findings.push(`package.json: repository must point at ${expected}`);
  if (!homepageUrl.includes(expected)) findings.push(`package.json: homepage must point at ${expected}`);
  if (!bugsUrl.includes(`${expected}/issues`)) findings.push(`package.json: bugs.url must point at ${expected}/issues`);
}

function checkRemoteReachable() {
  const origin = git(["remote", "get-url", "origin"]).trim();
  if (!origin) {
    findings.push("git: origin remote is required before public release");
    return;
  }
  const normalizedOrigin = normalizeGitUrl(origin);
  const pkg = readPackageJson();
  const repositoryUrl = normalizeGitUrl(pkg.repository?.url || "");
  if (repositoryUrl && normalizedOrigin !== repositoryUrl) {
    findings.push(`git: origin (${origin}) does not match package repository (${pkg.repository.url})`);
  }
  if (!remoteMainSha()) findings.push("git: origin/main is not reachable");
}

function checkNpmPackageState() {
  const pkg = readPackageJson();
  const result = run("npm", ["view", pkg.name, "version", "--json"]);
  if (result.status !== 0) {
    if (result.stderr.includes("E404") || result.stdout.includes("\"code\":\"E404\"")) return;
    findings.push(`npm: unable to inspect package ${pkg.name}`);
    return;
  }
  const published = result.stdout.trim().replace(/^"|"$/g, "");
  if (published === pkg.version && process.env.LIVING_ATLAS_ALLOW_ALREADY_PUBLISHED === "1") return;
  if (published === pkg.version) findings.push(`npm: ${pkg.name}@${pkg.version} is already published`);
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}

function git(args) {
  return run("git", args).stdout;
}

function remoteMainSha() {
  const remoteHead = git(["ls-remote", "--heads", "origin", "main"]).trim();
  return remoteHead.split(/\s+/)[0] || "";
}

function releaseTagName() {
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  return git(["describe", "--tags", "--exact-match", "HEAD"]).trim();
}

function run(command, args) {
  try {
    return {
      status: 0,
      stdout: execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      stderr: ""
    };
  } catch (error) {
    return {
      status: error.status || 1,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || error.message || "")
    };
  }
}

function normalizeGitUrl(value) {
  return String(value || "")
    .replace(/^git\+/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^git@github\.com:/, "github.com/")
    .replace(/\.git$/, "")
    .replace(/#readme$/, "")
    .toLowerCase();
}

function normalizeWebUrl(value) {
  return String(value || "")
    .replace(/^https?:\/\//, "")
    .replace(/#readme$/, "")
    .toLowerCase();
}
