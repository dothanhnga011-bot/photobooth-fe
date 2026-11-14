import { api, getApiUrl } from "../api.js";
import { createCanvasCache } from "../canvas-cache.js";
import { hasPending, readSetting, updateSetting } from "../capture-store.js";
import { compareFrameOrder } from "../frame-catalog-data.js";
import {
  composeLayout,
  drawMarks,
  drawSlot,
  frameCapacity,
  slotScale,
  frameOutputSize,
  instaxPrint,
  largePrint,
  isSingleStrip,
  loadFrameImage,
  loadImageOnce,
  overlayFrame,
  packPrintSheets,
  photoLayout,
  rotateSlotContext,
  slotCutouts,
  slotRect,
} from "../frame-utils.js";
import { qrImage } from "../qr-image.js";
import { fetchMediaBlob } from "../media-delivery.js";
import { jpegDataUrl, pngDataUrl } from "../album/encode-jpeg.js";
import { printPackUpload } from "../album/print-upload.js";
import { isPolaroidSize } from "../print-sizes.js";
import { drawStickers, filterPhotos, loadStickers, stickerArea } from "./decor.js";
import { priority, whenUplinkIdle } from "./uplink.js";
import { sendDirectPrint } from "./direct-print.js";
import { slotMapping } from "./lanczos.js";
import { resampleImageAsync } from "../image-processing.js";

// Ghép khung và in ngay tại máy chụp (khách chọn ảnh → chọn khung → lấy ảnh ở khay in).
// Một "tấm" (shot): { key, preview: Blob | URL, image?: Blob gốc chưa lật, mirrored, serverId? }.

const PRINT_EDGE = 3000;
const urlOf = (token, id, size) => getApiUrl(`/api/albums/${token}/photos/${id}?size=${size}`);

// Ảnh xem nhanh (1600 px, đã lật như màn hình) của một tấm: ảnh trên máy, hoặc ảnh trên máy chủ.
export async function previewBitmap(shot, token, { signal } = {}) {
  signal?.throwIfAborted();
  const source = shot.preview instanceof Blob
    ? shot.preview
    : await fetchMediaBlob(shot.preview || urlOf(token, shot.serverId, "preview"), { signal });
  signal?.throwIfAborted();
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
  const polaroid = isPolaroidSize(printSize);
  if (!polaroid && sameSize.length) return sameSize;
  const exact = sameSize.filter((f) => frameCapacity(f) === count);
  if (exact.length) return exact;
  // Khổ Polaroid (20 × 30 / Instax) in ở máy riêng: dùng khung đúng khổ khác số ô trước khung 10 × 15.
  if (polaroid && sameSize.length) return sameSize;
  const sameCount = sorted.filter((f) => frameCapacity(f) === count);
  return sameCount.length ? sameCount : sorted;
}

// Số ảnh khách chọn cho khung đang xem: khổ lớn / nhỏ theo số ô của khung, Instax (và chưa có khung)
// theo gói; không quá số ảnh đã chụp.
export function frameNeed(frame, { count, printSize, shots }) {
  const wanted = frame && !isPolaroidSize(printSize) ? frameCapacity(frame) || count : count;
  return Math.max(0, Math.min(wanted, shots));
}

