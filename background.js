import { saveCapture, getCapture, deleteCapture, cleanCaptures, clearCaptures } from './capture-store.js';
import { mountOverlay, dismissOverlay } from './overlay-host.js';
import { createTabCapture } from './capture-tab.js';
import { captureScrollablePage } from './scroll-capture.js';

let capturing = false;
const captureTab = createTabCapture(chrome.tabs);
const pending = new Map();
let scrollJob = null;

async function dismiss(tabId, id = null) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: dismissOverlay, args: [id, id === null] });
  return results[0]?.result;
}

async function openEditor(record) {
  const editorRecord = { ...record, presentation: 'editor', overlayDocumentId: null };
  await saveCapture(editorRecord);
  const editor = await chrome.tabs.create({ windowId: record.windowId, url: chrome.runtime.getURL(`editor.html?id=${record.id}`) });
  await saveCapture({ ...editorRecord, editorTabId: editor.id });
}

function startScrollCapture(tab, previousId = null) {
  if (capturing || scrollJob) throw new Error('已有截图任务正在进行，请稍后再试');
  if (!Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) throw new Error('找不到当前网页');
  const state = { cancelled: false, stopped: false };
  const token = crypto.randomUUID();
  scrollJob = { tabId: tab.id, token, state };
  capturing = true;
  (async () => {
    const oldId = await dismiss(tab.id).catch(() => null);
    if (oldId) await deleteCapture(oldId);
    if (previousId && previousId !== oldId) await deleteCapture(previousId);
    const result = await captureScrollablePage({ tab, token, captureTab, state });
    if (state.cancelled) return;
    await cleanCaptures();
    await openEditor({
      id: crypto.randomUUID(), blob: result.blob, kind: 'scroll', scrollInfo: { ...result, blob: undefined },
      createdAt: Date.now(), title: `${tab.title || '网页'} · 滚动长图`, sourceTabId: tab.id, windowId: tab.windowId
    });
  })().catch(async error => {
    if (state.cancelled || /滚动截图已取消/.test(error.message)) return;
    console.error('Scroll capture failed:', error);
    await chrome.tabs.create({ windowId: tab.windowId, url: chrome.runtime.getURL(`editor.html?error=${encodeURIComponent(`滚动长图失败：${error.message}`)}`) }).catch(() => {});
  }).finally(() => { scrollJob = null; capturing = false; });
  return { ok: true };
}

chrome.action.onClicked.addListener(async tab => {
  if (scrollJob?.tabId === tab.id) { scrollJob.state.cancelled = true; return; }
  if (capturing) return;
  capturing = true;
  let id;
  try {
    if (!Number.isInteger(tab.windowId) || !Number.isInteger(tab.id)) throw new Error('找不到当前浏览器窗口');
    const oldId = await dismiss(tab.id).catch(() => null);
    if (oldId) await deleteCapture(oldId);
    // Acquire the image before inserting selection UI into the source page.
    const dataUrl = await captureTab(tab);
    await cleanCaptures();
    id = crypto.randomUUID();
    const record = { id, dataUrl, createdAt: Date.now(), title: tab.title || '网页截图', sourceTabId: tab.id, windowId: tab.windowId, presentation: 'overlay' };
    await saveCapture(record);
    let timer;
    const ready = new Promise(resolve => {
      pending.set(id, resolve);
      timer = setTimeout(() => resolve(false), 4000);
    });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, func: mountOverlay,
        args: [id, chrome.runtime.getURL(`overlay.html?id=${id}`)]
      });
    } catch (error) { record.fallbackReason = error.message; pending.get(id)?.(false); }
    const mounted = await ready;
    clearTimeout(timer);
    pending.delete(id);
    if (!mounted) {
      record.fallbackReason ||= '原网页选框未能在 4 秒内完成加载';
      await dismiss(tab.id, id).catch(() => {});
      await openEditor(record);
    }
  } catch (error) {
    if (id) {
      pending.get(id)?.(true);
      pending.delete(id);
      await dismiss(tab.id, id).catch(() => {});
      await deleteCapture(id).catch(() => {});
    }
    console.error('Capture failed:', error);
    const captureError = /image readback failed|view is invisible/i.test(error?.message || '')
      ? `Chrome 暂时无法读取网页画面，已自动重试。请保持 Chrome 窗口可见、等待网页加载完成后，再点击扩展截图。原始错误：${error.message}`
      : error?.message || '截图失败，请重试';
    await chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?error=${encodeURIComponent(captureError)}`) });
  } finally { capturing = false; }
});

async function overlayMessage(message, sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab || !sender.frameId || !sender.documentId) throw new Error('截图界面来源无效');
  const url = new URL(sender.url);
  const ownUrl = new URL(chrome.runtime.getURL('/'));
  if (url.protocol !== ownUrl.protocol || url.host !== ownUrl.host || url.pathname !== '/overlay.html' || url.searchParams.get('id') !== message.id) throw new Error('截图界面来源无效');
  const record = await getCapture(message.id);
  if (!record || record.presentation !== 'overlay' || record.sourceTabId !== sender.tab.id || Date.now() - record.createdAt > 3600000) throw new Error('截图已失效，请重新点击扩展');
  if (record.overlayDocumentId && record.overlayDocumentId !== sender.documentId) throw new Error('截图已在另一个界面打开');
  if (message.type === 'overlay-authorize') {
    await saveCapture({ ...record, overlayDocumentId: sender.documentId });
    return { ok: true };
  }
  if (record.overlayDocumentId !== sender.documentId) throw new Error('截图界面尚未验证');
  if (message.type === 'overlay-scroll') {
    pending.get(message.id)?.(true);
    return startScrollCapture(sender.tab, message.id);
  }
  if (message.type === 'overlay-ready') { pending.get(message.id)?.(true); return { ok: true }; }
  if (message.type === 'overlay-close') {
    pending.get(message.id)?.(true);
    await dismiss(sender.tab.id, message.id);
    await deleteCapture(message.id);
    return { ok: true };
  }
  throw new Error('未知截图操作');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'scroll-control') {
    const valid = sender.id === chrome.runtime.id && sender.frameId === 0 && sender.tab?.id === scrollJob?.tabId && message.token === scrollJob?.token;
    if (valid && message.action === 'cancel') scrollJob.state.cancelled = true;
    if (valid && message.action === 'finish') scrollJob.state.stopped = true;
    sendResponse({ ok: Boolean(valid) });
    return;
  }
  if (!['overlay-authorize', 'overlay-ready', 'overlay-close', 'overlay-scroll'].includes(message?.type)) return;
  overlayMessage(message, sender).then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => cleanCaptures(tabId).catch(console.error));
chrome.runtime.onStartup.addListener(() => clearCaptures().catch(console.error));
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'capture-scroll') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try { startScrollCapture(tab); }
  catch (error) { console.error(error); }
});
