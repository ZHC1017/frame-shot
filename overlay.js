import { centeredRect, clamp, moveRect, resizeRect } from './geometry.js';
import { getCapture } from './capture-store.js';

const $ = id => document.getElementById(id);
const image = $('source');
const selection = $('selection');
const fields = [$('width'), $('height')];
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const isExtension = location.protocol === 'chrome-extension:';
const id = params.get('id');
let bounds, rect, scale = 1, offsetX = 0, offsetY = 0;
let mode = 'free', ratio = null, drag = null, busy = false, ready = false;
let persistTimer, closing = false, closeTimer;

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}
function hint() {
  notice(mode === 'free' ? '拖动空白处新建选框 · 方向键微调 · Shift 加速 · Esc 取消' : '拖动选框调整位置 · 方向键微调 · Enter 复制 · Esc 取消');
}
async function saveSize(lastSize) {
  if (isExtension) await chrome.storage.local.set({ lastSize });
  else localStorage.setItem('frame-shot-size', JSON.stringify(lastSize));
}
async function message(type) {
  const result = await chrome.runtime.sendMessage({ type, id });
  if (!result?.ok) throw new Error(result?.error || '扩展连接已断开，请重新点击扩展图标');
  return result;
}
function persist() {
  clearTimeout(persistTimer);
  const lastSize = { width: rect.width, height: rect.height };
  persistTimer = setTimeout(() => saveSize(lastSize).catch(() => {}), 150);
}
function render(syncFields = true) {
  if (!rect) return;
  selection.style.left = `${offsetX + rect.x * scale}px`;
  selection.style.top = `${offsetY + rect.y * scale}px`;
  selection.style.width = `${rect.width * scale}px`;
  selection.style.height = `${rect.height * scale}px`;
  $('measurement').textContent = `${rect.width} × ${rect.height} px`;
  $('measurement').classList.toggle('below', offsetY + rect.y * scale < 39);
  selection.classList.toggle('locked', mode === 'size');
  selection.setAttribute('aria-label', `选框 ${rect.width} × ${rect.height} 像素，位置 ${rect.x}, ${rect.y}`);
  if (syncFields) { fields[0].value = rect.width; fields[1].value = rect.height; }
  const size = `${rect.width},${rect.height}`;
  $('presets').value = [...$('presets').options].some(option => option.value === size) ? size : '';
}
function changed() { render(); hint(); persist(); }
function layout() {
  if (!bounds) return;
  scale = Math.min(innerWidth / bounds.width, innerHeight / bounds.height);
  offsetX = (innerWidth - bounds.width * scale) / 2;
  offsetY = (innerHeight - bounds.height * scale) / 2;
  Object.assign(image.style, { left: `${offsetX}px`, top: `${offsetY}px`, width: `${bounds.width * scale}px`, height: `${bounds.height * scale}px` });
  render(false);
}
function setBusy(value) {
  busy = value;
  document.body.classList.toggle('busy', value);
  document.querySelectorAll('button,input,select').forEach(element => { element.disabled = value || !ready; });
  $('cancel').disabled = value;
}
function applySize(width, height) {
  if (!ready || busy) return false;
  try {
    rect = centeredRect(width, height, bounds, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    if (mode === 'ratio') ratio = rect.width / rect.height;
    changed();
    return true;
  } catch (error) { notice(error.message, true); return false; }
}
function commitFields() { return applySize(Number(fields[0].value), Number(fields[1].value)); }
$('toolbar').addEventListener('submit', event => { event.preventDefault(); if (commitFields()) selection.focus(); });
fields.forEach(field => field.addEventListener('change', commitFields));
$('presets').addEventListener('change', () => {
  if ($('presets').value) applySize(...$('presets').value.split(',').map(Number));
});
$('mode').addEventListener('change', () => {
  mode = $('mode').value;
  ratio = mode === 'ratio' ? rect.width / rect.height : null;
  render(); hint();
});

function pixelPoint(event) {
  return { x: clamp(Math.round((event.clientX - offsetX) / scale), 0, bounds.width), y: clamp(Math.round((event.clientY - offsetY) / scale), 0, bounds.height) };
}
$('surface').addEventListener('pointerdown', event => {
  if (!ready || busy || event.button !== 0 || drag) return;
  event.preventDefault();
  selection.focus({ preventScroll: true });
  const handle = event.target.closest('[data-handle]')?.dataset.handle;
  const inside = selection.contains(event.target);
  if (inside) {
    if (handle && mode === 'size') return;
    drag = { pointerId: event.pointerId, kind: handle ? 'resize' : 'move', handle, x: event.clientX, y: event.clientY, rect: { ...rect }, scale, ratio };
  } else if (mode === 'free') {
    const point = pixelPoint(event);
    drag = { pointerId: event.pointerId, kind: 'create', point };
  } else return;
  $('surface').setPointerCapture(event.pointerId);
  selection.classList.add('dragging');
});
$('surface').addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId || busy) return;
  if (drag.kind === 'create') {
    const point = pixelPoint(event), start = drag.point;
    const width = Math.max(1, Math.abs(point.x - start.x));
    const height = Math.max(1, Math.abs(point.y - start.y));
    rect = { x: Math.min(Math.min(start.x, point.x), bounds.width - width), y: Math.min(Math.min(start.y, point.y), bounds.height - height), width, height };
  } else {
    const dx = (event.clientX - drag.x) / drag.scale, dy = (event.clientY - drag.y) / drag.scale;
    rect = drag.kind === 'resize' ? resizeRect(drag.rect, drag.handle, dx, dy, bounds, drag.ratio) : moveRect(drag.rect, dx, dy, bounds);
  }
  changed();
});
function endDrag(event) {
  if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
  drag = null;
  selection.classList.remove('dragging');
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('surface').addEventListener(type, endDrag);
window.addEventListener('blur', () => endDrag());
window.addEventListener('resize', () => { endDrag(); layout(); });
window.addEventListener('wheel', event => event.preventDefault(), { passive: false });

async function closeOverlay() {
  if (closing) return;
  closing = true;
  clearTimeout(closeTimer);
  if (rect) await saveSize({ width: rect.width, height: rect.height }).catch(() => {});
  if (demo) {
    $('bottom').hidden = true; selection.hidden = true; $('surface').hidden = false; $('intro').hidden = false;
    $('intro-text').textContent = '演示已结束，刷新可重新体验';
    return;
  }
  try { await message('overlay-close'); }
  catch (error) { closing = false; setBusy(false); notice(error.message, true); }
}
$('cancel').addEventListener('click', () => { if (!busy) closeOverlay(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); if (!busy) closeOverlay(); return; }
  if (!ready || busy || closing || event.target.closest('input,select,button') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'Enter') { event.preventDefault(); exportImage('copy'); return; }
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (delta) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    rect = moveRect(rect, delta[0] * step, delta[1] * step, bounds);
    changed();
  }
});

