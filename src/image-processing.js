import { prepareCameraImage } from "./kiosk/camera-image.js";
import { resampleImage } from "./kiosk/lanczos.js";
import { applyBeauty } from './beauty-render.js';

let worker;
let unavailable = false;
let sequence = 0;
let queue = Promise.resolve();
const pending = new Map();
const workerError = () => Object.assign(new Error("Image worker unavailable"), {
  code: "IMAGE_WORKER_UNAVAILABLE",
});
function stopWorker() {
  unavailable = true;
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(workerError());
  }
  pending.clear();
}
function getWorker() {
  if (unavailable || typeof Worker === "undefined" ||
      typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined" ||
      typeof OffscreenCanvas.prototype.convertToBlob !== "function")
    throw workerError();
  if (!worker) {
    try {
      worker = new Worker(new URL("./image-processing.worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => {
        const request = pending.get(data.id);
        if (!request) { data.result?.close?.(); return; }
        pending.delete(data.id);
        clearTimeout(request.timer);
        if (data.error) {
          const error = Object.assign(new Error(data.error.message), { code: data.error.code });
          request.reject(error);
          if (error.code === "IMAGE_WORKER_UNAVAILABLE") stopWorker();
        } else request.resolve(data.result);
      };
      worker.onerror = (event) => { event.preventDefault(); stopWorker(); };
      worker.onmessageerror = stopWorker;
    } catch { stopWorker(); throw workerError(); }
  }
  return worker;
}

// One full-size image at a time. Create transferable bitmaps inside the queue,
// so a frame containing many photos does not allocate them all at once.
function run(task, makeInput, fallback) {
  const result = queue.then(async () => {
    try {
      const active = getWorker();
      const { input, transfer = [] } = await makeInput();
      if (unavailable || active !== worker) {
        for (const value of transfer) value.close?.();
        throw workerError();
      }
      return await new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(stopWorker, 60000);
        pending.set(id, { resolve, reject, timer });
        try { active.postMessage({ id, task, ...input }, transfer); }
        catch {
          for (const value of transfer) value.close?.();
          stopWorker();
        }
      });
    } catch (error) {
      if (error.code !== "IMAGE_WORKER_UNAVAILABLE") throw error;
      return fallback();
    }
  });
  queue = result.catch(() => {});
  return result;
}

export function prepareCameraImageAsync(file, mirror) {
  return run("camera", () => ({ input: { file, mirror } }),
    () => prepareCameraImage(file, mirror));
}

// Lanczos3 vùng src của ảnh (ảnh gốc / ảnh khung) về out = { width, height } điểm, trong worker để màn
// hình máy chụp không khựng (ảnh 26 MP ~1 giây). Không có worker: làm ngay trên trang.
export function resampleImageAsync(image, out, src) {
  return run("resample", async () => {
    const bitmap = await createImageBitmap(image);
    return { input: { bitmap, out, src }, transfer: [bitmap] };
  }, () => resampleImage(image, out, src, (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h })));
}

export async function applyBeautyAsync(image, faces, adjust, { isCurrent = () => true } = {}) {
  const check = () => { if (!isCurrent()) throw new DOMException('Edit replaced', 'AbortError'); };
  const result = await run('beauty', async () => {
    check();
    const bitmap = await createImageBitmap(image);
    if (!isCurrent()) { bitmap.close(); check(); }
    return { input: { bitmap, faces, adjust }, transfer: [bitmap] };
  }, () => { check(); return applyBeauty(image, faces, adjust); });
  try {
    check();
    if (result.getContext) return result;
    // Existing composition code owns HTML canvases. Keep this contract while
    // the expensive per-pixel work runs in the shared image worker.
    const canvas = Object.assign(document.createElement('canvas'), { width: result.width, height: result.height });
    canvas.getContext('2d').drawImage(result, 0, 0);
    return canvas;
  } catch (error) {
    if (result.getContext) result.width = result.height = 0;
    throw error;
  } finally { result.close?.(); }
}
