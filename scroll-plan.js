export const SCROLL_LIMITS = { maxPixels: 48000000, maxHeight: 30000, maxTiles: 60, maxDuration: 90000 };

export function outputPlan(metrics, bitmap, limits = SCROLL_LIMITS) {
  const scaleX = bitmap.width / metrics.viewportWidth;
  const scaleY = bitmap.height / metrics.viewportHeight;
  const pixelsPerY = scaleY * metrics.transformScaleY;
  const width = Math.round(metrics.clip.width * scaleX);
  if (width < 1 || pixelsPerY <= 0) throw new Error('无法确定页面截图尺寸');
  const maxHeight = Math.min(limits.maxHeight, Math.floor(limits.maxPixels / width));
  if (maxHeight < 1) throw new Error('页面过宽，无法生成长图');
  return { width, pixelsPerY, scaleX, scaleY, maxHeight, cssLimit: maxHeight / pixelsPerY };
}

export function nextScroll(metrics, coveredEnd) {
  const overlap = Math.min(128, Math.floor(metrics.visibleHeight * 0.15));
  return Math.max(0, Math.min(coveredEnd - overlap, metrics.totalHeight - metrics.visibleHeight));
}

export function tilePlacement(metrics, bitmap, plan, coveredPixels, outputHeight) {
  const scaleX = bitmap.width / metrics.viewportWidth, scaleY = bitmap.height / metrics.viewportHeight;
  if (Math.abs(scaleX - plan.scaleX) > 0.01 || Math.abs(scaleY - plan.scaleY) > 0.01) throw new Error('页面截图比例变化，请保持窗口大小和缩放不变后重试');
  const tileY = Math.round(metrics.y * plan.pixelsPerY);
  const sourceX = Math.round(metrics.clip.x * scaleX);
  const sourceY = Math.round(metrics.clip.y * scaleY) + Math.max(0, coveredPixels - tileY);
  const available = Math.min(Math.round(metrics.clip.height * scaleY) - Math.max(0, coveredPixels - tileY), bitmap.height - sourceY);
  const height = Math.max(0, Math.min(available, outputHeight - coveredPixels));
  if (tileY > coveredPixels + 1) throw new Error('网页滚动发生跳跃，无法无缝拼接，请重试');
  if (sourceX < 0 || sourceY < 0 || sourceX + plan.width > bitmap.width + 1) throw new Error('滚动区域超出可截图的窗口范围');
  return { sx: sourceX, sy: sourceY, width: plan.width, height, dy: coveredPixels };
}
