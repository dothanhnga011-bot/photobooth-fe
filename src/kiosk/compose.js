import { api, getApiUrl } from "../api.js";
import { readPending, readSetting, saveSetting } from "../capture-store.js";
import { compareFrameOrder } from "../frame-catalog-data.js";
import {
  composeLayout,
  drawMarks,
  drawSlot,
  frameCapacity,
  slotScale,
  frameOutputSize,
  instaxPrint,
  isSingleStrip,
  loadFrameImage,
  packPrintSheets,
  photoLayout,
  slotRect,
} from "../frame-utils.js";
import { qrImage } from "../qr-image.js";
import { fetchMediaBlob } from "../media-delivery.js";
import { jpegDataUrl, pngDataUrl } from "../album/encode-jpeg.js";
import { printPackUpload } from "../album/print-upload.js";
import { drawStickers, filterPhotos, loadStickers, stickerArea } from "./decor.js";
import { priority, whenUplinkIdle } from "./uplink.js";
import { sendDirectPrint } from "./direct-print.js";

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
export async function printSource(shot, token, { strict = false } = {}) {
  if (strict && shot.originalPending)
    throw new Error("Ảnh gốc đang tải lên. Vui lòng chờ ảnh gốc hoặc thêm file gốc từ máy quầy trước khi in.");
  if (shot.image instanceof Blob) {
    const bitmap = await createImageBitmap(shot.image, { imageOrientation: "from-image" });
    const scale = strict ? 1 : Math.min(1, PRINT_EDGE / Math.max(bitmap.width, bitmap.height));
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
    } catch (error) {
      if (strict) throw new Error("Không tải được ảnh chất lượng in. Vui lòng thử lại; chưa dùng ảnh xem nhanh để in.", { cause: error });
      /* dùng ảnh xem nhanh */
    }
  if (strict) throw new Error("Thiếu ảnh gốc để in. Hãy chọn lại ảnh hoặc thêm file gốc từ máy quầy.");
  return previewBitmap(shot, token);
}
const release = (image) => {
  if (image?.close) image.close();
  else if (image) image.width = image.height = 0;
};

// Khung cho gói: khổ lớn / khổ nhỏ hiện MỌI khung đúng khổ in của gói (số ảnh khách chọn theo số ô
// của khung đang xem — frameNeed). Instax: layout theo số ảnh của gói (đúng số ô trước). Không có khung
// đúng khổ thì nới dần (đúng số ô mọi khổ → mọi khung, ảnh được lặp lại cho đủ ô). Xếp theo thứ tự chủ đề.
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
  if (printSize !== "instax" && sameSize.length) return sameSize;
  const exact = sameSize.filter((f) => frameCapacity(f) === count);
  if (exact.length) return exact;
  // Khổ Instax in ở máy riêng: dùng khung Instax khác số ô trước khung 10 × 15.
  if (printSize === "instax" && sameSize.length) return sameSize;
  const sameCount = sorted.filter((f) => frameCapacity(f) === count);
  return sameCount.length ? sameCount : sorted;
}

// Số ảnh khách chọn cho khung đang xem: khổ lớn / nhỏ theo số ô của khung, Instax (và chưa có khung)
// theo gói; không quá số ảnh đã chụp.
export function frameNeed(frame, { count, printSize, shots }) {
  const wanted = frame && printSize !== "instax" ? frameCapacity(frame) || count : count;
  return Math.max(0, Math.min(wanted, shots));
}

