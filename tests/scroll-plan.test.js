import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputPlan, nextScroll, tilePlacement } from '../scroll-plan.js';

const metrics = { viewportWidth: 1200, viewportHeight: 800, y: 0, totalHeight: 2500, visibleHeight: 800, contentWidth: 1200, clip: { x: 0, y: 0, width: 1200, height: 800 }, transformScaleY: 1 };
const bitmap = { width: 2400, height: 1600 };
test('long image uses actual screenshot scale, with bounded memory', () => {
  const plan = outputPlan(metrics, bitmap);
  assert.equal(plan.width, 2400);
  assert.equal(plan.pixelsPerY, 2);
  assert.ok(plan.width * plan.maxHeight <= 48000000);
  assert.ok(plan.maxHeight <= 30000);
});
test('overlapping tiles cover every output pixel once, including a clamped final viewport', () => {
  const plan = outputPlan(metrics, bitmap);
  const offsets = [0, 680, 1360, 1700];
  let covered = 0;
  for (const y of offsets) {
    const p = tilePlacement({ ...metrics, y }, bitmap, plan, covered, 5000);
    assert.equal(p.dy, covered);
    assert.ok(p.sy >= 0 && p.sy + p.height <= 1600);
    covered += p.height;
  }
  assert.equal(covered, 5000);
  assert.equal(nextScroll({ ...metrics, y: 1360 }, 2160), 1700);
});
test('internal scroller excludes outside headers and sidebars', () => {
  const nested = { ...metrics, viewportWidth: 1200, viewportHeight: 800, visibleHeight: 600, contentWidth: 900, clip: { x: 200, y: 100, width: 900, height: 600 } };
  const plan = outputPlan(nested, bitmap);
  const p = tilePlacement(nested, bitmap, plan, 0, 5000);
  assert.deepEqual(p, { sx: 400, sy: 200, width: 1800, height: 1200, dy: 0 });
});
test('truncation clips the final tile exactly at the pixel limit', () => {
  const plan = outputPlan(metrics, bitmap, { maxPixels: 2400000, maxHeight: 30000 });
  assert.equal(plan.maxHeight, 1000);
  assert.equal(tilePlacement(metrics, bitmap, plan, 0, plan.maxHeight).height, 1000);
});
test('viewport scale changes and skipped content are rejected', () => {
  const plan = outputPlan(metrics, bitmap);
  assert.throws(() => tilePlacement(metrics, { width: 2200, height: 1600 }, plan, 0, 5000), /比例变化/);
  assert.throws(() => tilePlacement({ ...metrics, y: 900 }, bitmap, plan, 1600, 5000), /跳跃/);
});
