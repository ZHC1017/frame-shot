import { centeredRect, moveRect, resizeRect } from './geometry.js';
import { getCapture, deleteCapture } from './capture-store.js';

const $ = id => document.getElementById(id);
const image = $('source-image');
const wrap = $('image-wrap');
const selection = $('selection');
const fields = [$('width'), $('height')];
const isExtension = location.protocol === 'chrome-extension:';
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const captureId = params.get('id');
let bounds, rect, scale = 1, ratio = null, drag = null, busy = false;
let savedSize = { width: 800, height: 600 };
let mode = 'free';
let resultUrl;
let ready = false;
let persistTimer;
let captureKind = 'viewport';
let viewMode = 'fit';
let sourceObjectUrl;

function status(message, kind = '') {
  $('status').textContent = message;
  $('status').className = `status ${kind}`;
}

function persistSize() {
  if (captureKind === 'scroll') return;
  clearTimeout(persistTimer);
  // Persist dimensions only, never image data or webpage metadata.
  const value = { width: rect.width, height: rect.height };
  persistTimer = setTimeout(() => {
    if (isExtension) chrome.storage.local.set({ lastSize: value }).catch(() => status('尺寸偏好保存失败，当前截图仍可使用。', 'error'));
    else localStorage.setItem('frame-shot-size', JSON.stringify(value));
  }, 200);
}

function render(syncFields = true) {
  if (!rect) return;
  selection.style.left = `${rect.x * scale}px`;
  selection.style.top = `${rect.y * scale}px`;
  selection.style.width = `${rect.width * scale}px`;
  selection.style.height = `${rect.height * scale}px`;
  $('selection-label').textContent = `${rect.width} × ${rect.height} px`;
  selection.setAttribute('aria-label', `截图选框 ${rect.width} × ${rect.height} 像素，位置 ${rect.x}, ${rect.y}，可使用方向键移动`);
  selection.classList.toggle('locked', mode === 'size');
  if (syncFields) {
    fields[0].value = rect.width;
    fields[1].value = rect.height;
  }
  document.querySelectorAll('[data-size]').forEach(button => {
    const [w, h] = button.dataset.size.split(',').map(Number);
    button.classList.toggle('active', w === rect.width && h === rect.height);
  });
}

function changed() {
  $('result').hidden = true;
  status(demo ? '示例模式 · 可体验拖动、复制和保存。' : '按 Enter 确认，截图将自动复制到剪贴板。');
  render();
  persistSize();
}

function layout() {
  if (!bounds) return;
  const viewport = $('viewport');
  viewport.classList.toggle('scrollable', viewMode !== 'fit');
  const style = getComputedStyle(viewport);
  const availableWidth = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availableHeight = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  scale = viewMode === 'actual' ? 1 : viewMode === 'width'
    ? Math.min(1, Math.max(1, availableWidth) / bounds.width)
    : Math.min(1, Math.max(1, availableWidth) / bounds.width, Math.max(1, availableHeight) / bounds.height);
  wrap.style.width = `${bounds.width * scale}px`;
  wrap.style.height = `${bounds.height * scale}px`;
  $('zoom-label').textContent = `画面缩放 ${Math.round(scale * 100)}% · 按原始像素导出`;
  render(false);
}

function applySize(width, height) {
  if (!ready || busy) return;
  try {
    const next = centeredRect(width, height, bounds, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    rect = next;
    if (mode === 'ratio') ratio = rect.width / rect.height;
    changed();
  } catch (error) {
    status(error.message, 'error');
  }
}

function commitFields() {
  applySize(Number(fields[0].value), Number(fields[1].value));
}

$('size-form').addEventListener('submit', event => { event.preventDefault(); commitFields(); });
// Changing one field applies the dimensions; invalid text stays visible for correction.
fields.forEach(field => field.addEventListener('change', commitFields));
$('swap').addEventListener('click', () => applySize(Number(fields[1].value), Number(fields[0].value)));
$('reset').addEventListener('click', () => applySize(savedSize.width, savedSize.height));
document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => applySize(...button.dataset.size.split(',').map(Number))));
$('mode').addEventListener('change', () => {
  mode = $('mode').value;
  ratio = mode === 'ratio' && rect ? rect.width / rect.height : null;
  $('mode-description').textContent = {
    free: '拖动边角改变宽高，尺寸实时更新。',
    size: '选框宽高固定，拖动内部调整位置。',
    ratio: '保持当前比例缩放；像素取整误差不超过 1 px。'
  }[mode];
  render();
});

