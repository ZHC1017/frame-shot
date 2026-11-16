// Retry only transient compositor/quota failures; never retry denied permissions.
export function createTabCapture(tabs, {
  now = () => Date.now(),
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
} = {}) {
  let lastCaptureAt = -Infinity;
  return async function captureTab(tab, { beforeCapture } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = 1100 - (now() - lastCaptureAt);
      if (wait > 0) await sleep(wait);
      const [active] = await tabs.query({ active: true, windowId: tab.windowId });
      if (active?.id !== tab.id) throw new Error('标签页已切换，请在需要截图的网页重新点击扩展');
      if (beforeCapture) {
        await beforeCapture();
        const [current] = await tabs.query({ active: true, windowId: tab.windowId });
        if (current?.id !== tab.id) throw new Error('标签页已切换，滚动截图已中止');
      }
      lastCaptureAt = now();
      try { return await tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
      catch (error) {
        const transient = /image readback failed|view is invisible|MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(error.message);
        if (!transient || attempt === 2) throw error;
      }
    }
  };
}
