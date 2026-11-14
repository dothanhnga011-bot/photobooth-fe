import { imageRect } from "./image-utils.js";
import { compareFrameOrder } from "./frame-catalog-data.js";
import { createCanvasCache } from "./canvas-cache.js";
import { drawDecorations } from "./album/decorations.js";

// Khung ảnh thiết kế sẵn (xuất từ Canva...): các ô đặt ảnh là vùng trắng
// hoặc trong suốt. Tự dò các ô này, trả về tọa độ tỉ lệ 0–1, xếp trái→phải, trên→dưới.
export function detectSlots({ data, width, height }) {
  const raw = new Uint8Array(width * height);
  for (let i = 0; i < raw.length; i++) {
    const p = i * 4;
    const lo = Math.min(data[p], data[p + 1], data[p + 2]);
    const hi = Math.max(data[p], data[p + 1], data[p + 2]);
    raw[i] = data[p + 3] < 40 || (lo >= 246 && hi - lo <= 6) ? 1 : 0;
  }
  // Co vùng trắng r px để cắt các sọc/viền trắng mảnh nối liền các ô,
  // sau đó nới khung chữ nhật tìm được ra lại r px.
  const r = Math.max(2, Math.round(Math.min(width, height) * 0.012));
  const erode = (src, horizontal) => {
    const out = new Uint8Array(src.length);
    const len = horizontal ? width : height,
      lines = horizontal ? height : width;
    for (let line = 0; line < lines; line++) {
      const at = (k) => (horizontal ? line * width + k : k * width + line);
      let run = 0;
      const runs = new Int32Array(len);
      for (let k = 0; k < len; k++) runs[k] = run = src[at(k)] ? run + 1 : 0;
      run = 0;
      for (let k = len - 1; k >= 0; k--) {
        run = src[at(k)] ? run + 1 : 0;
        out[at(k)] = runs[k] > r && run > r ? 1 : 0;
      }
    }
    return out;
  };
  const hole = erode(erode(raw, true), false);
  const seen = new Uint8Array(hole.length);
  const stack = new Int32Array(hole.length);
  const slots = [];
  const minArea = width * height * 0.03;
  for (let start = 0; start < hole.length; start++) {
    if (!hole[start] || seen[start]) continue;
    let top = 0,
      area = 0,
      x0 = width,
      y0 = height,
      x1 = 0,
      y1 = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % width,
        y = (i - x) / width;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const n of [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ])
        if (n >= 0 && hole[n] && !seen[n]) {
          seen[n] = 1;
          stack[top++] = n;
        }
    }
    const w = x1 - x0 + 1,
      h = y1 - y0 + 1;
    // Co vùng chỉ dùng để tách các ô và kiểm tra hình chữ nhật.
    if (area / (w * h) < 0.85) continue;
    const left = Math.max(0, x0 - r),
      topY = Math.max(0, y0 - r),
      right = Math.min(width, x1 + 1 + r),
      bottom = Math.min(height, y1 + 1 + r);
    // Đo diện tích ô sau khi nới lại: ô ảnh nhỏ trong khung 12–14 ảnh
    // có thể còn dưới 3% sau bước co nhưng vẫn đủ lớn ở thiết kế gốc.
    if ((right - left) * (bottom - topY) < minArea) continue;
    slots.push({
      x: left / width,
      y: topY / height,
      w: (right - left) / width,
      h: (bottom - topY) / height,
    });
  }
  return slots.sort((a, b) =>
    Math.abs(a.y - b.y) < 0.05 ? a.x - b.x : a.y - b.y,
  );
}

const cache = createCanvasCache({ maxPixels: 12_000_000, maxEntries: 12 });
// Tải một ảnh khung, không giữ trong bộ nhớ đệm.
export const loadImageOnce = (src) => new Promise((resolve, reject) => {
  const im = new window.Image();
  // Ảnh khung tải từ máy chủ API (khác tên miền): cần CORS để vẽ lên canvas rồi xuất JPEG.
  if (!/^(data|blob):/.test(src)) im.crossOrigin = "anonymous";
  im.onload = () => resolve(im);
  im.onerror = () => {
    reject(new Error("Không tải được ảnh khung."));
  };
  im.src = src;
});
export function loadFrameImage(src) {
  // Temporary album URLs must not retain decoded full-size photos globally.
  // Their caller already owns the per-album cache and revokes the object URL.
  return src.startsWith("blob:") ? loadImageOnce(src) : cache.remember(src, () => loadImageOnce(src));
}