// Ghép nhanh để xem trên màn hình (ảnh 1600 px), ảnh lặp lại khi khung nhiều số ảnh hơn số ảnh đã
// chọn. qrUrl: link album của khách (vùng QR trên khung). placeholders: đang chọn ảnh — ô chưa có ảnh
// để trống, hiện số thứ tự (không lặp ảnh). filters: công thức màu của từng ảnh (cùng thứ tự images),
// stickers: nhãn dán (decor.js). width "print": đúng cỡ bản in của khung (vd. 1200 × 1800, khung ngang
// 1800 × 1200) — ảnh xem trước nét như bản in kể cả khi khung hiện to trên màn 1920 × 1080 (trước đây
// 700 px, khung ngang hiện rộng ~1000 px bị phóng to nên mờ).
export async function composePreview(frame, images, width = 900, qrUrl = "",
  { placeholders = false, filters = [], stickers = [], transforms = [] } = {}) {
  const layout = photoLayout(frame);
  const [background, qr] = await Promise.all([
    loadFrameImage(frame.image),
    layout.marks.some((m) => m.kind === "qr") && qrUrl ? qrImage(qrUrl).catch(() => null) : null,
    loadStickers(stickers),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = width === "print" ? frameOutputSize(frame, background).width : width;
  canvas.height = Math.round((canvas.width * background.naturalHeight) / background.naturalWidth);
  const filled = layout.slots.map((_, i) =>
    placeholders ? images[i] || null : images.length ? images[i % images.length] : null);
  // Ảnh trong ô → màu ảnh → mã QR / ngày in → nhãn dán (nhãn dán không bị đổi màu).
  // transforms: phóng/dời của từng ảnh (khách tự chỉnh); ô bản sao theo transform của ảnh gốc.
  composeLayout(canvas, background, layout.slots, filled, transforms, [], { frame: { ...layout, marks: [] } });
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

// Vẽ ảnh vào ô in: thu nhỏ MỘT lần thẳng về đúng cỡ ô bằng bộ lọc chất lượng cao của trình duyệt
// (createImageBitmap resizeQuality "high"), thay vì để drawImage thu nhỏ 3–6 lần trong một bước
// (mờ / răng cưa chi tiết tóc, mắt). Ảnh thu đều cả hai chiều nên vị trí, phóng to, xoay giữ nguyên.
async function drawSharpSlot(ctx, source, rect, t) {
  const scale = slotScale(source, rect, t);
  let fitted = null;
  if (scale < 0.9 && typeof createImageBitmap === "function") {
    try {
      fitted = await createImageBitmap(source, {
        resizeWidth: Math.max(1, Math.round(source.width * scale)),
        resizeHeight: Math.max(1, Math.round(source.height * scale)),
        resizeQuality: "high",
      });
    } catch { /* trình duyệt không hỗ trợ: vẽ thẳng từ ảnh gốc */ }
  }
  try {
    drawSlot(ctx, fitted || source, rect, t);
  } finally {
    fitted?.close();
  }
}

// Ghép bản in: đúng kích thước in của khung, mỗi ô vẽ từ ảnh chất lượng cao, lần lượt từng ảnh
// (ảnh 26 MP giải mã ~100 MB nên không giữ nhiều ảnh cùng lúc). filters (màu từng ảnh, cùng thứ tự
// shots) / stickers: màu ảnh và nhãn dán khách chọn, vẽ giống hệt ảnh xem trước.
// scale: 1 = 1200 × 1800, 2 = 2400 × 3600 for RX1. pixels overrides scale for
// guest composites (~20 MP), rendered from the full camera source with strict=true.
export async function renderPrintFrame(frame, shots, token, qrUrl = "", { filters = [], stickers = [], transforms = [], scale = 1, pixels = 0, strict = false } = {}) {
  const layout = photoLayout(frame);
  const background = await loadFrameImage(frame.image);
  const canvas = document.createElement("canvas");
  const size = frameOutputSize(frame, background);
  if (pixels > 0) scale = Math.sqrt(pixels / (size.width * size.height));
  canvas.width = pixels > 0 ? Math.floor(size.width * scale) : Math.round(size.width * scale);
  canvas.height = pixels > 0 ? Math.floor(size.height * scale) : Math.round(size.height * scale);
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
        sources.set(shot.key, await printSource(shot, token, { strict }));
      }
      const source = sources.get(shot.key);
      const t = transforms[index];
      await drawSharpSlot(ctx, source, slotRect(slot, canvas.width, canvas.height), t);
      // Ô bản sao cùng số ảnh (vd. dải thứ hai của khung nhỏ).
      for (const copy of layout.copies)
        if (copy.of === index) await drawSharpSlot(ctx, source, slotRect(copy.slot, canvas.width, canvas.height), t);
    }
    filterPhotos(ctx, layout, filters, canvas.width, canvas.height);
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
export async function printSheets(frameCanvas, frame, prints, printSize = frame.printSize, scale = 1) {
  if (!prints) return [];
  if (printSize === "instax") {
    const image = instaxPrint(frameCanvas);
    const data = await jpegDataUrl(image, 0.95);
    image.width = image.height = 0;
    return Array.from({ length: prints }, () => data);
  }
  // Khung nhỏ 1200 × 1800 đã có sẵn 2 dải: in nguyên tờ 1 lần (máy DNP cắt đôi), không nhân đôi nữa.
  const layout = isSingleStrip(frame, frameCanvas.width, frameCanvas.height) ? "strip" : "full";
  const copies = layout === "strip" ? prints * 2 : prints;
  const outputs = Array.from({ length: copies }, () => ({ canvas: frameCanvas, printSize: layout }));
  const sheets = packPrintSheets(outputs, scale);
  // Tờ in DNP: PNG không nén mất — giữ đủ màu từng điểm ảnh (JPEG giảm độ phân giải màu, nhoè viền
  // chữ / khung). Mọi tờ của một lượt giống hệt nhau (cùng một khung), nên chỉ mã hoá một lần.
  const data = await pngDataUrl(sheets[0].canvas);
  for (const sheet of sheets) sheet.canvas.width = sheet.canvas.height = 0;
  return sheets.map(() => data);
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

export async function directKioskPrint(job, { archiveAfter } = {}) {
  const key = `kiosk-direct-request:${job.token}`;
  const saved = await readSetting(key);
  const requestKey = saved?.requestKey || crypto.randomUUID();
  // Keep the identity even if the browser reloads after a lost acknowledgement.
  await saveSetting(key, { requestKey });
  notify(job.token, { status: 'sending' });
  try {
    await sendDirectPrint({ ...job, requestKey });
    notify(job.token, { status: 'printed' });
    if (archiveAfter) await archiveAfter;
    // Archive in the background only after the local acknowledgement. Upload retries never print.
    await queueKioskPrint({ ...job, requestKey, archive: true }).catch((error) =>
      console.warn('RX1 accepted the print; could not persist its archive upload.', error));
  } catch (error) {
    notify(job.token, { status: 'failed', message: error.message });
    throw error;
  }
}

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

// printSize: khổ của khung được in ("strip" → máy cắt đôi, "full" → nguyên tờ; Instax bỏ trống).
export async function queueKioskPrint({ token, images, frameName, printSize, archive = false, requestKey = crypto.randomUUID() }) {
  if (!images.length) return;
  const queue = (await readSetting(QUEUE_KEY).catch(() => null)) || [];
  if (!queue.some((job) => job.token === token))
    queue.push({ token, frameName, printSize, images, archive, requestKey, queuedAt: Date.now() });
  await saveSetting(QUEUE_KEY, queue);
  if (!archive) notify(token, { status: "sending" });
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
            if (job.archive) {
              if (Date.now() - job.queuedAt > 24 * 60 * 60000) continue;
              // Guest photos and composites get the upload link before bulky duplicate print PNGs.
              await whenUplinkIdle();
              if ((await readPending(job.token)).length) { left.push(job); continue; }
            }
            const upload = () => api(`/albums/${job.token}/${job.archive ? "print-archive" : "print-pack"}`, printPackUpload({
              images: job.images, frameName: job.frameName, requestKey: job.requestKey, printSize: job.printSize,
            }));
            const printed = await (job.archive ? upload() : priority(upload));
            if (!job.archive) {
              notify(job.token, spoolState(printed));
              watchSpool(job.token, job.requestKey);
            }
          } catch (error) {
            // Vé đã in hết số tờ / album không còn: không thử lại nữa.
            const tooLate = Date.now() - job.queuedAt > (job.archive ? 24 * 60 : 45) * 60000;
            if ((!job.archive && ((error.status === 409 && /tờ in/.test(error.message)) || error.status === 404)) || tooLate) {
              if (!job.archive) notify(job.token, { status: "failed", message: error.message });
              continue;
            }
            if (!job.archive) notify(job.token, { status: "waiting", message: error.message });
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
            await priority(() => api("/kiosk/composite", {
              method: "POST",
              body: job.image,
              timeout: 120000,
              headers: {
                "X-Capture-Token": job.captureToken,
                "X-Frame-Name": encodeURIComponent(job.frameName || ""),
              },
            }));
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
