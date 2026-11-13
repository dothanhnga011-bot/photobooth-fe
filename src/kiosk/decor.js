import {
  COLOR_FILTERS,
  CUSTOM_FILTER,
  FILTER_CSS,
  customCss,
  filterRegion,
  filterSteps,
} from "../color-filters.js";
import {
  DECOR_COLORS,
  DECOR_FONTS,
  decorFontsReady,
  decorationBox,
  decorationsReady,
  drawDecorations,
  loadDecorFonts,
  preloadDecorations,
} from "../album/decorations.js";
import { photoLayout, slotRect } from "../frame-utils.js";

// Dùng lại bảng font & màu của phần album cho chữ đánh máy trên máy chụp.
export { DECOR_COLORS, DECOR_FONTS };

// Bảng ký tự cho chữ ký / tên trên khung (kiểu "hntram.ngn__ ♡ __tthiuha__"): dấu hay dùng trong tên
// Instagram, ký hiệu trang trí và vài mẫu ghép sẵn. Chỉ gồm ký tự có trong font đi kèm (♡ ☆ ✿… thuộc
// Noto Sans Symbols 2) — test/font-coverage.test.js kiểm tra từng ký tự, không ra ô vuông.
export const TEXT_MARKS = [".", "_", "@", "-", "~", "·", "—"];
export const TEXT_SYMBOLS = ["♡", "♥", "❤", "☆", "★", "✩", "✿", "❀", "✧", "✦", "⋆", "☁", "☀", "❦"];
export const TEXT_PRESETS = ["__ ♡ __", "~ ♡ ~", "— ☆ —", "✧˚ · ✧", "⋆˚✿˚⋆", "♡♡♡"];

// Trang trí trên màn chọn ảnh của máy chụp: một màu ảnh (filter) cho mọi ảnh trong khung và các
// nhãn dán trên khung. Ảnh xem trước, ảnh ghép trong album và ảnh in vẽ bằng cùng các hàm này.
// filter: màu chung cho mọi ảnh; photoFilters: màu riêng của từng ảnh (theo mã tấm ảnh), đè màu chung.
export const NO_DECOR = Object.freeze({ filter: "original", photoFilters: Object.freeze({}), stickers: Object.freeze([]) });
export const MAX_STICKERS = 20;
// Cỡ nhãn dán: chiều cao so với bề rộng vùng đặt nhãn dán.
export const STICKER_SCALE = Object.freeze({ initial: 0.2, min: 0.06, max: 0.45, step: 1.2 });
export const clampScale = (scale) =>
  Math.max(STICKER_SCALE.min, Math.min(STICKER_SCALE.max, Number(scale) || STICKER_SCALE.initial));

// Màu ảnh khách chọn được: "Gốc", filter tiệm tự tạo đang kích hoạt, rồi bộ lọc có sẵn đang bật
// (Thiết lập → Quản lý filter). steps: công thức màu (null = giữ ảnh gốc).
export function filterChoices(settings = {}) {
  const enabled = settings.enabledFilters?.length ? settings.enabledFilters : Object.keys(COLOR_FILTERS);
  const builtIn = (id) => ({
    id,
    label: COLOR_FILTERS[id],
    css: FILTER_CSS[id] || "none",
    steps: filterSteps({ filter: id }) || null,
  });
  return [
    builtIn("original"),
    ...(settings.customFilters || [])
      .filter((f) => f.active !== false && f.id && f.name)
      .map((f) => {
        const steps = filterSteps({ filter: CUSTOM_FILTER + f.id, custom: f });
        return { id: CUSTOM_FILTER + f.id, label: f.name, css: customCss(f), steps: steps.length ? steps : null };
      }),
    ...Object.keys(COLOR_FILTERS)
      .filter((id) => id !== "original" && enabled.includes(id))
      .map(builtIn),
  ];
}
// Công thức màu của filter khách đã chọn (filter vừa bị tắt / xóa: giữ ảnh gốc).
export const filterStepsFor = (id, settings) =>
  filterChoices(settings).find((choice) => choice.id === id)?.steps || null;
// Màu của một tấm ảnh: màu riêng của tấm đó, không có thì màu chung.
export const photoFilterId = (decor, shotKey) => decor?.photoFilters?.[shotKey] || decor?.filter || "original";

