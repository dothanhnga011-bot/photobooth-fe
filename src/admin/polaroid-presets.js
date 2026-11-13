import { api } from "../api";
import { frameCapacity } from "../frame-utils";
import { LAYOUT_COUNTS, WIDE_FRAME, layoutSlots, polaroidLayout } from "../polaroid-layouts.js";

// Layout mẫu: ảnh nhỏ chọn 1 ảnh / 3 phút, ảnh to chọn 2 ảnh / 5 phút,
// mỗi layout một gói khổ Instax (100.000 đ, chụp không giới hạn) và một
// khung trắng Instax Wide đúng số ô. Khung Polaroid không thuộc chủ đề nào.
export const SAMPLE_PRICE = 100000;

// Khung trắng 1800 × 1200: nền trắng, ô ảnh màu kem nhạt (ảnh của khách phủ lên ô khi ghép).
export function whiteFrame(count) {
  const { w, h } = WIDE_FRAME;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#efe7de";
  for (const s of layoutSlots(count)) ctx.fillRect(s.x * w, s.y * h, s.w * w, s.h * h);
  const data = canvas.toDataURL("image/png");
  canvas.width = canvas.height = 0;
  return data;
}

// Các ô ảnh của layout `count` ảnh, đánh số ảnh 1, 2… (để lưu vào khung).
export const layoutRegions = (count) => layoutSlots(count).map((s, i) => ({ ...s, kind: "photo", photo: i + 1 }));

// Số layout / khung mẫu còn thiếu: layout (kể cả đã tắt) hay khung Instax đã có cùng số ảnh thì giữ nguyên.
export function missingSamples(packages, frames) {
  const layouts = new Set(packages.filter((p) => p.printSize === "instax").map((p) => Number(p.selectCount)));
  const framed = new Set(frames.filter((f) => f.printSize === "instax").map(frameCapacity));
  return {
    layouts: LAYOUT_COUNTS.filter((n) => !layouts.has(n)),
    frames: LAYOUT_COUNTS.filter((n) => !framed.has(n)),
  };
}

// ─── Khung thử Mellow (Instax Wide 1800 × 1200) để thử phòng Selfbooth ngay, chưa cần thiết kế khung ────
// Vẽ bằng canvas: nền giấy kem / hồng phấn, chữ "Mellow" viết tay, tim ♡, ngày in. Vị trí theo px trên khung
// 1800 × 1200 (phim Wide che ~17 px hai bên, ~46 px trên / dưới: chữ và ô đều nằm trong vùng in).
const COCOA = "#4b332a";
const ROSE = "#e0526b";
const SCRIPT = '"Great Vibes", "Dancing Script", cursive';
const SYMBOL = '"Noto Sans Symbols 2", "Segoe UI Symbol", sans-serif';
const SANS = '"Be Vietnam Pro", system-ui, sans-serif';
export const TEST_FRAMES = [
  {
    name: "Khung thử Mellow · 1 ảnh",
    paper: "#fbf6ef",
    photos: [{ x: 70, y: 70, w: 930, h: 1060 }],
    date: { x: 1115, y: 880, w: 500, h: 64 },
    script: { text: "Mellow", x: 1365, y: 470, size: 230 },
    caption: { text: "PHOTOBOOTH", x: 1365, y: 640, size: 38 },
    hearts: [{ text: "♡   ✿   ♡", x: 1365, y: 760, size: 56 }],
  },
  {
    name: "Khung thử Mellow · 2 ảnh",
    paper: "#f8e4e5",
    photos: [{ x: 70, y: 70, w: 815, h: 905 }, { x: 915, y: 70, w: 815, h: 905 }],
    date: { x: 1390, y: 1046, w: 320, h: 56 },
    script: { text: "Mellow", x: 900, y: 1088, size: 124 },
    caption: { text: "PHOTOBOOTH", x: 330, y: 1078, size: 32 },
    hearts: [{ text: "♡", x: 655, y: 1080, size: 44 }, { text: "♡", x: 1145, y: 1080, size: 44 }],
  },
];
const fraction = (r) => {
  const { w, h } = WIDE_FRAME;
  const round4 = (n) => Math.round(n * 10000) / 10000;
  return { x: round4(r.x / w), y: round4(r.y / h), w: round4(r.w / w), h: round4(r.h / h) };
};
// Vùng của khung thử: các ô ảnh (ảnh 1, 2…) và ô ngày in.
export const testFrameRegions = (design) => [
  ...design.photos.map((r, i) => ({ ...fraction(r), kind: "photo", photo: i + 1 })),
  { ...fraction(design.date), kind: "date" },
];

