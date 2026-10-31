// Layout phòng Polaroid trên thẻ Instax Wide (ảnh ngang 3 : 2, máy Instax Link WIDE): vị trí các ô
// ảnh theo số ảnh của layout. Dùng chung cho hình layout trên máy chụp / quản trị và khung trắng mẫu.
export const WIDE_FRAME = { w: 1800, h: 1200 };
// Lề trắng (px trên khung 1800 × 1200): phim Wide che ~17 px hai bên và ~46 px trên / dưới.
const MARGIN_X = 42;
const MARGIN_Y = 70;
const GAP = 22;
// Layout mẫu: 1, 2, 3 ảnh xếp ngang; 4 ảnh 2 × 2; 5 ảnh = 2 ảnh to bên trái + 3 ảnh bé bên phải;
// 6 ảnh 3 × 2.
export const LAYOUT_COUNTS = [1, 2, 3, 4, 5, 6];

function grid(cols, rows, box) {
  const w = (box.w - GAP * (cols - 1)) / cols;
  const h = (box.h - GAP * (rows - 1)) / rows;
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push({ x: box.x + c * (w + GAP), y: box.y + r * (h + GAP), w, h });
  return cells;
}

function cells(count, box) {
  if (count === 1) return grid(1, 1, box);
  if (count === 2) return grid(2, 1, box);
  if (count === 3) return grid(3, 1, box);
  if (count === 4) return grid(2, 2, box);
  if (count === 5) {
    const left = { ...box, w: Math.round((box.w - GAP) * 0.58) };
    const right = { ...box, x: box.x + left.w + GAP, w: box.w - left.w - GAP };
    return [...grid(1, 2, left), ...grid(1, 3, right)];
  }
  if (count === 6) return grid(3, 2, box);
  const cols = Math.ceil(Math.sqrt(count * 1.5));
  return grid(cols, Math.ceil(count / cols), box).slice(0, count);
}

const round = (n) => Math.round(n * 10000) / 10000;

// Các ô ảnh của layout `count` ảnh, tỉ lệ 0–1 trên thẻ (gồm cả lề), theo thứ tự ảnh 1, 2, 3…
export function layoutSlots(count) {
  const n = Math.max(1, Math.min(40, Math.round(Number(count) || 1)));
  const { w, h } = WIDE_FRAME;
  const box = { x: MARGIN_X, y: MARGIN_Y, w: w - MARGIN_X * 2, h: h - MARGIN_Y * 2 };
  return cells(n, box).map((c) => ({ x: round(c.x / w), y: round(c.y / h), w: round(c.w / w), h: round(c.h / h) }));
}
