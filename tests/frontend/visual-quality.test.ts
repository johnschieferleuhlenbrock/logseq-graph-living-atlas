import assert from "node:assert/strict";
import test from "node:test";
import { computeRenderQuality, scaleCount, shouldKeepEvery } from "../../src/visuals/model/quality";

test("render quality keeps small graphs cinematic", () => {
  const quality = computeRenderQuality({
    visibleNodes: 800,
    totalNodes: 900,
    visibleLinks: 3200,
    devicePixelRatio: 2,
    hardwareConcurrency: 10
  });

  assert.equal(quality.tier, "cinematic");
  assert.equal(quality.pixelRatioCap, 2);
  assert.equal(quality.particleScale, 1);
  assert.equal(quality.tetherScale, 1);
  assert.equal(quality.antialias, true);
});

test("render quality switches to balanced for 10k-scale graphs", () => {
  const quality = computeRenderQuality({
    visibleNodes: 4200,
    totalNodes: 12000,
    visibleLinks: 11000,
    devicePixelRatio: 2,
    hardwareConcurrency: 8
  });

  assert.equal(quality.tier, "balanced");
  assert.ok(quality.pixelRatioCap < 2);
  assert.ok(quality.particleScale < 1);
  assert.ok(quality.tetherScale < 1);
});

test("render quality switches to safe for 100k or reduced-motion views", () => {
  const large = computeRenderQuality({
    visibleNodes: 6200,
    totalNodes: 100000,
    visibleLinks: 22000,
    devicePixelRatio: 3,
    hardwareConcurrency: 12
  });
  const reduced = computeRenderQuality({
    visibleNodes: 800,
    totalNodes: 900,
    visibleLinks: 3200,
    reducedMotion: true
  });

  assert.equal(large.tier, "safe");
  assert.equal(reduced.tier, "safe");
  assert.equal(large.pixelRatioCap, 1);
  assert.equal(large.antialias, false);
});

test("render quality scales deterministic counts and keep strides", () => {
  assert.equal(scaleCount(100, 0.45, 2), 45);
  assert.equal(scaleCount(1, 0.1, 2), 2);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, index) => shouldKeepEvery(index, 0.34)),
    [true, false, false, true, false, false, true]
  );
  assert.equal(shouldKeepEvery(10, 1), true);
});