selection.addEventListener('pointerdown', event => {
  if (!ready || busy || event.button !== 0 || drag) return;
  const handle = event.target.closest('[data-handle]')?.dataset.handle;
  if (handle && mode === 'size') return;
  event.preventDefault();
  selection.focus({ preventScroll: true });
  selection.setPointerCapture(event.pointerId);
  drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect: { ...rect }, handle, scale, ratio };
  selection.classList.add('dragging');
});

selection.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId || busy) return;
  const dx = (event.clientX - drag.startX) / drag.scale;
  const dy = (event.clientY - drag.startY) / drag.scale;
  rect = drag.handle
    ? resizeRect(drag.rect, drag.handle, dx, dy, bounds, drag.ratio)
    : moveRect(drag.rect, dx, dy, bounds);
  changed();
});

function endDrag(event) {
  if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
  drag = null;
  selection.classList.remove('dragging');
}
selection.addEventListener('pointerup', endDrag);
selection.addEventListener('pointercancel', endDrag);
selection.addEventListener('lostpointercapture', endDrag);
window.addEventListener('blur', () => endDrag());
new ResizeObserver(() => { endDrag(); layout(); }).observe($('viewport'));

async function closeEditor() {
  if (busy) return;
  if (isExtension) {
    // Close first; tabs.onRemoved deletes the backing capture after successful close.
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id) await chrome.tabs.remove(tab.id);
  } else {
    status('演示已取消。实际使用时会关闭截图页，保留原网页。');
  }
}
$('cancel').addEventListener('click', () => closeEditor().catch(() => status('无法关闭截图页，请手动关闭标签页。', 'error')));

document.addEventListener('keydown', event => {
  const editing = event.target.closest('input,select,textarea,[contenteditable="true"]');
  if (event.key === 'Escape') {
    event.preventDefault();
    if (drag) { endDrag(); return; }
    closeEditor().catch(() => status('无法关闭截图页，请手动关闭标签页。', 'error'));
    return;
  }
  if (editing || !ready || busy || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'Enter' && !event.target.closest('button,a')) { event.preventDefault(); exportImage('copy'); }
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (delta) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    rect = moveRect(rect, delta[0] * step, delta[1] * step, bounds);
    changed();
  }
});

function setBusy(value) {
  busy = value;
  document.body.classList.toggle('busy', value);
  document.querySelectorAll('button,input,select').forEach(element => { element.disabled = value || !ready; });
  $('cancel').disabled = value;
}

