#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fssync from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { createFixtureGraph } from "./fixtures/logseq-fixture.mjs";

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const fixtureRoot = createFixtureGraph();
const cacheRoot = fssync.mkdtempSync(path.join(os.tmpdir(), "living-atlas-ui-cache-"));
const qaDir = process.env.LIVING_ATLAS_QA_DIR || process.env.BRAIN_ATLAS_QA_DIR || path.join(os.tmpdir(), `living-atlas-qa-${process.pid}`);
const qaPath = (fileName) => path.join(qaDir, fileName);
const service = spawn(process.execPath, [
  "server/brain-service.mjs",
  "--root",
  fixtureRoot,
  "--cache",
  path.join(cacheRoot, "snapshot.json"),
  "--static",
  "dist",
  "--allow-unauthenticated-read",
  "--port",
  String(port)
], {
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
service.stderr.on("data", (chunk) => (stderr += chunk.toString()));

try {
  await waitForHealth();
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.root, undefined, "health should not expose absolute graph paths by default");
  assert.equal(health.cache?.configured, true, "health should expose cache status without leaking cache path");
  const snapshotPayload = await (await fetch(`${baseUrl}/api/snapshot`)).json();
  assert.ok(snapshotPayload.graph?.fingerprint, "snapshot should expose a stable non-path graph fingerprint for local-only storage namespaces");
  assert.ok(snapshotPayload.graph?.id, "snapshot should expose a stable non-path graph id for browser review storage");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(baseUrl, { waitUntil: "load" });
  await expectText(page, "Living Atlas");
  await expectText(page, "Nexus");
  await expectText(page, "People");
  await expectText(page, "Real pages");
  await expectText(page, "atlas points");
  await expectText(page, "atlas links");
  await expectText(page, "Lens links");
  await expectText(page, "Visual field");
  await expectText(page, "First signal");
  await page.getByRole("button", { name: "Search a page" }).click();
  assert.ok(await page.locator(".command-input input").inputValue(), "first-run search action should seed the command input");
  assert.equal(await page.locator(".command-input input").evaluate((input) => document.activeElement === input), true);
  await page.getByRole("button", { name: "Clear current atlas lens" }).click();
  await page.getByRole("button", { name: "Dismiss first run actions" }).click();
  assert.equal(await page.getByText("First signal", { exact: false }).count(), 0, "first-run panel should dismiss locally");
  assert.equal(await page.evaluate(() => window.localStorage.getItem("living-atlas-first-run-dismissed")), "1");
  await page.locator(".stream-header").getByText("Cognition Stream", { exact: false }).waitFor({ timeout: 5000 });
  await page.locator("canvas").waitFor({ timeout: 10000 });
  assert.equal(await page.locator("canvas").count(), 1);
  const canvasBox = await page.locator("canvas").boundingBox();
  assert.ok(canvasBox?.width && canvasBox.width > 800, "canvas should occupy a desktop-scale field");
  await fs.mkdir(qaDir, { recursive: true });
  const canvasPng = await page.locator("canvas").screenshot({ path: qaPath("living-atlas-canvas.png") });
  assertCanvasHasSignal(canvasPng);
  await page.waitForFunction(() => Number(document.querySelector(".atlas-canvas")?.getAttribute("data-nebula-tethers") || 0) > 0, null, { timeout: 20000 });
  const atlasMotionContract = await page.locator(".atlas-canvas").evaluate((host) => ({
    morphModel: host.getAttribute("data-morph-model"),
    anchorMode: host.getAttribute("data-nebula-anchor-mode"),
    renderQuality: host.getAttribute("data-render-quality"),
    tetherVertices: Number(host.getAttribute("data-nebula-tethers") || 0)
  }));
  assert.equal(atlasMotionContract.morphModel, "pressure-shove", "filter morphs should use the local pressure shove model");
  assert.equal(atlasMotionContract.anchorMode, "node-tethered", "nebula dust should be visually tethered to page nodes");
  const minimumTetherVertices = atlasMotionContract.renderQuality === "safe" ? 1000 : atlasMotionContract.renderQuality === "balanced" ? 3000 : 5000;
  assert.ok(
    atlasMotionContract.tetherVertices > minimumTetherVertices,
    `nebula projections should expose dense visible node-backed tethers for ${atlasMotionContract.renderQuality} quality, saw ${atlasMotionContract.tetherVertices}`
  );
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.5);
  for (let index = 0; index < 8; index += 1) await page.mouse.wheel(0, -540);
  await delay(700);
  const semanticZoom = await page.locator(".atlas-canvas").evaluate((host) => ({
    tier: host.getAttribute("data-zoom-tier"),
    labels: host.querySelectorAll(".atlas-node-label.semantic").length,
    motionScale: Number(host.getAttribute("data-motion-scale") || 1)
  }));
  assert.equal(semanticZoom.tier, "near", "deep zoom should enter the semantic detail tier");
  assert.ok(semanticZoom.labels > 0 && semanticZoom.labels <= 4, `semantic zoom should reveal a small number of page labels, saw ${semanticZoom.labels}`);
  assert.ok(semanticZoom.motionScale <= 0.05, `deep zoom should stabilize atlas motion, saw ${semanticZoom.motionScale}`);
  await page.reload({ waitUntil: "load" });
  await page.getByText("Living Atlas", { exact: true }).waitFor({ timeout: 10000 });
  await page.locator("canvas").waitFor({ timeout: 10000 });
  const resetCanvasBox = await page.locator("canvas").boundingBox();
  assert.ok(resetCanvasBox?.width && resetCanvasBox.width > 800, "canvas should reset to a desktop-scale field");
  await page.keyboard.press("Control+K");
  await page.locator(".command-input input").fill("Atlas");
  await page.locator(".command-input input").press("Enter");
  await expectTextInDom(page, "Selected dots are Logseq page nodes");
  await page.waitForFunction(() => document.querySelector(".atlas-canvas")?.getAttribute("data-selected-shockwave") === "on", null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector(".atlas-canvas")?.getAttribute("data-link-current") === "on", null, { timeout: 5000 });
  const selectedMotionContract = await page.locator(".atlas-canvas").evaluate((host) => ({
    selectionMotion: host.getAttribute("data-selection-motion"),
    linkCurrentModel: host.getAttribute("data-link-current-model")
  }));
  assert.equal(selectedMotionContract.selectionMotion, "quiet-orbit", "selected node halo should use the quieter orbit treatment");
  assert.equal(selectedMotionContract.linkCurrentModel, "slow-packets", "selected edges should use slow information packets instead of fast repeating beads");
  await expectText(page, "Orbit Edges");
  await expectText(page, "Entity X-Ray");
  await expectText(page, "Atlas Intelligence");
  await expectText(page, "links in");
  await expectText(page, "links out");
  await expectText(page, "total links");
  await expectText(page, "Role");
  await expectText(page, "Why");
  await expectText(page, "Next");
  await expectText(page, "Use Nexus as parent anchor.");
  const intelligenceRole = await page.locator(".atlas-intelligence").textContent();
  assert.ok(!(intelligenceRole || "").includes("Review Risk"), "Atlas Intelligence should use plain product language instead of internal risk labels");
  assert.equal(await page.getByText("Proof debt", { exact: false }).count(), 0, "primary UI should say Needs review instead of Proof debt");
  await expectText(page, "Cluster Command Deck");
  await expectText(page, "Needs review");
  await expectText(page, "Live Changes");
  await expectText(page, "No recent graph deltas");
  await expectText(page, "Stream idle");
  assert.equal(await page.locator(".mutation-layer.quiet").count(), 1, "quiet mutation layer should render a compact idle state");
  assert.equal(await page.getByText("0 recent", { exact: false }).count(), 0, "quiet mutation layer should not show dashboard zero counters");
  assert.equal(await page.getByText("waiting for Logseq CRUD", { exact: false }).count(), 0, "quiet live layer should not render synthetic delta rows");
  await expectText(page, "Atlas Filters");
  await expectText(page, "Signal tags");
  await expectText(page, "Next");
  assert.ok(
    await page.locator(".insight-next strong").first().isVisible(),
    "cognition stream should render a service-generated next action"
  );
  assert.equal(await page.getByText("2 min ago", { exact: false }).count(), 0, "insight cards should not show hardcoded demo timestamps");
  assert.ok(await page.locator(".related-sources .source-chip").count() >= 1, "signal tags should be derived from visible graph tags");
  await page.locator(".related-sources .source-chip").first().click();
  await expectText(page, "Clear");
  await page.getByRole("button", { name: "Clear current atlas lens" }).click();
  await expectText(page, "All");
  await expectText(page, "Core");
  await expectText(page, "Connectors");
  await expectText(page, "Advanced filters");
  await page.locator(".view-preset-grid button").filter({ hasText: "Core" }).click();
  await expectText(page, "Adaptive compact");
  await expectText(page, "Reset atlas");
  await expectText(page, "Core");
  assert.match(await page.locator(".replay-readout").textContent(), /(View|Live now) .+ pages/);
  assert.ok((await page.getByRole("button", { name: "Clear Core" }).count()) === 1, "active lens chip should clear the Core preset");
  assert.deepEqual(
    await page.locator(".active-lens-strip button").evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim())),
    ["Core"],
    "active lens chips should not concatenate the clear icon into visible text"
  );
  await delay(520);
  const coreCanvasPng = await page.locator("canvas").screenshot({ path: qaPath("living-atlas-core-filter-canvas.png") });
  assertCanvasHasSignal(coreCanvasPng);
  await page.getByRole("button", { name: "Advanced filters" }).click();
  await expectText(page, "Promoted labels");
  await expectText(page, "Edge density");
  await expectText(page, "Link direction");
  await expectText(page, "All labels");
  await expectText(page, "core atlas stays spatially stable");
  await expectText(page, "w ");
  const statusOptions = await page.locator(".filter-select-grid select").nth(0).locator("option").allTextContents();
  assert.ok(statusOptions.length > 1, "status filter should expose grouped status options");
  assert.ok(statusOptions.every((item) => item.length <= 24), `status options should be compact labels: ${statusOptions.join(" | ")}`);
  await page.locator(".filter-select-grid select").nth(0).selectOption("active");
  await expectText(page, "Status Active");
  await page.getByRole("button", { name: "Clear Status Active" }).click();
  assert.equal(await page.locator(".filter-select-grid select").nth(0).inputValue(), "all");
  const confidenceOptions = await page.locator(".filter-select-grid select").nth(1).locator("option").allTextContents();
  assert.ok(confidenceOptions.length > 1, "confidence filter should expose grouped confidence options");
  assert.ok(confidenceOptions.every((item) => item.length <= 24), `confidence options should be compact labels: ${confidenceOptions.join(" | ")}`);
  const sourceOptions = await page.locator(".filter-select-grid select").nth(2).locator("option").allTextContents();
  assert.ok(sourceOptions.length > 1, "source filter should expose grouped provenance options");
  assert.ok(sourceOptions.every((item) => item.length <= 34), `source options should be compact labels: ${sourceOptions.join(" | ")}`);
  await page.getByRole("button", { name: "dense" }).click();
  assert.ok((await page.locator(".filter-segment button.active").filter({ hasText: "dense" }).count()) >= 1);
  await page.getByRole("button", { name: "outbound" }).click();
  await page.locator(".filter-row").filter({ hasText: "Group names" }).getByRole("button").click();
  await page.reload({ waitUntil: "load" });
  await expectText(page, "Living Atlas");
  await expectText(page, "Hidden");
  await page.getByRole("button", { name: "Advanced filters" }).click();
  assert.ok((await page.locator(".filter-segment button.active").filter({ hasText: "dense" }).count()) >= 1, "edge density preference should survive reload");
  assert.ok((await page.locator(".filter-segment button.active").filter({ hasText: "outbound" }).count()) >= 1, "link direction preference should survive reload");
  const displaySettings = await page.evaluate(() => JSON.parse(window.localStorage.getItem("living-atlas-display-settings") || "{}"));
  assert.equal(displaySettings.version, 1, "display preferences should use a versioned storage shape");
  assert.equal(displaySettings.edgeDensity, "dense");
  assert.equal(displaySettings.linkDirection, "outbound");
  assert.equal(displaySettings.showGroupNames, false);
  await page.getByRole("button", { name: "Reset atlas" }).click();
  await expectText(page, "Visible");
  await page.getByRole("button", { name: "dense" }).click();
  assert.ok((await page.locator(".filter-segment button.active").filter({ hasText: "dense" }).count()) >= 1);
  const visibleGroupButtons = page.locator(".atlas-filters .cluster-toggle-grid").first().locator("button");
  const visibleGroupCount = await visibleGroupButtons.count();
  assert.ok(visibleGroupCount >= 2, "advanced filters should expose group toggles");
  await visibleGroupButtons.nth(1).click();
  await page.waitForFunction(() => document.querySelector(".atlas-canvas")?.getAttribute("data-morph-model") === "pressure-shove", null, { timeout: 3000 });
  await delay(760);
  await page.waitForFunction(() => document.querySelector(".atlas-canvas")?.getAttribute("data-morph-transition") === "off", null, { timeout: 4000 });
  const toggledCanvasPng = await page.locator("canvas").screenshot({ path: qaPath("living-atlas-group-toggle-canvas.png") });
  assertCanvasHasSignal(toggledCanvasPng);
  await page.getByRole("button", { name: "All groups" }).click();
  await page.screenshot({ path: qaPath("living-atlas-click-smoke.png"), fullPage: false });
  await page.screenshot({ path: qaPath("living-atlas-ui-smoke.png"), fullPage: false });
  await page.keyboard.press("Control+K");
  assert.equal(await page.locator(".command-input input").evaluate((input) => document.activeElement === input), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".command-input input").evaluate((input) => document.activeElement === input), false, "Escape should leave command search so numeric mode shortcuts work");
  await page.keyboard.press("5");
  await expectMode(page, "Replay");
  await page.keyboard.press("Escape");
  await expectMode(page, "Whole Mind");
  await page.keyboard.press("Control+K");
  await page.locator(".command-input input").fill("Atlas");
  await page.locator(".command-suggestions").waitFor({ timeout: 5000 });
  const atlasSuggestions = page.locator(".command-suggestions button").filter({ hasText: "Atlas" });
  assert.ok((await atlasSuggestions.count()) >= 1, "search should expose direct page suggestions");
  await page.locator(".command-input input").press("Enter");
  await expectText(page, "Orbit Edges");
  await expectText(page, "Clear");
  await page.getByRole("button", { name: "Clear current atlas lens" }).click();
  assert.equal(await page.locator(".command-input input").inputValue(), "");
  await expectMode(page, "Whole Mind");
  await page.keyboard.press("2");
  await expectMode(page, "Today");
  await page.keyboard.press("4");
  await expectMode(page, "Radar");
  await expectText(page, "Radar Sweep");
  await page.keyboard.press("5");
  await expectMode(page, "Replay");
  const shortcutReplayReadout = await page.locator(".replay-readout").textContent();
  assert.match(shortcutReplayReadout || "", /pages · \+/, "keyboard replay should expose visible page count and growth delta");
  await page.keyboard.press("ArrowLeft");
  await expectMode(page, "Replay");
  await page.keyboard.press("Escape");
  await expectMode(page, "Whole Mind");
  await page.getByRole("button", { name: "Radar pulse" }).click();
  await expectMode(page, "Radar");
  await expectText(page, "Radar Sweep");
  await expectText(page, "Connector Radar");
  assert.equal(await page.getByText("Bridge Candidate Radar", { exact: false }).count(), 0, "primary UI should use connector language instead of bridge jargon");
  await expectText(page, "Trigger sweep");
  await page.locator(".dimension-button").click();
  await expectMode(page, "Replay");
  const replayReadout = await page.locator(".replay-readout").textContent();
  assert.match(replayReadout || "", /pages · \+/, "replay readout should expose visible page count and growth delta");
  assert.equal(await page.locator(".timeline-next-button").isEnabled(), true, "replay should allow stepping forward from a previous frame");
  assert.ok(await page.locator(".timeline-track button").count() >= 4, "timeline should expose replay stops");
  await page.locator(".timeline-track button").first().click();
  await expectMode(page, "Replay");
  assert.equal(await page.locator(".dimension-button").isDisabled(), true, "first replay frame should disable previous step");
  await page.locator(".mode-switcher button").filter({ hasText: "Whole Mind" }).click();
  await expectMode(page, "Whole Mind");

  assert.equal(await page.locator("input[aria-label='Path from']").inputValue(), "");
  assert.equal(await page.locator("input[aria-label='Path to']").inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "Trace path" }).isDisabled(), true, "path tracing should start neutral until endpoints are explicit");
  await page.locator("input[aria-label='Path from']").fill("Project Orion");
  await page.locator("input[aria-label='Path to']").fill("Atlas");
  assert.equal(await page.getByRole("button", { name: "Trace path" }).isEnabled(), true);
  await page.getByRole("button", { name: "Trace path" }).click();
  await expectText(page, "Project Orion connects to Atlas");
  await expectText(page, "path");
  await expectText(page, "Project Orion links to Signal Desk");
  await expectText(page, "Signal Desk links to Atlas");
  await expectText(page, "Alternate paths");
  await expectText(page, "Project Orion -> Nexus -> Atlas");
  await expectText(page, "Source page");
  await expectText(page, "pages/Project Orion.md");
  await expectText(page, "Flag data issue");
  await expectText(page, "Non-destructive local triage");
  await page.getByRole("button", { name: "Flag for review" }).click();
  await expectText(page, "Review queued");
  await expectText(page, "Review Queue");
  await expectText(page, "1 local flag");
  await expectText(page, "Flags are local triage only");
  await expectText(page, "Copy packet");
  assert.equal(await page.getByRole("button", { name: "Queued" }).isDisabled(), true, "review flag should become a queued non-destructive state");
  await page.getByRole("button", { name: "Copy packet" }).click();
  await expectText(page, "Copied");
  await page.getByRole("button", { name: "View flagged" }).click();
  await expectText(page, "showing flagged pages with direct context");
  const reviewLegendText = await page.locator(".field-truth").textContent();
  const reviewVisiblePages = Number((reviewLegendText || "").match(/Real pages\s*([0-9,]+)/)?.[1]?.replaceAll(",", "") || 0);
  const reviewLensLinks = Number((reviewLegendText || "").match(/Lens links\s*([0-9,]+)/)?.[1]?.replaceAll(",", "") || 0);
  assert.ok(reviewVisiblePages > 1 && reviewVisiblePages <= 30, `review lens should expose bounded direct context, saw: ${reviewLegendText}`);
  assert.ok(reviewLensLinks > 0, `review lens should include direct context links, saw: ${reviewLegendText}`);
  const reviewPresetActive = await page.locator(".view-preset-grid button.active").evaluate((element) => element.textContent || "");
  assert.ok(reviewPresetActive.includes("Review"), `review preset should become the active atlas lens: ${reviewPresetActive}`);
  const queuedFlag = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((item) => item.startsWith("living-atlas-review-flags:"));
    const raw = key ? window.localStorage.getItem(key) : "";
    return raw ? JSON.parse(raw) : {};
  });
  assert.ok(Object.values(queuedFlag).some((flag) => flag.nodeRef && !flag.relativePath && !flag.name && !flag.nodeId), "review flag should persist a graph-local reference without page names or source paths");
  assert.ok(Object.values(queuedFlag).some((flag) => flag.role && !flag.why && !flag.next), "review flag should persist only generic Atlas role context");
  await page.getByRole("button", { name: "Open review flag Project Orion" }).click();
  await expectText(page, "pages/Project Orion.md");
  await expectText(page, "Atlas Intelligence");
  await page.getByRole("button", { name: "Copy path" }).click();
  await expectText(page, "Copied");
  await page.getByRole("button", { name: "Clear local data" }).click();
  await expectText(page, "local atlas data cleared");
  const localDataAfterClear = await page.evaluate(() => ({
    reviewKeys: Object.keys(window.localStorage).filter((key) => key.startsWith("living-atlas-review-flags:")).length,
    display: window.localStorage.getItem("living-atlas-display-settings"),
    firstRun: window.localStorage.getItem("living-atlas-first-run-dismissed"),
    authValue: window.sessionStorage.getItem("living-atlas-api-token")
  }));
  assert.deepEqual(localDataAfterClear, { reviewKeys: 0, display: null, firstRun: null, authValue: null });
  await page.screenshot({ path: qaPath("living-atlas-path-smoke.png"), fullPage: false });

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobilePage.goto(baseUrl, { waitUntil: "load" });
  await expectText(mobilePage, "Living Atlas");
  await mobilePage.locator("canvas").waitFor({ timeout: 10000 });
  const mobileModeMetrics = await mobilePage.locator(".mode-switcher").evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    overflowX: getComputedStyle(element).overflowX,
    display: getComputedStyle(element).display,
    columns: getComputedStyle(element).gridTemplateColumns.split(" ").length
  }));
  assert.equal(mobileModeMetrics.display, "grid");
  assert.equal(mobileModeMetrics.columns, 5, "mobile mode rail should show all five modes without hidden scrolling");
  assert.ok(mobileModeMetrics.scrollWidth <= mobileModeMetrics.clientWidth + 1, "mobile mode rail should not need horizontal scroll");
  const hiddenMobileLabels = await mobilePage.locator(".atlas-canvas").evaluate((host) => {
    const hostRect = host.getBoundingClientRect();
    return [...host.querySelectorAll(".atlas-cluster-label")].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent?.trim(),
        clipped: rect.left < hostRect.left || rect.right > hostRect.right || rect.top < hostRect.top || rect.bottom > hostRect.bottom
      };
    }).filter((item) => item.clipped);
  });
  assert.deepEqual(hiddenMobileLabels, [], "mobile cluster labels should stay inside the canvas viewport");
  for (const modeName of ["Whole Mind", "Today", "Focus", "Radar", "Replay"]) {
    const box = await mobilePage.locator(".mode-switcher button").filter({ hasText: modeName }).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `${modeName} should be fully visible in the first mobile viewport`);
  }
  await expectText(mobilePage, "Connector Radar");
  await expectText(mobilePage, "Pathfinder");
  await expectText(mobilePage, "Source truth");
  for (const selector of [".bridge-radar", ".pathfinder", ".source-truth"]) {
    const display = await mobilePage.locator(selector).evaluate((element) => getComputedStyle(element).display);
    assert.equal(display, "block", `${selector} should remain visible on mobile`);
  }
  await mobilePage.screenshot({ path: qaPath("living-atlas-mobile-mode-rail.png"), fullPage: false });
  await mobilePage.close();
  await verifyTokenProtectedUi(browser);
  await verifyOfflineServiceState(browser);
  await browser.close();
} finally {
  service.kill();
  fssync.rmSync(fixtureRoot, { recursive: true, force: true });
  fssync.rmSync(cacheRoot, { recursive: true, force: true });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await delay(100);
  }
  throw new Error(`service did not start\nstdout=${stdout}\nstderr=${stderr}`);
}

