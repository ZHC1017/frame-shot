// Executed in the source page's isolated world. All helpers must live inside these functions.
export async function prepareScrollPage(token) {
  globalThis.__frameShotScroll?.cleanup();
  const viewportWidth = innerWidth, viewportHeight = innerHeight;
  const root = document.scrollingElement || document.documentElement;
  let target = root;
  if (root.scrollHeight <= innerHeight + 5) {
    let bestArea = 0;
    for (const element of document.querySelectorAll('body *')) {
      if (element.scrollHeight <= element.clientHeight + 30 || element.clientHeight < 180 || element.clientWidth < innerWidth * 0.35) continue;
      const style = getComputedStyle(element);
      if (!['auto', 'scroll', 'overlay'].includes(style.overflowY)) continue;
      const r = element.getBoundingClientRect();
      if (r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1) continue;
      const area = r.width * r.height;
      if (area > bestArea) { target = element; bestArea = area; }
    }
  }
  const isDocument = target === root;
  const original = { x: scrollX, y: scrollY, left: target.scrollLeft, top: target.scrollTop, focus: document.activeElement };
  const saved = new Map();
  function change(element, property, value) {
    if (!saved.has(element)) saved.set(element, element.getAttribute('style'));
    element.style.setProperty(property, value, 'important');
  }
  for (const element of new Set([document.documentElement, document.body, target])) {
    if (!element) continue;
    change(element, 'scroll-behavior', 'auto');
    change(element, 'scroll-snap-type', 'none');
    change(element, 'overflow-anchor', 'none');
  }
  const fixed = [];
  // First collect styles and rectangles, then mutate, avoiding layout-dependent discovery.
  const candidates = [];
  for (const element of document.querySelectorAll('body *')) {
    const position = getComputedStyle(element).position;
    if (position !== 'fixed' && position !== 'sticky') continue;
    const r = element.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    candidates.push({ element, position, r });
  }
  for (const { element, position, r } of candidates) {
    if (position === 'sticky') {
      change(element, 'position', 'relative');
      for (const p of ['top', 'right', 'bottom', 'left']) change(element, p, 'auto');
    } else if (r.width * r.height < viewportWidth * viewportHeight * 0.75) {
      // Keep fixed navigation once; hide bottom floating widgets from the first tile too.
      const bottomWidget = r.top > viewportHeight / 2 && r.bottom >= viewportHeight - 25;
      fixed.push({ element, hiddenInitially: bottomWidget });
      if (bottomWidget) change(element, 'visibility', 'hidden');
    }
  }
  const host = document.createElement('div');
  host.id = 'frame-shot-scroll-progress';
  host.setAttribute('popover', 'manual');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:18px 18px auto auto!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;width:286px!important;height:auto!important;overflow:visible!important;z-index:2147483647!important;color-scheme:normal!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{font:12px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.card{color:#f4f5f8;background:#292c33f5;border:1px solid #ffffff35;border-radius:13px;padding:17px;box-shadow:0 10px 32px #0005;backdrop-filter:blur(22px)}strong{font-size:14px;font-weight:550}p{font-size:11px;color:#ffffffa0;margin:10px 0;line-height:1.7}.bar{height:4px;background:#ffffff20;border-radius:4px;overflow:hidden}.fill{height:100%;background:#95b8fd;width:0;transition:width .2s}.controls{display:flex;gap:8px;margin-top:13px}button{font:11px inherit;border:1px solid #ffffff25;border-radius:6px;background:#ffffff0e;color:#fff;padding:7px 12px;cursor:pointer}button:hover{background:#ffffff20}button:disabled{opacity:.45;cursor:wait}';
  const card = document.createElement('div'); card.className = 'card';
  const heading = document.createElement('strong'); heading.textContent = '↓ 正在截取长图';
  const text = document.createElement('p'); text.textContent = '准备页面…截图期间请保持此标签页打开。';
  const bar = document.createElement('div'); bar.className = 'bar';
  const fill = document.createElement('div'); fill.className = 'fill'; bar.append(fill);
  const controls = document.createElement('div'); controls.className = 'controls';
  const finish = document.createElement('button'); finish.textContent = '完成到这里';
  const cancel = document.createElement('button'); cancel.textContent = '取消 · Esc';
  controls.append(finish, cancel); card.append(heading, text, bar, controls); shadow.append(style, card);
  document.documentElement.append(host);
  if (typeof host.showPopover === 'function') host.showPopover(); else host.removeAttribute('popover');
  const session = { token, root, target, isDocument, saved, fixed, change, host, text, fill, original, cancelled: false, stopped: false };
  const control = action => {
    if (action === 'cancel') session.cancelled = true; else session.stopped = true;
    finish.disabled = true; cancel.disabled = true;
    text.textContent = action === 'cancel' ? '正在取消并恢复页面…' : '正在拼接已截取的部分…';
    chrome.runtime.sendMessage({ type: 'scroll-control', token, action }).catch(() => {});
  };
  finish.addEventListener('click', () => control('finish'));
  cancel.addEventListener('click', () => control('cancel'));
  const keyHandler = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); control('cancel'); }
    else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const blockScroll = event => event.preventDefault();
  window.addEventListener('keydown', keyHandler, true);
  window.addEventListener('wheel', blockScroll, { passive: false, capture: true });
  window.addEventListener('touchmove', blockScroll, { passive: false, capture: true });
  const guard = setTimeout(() => session.cleanup(), 120000);
  session.cleanup = () => {
    clearTimeout(guard);
    host.remove();
    window.removeEventListener('keydown', keyHandler, true);
    window.removeEventListener('wheel', blockScroll, true);
    window.removeEventListener('touchmove', blockScroll, true);
    // Restore positions before restoring smooth-scroll CSS.
    target.scrollTo({ left: original.left, top: original.top, behavior: 'instant' });
    window.scrollTo({ left: original.x, top: original.y, behavior: 'instant' });
    for (const [element, inline] of saved) {
      if (!element.isConnected) continue;
      if (inline === null) { element.style.cssText = ''; element.removeAttribute('style'); }
      else element.setAttribute('style', inline);
    }
    if (original.focus?.isConnected) original.focus.focus({ preventScroll: true });
    if (globalThis.__frameShotScroll?.token === token) delete globalThis.__frameShotScroll;
  };
  globalThis.__frameShotScroll = session;
  return { isDocument, originalTop: original.top };
}

