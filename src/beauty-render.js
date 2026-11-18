// Pixel rendering shared by the page and image worker; no detector/model imports.
import { createImageCanvas } from "./image-canvas.js";
import {
  featherSkinRegion,
  retouchSkin,
  skinColorWeight,
} from "./skin-retouch.js";

import { normalizeAdjust, isNeutral } from './beauty-settings.js';
import { FACE_OVAL, LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS, faceWidth, faceCrop, tracePath } from './face-regions.js';
import { warpFaces } from './face-warp.js';
import { applyMakeup } from './face-makeup.js';
export { DEFAULT_ADJUST, ADJUST_LABELS, isNeutral } from './beauty-settings.js';

export const COLOR_FILTERS = {
  original: "Gốc",
  soft: "Dịu",
  warm: "Ấm",
  film: "Film",
  mono: "Đen trắng",
  vintage: "Cổ điển",
};
// Dùng cho ảnh xem trước (CSS). Ảnh xuất ra tính bằng pixel (FILTER_STEPS) vì
// Safari trên iPhone đời cũ bỏ qua ctx.filter của canvas.
export const FILTER_CSS = {
  soft: "contrast(.92) brightness(1.08) saturate(.9)",
  warm: "sepia(.22) saturate(1.18)",
  film: "contrast(1.12) saturate(.8) sepia(.12)",
  mono: "grayscale(1)",
  vintage: "sepia(.4) contrast(.9)",
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
};
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
function skinMask(data, w, h, faces) {
  if (!faces.length) return new Float32Array(w * h);
  let region = null;
  if (faces.length) {
    const c = createImageCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    for (const f of faces) {
      tracePath(ctx, f, FACE_OVAL, 1);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "destination-out";
    for (const f of faces)
      for (const [part, scale] of [
        [LEFT_EYE, 1.5],
        [RIGHT_EYE, 1.5],
        [LEFT_BROW, 1.25],
        [RIGHT_BROW, 1.25],
        [LIPS, 1.12],
      ]) {
        tracePath(ctx, f, part, scale);
        ctx.fill();
      }
    const alpha = ctx.getImageData(0, 0, w, h).data;
    region = new Float32Array(w * h);
    for (let i = 0; i < region.length; i++) region[i] = alpha[i * 4 + 3] / 255;
    c.width = c.height = 0;
    featherSkinRegion(region, w, h, Math.max(2, faceWidth(faces[0]) * 0.045));
  }
  // Reuse the feathered region as the final mask. At 6240×4160, allocating
  // another full Float32 mask would cost an unnecessary ~104 MB.
  for (let i = 0; i < region.length; i++) {
    const o = i * 4,
      r = data[o],
      g = data[o + 1],
      b = data[o + 2];
    region[i] = skinColorWeight(r, g, b) * region[i];
  }
  return region;
}

function retouchFace(ctx, w, h, faces, a) {
  if (faces.length && (a.smooth > 0 || a.whiten > 0 || a.darkCircles > 0 || a.lips > 0)) {
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    if (a.smooth > 0 || a.whiten > 0) {
      const mask = skinMask(data, w, h, faces);
      retouchSkin(data, w, h, mask, a, faceWidth(faces[0]));
    }
    applyMakeup(data, w, h, faces, a);
    ctx.putImageData(img, 0, 0);
  }
  if (a.blush > 0 && faces.length) {
    const alpha = (a.blush / 100) * 0.34;
    for (const f of faces) {
      const fw = faceWidth(f);
      ctx.save();
      tracePath(ctx, f, FACE_OVAL, 1);
      ctx.clip();
      // Gò má: giữa điểm xương gò má và khóe mũi, hạ thấp một chút.
      for (const [cheek, nose] of [
        [50, 129],
        [280, 358],
      ]) {
        const x = f[cheek].x * 0.8 + f[nose].x * 0.2,
          y = f[cheek].y * 0.85 + f[nose].y * 0.15 + fw * 0.02;
        const r = fw * 0.15;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255, 96, 128, ${alpha})`);
        g.addColorStop(0.55, `rgba(255, 110, 140, ${alpha * 0.45})`);
        g.addColorStop(1, "rgba(255, 120, 150, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.2, r, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  if (faces.length && ['slim', 'eyeSize', 'irisSize', 'nose', 'mouth'].some(key => a[key] > 0)) {
    const img = ctx.getImageData(0, 0, w, h);
    warpFaces(img.data, w, h, faces, a);
    ctx.putImageData(img, 0, 0);
  }
}

// Source pixels stay full-size. Process one face tile at a time, including
// its own skin/feature scale, and retain the existing combined single warp.
export function applyBeauty(source, faces, adjust) {
  const w = source.width, h = source.height, out = createImageCanvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const a = normalizeAdjust(adjust);
  if (isNeutral(a)) return out;
  if (Object.keys(a).some(key => key !== 'filter' && a[key] > 0)) for (const face of faces || []) {
    const crop = faceCrop(face, w, h);
    if (!crop) continue;
    const tile = createImageCanvas(crop.width, crop.height), local = tile.getContext('2d', { willReadFrequently: true });
    try {
      local.drawImage(out, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      const shifted = face.map(p => ({ ...p, x: p.x - crop.x, y: p.y - crop.y }));
      retouchFace(local, crop.width, crop.height, [shifted], a);
      ctx.drawImage(tile, crop.x, crop.y);
    } finally { tile.width = tile.height = 0; }
  }
  if (FILTER_STEPS[a.filter]) {
    // Colour filters are per-pixel operations. Bounded row buffers preserve
    // their exact formula while avoiding another 104 MB RGBA readback.
    for (let y = 0; y < h; y += 256) {
      const pixels = ctx.getImageData(0, y, w, Math.min(256, h - y));
      colorFilter(pixels.data, FILTER_STEPS[a.filter]);
      ctx.putImageData(pixels, 0, y);
    }
  }
  return out;
}