// Ghép nhanh để xem trên màn hình (ảnh 1600 px), ảnh lặp lại khi khung nhiều số ảnh hơn số ảnh đã
// chọn. qrUrl: link album của khách (vùng QR trên khung). placeholders: đang chọn ảnh — ô chưa có ảnh
// để trống, hiện số thứ tự (không lặp ảnh). filters: công thức màu của từng ảnh (cùng thứ tự images),
// stickers: nhãn dán (decor.js). width "print": đúng cỡ bản in của khung (vd. 1200 × 1800, khung ngang
// 1800 × 1200) — ảnh xem trước nét như bản in kể cả khi khung hiện to trên màn 1920 × 1080 (trước đây
// 700 px, khung ngang hiện rộng ~1000 px bị phóng to nên mờ).
export async function composePreview(frame, images, width = 900, qrUrl = "",
  { placeholders = false, filters = [], stickers = [], transforms = [], signal, background: frameImage = null, overlay = false } = {}) {
  signal?.throwIfAborted();
  const layout = photoLayout(frame);
  const [background, qr] = await Promise.all([
    frameImage || loadFrameImage(frame.image),
    layout.marks.some((m) => m.kind === "qr") && qrUrl ? qrImage(qrUrl).catch(() => null) : null,
    loadStickers(stickers),
  ]);
  // A newer drag/filter/frame change can supersede this while assets load.
  // Stop before allocating and filtering a full-size canvas for an obsolete view.
  signal?.throwIfAborted();
  const canvas = document.createElement("canvas");
  canvas.width = width === "print" ? frameOutputSize(frame, background).width : width;
  canvas.height = Math.round((canvas.width * background.naturalHeight) / background.naturalWidth);
  const filled = layout.slots.map((_, i) =>
    placeholders ? images[i] || null : images.length ? images[i % images.length] : null);
  // Ảnh trong ô → màu ảnh → mã QR / ngày in → nhãn dán (nhãn dán không bị đổi màu).
  // transforms: phóng/dời của từng ảnh (khách tự chỉnh); ô bản sao theo transform của ảnh gốc.
  composeLayout(canvas, background, layout.slots, filled, transforms, [], { frame: { ...layout, marks: [] }, overlay });
  const ctx = canvas.getContext("2d");
  filterPhotos(ctx, layout, filters, canvas.width, canvas.height);
  if (placeholders) {
    const empty = (slot, number) => {
      const r = slotRect(slot, canvas.width, canvas.height);
      ctx.save();
      rotateSlotContext(ctx, r);
      ctx.fillStyle = "#f6e9ec";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#b9939a";
      ctx.font = `700 ${Math.round(Math.min(r.w, r.h) * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(number), r.x + r.w / 2, r.y + r.h / 2);
      ctx.restore();
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

// Ô nhỏ của mục "Khung" trên màn chọn ảnh: ảnh khách (đã áp màu, phóng / dời) ghép vào ảnh khung xem
// nhanh (WebP cạnh dài 720 px) thay vì ảnh khung gốc — 16 khung chỉ tốn vài MB và không đẩy ảnh gốc
// của khung đang xem ra khỏi bộ nhớ đệm. Các ô ghép lần lượt từng ô (máy chụp yếu không bị khựng); ô
// đã bị bỏ (khách rời mục, đổi ảnh) thì bỏ qua. Cạnh dài 360 px: đủ nét cho ô ~180 px trên màn hình.
const TILE_EDGE = 360;
// Ảnh khung xem nhanh đã giải mã của các ô, giữ riêng (16 khung tờ nhỏ ~12 MP), không chung bộ nhớ đệm
// ảnh khung gốc. Tải sẵn trong lúc khách đang chụp (preloadFrameTiles) để chụp xong các ô hiện ngay.
const tileBackgrounds = createCanvasCache({ maxPixels: 16_000_000, maxEntries: 32 });
const decoded = (image) => (image.decode ? image.decode().then(() => image, () => image) : image);
function tileBackground(frame) {
  const src = frame.thumb || frame.image;
  return src.startsWith("blob:")
    ? loadImageOnce(src)
    : tileBackgrounds.remember(src, () => loadImageOnce(src).then(decoded));
}
// Tải sẵn (lần lượt, từng ảnh một) ảnh khung xem nhanh của mọi khung trong gói và ảnh khung gốc của
// khung khách thấy đầu tiên. Lỗi mạng bỏ qua: lúc mở mục Khung sẽ tải lại như thường.
export async function preloadFrameTiles(frames, { first = frames[0], signal } = {}) {
  if (first?.image) await loadFrameImage(first.image).then(decoded).catch(() => {});
  for (const frame of frames) {
    if (signal?.aborted) return;
    await tileBackground(frame).catch(() => {});
  }
}
let tileTurn = Promise.resolve();
export function composeFrameTile(frame, images, { filters = [], transforms = [], signal, placeholders = true } = {}) {
  const run = tileTurn.then(async () => {
    signal?.throwIfAborted();
    const background = await tileBackground(frame);
    const width = background.naturalWidth >= background.naturalHeight
      ? TILE_EDGE
      : Math.max(1, Math.round((TILE_EDGE * background.naturalWidth) / background.naturalHeight));
    return composePreview(frame, images, width, "", { placeholders, filters, transforms, signal, background });
  });
  tileTurn = run.catch(() => {}).then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return run;
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

// Tờ in DNP (sharp): ô không xoay → Lanczos3 MỘT lần từ ảnh gốc, ghi thẳng điểm ảnh vào đúng ô (toạ độ
// nguyên). Cùng vị trí / phóng / dời như drawSlot. cache: kết quả theo hình học ô (ô bản sao cùng cỡ dùng lại).
async function drawLanczosSlot(ctx, source, rect, t, cache) {
  const scale = slotScale(source, rect, t);
  const { width, height } = source;
  const limitX = Math.abs(width * scale - rect.w) / 2;
  const limitY = Math.abs(height * scale - rect.h) / 2;
  const dx = Math.max(-limitX, Math.min(limitX, (t?.x || 0) * rect.w));
  const dy = Math.max(-limitY, Math.min(limitY, (t?.y || 0) * rect.h));
  const left = rect.x + rect.w / 2 + dx - (width * scale) / 2;
  const top = rect.y + rect.h / 2 + dy - (height * scale) / 2;
  const map = slotMapping({ width, height }, rect, scale, left, top, ctx.canvas);
  if (!map) return;
  const key = [map.dest.x - rect.x, map.dest.y - rect.y, map.dest.w, map.dest.h, map.src.x, map.src.y, map.src.w, map.src.h].join();
  let pixels = cache.get(key);
  if (!pixels) {
    pixels = await resampleImageAsync(source, { width: map.dest.w, height: map.dest.h }, map.src);
    cache.set(key, pixels);
  }
  ctx.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), map.dest.x, map.dest.y);
}
const rotated = (t) => Boolean(((t?.rotate || 0) % 360 + 360) % 360);

// Ghép bản in: đúng kích thước in của khung, mỗi ô vẽ từ ảnh chất lượng cao, lần lượt từng ảnh
// (ảnh 26 MP giải mã ~100 MB nên không giữ nhiều ảnh cùng lúc). filters (màu từng ảnh, cùng thứ tự
// shots) / stickers: màu ảnh và nhãn dán khách chọn, vẽ giống hệt ảnh xem trước.
// scale: 1 = 1200 × 1800, 2 = 2400 × 3600 for RX1. pixels overrides scale for
// guest composites (~20 MP), rendered from the full camera source with strict=true.
// sharp (tờ in DNP): khung và ảnh co / giãn bằng Lanczos3 một lần, ảnh đặt ở toạ độ nguyên (lanczos.js) —
// chi tiết mảnh của ảnh giữ 83 % thay vì 64 %, chữ / nét khung 65 % thay vì 46 % (ở 0,4 chu kỳ / điểm in).
// overlay (album Selfbooth): ô trên cửa sổ trong suốt của khung được vẽ khung đè lại như bên Selfbooth.
// Ô xoay (khung chép từ Selfbooth) luôn vẽ bằng canvas (xoay quanh tâm ô), không qua Lanczos.
export async function renderPrintFrame(frame, shots, token, qrUrl = "", { filters = [], stickers = [], transforms = [], scale = 1, pixels = 0, strict = false, sharp = false, sourceFor = printSource, overlay = false } = {}) {
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
  if (sharp && (background.naturalWidth !== canvas.width || background.naturalHeight !== canvas.height)) {
    const art = await resampleImageAsync(background, { width: canvas.width, height: canvas.height },
      { x: 0, y: 0, w: background.naturalWidth, h: background.naturalHeight });
    ctx.putImageData(new ImageData(art.data, art.width, art.height), 0, 0);
  } else ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  const sources = new Map();
  const fitted = new Map();
  const cutouts = overlay ? slotCutouts(background, layout.slots) : [];
  const copyCutouts = overlay ? slotCutouts(background, layout.copies.map((copy) => copy.slot)) : [];
  const draw = (source, rect, t) =>
    sharp && !rotated(t) && !rect.angle ? drawLanczosSlot(ctx, source, rect, t, fitted) : drawSharpSlot(ctx, source, rect, t);
  try {
    for (const [index, slot] of layout.slots.entries()) {
      const shot = shots.length ? shots[index % shots.length] : null;
      if (!shot) continue;
      if (!sources.has(shot.key)) {
        for (const image of sources.values()) release(image);
        sources.clear();
        fitted.clear();
        sources.set(shot.key, await sourceFor(shot, token, { strict }));
      }
      const source = sources.get(shot.key);
      const t = transforms[index];
      const rect = slotRect(slot, canvas.width, canvas.height);
      await draw(source, rect, t);
      if (cutouts[index]) overlayFrame(ctx, background, rect);
      // Ô bản sao cùng số ảnh (vd. dải thứ hai của khung nhỏ).
      for (const [i, copy] of layout.copies.entries())
        if (copy.of === index) {
          const copyRect = slotRect(copy.slot, canvas.width, canvas.height);
          await draw(source, copyRect, t);
          if (copyCutouts[i]) overlayFrame(ctx, background, copyRect);
        }
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
  } catch (error) {
    canvas.width = canvas.height = 0;
    throw error;
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
  // Tờ 20 × 30 máy DS820 (phòng Polaroid / Selfbooth): mỗi tờ đúng 2400 × 3600 (hoặc ngang), JPEG như album.
  if (printSize === "large") {
    const image = largePrint(frameCanvas);
    const data = await jpegDataUrl(image, 0.95);
    if (image !== frameCanvas) image.width = image.height = 0;
    return Array.from({ length: prints }, () => data);
  }
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

// Vị trí các ô ảnh trên tờ in DNP ([x, y, rộng, cao] theo tỉ lệ 0–1 của tờ): bộ in làm nét đủ phần ảnh,
// chữ / khung chỉ một nửa. Khung nguyên tờ: các ô của khung (cả ô bản sao); khung một dải: hai dải trên
// một tờ (trái / phải), như printSheets xếp.
export function printPhotoRegions(frame, frameCanvas) {
  const layout = photoLayout(frame);
  const slots = [...layout.slots, ...layout.copies.map((copy) => copy.slot)];
  const halves = isSingleStrip(frame, frameCanvas.width, frameCanvas.height) ? [0, 0.5] : [null];
  const round = (value) => Math.round(Math.min(1, Math.max(0, value)) * 1e5) / 1e5;
  const rects = [];
  for (const half of halves)
    for (const s of slots) {
      const [x, y, w, h] = half === null ? [s.x, s.y, s.w, s.h] : [half + s.x / 2, s.y, s.w / 2, s.h];
      const left = round(x), top = round(y);
      const width = round(Math.min(w, 1 - left)), height = round(Math.min(h, 1 - top));
      if (width > 0 && height > 0) rects.push([left, top, width, height]);
    }
  return rects.slice(0, 40);
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
  // Observe a failed archive prerequisite immediately, even while RX1 is busy.
  const archiveReady = Promise.resolve(archiveAfter).catch((error) => {
    console.warn('Could not finish the guest composite before archiving its print.', error);
  });
  const key = `kiosk-direct-request:${job.token}`;
  // Keep the identity even if the browser reloads after a lost acknowledgement.
  const saved = await updateSetting(key, (current) => current?.requestKey ? current : { requestKey: crypto.randomUUID() });
  const requestKey = saved.requestKey;
  notify(job.token, { status: 'sending' });
  try {
    await sendDirectPrint({ ...job, requestKey });
  } catch (error) {
    notify(job.token, { status: 'failed', message: error.message });
    throw error;
  }
  notify(job.token, { status: 'printed' });
  await archiveReady;
  // A failed archive must never turn an acknowledged physical print into "failed".
  await queueKioskPrint({ ...job, requestKey, archive: true }).catch((error) =>
    console.warn('RX1 accepted the print; could not persist its archive upload.', error));
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
  await updateSetting(QUEUE_KEY, (current) => {
    const queue = current || [];
    return queue.some((job) => job.token === token) ? queue
      : [...queue, { token, frameName, printSize, images, archive, requestKey, queuedAt: Date.now() }];
  });
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
              if (await hasPending(job.token)) { left.push(job); continue; }
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
        const next = await updateSetting(QUEUE_KEY, (current) =>
          [...left, ...(current || []).filter((job) => !processed.has(job.requestKey))]);
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
  await updateSetting(COMPOSITE_KEY, (current) => [
    ...(current || []).filter((job) => job.token !== token),
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
        const left = await updateSetting(COMPOSITE_KEY, (current) =>
          (current || []).filter((job) => !finished.has(job.id)));
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
