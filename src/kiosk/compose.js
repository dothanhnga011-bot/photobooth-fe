import { api, getApiUrl } from "../api.js";
import { readSetting, saveSetting } from "../capture-store.js";
import { compareFrameOrder } from "../frame-catalog-data.js";
import {
  composeLayout,
  drawMarks,
  drawSlot,
  frameCapacity,
  sharpenRect,
  frameOutputSize,
  instaxPrint,
  loadFrameImage,
  packPrintSheets,
  photoLayout,
  slotRect,
} from "../frame-utils.js";
import { qrImage } from "../qr-image.js";
import { fetchMediaBlob } from "../media-delivery.js";
import { jpegDataUrl } from "../album/encode-jpeg.js";
import { printPackUpload } from "../album/print-upload.js";
import { drawStickers, filterPhotos, loadStickers, stickerArea } from "./decor.js";

// Ghép khung và in ngay tại máy chụp (khách chọn ảnh → chọn khung → lấy ảnh ở khay in).
// Một "tấm" (shot): { key, preview: Blob | URL, image?: Blob gốc chưa lật, mirrored, serverId? }.

const PRINT_EDGE = 3000;
const urlOf = (token, id, size) => getApiUrl(`/api/albums/${token}/photos/${id}?size=${size}`);

// Ảnh xem nhanh (1600 px, đã lật như màn hình) của một tấm: ảnh trên máy, hoặc ảnh trên máy chủ.
export async function previewBitmap(shot, token) {
  const source = shot.preview instanceof Blob
    ? shot.preview
    : await fetchMediaBlob(shot.preview || urlOf(token, shot.serverId, "preview"));
  return createImageBitmap(source, { imageOrientation: "from-image" });
}