function text(ctx, { text, x, y, size }, font, color, { weight = 400, spacing = 0 } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (spacing && "letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export async function drawTestFrame(design) {
  // Font viết tay / ký hiệu tải theo ký tự cần dùng: phải tải xong mới vẽ lên canvas được.
  if (globalThis.document?.fonts) {
    await Promise.all([
      document.fonts.load(`${design.script.size}px ${SCRIPT}`, design.script.text),
      ...design.hearts.map((mark) => document.fonts.load(`${mark.size}px ${SYMBOL}`, mark.text.replace(/\s/g, ""))),
      document.fonts.load(`600 ${design.caption.size}px ${SANS}`, design.caption.text),
    ]).catch(() => {});
  }
  const { w, h } = WIDE_FRAME;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = design.paper;
  ctx.fillRect(0, 0, w, h);
  // Viền đôi mảnh màu nâu cacao.
  ctx.strokeStyle = "rgb(75 51 42 / 30%)";
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, w - 60, h - 60);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(44, 44, w - 88, h - 88);
  // Ô ảnh màu kem nhạt (ảnh khách phủ lên khi ghép) với viền trắng như ảnh dán.
  for (const r of design.photos) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(r.x - 10, r.y - 10, r.w + 20, r.h + 20);
    ctx.fillStyle = "#efe7de";
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  text(ctx, design.script, SCRIPT, COCOA);
  text(ctx, design.caption, SANS, COCOA, { weight: 600, spacing: 12 });
  for (const mark of design.hearts) text(ctx, mark, SYMBOL, ROSE);
  const data = canvas.toDataURL("image/png");
  canvas.width = canvas.height = 0;
  return data;
}

// Tạo các khung thử còn thiếu (khung cùng tên đang bật thì giữ nguyên). Trả về tên các khung đã tạo.
export async function createTestFrames() {
  const frames = await api("/admin/frames");
  const have = new Set(frames.filter((f) => f.active !== false).map((f) => f.name));
  const made = [];
  for (const design of TEST_FRAMES) {
    if (have.has(design.name)) continue;
    await api("/admin/frames", {
      method: "POST",
      body: {
        name: design.name,
        themeName: "",
        // Thứ tự 0: khách thấy khung thử đầu tiên, trước khung trắng.
        order: 0,
        printSize: "instax",
        image: await drawTestFrame(design),
        slots: testFrameRegions(design),
        sheet: false,
        dateColor: COCOA,
        shots: 0,
        active: true,
      },
    });
    made.push(design.name);
  }
  return made;
}

export async function createSampleLayouts(packages) {
  const frames = await api("/admin/frames");
  const missing = missingSamples(packages, frames);
  for (const count of missing.frames)
    await api("/admin/frames", {
      method: "POST",
      body: {
        name: `Khung trắng ${count} ảnh`,
        themeName: "",
        order: count,
        printSize: "instax",
        image: whiteFrame(count),
        slots: layoutRegions(count),
        sheet: false,
        shots: 0,
        active: true,
      },
    });
  for (const count of missing.layouts)
    await api("/admin/packages", {
      method: "POST",
      body: {
        name: polaroidLayout(count).label,
        description: "",
        price: SAMPLE_PRICE,
        duration: polaroidLayout(count).duration,
        shots: 0,
        selectCount: count,
        printSize: "instax",
        prints: 1,
        branches: [],
        active: true,
      },
    });
  return missing;
}
