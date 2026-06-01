#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { parsePageRecord } from "../server/logseq/parser.mjs";
import { createBrainService } from "../server/service.mjs";

const qaDir = process.env.LIVING_ATLAS_QA_DIR || process.env.BRAIN_ATLAS_QA_DIR || path.join(os.tmpdir(), `living-atlas-scale-qa-${process.pid}`);
fs.mkdirSync(qaDir, { recursive: true });

const browser = await chromium.launch();
try {
  await verifyScaleCase({ size: 10000, expectedTier: /balanced|safe/, timeoutMs: 20000 });
  await verifyScaleCase({ size: 100000, expectedTier: /safe/, timeoutMs: 30000 });
} finally {
  await browser.close();
}

async function verifyScaleCase({ size, expectedTier, timeoutMs }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `living-atlas-ui-scale-${size}-`));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), `living-atlas-ui-scale-cache-${size}-`));
  const port = await getFreePort();
  const records = makeRecords(root, size);
  const service = createBrainService({
    root,
    allowUnauthenticatedRead: true,
    sourceAdapter: {
      kind: "ui-scale-adapter",
      root,
      readManifest() {
        return {
          pages: records.length,
          graphId: `ui-scale-${size}`,
          fingerprint: `ui-scale-${size}-v1`,
          maxMtimeMs: Date.parse("2026-05-31T00:00:00.000Z")
        };
      },
      readRecords() {
        return records;
      },
      watchDirectories() {
        return [];
      }
    },
    cachePath: path.join(cacheRoot, "snapshot.json"),
    staticDir: path.resolve("dist"),
    port,
    allowUnauthenticatedReindex: true,
    logger: { log() {}, error: console.error }
  });

  try {
    await service.listen();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const start = performance.now();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.getByText("Living Atlas", { exact: true }).waitFor({ timeout: timeoutMs });
    await page.locator("canvas").waitFor({ timeout: timeoutMs });
    await page.waitForFunction(() => {
      const host = document.querySelector(".atlas-canvas");
      return Boolean(host?.getAttribute("data-render-quality"));
    }, null, { timeout: timeoutMs });
    const loadMs = performance.now() - start;
    const contract = await page.locator(".atlas-canvas").evaluate((host) => ({
      quality: host.getAttribute("data-render-quality") || "",
      qualityLabel: host.getAttribute("data-render-quality-label") || "",
      pixelRatioCap: Number(host.getAttribute("data-render-pixel-ratio-cap") || 0),
      particleScale: Number(host.getAttribute("data-render-particle-scale") || 0),
      tetherScale: Number(host.getAttribute("data-render-tether-scale") || 0),
      tetherVertices: Number(host.getAttribute("data-nebula-tethers") || 0)
    }));
    assert.match(contract.quality, expectedTier, `${size} graph should select adaptive render quality, saw ${contract.quality}`);
    assert.ok(contract.pixelRatioCap <= 1.35, `${size} graph should cap pixel ratio, saw ${contract.pixelRatioCap}`);
    assert.ok(contract.particleScale <= 0.7, `${size} graph should reduce particle density, saw ${contract.particleScale}`);
    assert.ok(contract.tetherScale <= 0.55, `${size} graph should reduce tether density, saw ${contract.tetherScale}`);
    const statsText = await page.locator(".stats-strip").textContent();
    assert.match(statsText || "", new RegExp(formatNumber(size)), `stats strip should expose full ${size} node total`);
    const screenshot = await page.locator("canvas").screenshot({ path: path.join(qaDir, `living-atlas-ui-scale-${size}.png`) });
    assertCanvasHasSignal(screenshot, size);
    assert.ok(loadMs < timeoutMs, `${size} UI scale load exceeded ${timeoutMs}ms: ${Math.round(loadMs)}ms`);
    await page.close();
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
}

function makeRecords(root, size) {
  const records = [];
  const anchorCount = 12;
  for (let index = 0; index < Math.min(anchorCount, size); index += 1) {
    records.push(parsePageRecord(
      path.join(root, "pages", `Region ${index}.md`),
      "type:: project\nstatus:: active\n",
      { mtimeMs: Date.parse("2026-05-31T00:00:00.000Z") - index * 1000 },
      { root }
    ));
  }
  for (let index = records.length; index < size; index += 1) {
    const anchor = `Region ${index % anchorCount}`;
    const previous = `Scale ${Math.max(anchorCount, index - 1)}`;
    records.push(parsePageRecord(
      path.join(root, "pages", `Scale ${index}.md`),
      `type:: ${index % 11 === 0 ? "person" : index % 7 === 0 ? "organization" : "project"}\ntags:: [[${anchor}]]\n- [[${anchor}]] [[${previous}]]\n`,
      { mtimeMs: Date.parse("2026-05-31T00:00:00.000Z") - (index % 2000) * 60000 },
      { root }
    ));
  }
  return records;
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

function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "\\s+");
}

function assertCanvasHasSignal(buffer, size) {
  const png = PNG.sync.read(buffer);
  let lit = 0;
  let colored = 0;
  let brightest = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const brightness = r + g + b;
    if (brightness > 40) lit += 1;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 10 && brightness > 50) colored += 1;
    brightest = Math.max(brightest, brightness);
  }
  const pixels = png.width * png.height;
  assert.ok(lit / pixels > 0.004, `${size} canvas should render luminous matter; lit ratio=${lit / pixels}`);
  assert.ok(colored / pixels > 0.0025, `${size} canvas should render colored matter; colored ratio=${colored / pixels}`);
  assert.ok(brightest > 220, `${size} canvas should contain bright highlights; brightest=${brightest}`);
}