async function waitForHttp(url, stdoutRef, stderrRef) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await delay(100);
  }
  throw new Error(`server did not start: ${url}\nstdout=${stdoutRef()}\nstderr=${stderrRef()}`);
}

async function verifyOfflineServiceState(browser) {
  const offlinePort = await getFreePort();
  const missingApiPort = await getFreePort();
  let offlineStdout = "";
  let offlineStderr = "";
  const vite = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    String(offlinePort),
    "--strictPort"
  ], {
    env: {
      ...process.env,
      VITE_BRAIN_API: `http://127.0.0.1:${missingApiPort}`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  vite.stdout.on("data", (chunk) => (offlineStdout += chunk.toString()));
  vite.stderr.on("data", (chunk) => (offlineStderr += chunk.toString()));
  try {
    await waitForHttp(`http://127.0.0.1:${offlinePort}/`, () => offlineStdout, () => offlineStderr);
    const offlinePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await offlinePage.goto(`http://127.0.0.1:${offlinePort}/`, { waitUntil: "load" });
    await expectText(offlinePage, "Local Index Service offline");
    await expectText(offlinePage, "Start the Local Index Service");
    await expectText(offlinePage, "Local API unavailable");
    await expectText(offlinePage, "npm run demo");
    await expectText(offlinePage, "npm run serve -- --root /path/to/logseq");
    await expectText(offlinePage, "Waiting for a fresh local snapshot");
    await expectText(offlinePage, "Service offline");
    await expectText(offlinePage, "Offline");
    await expectText(offlinePage, "snapshot required");
    assert.equal(await offlinePage.getByRole("button", { name: "Retry connection" }).isVisible(), true);
    assert.equal(await offlinePage.getByRole("button", { name: "Retry API" }).isVisible(), true);
    assert.equal(await offlinePage.locator("canvas").count(), 0, "offline state should not render a stale atlas canvas");
    assert.equal(
      await offlinePage.getByRole("textbox", { name: "Search atlas" }).getAttribute("placeholder"),
      "Start Local Index Service to search..."
    );
    assert.equal(await offlinePage.locator(".command-offline-chip").textContent(), "Offline");
    assert.equal(await offlinePage.locator(".command-input kbd").count(), 0, "offline search should not advertise a keyboard shortcut");
    assert.equal(await offlinePage.getByRole("textbox", { name: "Search atlas" }).isDisabled(), true, "offline search should be disabled until a snapshot exists");
    assert.equal(await offlinePage.getByRole("button", { name: "Radar pulse" }).isDisabled(), true, "offline radar should be disabled until a snapshot exists");
    assert.deepEqual(
      await offlinePage.locator(".mode-switcher button").evaluateAll((buttons) => buttons.map((button) => button.hasAttribute("disabled"))),
      [true, true, true, true, true],
      "offline mode controls should be disabled until a snapshot exists"
    );
    assert.equal(await offlinePage.locator(".timeline").getAttribute("class"), "timeline offline");
    assert.equal(await offlinePage.getByRole("button", { name: "Toggle replay" }).isDisabled(), true, "offline replay control should be disabled");
    assert.equal(await offlinePage.getByRole("button", { name: "Previous replay frame" }).isDisabled(), true, "offline previous replay control should be disabled");
    assert.equal(await offlinePage.getByRole("button", { name: "Next replay frame" }).isDisabled(), true, "offline next replay control should be disabled");
    assert.equal(await offlinePage.getByText("View · 0 pages", { exact: false }).count(), 0, "offline footer should not present a valid empty graph");
    assert.equal(await offlinePage.getByText("Atlas Filters", { exact: false }).count(), 0, "offline rail should not show stale filter controls");
    assert.equal(await offlinePage.getByText("No active cognition thresholds", { exact: false }).count(), 0, "offline rail should not show live fallback insights");
    assert.equal(await offlinePage.getByText("Pathfinder", { exact: false }).count(), 0, "offline rail should not show graph workflows without a snapshot");
    await offlinePage.screenshot({ path: qaPath("living-atlas-offline-service.png"), fullPage: false });
    await offlinePage.close();
  } finally {
    vite.kill();
  }
}

async function verifyTokenProtectedUi(browser) {
  const tokenPort = await getFreePort();
  const tokenBaseUrl = `http://127.0.0.1:${tokenPort}`;
  const tokenCacheRoot = fssync.mkdtempSync(path.join(os.tmpdir(), "living-atlas-token-ui-cache-"));
  let tokenStdout = "";
  let tokenStderr = "";
  const uiSmokeCredential = "ui-smoke-credential-123456";
  const tokenService = spawn(process.execPath, [
    "server/brain-service.mjs",
    "--root",
    fixtureRoot,
    "--cache",
    path.join(tokenCacheRoot, "snapshot.json"),
    "--static",
    "dist",
    "--token",
    uiSmokeCredential,
    "--require-token",
    "--port",
    String(tokenPort)
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  tokenService.stdout.on("data", (chunk) => (tokenStdout += chunk.toString()));
  tokenService.stderr.on("data", (chunk) => (tokenStderr += chunk.toString()));
  try {
    await waitForHttp(`${tokenBaseUrl}/`, () => tokenStdout, () => tokenStderr);
    assert.equal(await requestStatus(`${tokenBaseUrl}/api/health`), 401, "token-protected API should deny unauthenticated reads");
    const tokenPage = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await tokenPage.goto(`${tokenBaseUrl}/#token=${uiSmokeCredential}`, { waitUntil: "load" });
    await expectText(tokenPage, "Living Atlas");
    await expectText(tokenPage, "Nexus");
    await tokenPage.locator("canvas").waitFor({ timeout: 10000 });
    assert.deepEqual(await tokenPage.evaluate(() => ({
      hash: window.location.hash,
      storedValue: window.sessionStorage.getItem("living-atlas-api-token")
    })), {
      hash: "",
      storedValue: uiSmokeCredential
    });
    await tokenPage.screenshot({ path: qaPath("living-atlas-token-protected-ui.png"), fullPage: false });
    await tokenPage.close();
  } finally {
    tokenService.kill();
    fssync.rmSync(tokenCacheRoot, { recursive: true, force: true });
  }
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

async function requestStatus(url) {
  const response = await fetch(url);
  return response.status;
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10000 });
}

async function expectTextInDom(page, text) {
  await page.waitForFunction((needle) => document.body.innerText.includes(needle), text, { timeout: 10000 });
}

async function expectMode(page, mode) {
  const className = await page.locator(".mode-switcher button").filter({ hasText: mode }).getAttribute("class");
  assert.equal(className, "active");
}

async function clickAtlasNode(page, canvasBox) {
  const probes = [
    [0.48, 0.46],
    [0.42, 0.5],
    [0.56, 0.5],
    [0.5, 0.38],
    [0.36, 0.56],
    [0.62, 0.56],
    [0.48, 0.62]
  ];
  for (const [xRatio, yRatio] of probes) {
    await page.mouse.click(canvasBox.x + canvasBox.width * xRatio, canvasBox.y + canvasBox.height * yRatio);
    await delay(220);
    if ((await page.getByText("Source page", { exact: false }).count()) > 0) return;
  }
  throw new Error("canvas click should select a page-backed atlas dot");
}

function assertCanvasHasSignal(buffer) {
  const png = PNG.sync.read(buffer);
  let lit = 0;
  let colored = 0;
  let brightest = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const brightness = r + g + b;
    if (brightness > 45) lit += 1;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 12 && brightness > 55) colored += 1;
    brightest = Math.max(brightest, brightness);
  }
  const pixels = png.width * png.height;
  assert.ok(lit / pixels > 0.006, `canvas should have visible luminous matter; lit ratio=${lit / pixels}`);
  assert.ok(colored / pixels > 0.004, `canvas should have colored particle signal; colored ratio=${colored / pixels}`);
  assert.ok(brightest > 260, `canvas should contain bright atlas highlights; brightest=${brightest}`);
}
