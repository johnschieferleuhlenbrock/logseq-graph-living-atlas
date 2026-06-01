#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createFixtureGraph } from "../server/fixture/create-fixture-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const galleryMode = argv.includes("--gallery");
const outArg = argv.find((item) => !item.startsWith("--"));
const out = path.resolve(repoRoot, outArg || "docs/assets/living-atlas-demo.png");
const port = 18987;
const graphRoot = createFixtureGraph({ out: path.join(os.tmpdir(), "living-atlas-capture-logseq-graph") });
const cachePath = path.join(os.tmpdir(), "living-atlas-capture-snapshot.json");

await fs.mkdir(path.dirname(galleryMode ? path.join(repoRoot, "docs/assets/living-atlas-demo.png") : out), { recursive: true });

const service = spawn(process.execPath, [
  "server/brain-service.mjs",
  "--root",
  graphRoot,
  "--cache",
  cachePath,
  "--static",
  "dist",
  "--allow-unauthenticated-read",
  "--port",
  String(port)
], {
  cwd: repoRoot,
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
service.stderr.on("data", (chunk) => (stderr += chunk.toString()));

try {
  await waitForHealth(port);
  const browser = await chromium.launch();
  if (galleryMode) {
    const assets = [
      ["docs/assets/living-atlas-demo.png", captureOverview],
      ["docs/assets/living-atlas-source-detail.png", captureSourceDetail],
      ["docs/assets/living-atlas-pathfinder.png", capturePathfinder],
      ["docs/assets/living-atlas-radar.png", captureRadar]
    ];
    for (const [relativePath, capture] of assets) {
      const target = path.join(repoRoot, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const page = await newAtlasPage(browser);
      await capture(page, target);
      await page.close();
      console.log(target);
    }
  } else {
    const page = await newAtlasPage(browser);
    await page.screenshot({ path: out, fullPage: false });
    await page.close();
    console.log(out);
  }
  await browser.close();
} finally {
  service.kill();
}

async function newAtlasPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "load" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 15000 });
  await waitForText(page, "Living Atlas");
  return page;
}

async function captureOverview(page, target) {
  await page.screenshot({ path: target, fullPage: false });
}

async function captureSourceDetail(page, target) {
  await dismissFirstRun(page);
  await page.keyboard.press("Control+K");
  await page.locator(".command-input input").fill("Atlas");
  await page.locator(".command-input input").press("Enter");
  await waitForText(page, "Entity X-Ray");
  await waitForText(page, "Orbit Edges");
  await page.screenshot({ path: target, fullPage: false });
}

async function capturePathfinder(page, target) {
  await dismissFirstRun(page);
  await page.locator("input[aria-label='Path from']").fill("Project Orion");
  await page.locator("input[aria-label='Path to']").fill("Atlas");
  await page.getByRole("button", { name: "Trace path" }).click();
  await waitForText(page, "Project Orion connects to Atlas");
  await waitForText(page, "Alternate paths");
  await page.screenshot({ path: target, fullPage: false });
}

async function captureRadar(page, target) {
  await dismissFirstRun(page);
  await page.getByRole("button", { name: "Radar pulse" }).click();
  await waitForText(page, "Radar Sweep");
  await waitForText(page, "Connector Radar");
  await page.screenshot({ path: target, fullPage: false });
}

async function dismissFirstRun(page) {
  const dismiss = page.getByRole("button", { name: "Dismiss first run actions" });
  if (await dismiss.count()) await dismiss.click();
}

async function waitForText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10000 });
}

async function waitForHealth(portNumber) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/api/health`);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`capture service did not start\nstdout=${stdout}\nstderr=${stderr}`);
}