async function croppedBlob(snapshot) {
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.width;
  canvas.height = snapshot.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建裁剪画布');
  context.drawImage(image, snapshot.x, snapshot.y, snapshot.width, snapshot.height, 0, 0, snapshot.width, snapshot.height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败，请尝试缩小选框')), 'image/png'));
}

async function exportImage(action) {
  if (!ready || busy) return;
  // Reject pending invalid dimensions instead of silently exporting the previous rectangle.
  if (Number(fields[0].value) !== rect.width || Number(fields[1].value) !== rect.height) {
    commitFields();
    if (Number(fields[0].value) !== rect.width || Number(fields[1].value) !== rect.height) return;
  }
  endDrag();
  const snapshot = { ...rect };
  setBusy(true);
  $('result').hidden = true;
  status(action === 'copy' ? '正在生成并复制 PNG…' : '正在生成 PNG…');
  try {
    const blob = await croppedBlob(snapshot);
    if (action === 'copy') {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前环境不支持图片复制，请使用 Chrome 扩展页或保存 PNG');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } else {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `frame-shot-${snapshot.width}x${snapshot.height}-${Date.now()}.png`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    $('result-image').src = resultUrl;
    $('result-title').textContent = action === 'copy' ? '已复制到剪贴板' : '已生成 PNG';
    $('result-meta').textContent = `${snapshot.width} × ${snapshot.height} px · ${Math.max(1, Math.round(blob.size / 1024))} KB`;
    $('result').hidden = false;
    status(action === 'copy' ? '已复制，可直接粘贴到微信、文档或设计工具。' : 'PNG 已交给浏览器下载。', 'success');
  } catch (error) {
    const permissionError = error.name === 'NotAllowedError' || /focus|permission/i.test(error.message);
    status(permissionError ? '复制被浏览器阻止，请点击“复制截图”重试，或保存 PNG。' : `${error.message}。可重试或保存 PNG。`, 'error');
  } finally {
    setBusy(false);
  }
}
$('copy').addEventListener('click', () => exportImage('copy'));
$('download').addEventListener('click', () => exportImage('download'));
$('view-mode').addEventListener('change', () => { viewMode = $('view-mode').value; layout(); });
$('select-all').addEventListener('click', () => {
  if (!ready || busy) return;
  rect = { x: 0, y: 0, width: bounds.width, height: bounds.height };
  if (mode === 'ratio') ratio = rect.width / rect.height;
  changed();
});
window.addEventListener('pagehide', () => { if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl); });

async function initialize() {
  setBusy(false);
  const version = isExtension ? chrome.runtime.getManifest().version : '0.3.0';
  document.querySelector('.version').textContent = `v${version}`;
  $('mode-banner').textContent = `这是 v${version} 的独立编辑页。原网页框选请回到普通网页，点击 Chrome 工具栏中的 Frame Shot 图标。重新加载扩展不会把已打开的编辑页转换为网页遮罩。`;
  $('mode-banner').hidden = false;
  try {
    const preferences = isExtension ? (await chrome.storage.local.get('lastSize')).lastSize : JSON.parse(localStorage.getItem('frame-shot-size') || 'null');
    if (preferences && [preferences.width, preferences.height].every(value => Number.isInteger(value) && value > 0)) savedSize = preferences;
  } catch { /* Preferences must not prevent capturing. */ }
  try {
    let source;
    let scrollInfo;
    if (demo) {
      document.body.classList.add('demo');
      $('source-title').textContent = '示例画面 · 不是真实网页截图';
      source = 'demo.svg';
    } else {
      if (params.has('error')) throw new Error(params.get('error'));
      if (!captureId) return;
      const capture = await getCapture(captureId);
      if (!capture) throw new Error('截图已清理，请回到原网页再次点击扩展图标');
      if (Date.now() - capture.createdAt > 60 * 60 * 1000) {
        await deleteCapture(captureId);
        throw new Error('截图已超过一小时，请重新截取网页');
      }
      captureKind = capture.kind || 'viewport';
      scrollInfo = capture.scrollInfo;
      source = capture.blob ? (sourceObjectUrl = URL.createObjectURL(capture.blob)) : capture.dataUrl;
      $('source-title').textContent = capture.title;
      if (capture.fallbackReason) {
        $('mode-banner').textContent = `v${version} · 兼容模式：原网页选框未能启动，已在此页编辑。原因：${capture.fallbackReason}`;
      }
      if (captureKind === 'scroll') {
        $('mode-banner').textContent = `v${version} · 滚动长图 · 已拼接 ${scrollInfo?.tiles || 1} 屏，原网页位置已恢复。默认选中整张长图，可裁剪后复制或保存。${scrollInfo?.warning || ''}`;
        $('view-mode').value = viewMode = 'width';
      }
    }
    image.src = source;
    await image.decode();
    bounds = { width: image.naturalWidth, height: image.naturalHeight };
    let initialMessage;
    try { rect = captureKind === 'scroll' ? { x: 0, y: 0, width: bounds.width, height: bounds.height } : centeredRect(savedSize.width, savedSize.height, bounds); }
    catch {
      // Only the first load adapts an unavailable saved preset; explicit inputs never silently shrink.
      const fit = Math.min(1, bounds.width / savedSize.width, bounds.height / savedSize.height);
      rect = centeredRect(Math.max(1, Math.floor(savedSize.width * fit)), Math.max(1, Math.floor(savedSize.height * fit)), bounds);
      initialMessage = '原图小于上次尺寸，初始选框已按比例适配。';
    }
    $('empty').hidden = true;
    wrap.hidden = false;
    $('image-meta').textContent = `${bounds.width} × ${bounds.height} px`;
    ready = true;
    setBusy(false);
    layout();
    render();
    status(captureKind === 'scroll' ? `整张长图 ${bounds.width} × ${bounds.height} px 已选中。按 Enter 复制，或保存 PNG。${scrollInfo?.warning || ''}` : initialMessage || (demo ? '示例模式 · 可体验拖动、复制和保存。' : '按 Enter 确认，截图将自动复制到剪贴板。'));
  } catch (error) {
    $('mode-banner').textContent = `v${version} · 截图失败。这是新版的错误提示页，请按下面的提示重试。`;
    $('empty-title').textContent = '暂时无法打开截图';
    $('empty-message').textContent = `${error.message}。请回到原网页点击扩展图标重试。`;
    $('image-meta').textContent = '截图未就绪';
    status('截图未就绪，剪贴板没有被修改。', 'error');
  }
  // Cancel remains available even when there is no capture.
  $('cancel').disabled = false;
}

initialize();
