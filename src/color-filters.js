// Colour filters shared by preview and export.
export const COLOR_FILTERS = {
  original: "Gốc",
  soft: "Dịu",
  warm: "Ấm",
  film: "Phim",
  mono: "Trắng đen",
  vintage: "Cổ điển",
  retro: "Hoài cổ",
};
// Dùng cho ảnh xem trước (CSS). Ảnh xuất ra tính bằng pixel (FILTER_STEPS) vì
// Safari trên iPhone đời cũ bỏ qua ctx.filter của canvas.
export const FILTER_CSS = {
  soft: "contrast(.92) brightness(1.08) saturate(.9)",
  warm: "sepia(.22) saturate(1.18)",
  film: "contrast(1.12) saturate(.8) sepia(.12)",
  mono: "grayscale(1)",
  vintage: "sepia(.4) contrast(.9)",
  retro: "contrast(1.15) saturate(1.35) sepia(.18) brightness(1.03)",
};
const FILTER_STEPS = {
  soft: [
    ["contrast", 0.92],
    ["brightness", 1.08],
    ["saturate", 0.9],
  ],
  warm: [
    ["sepia", 0.22],
    ["saturate", 1.18],
  ],
  film: [
    ["contrast", 1.12],
    ["saturate", 0.8],
    ["sepia", 0.12],
  ],
  mono: [["saturate", 0]],
  vintage: [
    ["sepia", 0.4],
    ["contrast", 0.9],
  ],
  retro: [
    ["contrast", 1.15],
    ["saturate", 1.35],
    ["sepia", 0.18],
    ["brightness", 1.03],
  ],
};
// Filter tiệm tự tạo (Thiết lập → Quản lý filter): chỉ số tính bằng % như CSS filter
// (100 = giữ nguyên), xoay màu tính bằng độ. Ảnh lưu kèm chỉ số trong adjust.custom nên ảnh xem
// trước, ảnh tải về và ảnh in luôn giống nhau, kể cả khi tiệm sửa filter sau đó.
export const CUSTOM_FILTER = "custom:";
export const NEUTRAL_CUSTOM = { brightness: 100, contrast: 100, saturate: 100, sepia: 0, hueRotate: 0 };
export function customSteps(f) {
  const v = { ...NEUTRAL_CUSTOM, ...f };
  return [
    v.brightness !== 100 && ["brightness", v.brightness / 100],
    v.contrast !== 100 && ["contrast", v.contrast / 100],
    v.saturate !== 100 && ["saturate", v.saturate / 100],
    v.sepia && ["sepia", v.sepia / 100],
    v.hueRotate && ["hueRotate", v.hueRotate],
  ].filter(Boolean);
}
export const customCss = (f) =>
  customSteps(f)
    .map(([op, value]) =>
      op === "hueRotate" ? `hue-rotate(${value}deg)` : `${op}(${value})`)
    .join(" ") || "none";
export const filterSteps = (a) =>
  a?.custom && String(a.filter).startsWith(CUSTOM_FILTER)
    ? customSteps(a.custom)
    : FILTER_STEPS[a?.filter];

// Công thức giống CSS filter (Filter Effects spec), áp dụng trực tiếp lên pixel.
function colorFilter(data, steps) {
  for (let o = 0; o < data.length; o += 4) {
    let r = data[o],
      g = data[o + 1],
      b = data[o + 2];
    for (const [op, v] of steps) {
      if (op === "brightness") ((r *= v), (g *= v), (b *= v));
      else if (op === "contrast")
        ((r = (r - 128) * v + 128),
          (g = (g - 128) * v + 128),
          (b = (b - 128) * v + 128));
      else if (op === "saturate") {
        const nr =
          (0.213 + 0.787 * v) * r +
          (0.715 - 0.715 * v) * g +
          (0.072 - 0.072 * v) * b;
        const ng =
          (0.213 - 0.213 * v) * r +
          (0.715 + 0.285 * v) * g +
          (0.072 - 0.072 * v) * b;
        const nb =
          (0.213 - 0.213 * v) * r +
          (0.715 - 0.715 * v) * g +
          (0.072 + 0.928 * v) * b;
        ((r = nr), (g = ng), (b = nb));
      } else if (op === "hueRotate") {
        // Ma trận hue-rotate của CSS Filter Effects.
        const rad = (v * Math.PI) / 180,
          c = Math.cos(rad),
          s = Math.sin(rad);
        const nr =
          (0.213 + c * 0.787 - s * 0.213) * r +
          (0.715 - c * 0.715 - s * 0.715) * g +
          (0.072 - c * 0.072 + s * 0.928) * b;
        const ng =
          (0.213 - c * 0.213 + s * 0.143) * r +
          (0.715 + c * 0.285 + s * 0.14) * g +
          (0.072 - c * 0.072 - s * 0.283) * b;
        const nb =
          (0.213 - c * 0.213 - s * 0.787) * r +
          (0.715 - c * 0.715 + s * 0.715) * g +
          (0.072 + c * 0.928 + s * 0.072) * b;
        ((r = nr), (g = ng), (b = nb));
      } else if (op === "sepia") {
        const k = 1 - v;
        const nr =
          (0.393 + 0.607 * k) * r +
          (0.769 - 0.769 * k) * g +
          (0.189 - 0.189 * k) * b;
        const ng =
          (0.349 - 0.349 * k) * r +
          (0.686 + 0.314 * k) * g +
          (0.168 - 0.168 * k) * b;
        const nb =
          (0.272 - 0.272 * k) * r +
          (0.534 - 0.534 * k) * g +
          (0.131 + 0.869 * k) * b;
        ((r = nr), (g = ng), (b = nb));
      }
    }
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
  }
}
// Áp filter màu lên một vùng của canvas (vd. từng ô ảnh trong khung, chừa nền khung và nhãn dán).
// Đọc theo từng dải 256 dòng để ảnh lớn không cần thêm một bản RGBA cả ảnh.
export function filterRegion(ctx, x, y, w, h, steps) {
  if (!steps?.length) return;
  const left = Math.max(0, Math.floor(x)),
    top = Math.max(0, Math.floor(y));
  const width = Math.min(ctx.canvas.width, Math.ceil(x + w)) - left,
    bottom = Math.min(ctx.canvas.height, Math.ceil(y + h));
  if (width <= 0) return;
  for (let row = top; row < bottom; row += 256) {
    const pixels = ctx.getImageData(left, row, width, Math.min(256, bottom - row));
    colorFilter(pixels.data, steps);
    ctx.putImageData(pixels, left, row);
  }
}
