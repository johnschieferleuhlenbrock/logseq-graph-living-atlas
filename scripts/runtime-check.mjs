#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checkedRoots = ["server", "scripts", "tests"];
const findings = [];

for (const relativeRoot of checkedRoots) {
  collectMjs(path.join(root, relativeRoot)).forEach(checkSyntax);
}

if (findings.length) {
  console.error("Runtime syntax check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Runtime syntax check passed for ${checkedRoots.join(", ")}.`);

function collectMjs(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMjs(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(fullPath);
  }
  return files.sort();
}

function checkSyntax(filePath) {
  try {
    execFileSync(process.execPath, ["--check", filePath], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const relativePath = path.relative(root, filePath);
    const details = String(error.stderr || error.stdout || error.message || "").trim();
    findings.push(`${relativePath}${details ? `: ${details}` : ""}`);
  }
}