export async function operateScrollPage(token, action, value) {
  const s = globalThis.__frameShotScroll;
  if (!s || s.token !== token) throw new Error('页面已刷新或滚动截图会话已结束');
  if (action === 'restore') { s.cleanup(); return true; }
  if (s.cancelled) throw new Error('滚动截图已取消');
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  function metrics() {
    const t = s.target;
    const r = t.getBoundingClientRect();
    const scaleX = s.isDocument ? 1 : r.width / t.offsetWidth;
    const scaleY = s.isDocument ? 1 : r.height / t.offsetHeight;
    return {
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      y: t.scrollTop, totalHeight: s.isDocument ? Math.max(t.scrollHeight, document.body?.scrollHeight || 0) : t.scrollHeight,
      visibleHeight: s.isDocument ? innerHeight : t.clientHeight,
      contentWidth: s.isDocument ? document.documentElement.clientWidth : t.clientWidth,
      clip: { x: s.isDocument ? 0 : r.left + t.clientLeft * scaleX, y: s.isDocument ? 0 : r.top + t.clientTop * scaleY,
        width: (s.isDocument ? document.documentElement.clientWidth : t.clientWidth) * scaleX,
        height: (s.isDocument ? innerHeight : t.clientHeight) * scaleY },
      transformScaleY: scaleY, stopped: s.stopped
    };
  }
  if (action === 'move') {
    if (value > 0) for (const item of s.fixed) s.change(item.element, 'visibility', 'hidden');
    s.host.style.setProperty('visibility', 'visible', 'important');
    s.target.scrollTo({ left: 0, top: value, behavior: 'instant' });
    await frames();
    await new Promise(resolve => setTimeout(resolve, 350));
    const pendingImages = [...document.images].filter(image => {
      if (image.complete) return false;
      const r = image.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
    if (pendingImages.length) await Promise.race([
      Promise.all(pendingImages.map(image => image.decode().catch(() => {}))),
      new Promise(resolve => setTimeout(resolve, 1000))
    ]);
    await frames();
    return metrics();
  }
  if (action === 'hide') {
    s.host.style.setProperty('visibility', 'hidden', 'important');
    await frames();
    return metrics();
  }
  if (action === 'progress') {
    s.host.style.setProperty('visibility', 'visible', 'important');
    s.text.textContent = value.text;
    s.fill.style.width = `${Math.min(100, Math.max(0, value.percent))}%`;
    return metrics();
  }
  throw new Error('未知滚动截图操作');
}