export const DEFAULT_TRANSFORM = { zoom: 1, x: 0, y: 0, rotate: 0 };
// Khách chỉnh ảnh trong ô: 100 % = ảnh phủ kín ô; thu nhỏ tới 50 % (thấy cả ảnh, phần ô còn trống là
// nền khung), phóng to tới 300 %. Ảnh in vẽ từ ảnh gốc nên phóng to vẫn nét.
export const PHOTO_ZOOM = { min: 0.5, max: 3 };
export const clampZoom = (zoom) =>
  Math.max(PHOTO_ZOOM.min, Math.min(PHOTO_ZOOM.max, Number.isFinite(zoom) ? zoom : 1));

// Tọa độ pixel của một ô trên canvas (nới 1px để không lộ viền trắng). Ô xoay (khung chép từ Selfbooth)
// mang theo góc (độ, quanh tâm ô).
export function slotRect(slot, width, height) {
  const x = Math.floor(slot.x * width) - 1,
    y = Math.floor(slot.y * height) - 1;
  return {
    x,
    y,
    w: Math.ceil(slot.w * width) + 2,
    h: Math.ceil(slot.h * height) + 2,
    ...(slot.angle ? { angle: slot.angle } : {}),
  };
}

// Xoay ngữ cảnh vẽ quanh tâm ô (ô không xoay: giữ nguyên).
export function rotateSlotContext(ctx, rect) {
  if (!rect.angle) return;
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate((rect.angle * Math.PI) / 180);
  ctx.translate(-cx, -cy);
}

// Điểm (tỉ lệ 0–1 trên khung) có nằm trong ô không, kể cả ô xoay. size: kích thước khung (px) để quy đổi
// góc đúng trên khung dọc / ngang.
export function regionContains(region, point, size = { width: 1, height: 1 }) {
  const angle = ((region.angle || 0) * Math.PI) / 180;
  const dx = (point.x - region.x - region.w / 2) * size.width;
  const dy = (point.y - region.y - region.h / 2) * size.height;
  const lx = (Math.cos(angle) * dx + Math.sin(angle) * dy) / size.width;
  const ly = (-Math.sin(angle) * dx + Math.cos(angle) * dy) / size.height;
  return Math.abs(lx) <= region.w / 2 + 1e-10 && Math.abs(ly) <= region.h / 2 + 1e-10;
}

