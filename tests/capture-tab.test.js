import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabCapture } from '../capture-tab.js';

function fixture(failures, switched = false) {
  let time = 0, calls = 0;
  const waits = [];
  const capture = createTabCapture({
    query: async () => [{ id: switched && calls ? 99 : 7 }],
    captureVisibleTab: async () => {
      const error = failures[calls++];
      if (error) throw new Error(error);
      return 'data:image/png;base64,ok';
    }
  }, { now: () => time, sleep: async ms => { waits.push(ms); time += ms; } });
  return { capture, waits, calls: () => calls };
}
test('readback failure retries after compositor wait, preserving the source tab', async () => {
  const f = fixture(['Failed to capture tab: image readback failed']);
  assert.equal(await f.capture({ id: 7, windowId: 1 }), 'data:image/png;base64,ok');
  assert.equal(f.calls(), 2);
  assert.deepEqual(f.waits, [1100]);
});
test('persistent failure stops after three attempts', async () => {
  const f = fixture(Array(3).fill('image readback failed'));
  await assert.rejects(f.capture({ id: 7, windowId: 1 }), /readback/);
  assert.equal(f.calls(), 3);
});
test('denied permissions are not retried', async () => {
  const f = fixture(['Either the activeTab or all_urls permission is required']);
  await assert.rejects(f.capture({ id: 7, windowId: 1 }), /permission/);
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.waits, []);
});
test('switching tabs during retry cancels instead of capturing another page', async () => {
  const f = fixture(['image readback failed'], true);
  await assert.rejects(f.capture({ id: 7, windowId: 1 }), /标签页已切换/);
  assert.equal(f.calls(), 1);
});
test('successive user requests are spaced to respect capture quota', async () => {
  const f = fixture([]);
  await f.capture({ id: 7, windowId: 1 });
  await f.capture({ id: 7, windowId: 1 });
  assert.deepEqual(f.waits, [1100]);
});
test('capture hook hides progress only after waiting and rechecks active tab', async () => {
  const events = [];
  let active = 7;
  const capture = createTabCapture({
    query: async () => { events.push('query'); return [{ id: active }]; },
    captureVisibleTab: async () => { events.push('capture'); return 'png'; }
  });
  await capture({ id: 7, windowId: 1 }, { beforeCapture: async () => events.push('hide') });
  assert.deepEqual(events, ['query', 'hide', 'query', 'capture']);
  const other = createTabCapture({ query: async () => [{ id: active }], captureVisibleTab: async () => { throw new Error('should not capture'); } });
  await assert.rejects(other({ id: 7, windowId: 1 }, { beforeCapture: async () => { active = 8; } }), /标签页已切换/);
});
