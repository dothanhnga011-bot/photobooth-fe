// Lưu tạm trên máy chụp (IndexedDB): ảnh chờ gửi lên máy chủ và cài đặt của máy chụp
// (vd. thư mục ảnh của máy ảnh — trình duyệt chỉ lưu được quyền đọc thư mục ở đây).
const db = new Promise((resolve, reject) => {
  const r = indexedDB.open("photo-selfbooth-outbox", 2);
  r.onupgradeneeded = () => {
    const database = r.result;
    if (!database.objectStoreNames.contains("photos"))
      database.createObjectStore("photos", { keyPath: "id" });
    if (!database.objectStoreNames.contains("settings"))
      database.createObjectStore("settings");
  };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function run(name, mode, action, result = (request) => request.result) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(name, mode),
      req = action(tx.objectStore(name));
    tx.oncomplete = () => resolve(result(req));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Không lưu được ảnh trên thiết bị."));
  });
}
const pendingReads = new Map();
function writePhoto(action) {
  pendingReads.clear();
  return run("photos", "readwrite", action).finally(() => pendingReads.clear());
}
export const savePending = (row) => writePhoto((s) => s.put(row));
// Bulk reads are faster than per-record cursors for image rows. Keep the current
// schema so a still-open kiosk tab cannot block a database upgrade at startup.
export function readPending(token) {
  if (pendingReads.has(token)) return pendingReads.get(token);
  const reading = run("photos", "readonly", (s) => s.getAll(),
    (request) => token === undefined ? request.result
      : request.result.filter((row) => row.token === token));
  const task = reading.finally(() => {
    if (pendingReads.get(token) === task) pendingReads.delete(token);
  });
  pendingReads.set(token, task);
  return task;
}
// Archive scheduling only needs a yes/no answer, not every customer's photo blobs.
export async function hasPending(token) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction("photos", "readonly");
    const request = tx.objectStore("photos").openCursor();
    let found = false;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.token === token) found = true;
      else cursor.continue();
    };
    tx.oncomplete = () => resolve(found);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error("Không đọc được hàng ảnh trên thiết bị."));
  });
}
export const countPending = (token) => token === undefined
  ? run("photos", "readonly", (s) => s.count())
  : readPending(token).then((rows) => rows.length);
export const removePending = (id) => writePhoto((s) => s.delete(id));
// Ảnh xem trước đã lên album: dòng ảnh ở lại để gửi ảnh gốc sau (stage "original", theo thứ tự chụp).
export const markOriginalPending = (row) => savePending({ ...row, stage: "original", originalAt: Date.now() });
// Ảnh còn phải gửi ảnh xem trước (chưa lên album).
export const isPreviewPending = (row) => row.stage !== "original";
export const saveSetting = (key, value) =>
  run("settings", "readwrite", (s) => s.put(value, key));
export const readSetting = (key) => run("settings", "readonly", (s) => s.get(key));

// One read/write transaction prevents a queue append and an acknowledgement
// from overwriting each other, including when two kiosk tabs are open.
// update must be synchronous: IndexedDB commits when no requests remain.
export async function updateSetting(key, update) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction("settings", "readwrite"), store = tx.objectStore("settings");
    const request = store.get(key);
    let next, failure;
    request.onsuccess = () => {
      try {
        next = update(request.result);
        if (next?.then) throw new Error("Cập nhật hàng gửi phải chạy đồng bộ.");
        store.put(next, key);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(next);
    tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error("Không lưu được hàng gửi trên thiết bị."));
  });
}