async function exportImage(action) {
  if (!ready || busy || closing) return;
  if ((Number(fields[0].value) !== rect.width || Number(fields[1].value) !== rect.height) && !commitFields()) return;
  endDrag();
  const snapshot = { ...rect };
  setBusy(true);
  notice(action === 'copy' ? '正在截取并复制…' : '正在生成 PNG…');
  try {
    const canvas = document.createElement('canvas');
    canvas.width = snapshot.width; canvas.height = snapshot.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建裁剪画布');
    ctx.drawImage(image, snapshot.x, snapshot.y, snapshot.width, snapshot.height, 0, 0, snapshot.width, snapshot.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片编码失败')), 'image/png'));
    if (action === 'copy') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      $('surface').hidden = true;
      $('bottom').hidden = true;
      $('intro').hidden = true;
      $('success-size').textContent = `${snapshot.width} × ${snapshot.height} px · 可直接粘贴`;
      $('success').hidden = false;
      closeTimer = setTimeout(closeOverlay, 950);
      return;
    }
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `frame-shot-${snapshot.width}x${snapshot.height}-${Date.now()}.png`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notice(`已生成 ${snapshot.width} × ${snapshot.height} px PNG，已交给浏览器下载。`);
  } catch (error) {
    notice(error.name === 'NotAllowedError' ? '复制被浏览器阻止。请点击“截取并复制”重试，或点击 ↓ 保存 PNG。' : `${error.message}。可重试或保存 PNG。`, true);
  }
  setBusy(false);
}
$('copy').addEventListener('click', () => exportImage('copy'));
$('save').addEventListener('click', () => exportImage('save'));
$('scroll').addEventListener('click', async () => {
  if (!ready || busy) return;
  if (demo) { notice('请在真实网页点击扩展，再选择“滚动长图”。示例画面不支持滚动截图。'); return; }
  setBusy(true);
  notice('正在启动滚动长图，完成后会恢复原来的滚动位置…');
  try { await message('overlay-scroll'); }
  catch (error) { setBusy(false); notice(error.message, true); }
});

async function initialize() {
  setBusy(false);
  selection.hidden = true;
  try {
    if (demo) {
      image.src = 'demo.svg';
      $('intro-text').textContent = '示例画面 · 实际使用时直接覆盖原网页';
    } else {
      await message('overlay-authorize');
      const capture = await getCapture(id);
      if (!capture) throw new Error('截图已清理，请重新点击扩展');
      image.src = capture.dataUrl;
    }
    await image.decode();
    bounds = { width: image.naturalWidth, height: image.naturalHeight };
    const lastSize = isExtension ? (await chrome.storage.local.get('lastSize')).lastSize : JSON.parse(localStorage.getItem('frame-shot-size') || 'null');
    const saved = lastSize && [lastSize.width, lastSize.height].every(value => Number.isInteger(value) && value > 0) ? lastSize : { width: 800, height: 600 };
    const fit = Math.min(1, bounds.width / saved.width, bounds.height / saved.height);
    rect = centeredRect(Math.max(1, Math.floor(saved.width * fit)), Math.max(1, Math.floor(saved.height * fit)), bounds);
    ready = true;
    selection.hidden = false;
    setBusy(false); layout(); render();
    if (fit < 1) notice('上次尺寸大于当前画面，初始选框已按比例适配。');
    selection.focus({ preventScroll: true });
    if (!demo) await message('overlay-ready');
  } catch (error) { notice(error.message, true); }
}
initialize();
