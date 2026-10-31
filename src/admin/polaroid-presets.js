import { api } from "../api";
import { frameCapacity } from "../frame-utils";
import { LAYOUT_COUNTS, WIDE_FRAME, layoutSlots } from "../polaroid-layouts.js";

// Bộ layout mẫu của phòng Polaroid (Khổ ảnh & bảng giá → Polaroid → "Tạo layout mẫu"): 1, 2, 3, 4,
// 5 (2 to + 3 bé), 6 ảnh, mỗi layout một gói khổ Instax và một khung trắng Instax Wide đúng số ô.
export const SAMPLE_THEME = "Layout trắng";
const SAMPLE_PRICE = 110000;

// Khung trắng 1800 × 1200: nền trắng, ô ảnh màu kem nhạt (ảnh của khách phủ lên ô khi ghép).
function whiteFrame(count) {
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

// Số layout / khung mẫu còn thiếu: layout (kể cả đã tắt) hay khung Instax đã có cùng số ảnh thì giữ nguyên.
export function missingSamples(packages, frames) {
  const layouts = new Set(packages.filter((p) => p.printSize === "instax").map((p) => Number(p.selectCount)));
  const framed = new Set(frames.filter((f) => f.printSize === "instax").map(frameCapacity));
  return {
    layouts: LAYOUT_COUNTS.filter((n) => !layouts.has(n)),
    frames: LAYOUT_COUNTS.filter((n) => !framed.has(n)),
  };
}

export async function createSampleLayouts(packages) {
  const [frames, themes] = await Promise.all([api("/admin/frames"), api("/admin/themes")]);
  const missing = missingSamples(packages, frames);
  if (missing.frames.length && !themes.some((t) => t.name === SAMPLE_THEME))
    await api("/admin/themes", { method: "POST", body: { name: SAMPLE_THEME, kind: "polaroid" } });
  for (const count of missing.frames)
    await api("/admin/frames", {
      method: "POST",
      body: {
        name: `Layout ${count} ảnh`,
        themeName: SAMPLE_THEME,
        order: count,
        printSize: "instax",
        image: whiteFrame(count),
        slots: layoutSlots(count).map((s, i) => ({ ...s, kind: "photo", photo: i + 1 })),
        sheet: false,
        shots: count,
        active: true,
      },
    });
  for (const count of missing.layouts)
    await api("/admin/packages", {
      method: "POST",
      body: {
        name: `Layout ${count} ảnh`,
        description: "",
        price: SAMPLE_PRICE,
        duration: 10,
        shots: Math.max(4, count * 2),
        selectCount: count,
        printSize: "instax",
        prints: 2,
        branches: [],
        active: true,
      },
    });
  return missing;
}