// Như Selfbooth: ô nằm trên "cửa sổ" trong suốt của khung (PNG khoét ô) thì vẽ lại khung đè lên ảnh, giữ
// góc bo / viền của thiết kế; ô trên nền trắng đục thì ảnh nằm trên. Đo một lần cho mỗi ảnh khung + bộ ô.
const cutoutCache = new WeakMap();
export function slotCutouts(frameImage, slots) {
  if (!frameImage || typeof frameImage !== "object") return slots.map(() => false);
  let known = cutoutCache.get(frameImage);
  if (!known) cutoutCache.set(frameImage, (known = new Map()));
  const key = JSON.stringify(slots);
  if (known.has(key)) return known.get(key);
  let cutouts = slots.map(() => false);
  try {
    const width = frameImage.naturalWidth || frameImage.width;
    const height = frameImage.naturalHeight || frameImage.height;
    const k = Math.min(1, 400 / Math.max(width, height));
    const probe = document.createElement("canvas");
    probe.width = Math.max(1, Math.round(width * k));
    probe.height = Math.max(1, Math.round(height * k));
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(frameImage, 0, 0, probe.width, probe.height);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    cutouts = slots.map((slot) => {
      const cx = Math.round((slot.x + slot.w / 2) * probe.width);
      const cy = Math.round((slot.y + slot.h / 2) * probe.height);
      if (cx < 0 || cy < 0 || cx >= probe.width || cy >= probe.height) return false;
      return data[(cy * probe.width + cx) * 4 + 3] < 128;
    });
    probe.width = probe.height = 0;
  } catch { /* ảnh khung khác nguồn (CORS): coi như ô trên nền đục */ }
  known.set(key, cutouts);
  return cutouts;
}
export function overlayFrame(ctx, frameImage, rect) {
  const base = ctx.getTransform();
  ctx.save();
  rotateSlotContext(ctx, rect);
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.setTransform(base);
  ctx.drawImage(frameImage, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

// Tỉ lệ phóng ảnh khi đặt vào ô (> 1: ảnh nguồn ít điểm ảnh hơn ô cần, bị phóng lên).
export function slotScale(image, rect, t = DEFAULT_TRANSFORM) {
  const angle = ((t.rotate || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle)),
    sin = Math.abs(Math.sin(angle));
  return (
    Math.max(
      (cos * rect.w + sin * rect.h) / image.width,
      (sin * rect.w + cos * rect.h) / image.height,
    ) * clampZoom(t.zoom ?? 1)
  );
}

// Draw a photo with the selected crop, zoom and rotation.
export function drawSlot(ctx, image, rect, t = DEFAULT_TRANSFORM) {
  const angle = ((t.rotate || 0) * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const scale = slotScale(image, rect, t);
  // Ảnh lớn hơn ô: dời tới mép ảnh; ảnh nhỏ hơn ô (đã thu nhỏ): dời trong phạm vi ô.
  const limitX = Math.abs(image.width * scale - Math.abs(cos) * rect.w - Math.abs(sin) * rect.h) / 2;
  const limitY = Math.abs(image.height * scale - Math.abs(sin) * rect.w - Math.abs(cos) * rect.h) / 2;
  const px = (t.x || 0) * rect.w,
    py = (t.y || 0) * rect.h;
  const dx = Math.max(-limitX, Math.min(limitX, cos * px + sin * py));
  const dy = Math.max(-limitY, Math.min(limitY, -sin * px + cos * py));
  ctx.save();
  rotateSlotContext(ctx, rect);
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.translate(
    rect.x + rect.w / 2 + cos * dx - sin * dy,
    rect.y + rect.h / 2 + sin * dx + cos * dy,
  );
  ctx.rotate(angle);
  ctx.drawImage(
    image,
    (-image.width * scale) / 2,
    (-image.height * scale) / 2,
    image.width * scale,
    image.height * scale,
  );
  ctx.restore();
}

// ─── Vùng trên khung: ô ảnh có số ảnh, bản sao, mã QR, ngày in ───────────
export const isPhotoRegion = (region) => !region.kind || region.kind === "photo";
// Khung để ghép: mỗi số ảnh là một ô (ô đầu tiên mang số đó). Các ô cùng số (bản sao — vd. 2 dải
// giống nhau trên khung nhỏ) và vùng QR / ngày in vẽ thêm khi ghép. Khung cũ giữ nguyên các ô.
export function photoLayout(frame) {
  if (frame.copies) return frame;
  const leaders = new Map(), copies = [], marks = [];
  let next = 0;
  for (const region of frame.slots || []) {
    if (!isPhotoRegion(region)) {
      marks.push(region);
      continue;
    }
    const number = region.photo ?? ++next;
    if (leaders.has(number)) copies.push({ slot: region, number });
    else leaders.set(number, region);
  }
  const order = [...leaders.keys()].sort((a, b) => a - b);
  return {
    ...frame,
    slots: order.map((n) => leaders.get(n)),
    copies: copies.map(({ slot, number }) => ({ slot, of: order.indexOf(number) })),
    marks,
  };
}
// Số ảnh khác nhau khung cần (bản sao không tính thêm).
export const frameCapacity = (frame) => photoLayout(frame).slots.length;
export const printDate = (date = new Date()) =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh",
  }).format(date).replaceAll("/", ".");
// Mã QR (ảnh đã nạp, chưa có thì ô trắng chờ) và ngày in theo màu chữ của khung.
export function drawMarks(ctx, frame, qr, width, height) {
  for (const region of frame.marks || []) {
    const r = slotRect(region, width, height);
    if (region.kind === "qr") {
      const side = Math.min(r.w, r.h);
      const x = r.x + (r.w - side) / 2, y = r.y + (r.h - side) / 2;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y, side, side);
      if (qr) {
        // Mã QR là các ô vuông: phóng kiểu "điểm gần nhất" cho cạnh sắc, không nhoè (dễ quét, in nét).
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(qr, x, y, side, side);
        ctx.restore();
      }
    } else if (region.kind === "date") {
      const text = printDate();
      ctx.save();
      ctx.fillStyle = frame.dateColor || "#2f1a12";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let size = r.h * 0.8;
      ctx.font = `600 ${size}px "Be Vietnam Pro", "Be Vietnam Pro Local", system-ui, sans-serif`;
      const measured = ctx.measureText(text).width;
      if (measured > r.w * 0.95) {
        size *= (r.w * 0.95) / measured;
        ctx.font = `600 ${size}px "Be Vietnam Pro", "Be Vietnam Pro Local", system-ui, sans-serif`;
      }
      ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2);
      ctx.restore();
    }
  }
}

