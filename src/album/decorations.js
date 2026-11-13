// Chữ, sticker và chữ ký vẽ tay trên khung. Tọa độ lưu theo tỉ lệ 0–1 của khung, cỡ chữ / nét vẽ
// theo khung rộng 1200 px, nên ảnh xem trước và ảnh in 10 × 15 cm vẽ ra giống hệt nhau.
// Font viết tay đi kèm web (Great Vibes, Dancing Script, Pacifico — đủ dấu tiếng Việt, nạp trong main.jsx)
// nên máy chụp nào cũng vẽ giống nhau. Ký hiệu trang trí (♡ ☆ ✿ ✧…) font chữ không có thì lấy từ font ký
// hiệu đi kèm (Noto Sans Symbols 2) ngay sau font chính: không bao giờ ra ô vuông (test/font-coverage).
const SYMBOLS = "'Noto Sans Symbols 2'";
export const DECOR_FONTS = {
  sans: { label: "Hiện đại", css: `'Be Vietnam Pro', ${SYMBOLS}, Arial, sans-serif` },
  vibes: { label: "Chữ ký", css: `'Great Vibes', ${SYMBOLS}, cursive` },
  dancing: { label: "Mềm mại", css: `'Dancing Script', ${SYMBOLS}, cursive` },
  pacifico: { label: "Bo tròn", css: `'Pacifico', ${SYMBOLS}, cursive` },
  serif: { label: "Cổ điển", css: `Georgia, ${SYMBOLS}, 'Times New Roman', serif` },
  handwritten: { label: "Viết tay", css: `'Segoe Script', 'Brush Script MT', ${SYMBOLS}, cursive` },
  round: { label: "Tròn", css: `'Comic Sans MS', 'Chalkboard SE', 'Trebuchet MS', ${SYMBOLS}, sans-serif` },
  typewriter: { label: "Đánh máy", css: `'Courier New', Courier, ${SYMBOLS}, monospace` },
};
export const DECOR_COLORS = [
  "#382b26", "#ffffff", "#7a4b36", "#c89b7b", "#e8d5c4", "#d94f5c",
  "#f29fb0", "#f2b544", "#5c9c6a", "#4a7bd0", "#8e6bbf", "#111111",
];
const MAX_POINTS = 600;
// Sticker ảnh do quản trị tải lên (src là địa chỉ ảnh): nạp một lần, vẽ đồng bộ khi đã sẵn sàng.
const stickerImages = new Map();
function stickerImage(src) {
  if (!stickerImages.has(src)) {
    const image = new window.Image();
    if (!/^(data|blob):/.test(src)) image.crossOrigin = "anonymous";
    const entry = { image, done: false };
    entry.ready = new Promise((resolve) => {
      image.onload = () => { entry.done = true; resolve(image); };
      image.onerror = () => { entry.done = true; resolve(null); };
    });
    image.src = src;
    stickerImages.set(src, entry);
  }
  return stickerImages.get(src);
}
// Mọi sticker ảnh đã nạp xong (hoặc lỗi) — vẽ ngay được, không cần chờ.
export const decorationsReady = (decorations = []) =>
  decorations.every((d) => !d.src || stickerImage(d.src).done);
// Chờ mọi sticker ảnh nạp xong (ảnh in phải có đủ sticker); ảnh lỗi thì bỏ qua.
export const preloadDecorations = (decorations = []) =>
  Promise.all(decorations.filter((d) => d.src).map((d) => stickerImage(d.src).ready));