// Ảnh để in: ảnh gốc máy ảnh trên máy chụp (lật theo lựa chọn, thu về ≤ 3000 px), không còn trên
// máy thì lấy nguồn in 3000 px máy chủ đã làm (đã lật sẵn), cuối cùng là ảnh xem nhanh.
async function printSource(shot, token) {
  if (shot.image instanceof Blob) {
    const bitmap = await createImageBitmap(shot.image, { imageOrientation: "from-image" });
    const scale = Math.min(1, PRINT_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (shot.mirrored) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  }
  if (shot.serverId)
    try {
      return await createImageBitmap(await fetchMediaBlob(urlOf(token, shot.serverId, "print")));
    } catch {
      /* dùng ảnh xem nhanh */
    }
  return previewBitmap(shot, token);
}
const release = (image) => {
  if (image?.close) image.close();
  else if (image) image.width = image.height = 0;
};

// Khung hợp với số ảnh khách chọn: đúng số ô và đúng khổ in của gói; không có thì nới dần
// (đúng số ô mọi khổ → mọi khung, ảnh được lặp lại cho đủ ô). Xếp theo thứ tự chủ đề.
export function frameCandidates(frames, { count, printSize, themeOrder = [] }) {
  const size = (f) => f.printSize || "full";
  const usable = frames.filter((f) => frameCapacity(f) > 0);
  const rank = (f) => {
    const index = themeOrder.indexOf(f.themeName?.trim());
    return index < 0 ? themeOrder.length : index;
  };
  const sorted = [...usable].sort((a, b) =>
    rank(a) - rank(b) ||
    String(a.themeName || "").localeCompare(String(b.themeName || ""), "vi") ||
    compareFrameOrder(a, b));
  const sameSize = sorted.filter((f) => size(f) === (printSize || "full"));
  const exact = sameSize.filter((f) => frameCapacity(f) === count);
  if (exact.length) return exact;
  // Khổ Instax in ở máy riêng: dùng khung Instax khác số ô trước khung 10 × 15.
  if (printSize === "instax" && sameSize.length) return sameSize;
  const sameCount = sorted.filter((f) => frameCapacity(f) === count);
  return sameCount.length ? sameCount : sorted;
}

// Ghép nhanh để xem trên màn hình (ảnh 1600 px), ảnh lặp lại khi khung nhiều số ảnh hơn số ảnh đã
// chọn. qrUrl: link album của khách (vùng QR trên khung). placeholders: đang chọn ảnh — ô chưa có ảnh
// để trống, hiện số thứ tự (không lặp ảnh). filters: công thức màu của từng ảnh (cùng thứ tự images),
// stickers: nhãn dán (decor.js).
export async function composePreview(frame, images, width = 900, qrUrl = "",
  { placeholders = false, filters = [], stickers = [] } = {}) {
  const layout = photoLayout(frame);
  const [background, qr] = await Promise.all([
    loadFrameImage(frame.image),
    layout.marks.some((m) => m.kind === "qr") && qrUrl ? qrImage(qrUrl).catch(() => null) : null,
    loadStickers(stickers),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round((width * background.naturalHeight) / background.naturalWidth);
  const filled = layout.slots.map((_, i) =>
    placeholders ? images[i] || null : images.length ? images[i % images.length] : null);
  // Ảnh trong ô → màu ảnh → mã QR / ngày in → nhãn dán (nhãn dán không bị đổi màu).
  composeLayout(canvas, background, layout.slots, filled, [], [], { frame: { ...layout, marks: [] } });
  const ctx = canvas.getContext("2d");
  filterPhotos(ctx, layout, filters, canvas.width, canvas.height);
  if (placeholders) {
    const empty = (slot, number) => {
      const r = slotRect(slot, canvas.width, canvas.height);
      ctx.fillStyle = "#f6e9ec";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#b9939a";
      ctx.font = `700 ${Math.round(Math.min(r.w, r.h) * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(number), r.x + r.w / 2, r.y + r.h / 2);
    };
    layout.slots.forEach((slot, i) => {
      if (filled[i]) return;
      empty(slot, i + 1);
      for (const copy of layout.copies) if (copy.of === i) empty(copy.slot, i + 1);
    });
  }
  drawMarks(ctx, layout, qr, canvas.width, canvas.height);
  drawStickers(ctx, stickers, stickerArea(layout), canvas.width, canvas.height);
  return canvas;
}

// Ghép bản in: đúng kích thước in của khung, mỗi ô vẽ từ ảnh chất lượng cao, lần lượt từng ảnh
// (ảnh 26 MP giải mã ~100 MB nên không giữ nhiều ảnh cùng lúc). filters (màu từng ảnh, cùng thứ tự
// shots) / stickers: màu ảnh và nhãn dán khách chọn, vẽ giống hệt ảnh xem trước.
export async function renderPrintFrame(frame, shots, token, qrUrl = "", { filters = [], stickers = [] } = {}) {
  const layout = photoLayout(frame);
  const background = await loadFrameImage(frame.image);
  const canvas = document.createElement("canvas");
  Object.assign(canvas, frameOutputSize(frame, background));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  const sources = new Map();
  try {
    for (const [index, slot] of layout.slots.entries()) {
      const shot = shots.length ? shots[index % shots.length] : null;
      if (!shot) continue;
      if (!sources.has(shot.key)) {
        for (const image of sources.values()) release(image);
        sources.clear();
        sources.set(shot.key, await printSource(shot, token));
      }
      const source = sources.get(shot.key);
      drawSlot(ctx, source, slotRect(slot, canvas.width, canvas.height));
      // Ô bản sao cùng số ảnh (vd. dải thứ hai của khung nhỏ).
      for (const copy of layout.copies)
        if (copy.of === index) drawSlot(ctx, source, slotRect(copy.slot, canvas.width, canvas.height));
    }
    filterPhotos(ctx, layout, filters, canvas.width, canvas.height);
    // Làm nét nhẹ các ô ảnh (bản in 300 dpi), trước khi vẽ mã QR / ngày in.
    for (const slot of [...layout.slots, ...layout.copies.map((c) => c.slot)])
      sharpenRect(ctx, slotRect(slot, canvas.width, canvas.height));
    if (layout.marks.length) {
      const qr = layout.marks.some((m) => m.kind === "qr") && qrUrl
        ? await qrImage(qrUrl).catch(() => null) : null;
      drawMarks(ctx, layout, qr, canvas.width, canvas.height);
    }
    if (stickers.length) {
      await loadStickers(stickers);
      drawStickers(ctx, stickers, stickerArea(layout), canvas.width, canvas.height);
    }
  } finally {
    for (const image of sources.values()) release(image);
  }
  return canvas;
}

// Tờ in 10 × 15 cm cho cả lượt: khung nguyên tờ (kể cả khung nhỏ phủ cả tờ — 2 dải, máy in cắt đôi)
// in `prints` tờ; khung dải cũ (một dải) ghép 2 dải / tờ.
// Khổ Instax (printSize của vé): mỗi tấm là một ảnh ngang 1260 × 840 riêng, máy Instax Link WIDE in từng tấm.
export async function printSheets(frameCanvas, frame, prints, printSize = frame.printSize) {
  if (!prints) return [];
  if (printSize === "instax") {
    const image = instaxPrint(frameCanvas);
    const data = await jpegDataUrl(image, 0.95);
    image.width = image.height = 0;
    return Array.from({ length: prints }, () => data);
  }
  const layout = frame.sheet ? "full" : frame.printSize || "full";
  const copies = layout === "strip" ? prints * 2 : prints;
  const outputs = Array.from({ length: copies }, () => ({ canvas: frameCanvas, printSize: layout }));
  const sheets = packPrintSheets(outputs);
  const images = [];
  for (const sheet of sheets) {
    images.push(await jpegDataUrl(sheet.canvas, 0.95));
    sheet.canvas.width = sheet.canvas.height = 0;
  }
  return images;
}

// ─── Hàng gửi in của máy chụp ─────────────────────────────────────────────
// Lệnh in lưu trên máy (IndexedDB) rồi mới gửi: mất mạng / tải lại trang vẫn gửi tiếp bằng đúng
// mã chống trùng. Album phải có ít nhất một ảnh gốc trên máy chủ mới nhận lệnh in, nên lệnh in
// được thử lại tới khi ảnh đầu tiên tải lên xong.
const QUEUE_KEY = "kiosk-print-queue";
const listeners = new Set();
const states = new Map();
let running = null;
const notify = (token, state) => {
  states.set(token, state);
  for (const listener of listeners) listener(token, state);
};
export function watchKioskPrint(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const kioskPrintState = (token) => states.get(token);

// Trạng thái máy in thật của lệnh in (print-agent ở quầy nhận lệnh → hàng in DNP của Windows / Mac).
function spoolState(job) {
  switch (job?.spoolStatus) {
    case "idle": return { status: "manual" }; // máy chủ chưa bật in tự động
    case "sending": return { status: "printing" };
    case "sent": return { status: "printed" };
    case "failed": return { status: "failed", message: job.spoolMessage };
    default: return { status: "sent" }; // chờ máy in ở quầy nhận lệnh
  }
}
// Theo dõi tới khi máy in nhận lệnh (tối đa 3 phút); quá 20 giây chưa nhận thì báo nhân viên.
async function watchSpool(token, requestKey) {
  const started = Date.now();
  while (Date.now() - started < 3 * 60000) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const job = await api(`/albums/${token}/print?requestKey=${requestKey}`, { allowNull: true }).catch(() => undefined);
    if (job === undefined) continue;
    const state = spoolState(job);
    if (state.status === "sent" && Date.now() - started > 20000) state.status = "stalled";
    notify(token, state);
    if (["printed", "failed", "manual"].includes(state.status)) return;
  }
}

export async function queueKioskPrint({ token, images, frameName }) {
  if (!images.length) return;
  const queue = (await readSetting(QUEUE_KEY).catch(() => null)) || [];
  if (!queue.some((job) => job.token === token))
    queue.push({ token, frameName, images, requestKey: crypto.randomUUID(), queuedAt: Date.now() });
  await saveSetting(QUEUE_KEY, queue);
  notify(token, { status: "sending" });
  runKioskPrints();
}

export function runKioskPrints() {
  running ??= (async () => {
    try {
      for (let round = 0; ; round++) {
        const queue = (await readSetting(QUEUE_KEY).catch(() => null)) || [];
        if (!queue.length) return;
        const left = [];
        for (const job of queue) {
          try {
            const printed = await api(`/albums/${job.token}/print-pack`, printPackUpload({
              images: job.images, frameName: job.frameName, requestKey: job.requestKey,
            }));
            notify(job.token, spoolState(printed));
            watchSpool(job.token, job.requestKey);
          } catch (error) {
            // Vé đã in hết số tờ / album không còn: không thử lại nữa.
            const tooLate = Date.now() - job.queuedAt > 45 * 60000;
            if ((error.status === 409 && /tờ in/.test(error.message)) || error.status === 404 || tooLate) {
              notify(job.token, { status: "failed", message: error.message });
              continue;
            }
            notify(job.token, { status: "waiting", message: error.message });
            left.push(job);
          }
        }
        // Lệnh in vừa thêm trong lúc gửi: giữ lại để gửi ở vòng sau.
        const processed = new Set(queue.map((job) => job.requestKey));
        const latest = (await readSetting(QUEUE_KEY).catch(() => null)) || [];
        const next = [...left, ...latest.filter((job) => !processed.has(job.requestKey))];
        await saveSetting(QUEUE_KEY, next);
        if (!next.length) return;
        if (left.length)
          await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 4000 * 2 ** Math.min(round, 3))));
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

// ─── Ảnh ghép khung gửi vào album ─────────────────────────────────────────
// Khách xem / tải ảnh đã ghép khung trong album kể cả khi gói không kèm tờ in. Lưu trên máy
// (IndexedDB) rồi mới gửi: mất mạng / tải lại trang vẫn gửi tiếp; gửi lại thì máy chủ thay ảnh cũ.
const COMPOSITE_KEY = "kiosk-composite-queue";
let sendingComposites = null;
export async function queueKioskComposite({ token, captureToken, image, frameName }) {
  const queue = (await readSetting(COMPOSITE_KEY).catch(() => null)) || [];
  await saveSetting(COMPOSITE_KEY, [
    ...queue.filter((job) => job.token !== token),
    { id: crypto.randomUUID(), token, captureToken, image, frameName, queuedAt: Date.now() },
  ]);
  runKioskComposites();
}
export function runKioskComposites() {
  sendingComposites ??= (async () => {
    try {
      for (let round = 0; ; round++) {
        const queue = (await readSetting(COMPOSITE_KEY).catch(() => null)) || [];
        if (!queue.length) return;
        const finished = new Set();
        for (const job of queue) {
          try {
            await api("/kiosk/composite", {
              method: "POST",
              body: job.image,
              timeout: 120000,
              headers: {
                "X-Capture-Token": job.captureToken,
                "X-Frame-Name": encodeURIComponent(job.frameName || ""),
              },
            });
            finished.add(job.id);
          } catch (error) {
            // Phiên chụp không còn hợp lệ / ảnh bị từ chối / chờ quá lâu: không thử lại nữa.
            if ([400, 401, 403, 404, 409, 413].includes(error.status) || Date.now() - job.queuedAt > 6 * 3600_000)
              finished.add(job.id);
          }
        }
        const latest = (await readSetting(COMPOSITE_KEY).catch(() => null)) || [];
        const left = latest.filter((job) => !finished.has(job.id));
        await saveSetting(COMPOSITE_KEY, left);
        if (!left.length) return;
        await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 4000 * 2 ** Math.min(round, 3))));
      }
    } finally {
      sendingComposites = null;
    }
  })();
  return sendingComposites;
}
// Bản ghép chất lượng in → JPEG gửi vào album.
export const compositeJpeg = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Không tạo được ảnh ghép."))),
      "image/jpeg",
      0.95,
    ));
