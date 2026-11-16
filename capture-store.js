const MAX_AGE = 60 * 60 * 1000;
let opening;

function database() {
  return opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('frame-shot', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('captures', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
  });
}

async function transaction(mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('captures', mode);
    const request = operation(tx.objectStore('captures'));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('截图暂存失败'));
  });
}

export const saveCapture = capture => transaction('readwrite', store => store.put(capture));
export const getCapture = id => transaction('readonly', store => store.get(id));
export const deleteCapture = id => transaction('readwrite', store => store.delete(id));
export const clearCaptures = () => transaction('readwrite', store => store.clear());

export async function cleanCaptures(closedTabId) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('captures', 'readwrite');
    const request = tx.objectStore('captures').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value;
      if (Date.now() - record.createdAt > MAX_AGE ||
          (closedTabId !== undefined && (record.editorTabId === closedTabId || (record.presentation === 'overlay' && record.sourceTabId === closedTabId)))) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
