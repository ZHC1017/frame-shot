import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centeredRect, moveRect, resizeRect } from '../geometry.js';

const bounds = { width: 1440, height: 900 };
test('exact dimensions, centering, and rejection of unavailable sizes', () => {
  assert.deepEqual(centeredRect(800, 600, bounds), { x: 320, y: 150, width: 800, height: 600 });
  assert.throws(() => centeredRect(1600, 600, bounds));
  assert.throws(() => centeredRect(0, 600, bounds));
  assert.throws(() => centeredRect(1.5, 600, bounds));
  assert.throws(() => centeredRect(NaN, 600, bounds));
});
test('moving keeps dimensions and clamps every boundary', () => {
  const rect = centeredRect(800, 600, bounds);
  assert.deepEqual(moveRect(rect, -9999, -9999, bounds), { ...rect, x: 0, y: 0 });
  assert.deepEqual(moveRect(rect, 9999, 9999, bounds), { ...rect, x: 640, y: 300 });
  assert.equal(moveRect(rect, 1, 0, bounds).x, 321);
});
test('free resizing anchors the opposite edge without snapping to a preset', () => {
  const rect = { x: 320, y: 150, width: 800, height: 600 };
  assert.deepEqual(resizeRect(rect, 'se', 53, 27, bounds), { x: 320, y: 150, width: 853, height: 627 });
  assert.deepEqual(resizeRect(rect, 'nw', 50, 20, bounds), { x: 370, y: 170, width: 750, height: 580 });
  assert.deepEqual(resizeRect(rect, 'e', -900, 0, bounds), { x: 320, y: 150, width: 1, height: 600 });
});
test('ratio resizing keeps its anchor and fits into the screenshot', () => {
  const rect = { x: 320, y: 150, width: 800, height: 600 };
  const next = resizeRect(rect, 'se', 10000, 10000, bounds, 4 / 3);
  assert.equal(next.x, rect.x);
  assert.equal(next.y, rect.y);
  assert.ok(Math.abs(next.width - next.height * 4 / 3) <= 1);
  assert.ok(next.x + next.width <= bounds.width);
  assert.ok(next.y + next.height <= bounds.height);
});
test('all handles and extreme drags stay within integer pixel bounds', () => {
  const examples = [centeredRect(800, 600, bounds), { x: 0, y: 0, width: 1, height: 1 }, { x: 1438, y: 898, width: 2, height: 2 }];
  for (const rect of examples) for (const handle of ['n','s','w','e','nw','ne','sw','se']) {
    for (const dx of [-2000,-20,0,13,2000]) for (const dy of [-2000,-20,0,13,2000]) {
      for (const ratio of [null, rect.width / rect.height]) {
        const next = resizeRect(rect, handle, dx, dy, bounds, ratio);
        assert.ok(Object.values(next).every(Number.isInteger));
        assert.ok(next.x >= 0 && next.y >= 0 && next.width >= 1 && next.height >= 1);
        assert.ok(next.x + next.width <= bounds.width && next.y + next.height <= bounds.height, JSON.stringify({rect, handle, dx, dy, next}));
      }
    }
  }
});
