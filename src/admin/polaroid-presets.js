import { api } from "../api";
import { frameCapacity } from "../frame-utils";
import { LAYOUT_COUNTS, WIDE_FRAME, layoutSlots } from "../polaroid-layouts.js";

// Layout mẫu của phòng Polaroid (Khổ ảnh & bảng giá → Polaroid → "Tạo layout mẫu"): 1 ảnh to và 2 ảnh
// dọc chia đôi, mỗi layout một gói khổ Instax (100.000 đ, 8 lần bấm dây) và một
// khung trắng Instax Wide đúng số ô. Khung Polaroid không thuộc chủ đề nào.
export const SAMPLE_PRICE = 100000;
export const SAMPLE_SHOTS = 8;

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
        name: count === 1 ? "1 ảnh to" : `${count} ảnh`,
        description: "",
        price: SAMPLE_PRICE,
        duration: 5,
        shots: SAMPLE_SHOTS,
        selectCount: count,
        printSize: "instax",
        prints: 1,
        branches: [],
        active: true,
      },
    });
  return missing;
}
