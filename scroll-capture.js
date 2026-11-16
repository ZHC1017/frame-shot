import { prepareScrollPage, operateScrollPage } from './scroll-page.js';
import { SCROLL_LIMITS, outputPlan, nextScroll, tilePlacement } from './scroll-plan.js';

export async function captureScrollablePage({ tab, token, captureTab, state }) {
  const inject = async (func, args) => {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
    if (!results[0]) throw new Error('无法连接当前网页');
    return results[0].result;
  };
  const operate = (action, value = null) => inject(operateScrollPage, [token, action, value]);
  const tiles = [];
  const started = Date.now();
  let plan, coveredEnd = 0, desiredY = 0, previousMetrics, finalMetrics, warning = '';
  function checkCancelled() { if (state.cancelled) throw new Error('滚动截图已取消'); }
  try {
    await inject(prepareScrollPage, [token]);
    for (let index = 0; index < SCROLL_LIMITS.maxTiles; index++) {
      checkCancelled();
      let metrics = await operate('move', desiredY);
      checkCancelled();
      if (previousMetrics && (metrics.viewportWidth !== previousMetrics.viewportWidth || metrics.viewportHeight !== previousMetrics.viewportHeight || Math.abs(metrics.clip.width - previousMetrics.clip.width) > 1 || Math.abs(metrics.clip.height - previousMetrics.clip.height) > 1)) throw new Error('截图期间窗口或滚动区域尺寸发生变化，请重试');
      let snapshotMetrics;
      const dataUrl = await captureTab(tab, { beforeCapture: async () => {
        checkCancelled();
        snapshotMetrics = await operate('hide');
      } });
      checkCancelled();
      metrics = snapshotMetrics;
      const blob = await (await fetch(dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      if (!plan) plan = outputPlan(metrics, bitmap);
      const bitmapSize = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      tiles.push({ blob, metrics, bitmapSize });
      const end = metrics.y + metrics.visibleHeight;
      if (tiles.length > 1 && end <= coveredEnd + 0.5) throw new Error('页面未按预期滚动，已停止截图');
      coveredEnd = end;
      finalMetrics = metrics;
      await operate('progress', { text: `已截取 ${tiles.length} 屏 · ${Math.round(Math.min(coveredEnd, metrics.totalHeight))} / ${Math.round(metrics.totalHeight)} px。可完成到这里或取消。`, percent: 100 * coveredEnd / metrics.totalHeight });
      if (state.stopped || metrics.stopped) { warning = '已按“完成到这里”结束，保留已截取部分。'; break; }
      if (coveredEnd >= plan.cssLimit && metrics.totalHeight > plan.cssLimit + 0.5) { warning = '已达到长图像素上限，仅保留已截取部分。'; break; }
      if (coveredEnd >= metrics.totalHeight - 0.5) break;
      if (Date.now() - started >= SCROLL_LIMITS.maxDuration || index === SCROLL_LIMITS.maxTiles - 1) { warning = '页面过长或持续加载，已保留目前截取的部分。'; break; }
      desiredY = nextScroll(metrics, coveredEnd);
      if (desiredY <= metrics.y + 0.5) throw new Error('页面滚动位置异常，无法继续拼接');
      previousMetrics = metrics;
    }
    checkCancelled();
    if (!plan || !tiles.length) throw new Error('没有可拼接的网页画面');
    const finalHeight = Math.max(1, Math.min(plan.maxHeight, Math.round(Math.min(coveredEnd, finalMetrics.totalHeight) * plan.pixelsPerY)));
    await operate('progress', { text: `正在拼接 ${tiles.length} 屏，马上完成…`, percent: 100 });
    const canvas = new OffscreenCanvas(plan.width, finalHeight);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('无法创建长图画布，请尝试截取更短的页面');
    context.fillStyle = '#fff'; context.fillRect(0, 0, plan.width, finalHeight);
    let coveredPixels = 0;
    for (const tile of tiles) {
      checkCancelled();
      const bitmap = await createImageBitmap(tile.blob);
      try {
        const p = tilePlacement(tile.metrics, tile.bitmapSize, plan, coveredPixels, finalHeight);
        if (p.height > 0) {
          context.drawImage(bitmap, p.sx, p.sy, p.width, p.height, 0, p.dy, p.width, p.height);
          coveredPixels += p.height;
        }
      } finally { bitmap.close(); }
      tile.blob = null;
      if (coveredPixels >= finalHeight) break;
    }
    if (coveredPixels < finalHeight) throw new Error('长图存在未覆盖的区域，未输出不完整图片');
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    checkCancelled();
    return { blob, width: plan.width, height: finalHeight, tiles: tiles.length, warning, target: finalMetrics.contentWidth < finalMetrics.viewportWidth - 25 ? 'container' : 'document' };
  } finally {
    await operate('restore').catch(() => {});
    tiles.length = 0;
  }
}
