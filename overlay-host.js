// Serialized by chrome.scripting: keep these functions self-contained.
export function mountOverlay(captureId, url) {
  globalThis.__frameShotOverlay?.cleanup();
  document.getElementById('frame-shot-overlay')?.remove();
  const previousFocus = document.activeElement;
  const host = document.createElement('div');
  host.id = 'frame-shot-overlay';
  host.setAttribute('popover', 'manual');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;border:0!important;margin:0!important;padding:0!important;background:transparent!important;z-index:2147483647!important;overflow:hidden!important;transform:none!important;opacity:1!important;pointer-events:auto!important;color-scheme:normal!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const frame = document.createElement('iframe');
  frame.title = 'Frame Shot 原网页截图';
  frame.allow = 'clipboard-write';
  frame.style.cssText = 'all:initial;display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal;';
  frame.src = url;
  shadow.append(frame);
  document.documentElement.append(host);
  if (typeof host.showPopover === 'function') host.showPopover();
  else host.removeAttribute('popover');
  const cleanup = () => {
    host.remove();
    if (globalThis.__frameShotOverlay?.captureId === captureId) delete globalThis.__frameShotOverlay;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  globalThis.__frameShotOverlay = { captureId, cleanup };
  frame.addEventListener('load', () => frame.focus(), { once: true });
  return true;
}

export async function dismissOverlay(captureId = null, waitForPaint = false) {
  const overlay = globalThis.__frameShotOverlay;
  if (!overlay) {
    const stale = document.getElementById('frame-shot-overlay');
    stale?.remove();
    if (stale && waitForPaint) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return null;
  }
  if (captureId && captureId !== overlay.captureId) return null;
  const removedId = overlay.captureId;
  overlay.cleanup();
  if (waitForPaint) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return removedId;
}