// Màu ảnh chỉ áp lên các ô ảnh (kể cả ô bản sao): nền khung, mã QR và nhãn dán giữ nguyên màu.
// filters: công thức màu của từng ảnh theo thứ tự đặt vào khung (null = ảnh gốc); khung nhiều ô hơn
// số ảnh thì ảnh lặp lại như lúc ghép (ô i → ảnh i % số ảnh), ô bản sao theo ô gốc của nó.
export function filterPhotos(ctx, frame, filters, width, height) {
  if (!filters?.some((steps) => steps?.length)) return;
  const layout = photoLayout(frame);
  const paint = (slot, steps) => {
    if (!steps?.length) return;
    const r = slotRect(slot, width, height);
    filterRegion(ctx, r.x, r.y, r.w, r.h, steps);
  };
  const stepsOf = (index) => filters[index % filters.length];
  layout.slots.forEach((slot, index) => paint(slot, stepsOf(index)));
  for (const copy of layout.copies) paint(copy.slot, stepsOf(copy.of));
}
// Ảnh (thứ tự đặt vào khung) ở điểm chạm x, y (tỉ lệ 0–1 của khung), kể cả ô bản sao; -1 nếu ngoài ô ảnh.
export function photoAt(frame, x, y) {
  const layout = photoLayout(frame);
  const inside = (s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
  const slot = layout.slots.findIndex(inside);
  if (slot >= 0) return slot;
  return layout.copies.find((copy) => inside(copy.slot))?.of ?? -1;
}
// Khung bao (px) các ô của một ảnh (cả ô bản sao) để tô viền ảnh đang chọn màu.
export function photoRects(frame, index, width, height) {
  const layout = photoLayout(frame);
  return [layout.slots[index], ...layout.copies.filter((copy) => copy.of === index).map((copy) => copy.slot)]
    .filter(Boolean)
    .map((slot) => slotRect(slot, width, height));
}

// Vùng đặt nhãn dán = TOÀN khung (tỉ lệ 0–1), KHÔNG tự nhân đôi sang dải kia. Mỗi lần khách bấm
// thêm 1 nhãn, tự kéo tới chỗ muốn; muốn dán ở dải kia thì bấm thêm một nhãn nữa. (Trước đây khung
// nhỏ 2 dải tự lặp nhãn sang dải kia — nay bỏ để khách chủ động dán từng cái.)
export function stickerArea() {
  return { x: 0, y: 0, w: 1, h: 1, shift: null };
}

// Nhãn dán lưu theo vùng đặt: { id, src (ảnh của tiệm) | text (biểu tượng), u, v (tâm, 0–1 trong
// vùng), scale }. Đổi sang mục trang trí của decorations.js (tọa độ theo cả khung, cỡ theo khung
// rộng 1200 px: ảnh cao size × 1,6, biểu tượng cao bằng cỡ chữ); index: vị trí trong danh sách.
export function placedStickers(stickers = [], area) {
  const placed = [];
  stickers.forEach((sticker, index) => {
    const scale = clampScale(sticker.scale);
    const base = {
      x: area.x + Math.max(0, Math.min(1, sticker.u)) * area.w,
      y: area.y + Math.max(0, Math.min(1, sticker.v)) * area.h,
      index,
    };
    // Chữ đánh máy: vẽ như chữ (font + màu khách chọn). Nhãn dán ảnh: vẽ ảnh của tiệm.
    const item = sticker.type === "text"
      ? { ...base, type: "text", text: sticker.text, font: sticker.font, color: sticker.color, bold: sticker.bold, size: 900 * scale * area.w }
      : { ...base, type: "sticker", ...(sticker.src ? { src: sticker.src } : { text: sticker.text }), size: (sticker.src ? 750 : 1200) * scale * area.w };
    placed.push(item);
    if (area.shift) placed.push({ ...item, x: item.x + area.shift.dx, y: item.y + area.shift.dy, copy: true });
  });
  return placed;
}
export function drawStickers(ctx, stickers, area, width, height) {
  if (stickers?.length) drawDecorations(ctx, placedStickers(stickers, area), width, height);
}
// Nhãn dán ở điểm chạm (px trên canvas); nhãn dán vẽ sau nằm trên nên được chọn trước.
export function hitSticker(ctx, stickers, area, x, y, width, height) {
  const placed = placedStickers(stickers, area);
  for (let i = placed.length - 1; i >= 0; i--) {
    const box = decorationBox(ctx, placed[i], width, height);
    // Nới vùng chạm một chút cho dễ chạm trên màn cảm ứng.
    const pad = Math.max(6, Math.min(box.w, box.h) * 0.15);
    if (x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad)
      return placed[i].index;
  }
  return -1;
}
// Khung bao (px) của một nhãn dán, cả bản lặp ở dải thứ hai.
export const stickerBoxes = (ctx, stickers, area, index, width, height) =>
  placedStickers(stickers, area)
    .filter((item) => item.index === index)
    .map((item) => decorationBox(ctx, item, width, height));
// Ảnh nhãn dán của tiệm nạp xong mới vẽ được (ảnh lỗi thì bỏ qua); chữ khách gõ chờ font tải xong.
const imageItems = (stickers = []) => stickers.filter((s) => s.src).map((s) => ({ src: s.src }));
const textItems = (stickers = []) =>
  stickers.filter((s) => s.type === "text" && s.text).map((s) => ({ type: "text", text: s.text, font: s.font, bold: s.bold }));
export const stickersReady = (stickers) =>
  decorationsReady(imageItems(stickers)) && decorFontsReady(textItems(stickers));
export const loadStickers = (stickers) =>
  Promise.all([preloadDecorations(imageItems(stickers)), loadDecorFonts(textItems(stickers))]);