// Sticker ảnh cao bằng cỡ chữ × 1,6, rộng theo tỉ lệ ảnh.
function imageSize(item, image, width) {
  const h = sizeOf(item, width) * 1.6;
  return { w: h * (image.naturalWidth / image.naturalHeight || 1), h };
}
const isColor = (value) => /^#[0-9a-fA-F]{6}$/.test(value || "");
const unit = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function fontOf(item, px) {
  if (item.type === "sticker") return `${px}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  const family = (DECOR_FONTS[item.font] || DECOR_FONTS.sans).css;
  return `${item.type === "signature" ? "italic " : ""}${item.bold ? "700 " : ""}${px}px ${family}`;
}
// Font của chữ trên khung phải tải xong mới vẽ được lên canvas (khung xem trước, ảnh in): tải đúng các
// ký tự đang dùng (font chia theo bảng chữ, chỉ phần cần thiết). Không có document.fonts (test Node): bỏ qua.
const textItems = (decorations) => decorations.filter((d) => d.text && !d.src);
export const decorFontsReady = (decorations = []) =>
  !globalThis.document?.fonts || textItems(decorations).every((d) => document.fonts.check(fontOf(d, 48), String(d.text)));
export const loadDecorFonts = (decorations = []) =>
  !globalThis.document?.fonts ? Promise.resolve([])
    : Promise.all(textItems(decorations).map((d) => document.fonts.load(fontOf(d, 48), String(d.text)).catch(() => [])));
// Nhãn dán trên máy chụp được phóng to tới gần nửa khung (cỡ 600 ở khung rộng 1200 px).
const sizeOf = (item, width) => Math.max(12, Math.min(600, Number(item.size) || 36)) * width / 1200;

export function drawDecorations(ctx, decorations = [], width, height) {
  for (const item of decorations) {
    ctx.save();
    if (item.type === "drawing") {
      const points = Array.isArray(item.points) ? item.points.slice(0, MAX_POINTS) : [];
      if (points.length) {
        ctx.strokeStyle = isColor(item.color) ? item.color : "#382b26";
        ctx.lineWidth = Math.max(1, Math.min(40, Number(item.width) || 6)) * width / 1200;
        ctx.setLineDash([]);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(unit(points[0][0]) * width, unit(points[0][1]) * height);
        for (const [x, y] of points.slice(1)) ctx.lineTo(unit(x) * width, unit(y) * height);
        if (points.length === 1) ctx.lineTo(unit(points[0][0]) * width + 0.1, unit(points[0][1]) * height);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    if (item.src) {
      const image = stickerImage(item.src).image;
      if (image.complete && image.naturalWidth) {
        const { w, h } = imageSize(item, image, width);
        ctx.drawImage(image, unit(item.x) * width - w / 2, unit(item.y) * height - h / 2, w, h);
      }
      ctx.restore();
      continue;
    }
    const text = String(item.text || "").slice(0, 100);
    if (text) {
      ctx.fillStyle = isColor(item.color) ? item.color : "#382b26";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = fontOf(item, sizeOf(item, width));
      ctx.fillText(text, unit(item.x) * width, unit(item.y) * height, width * .9);
    }
    ctx.restore();
  }
}

// Khung bao (px) của một mục trang trí để chạm chọn / kéo trên màn hình.
export function decorationBox(ctx, item, width, height) {
  if (item.type === "drawing") {
    const xs = item.points.map((p) => p[0] * width), ys = item.points.map((p) => p[1] * height);
    const pad = (Number(item.width) || 6) * width / 1200 + 6;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad,
      w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  if (item.src) {
    const image = stickerImage(item.src).image;
    const { w, h } = image.naturalWidth ? imageSize(item, image, width)
      : { w: sizeOf(item, width) * 1.6, h: sizeOf(item, width) * 1.6 };
    return { x: unit(item.x) * width - w / 2, y: unit(item.y) * height - h / 2, w, h };
  }
  const px = sizeOf(item, width);
  ctx.save();
  ctx.font = fontOf(item, px);
  const w = Math.min(width * .9, ctx.measureText(String(item.text || "")).width) + 12;
  ctx.restore();
  const h = px * 1.3;
  return { x: unit(item.x) * width - w / 2, y: unit(item.y) * height - h / 2, w, h };
}

export function hitDecoration(ctx, decorations, x, y, width, height) {
  for (let i = decorations.length - 1; i >= 0; i--) {
    const b = decorationBox(ctx, decorations[i], width, height);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
  }
  return -1;
}

export const MAX_DRAWING_POINTS = MAX_POINTS;