// Ghép khung: nền khung trước, ảnh đặt vào các ô trắng/trong suốt. `extras` (khung theo photoLayout
// + ảnh QR) vẽ thêm các ô bản sao, mã QR và ngày in; extras.overlay (album Selfbooth): ô trên cửa sổ trong
// suốt của khung được vẽ khung đè lại như bên Selfbooth.
export function composeLayout(canvas, frameImage, slots, images, transforms, decorations = [], extras = null) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frameImage, 0, 0, canvas.width, canvas.height);
  const cutouts = extras?.overlay ? slotCutouts(frameImage, slots) : [];
  slots.forEach((slot, i) => {
    if (!images[i]) return;
    const rect = slotRect(slot, canvas.width, canvas.height);
    drawSlot(ctx, images[i], rect, transforms[i]);
    if (cutouts[i]) overlayFrame(ctx, frameImage, rect);
  });
  if (extras?.frame) {
    for (const copy of extras.frame.copies || [])
      if (images[copy.of])
        drawSlot(ctx, images[copy.of], slotRect(copy.slot, canvas.width, canvas.height), transforms[copy.of]);
    drawMarks(ctx, extras.frame, extras.qr, canvas.width, canvas.height);
  }
  drawDecorations(ctx, decorations, canvas.width, canvas.height);
  return canvas;
}

// ─── Bộ chủ đề (nhiều khung cùng themeName) & xuất tờ in DNP 10 × 15 cm ───
export const SHEET = { w: 1200, h: 1800 }; // 4 × 6 inch @ 300 pixels/inch
// Khung Instax Wide thiết kế ở 1800 × 1200 (ngang 3 : 2, cùng cỡ tờ 10 × 15 nên ảnh ghép trong album
// nét); máy Instax Link WIDE in ảnh ngang 1260 × 840.
export const INSTAX_FRAME = { w: 1200, h: 1800 };
export const INSTAX_PRINT = { w: 1260, h: 840 };

// themeOrder: tên chủ đề theo thứ tự quản trị sắp ở Thiết lập → Chủ đề (chủ đề khác xếp sau).
export function groupFramePacks(frames, themeOrder = []) {
  const groups = new Map();
  for (const frame of frames) {
    const theme = frame.themeName?.trim();
    const key = theme ? `theme:${theme}` : frame._id;
    if (!groups.has(key))
      groups.set(key, { id: key, name: theme || frame.name, frames: [] });
    groups.get(key).frames.push(frame);
  }
  const rank = (g) => {
    const index = g.id.startsWith("theme:") ? themeOrder.indexOf(g.name) : -1;
    return index < 0 ? themeOrder.length : index;
  };
  return [...groups.values()]
    .map((g, index) => ({
      ...g,
      index,
      frames: g.frames.sort(compareFrameOrder),
      required: g.frames.reduce((n, f) => n + frameCapacity(f), 0),
    }))
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .map(({ index, ...g }) => g);
}

