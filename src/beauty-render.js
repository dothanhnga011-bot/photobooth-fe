// Pixel rendering shared by the page and image worker; no detector/model imports.
import { createImageCanvas } from "./image-canvas.js";
import {
  featherSkinRegion,
  retouchSkin,
  skinColorWeight,
} from "./skin-retouch.js";

export const DEFAULT_ADJUST = {
  smooth: 0,
  whiten: 0,
  blush: 0,
  slim: 0,
  filter: "original",
};
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
export const ADJUST_LABELS = {
  smooth: "Mịn da",
  whiten: "Trắng da",
  slim: "Thon mặt (V-Line)",
  blush: "Má hồng",
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
export const isNeutral = (a) =>
  !a ||
  (Object.keys(ADJUST_LABELS).every((k) => !a[k]) &&
    (!a.filter || a.filter === "original"));

// Chỉ số điểm mốc trên lưới 478 điểm của MediaPipe.
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
];
const LEFT_EYE = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
];
const RIGHT_EYE = [
  263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388,
  466,
];
const LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const RIGHT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const LIPS = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37,
  39, 40, 185,
];
// Đường viền hàm hai bên, kèm trọng số đẩy vào trong (hàm dưới đẩy nhiều hơn).
const JAW = [
  [132, 361, 0.018],
  [58, 288, 0.028],
  [172, 397, 0.038],
  [136, 365, 0.045],
  [150, 379, 0.045],
  [149, 378, 0.036],
  [176, 400, 0.024],
];

const faceWidth = (f) => Math.hypot(f[454].x - f[234].x, f[454].y - f[234].y);

function tracePath(ctx, face, indices, scale = 1) {
  const cx = indices.reduce((n, i) => n + face[i].x, 0) / indices.length;
  const cy = indices.reduce((n, i) => n + face[i].y, 0) / indices.length;
  ctx.beginPath();
  indices.forEach((i, k) => {
    const x = cx + (face[i].x - cx) * scale,
      y = cy + (face[i].y - cy) * scale;
    if (k) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
}

// Gộp các điểm kéo hàm thành một trường dịch chuyển rồi lấy mẫu ảnh gốc một lần.
// Chuẩn hóa vùng giao nhau để nhiều điểm gần nhau không cộng dồn làm méo mặt.
function warpJaw(data, w, h, controls, r) {
  const maximumMove = Math.max(...controls.map((p) => Math.hypot(p.dx, p.dy)));
  const pad = Math.ceil(maximumMove) + 1;
  const x0 = Math.max(
      0,
      Math.floor(Math.min(...controls.map((p) => p.x)) - r - pad),
    ),
    x1 = Math.min(
      w - 1,
      Math.ceil(Math.max(...controls.map((p) => p.x)) + r + pad),
    );
  const y0 = Math.max(
      0,
      Math.floor(Math.min(...controls.map((p) => p.y)) - r - pad),
    ),
    y1 = Math.min(
      h - 1,
      Math.ceil(Math.max(...controls.map((p) => p.y)) + r + pad),
    );
  // Viền hàm có thể nằm ngoài ảnh cận mặt: bỏ vùng không giao với bitmap.
  if (x1 < x0 || y1 < y0) return;
  const bw = x1 - x0 + 1;
  const copy = new Uint8ClampedArray((y1 - y0 + 1) * bw * 4);
  for (let y = y0; y <= y1; y++)
    copy.set(
      data.subarray((y * w + x0) * 4, (y * w + x1 + 1) * 4),
      (y - y0) * bw * 4,
    );
  const sample = (x, y, c) => copy[((y - y0) * bw + (x - x0)) * 4 + c];
  const weights = new Float32Array(bw),
    displacementX = new Float32Array(bw),
    displacementY = new Float32Array(bw);
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    weights.fill(0);
    displacementX.fill(0);
    displacementY.fill(0);
    for (const p of controls) {
      const dy2 = (y - p.y) ** 2;
      if (dy2 >= r2) continue;
      const halfWidth = Math.sqrt(r2 - dy2);
      const start = Math.max(x0, Math.ceil(p.x - halfWidth)),
        end = Math.min(x1, Math.floor(p.x + halfWidth));
      for (let x = start; x <= end; x++) {
        // Kernel bằng 0 và có độ dốc bằng 0 ở biên, tránh nếp gợn quanh vùng kéo.
        const weight = Math.max(0, 1 - ((x - p.x) ** 2 + dy2) / r2) ** 2;
        const index = x - x0;
        weights[index] += weight;
        displacementX[index] += p.dx * weight;
        displacementY[index] += p.dy * weight;
      }
    }
    for (let x = x0; x <= x1; x++) {
      const index = x - x0;
      if (!weights[index]) continue;
      const divisor = Math.max(1, weights[index]);
      const ux = Math.min(x1, Math.max(x0, x - displacementX[index] / divisor)),
        uy = Math.min(y1, Math.max(y0, y - displacementY[index] / divisor));
      const ix = Math.floor(ux),
        iy = Math.floor(uy);
      const nextX = Math.min(x1, ix + 1),
        nextY = Math.min(y1, iy + 1);
      const fx = ux - ix,
        fy = uy - iy;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++)
        data[o + c] =
          (sample(ix, iy, c) * (1 - fx) + sample(nextX, iy, c) * fx) *
            (1 - fy) +
          (sample(ix, nextY, c) * (1 - fx) + sample(nextX, nextY, c) * fx) * fy;
    }
  }
}

function slimFaces(data, w, h, faces, amount) {
  amount = Math.max(0, Math.min(1, amount));
  for (const f of faces) {
    const fw = faceWidth(f);
    if (!Number.isFinite(fw) || fw <= 0) continue;
    // Trục giữa mặt: từ sống mũi (168) xuống cằm (152).
    const ax = f[168].x,
      ay = f[168].y,
      bx = f[152].x,
      by = f[152].y;
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const controls = [];
    for (const [left, right, weight] of JAW)
      for (const i of [left, right]) {
        const p = f[i];
        const t = ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / len2;
        const qx = ax + t * (bx - ax),
          qy = ay + t * (by - ay);
        const dist = Math.hypot(qx - p.x, qy - p.y) || 1;
        const move = Math.min(dist * 0.5, fw * weight * amount * 1.6);
        if (move > 0)
          controls.push({
            x: p.x,
            y: p.y,
            dx: ((qx - p.x) / dist) * move,
            dy: ((qy - p.y) / dist) * move,
          });
      }
    if (controls.length) warpJaw(data, w, h, controls, fw * 0.22);
  }
}

// Mặt nạ da 0–1: màu da (YCbCr) giao với vùng mặt, trừ mắt, lông mày, môi.
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

// Áp dụng chỉnh sửa lên ảnh nguồn; trả về canvas mới cùng kích thước.
export function applyBeauty(source, faces, adjust) {
  const w = source.width,
    h = source.height;
  const out = createImageCanvas(w, h);
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const a = { ...DEFAULT_ADJUST, ...adjust };
  if (isNeutral(a)) return out;
  faces = faces || [];
  if (faces.length && (a.slim > 0 || a.smooth > 0 || a.whiten > 0)) {
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    if (a.slim > 0) slimFaces(data, w, h, faces, a.slim / 100);
    if (a.smooth > 0 || a.whiten > 0) {
      const mask = skinMask(data, w, h, faces);
      retouchSkin(data, w, h, mask, a, faceWidth(faces[0]));
    }
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
