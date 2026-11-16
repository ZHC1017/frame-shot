export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function centeredRect(width, height, bounds, center = { x: bounds.width / 2, y: bounds.height / 2 }) {
  if (![width, height].every(value => Number.isInteger(value) && value >= 1)) {
    throw new Error('宽高必须是大于 0 的整数');
  }
  if (width > bounds.width || height > bounds.height) {
    throw new Error(`尺寸超出原图 ${bounds.width} × ${bounds.height} px，请减小尺寸`);
  }
  return {
    x: clamp(Math.round(center.x - width / 2), 0, bounds.width - width),
    y: clamp(Math.round(center.y - height / 2), 0, bounds.height - height),
    width, height
  };
}

export function moveRect(rect, dx, dy, bounds) {
  return { ...rect,
    x: clamp(Math.round(rect.x + dx), 0, bounds.width - rect.width),
    y: clamp(Math.round(rect.y + dy), 0, bounds.height - rect.height)
  };
}

export function resizeRect(rect, handle, dx, dy, bounds, ratio = null) {
  const hx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const hy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  const anchorX = hx < 0 ? rect.x + rect.width : hx > 0 ? rect.x : rect.x + rect.width / 2;
  const anchorY = hy < 0 ? rect.y + rect.height : hy > 0 ? rect.y : rect.y + rect.height / 2;
  const maxWidth = hx < 0 ? anchorX : hx > 0 ? bounds.width - anchorX : 2 * Math.min(anchorX, bounds.width - anchorX);
  const maxHeight = hy < 0 ? anchorY : hy > 0 ? bounds.height - anchorY : 2 * Math.min(anchorY, bounds.height - anchorY);
  let width = hx ? rect.width + hx * dx : rect.width;
  let height = hy ? rect.height + hy * dy : rect.height;
  if (ratio) {
    if (!hx || (hy && Math.abs(dy / rect.height) > Math.abs(dx / rect.width))) width = height * ratio;
    width = clamp(width, Math.max(1, ratio), Math.min(maxWidth, maxHeight * ratio));
    height = width / ratio;
  } else {
    width = clamp(width, 1, maxWidth);
    height = clamp(height, 1, maxHeight);
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const x = hx < 0 ? anchorX - width : hx > 0 ? anchorX : anchorX - width / 2;
  const y = hy < 0 ? anchorY - height : hy > 0 ? anchorY : anchorY - height / 2;
  return { x: clamp(Math.round(x), 0, bounds.width - width), y: clamp(Math.round(y), 0, bounds.height - height), width, height };
}