// Khung nhỏ chỉ là MỘT dải (vd. 600 × 1800, tỉ lệ ~1 : 3) thì máy chụp mới ghép 2 dải lên tờ. Khung nhỏ
// thiết kế sẵn cả tờ 1200 × 1800 (2 dải đã nhân đôi) in nguyên tờ — dù cờ `sheet` chưa được lưu.
export const isSingleStrip = (frame, width, height) =>
  frame.printSize === "strip" && !frame.sheet && Math.min(width, height) / Math.max(width, height) < 0.5;

// Kích thước xuất của một khung: giữ đúng tỉ lệ thiết kế, vừa khổ in.
export function frameOutputSize(frame, image) {
  // Khung phủ cả tờ (khung nhỏ = 2 dải trên một tờ) in nguyên tờ; khung một dải chỉ nửa tờ.
  const box = frame.printSize === "instax"
    ? INSTAX_FRAME
    : isSingleStrip(frame, image.naturalWidth, image.naturalHeight) ? { w: SHEET.w / 2, h: SHEET.h } : SHEET;
  const landscape = image.naturalWidth > image.naturalHeight;
  const [bw, bh] = landscape ? [box.h, box.w] : [box.w, box.h];
  const { width, height } = imageRect(
    image.naturalWidth,
    image.naturalHeight,
    bw,
    bh,
  );
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

// Đặt ảnh vào vùng (x, y, w, h): xoay 90° nếu khác hướng, giữ tỉ lệ, căn giữa.
function placeOn(ctx, source, x, y, w, h) {
  const rotate =
    source.width > source.height !== w > h && source.width !== source.height;
  const sw = rotate ? source.height : source.width;
  const sh = rotate ? source.width : source.height;
  const scale = Math.min(w / sw, h / sh);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(x + w / 2, y + h / 2);
  if (rotate) ctx.rotate(Math.PI / 2);
  ctx.drawImage(
    source,
    (-source.width * scale) / 2,
    (-source.height * scale) / 2,
    source.width * scale,
    source.height * scale,
  );
  ctx.restore();
}

// Một tấm Instax Wide: ảnh ngang 1260 × 840, khung dọc được xoay cho vừa.
export function instaxPrint(canvas) {
  const out = document.createElement("canvas");
  out.width = INSTAX_PRINT.w;
  out.height = INSTAX_PRINT.h;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  placeOn(ctx, canvas, 0, 0, out.width, out.height);
  return out;
}

// Xếp khung lên tờ 10 × 15: khung nguyên tờ chiếm 1 tờ (khung ngang → tờ ngang
// 15 × 10, máy in tự xoay), khung dải ghép 2 dải / tờ dọc.
// Trả về [{ canvas, frames }] — frames: số khung nằm trên tờ đó.
export function packPrintSheets(outputs, scale = 1) {
  const sheetSize = { w: Math.round(SHEET.w * scale), h: Math.round(SHEET.h * scale) };
  const sheets = [];
  const blank = (landscape = false) => {
    const c = document.createElement("canvas");
    c.width = landscape ? sheetSize.h : sheetSize.w;
    c.height = landscape ? sheetSize.w : sheetSize.h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  };
  let half = null;
  for (const { canvas, printSize } of outputs) {
    if (printSize === "strip") {
      if (half) {
        placeOn(
          half.canvas.getContext("2d"),
          canvas,
          sheetSize.w / 2,
          0,
          sheetSize.w / 2,
          sheetSize.h,
        );
        half.frames = 2;
        half = null;
      } else {
        half = { canvas: blank(), frames: 1, source: canvas };
        placeOn(
          half.canvas.getContext("2d"),
          canvas,
          0,
          0,
          sheetSize.w / 2,
          sheetSize.h,
        );
        sheets.push(half);
      }
    } else {
      const sheet = blank(canvas.width > canvas.height);
      placeOn(sheet.getContext("2d"), canvas, 0, 0, sheet.width, sheet.height);
      sheets.push({ canvas: sheet, frames: 1 });
    }
  }
  // A single strip design still fills both halves of its 4×6 sheet.
  // The DS-RX1 driver cuts the sheet after printing when 2inch cut is enabled.
  if (half) {
    placeOn(half.canvas.getContext("2d"), half.source, sheetSize.w / 2, 0, sheetSize.w / 2, sheetSize.h);
    half.frames = 2;
  }
  return sheets;
}
