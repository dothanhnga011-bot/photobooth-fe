import { loadFrameImage } from "./frame-utils.js";
import { detectSlots } from "./frame-detect.js";
import { quarterTurnRegions } from "./frame-regions.js";

// Khung in đúng khổ tờ 20 × 30 cm ở 300 dpi (3600 px cạnh dài): giữ đủ nét cho viền và chữ.
// Một khung PNG cỡ này (hoặc WebP giữ nền trong suốt) thường 1–6 MB.
const MAX_SIDE = 3600;
const MAX_BYTES = 8_000_000;

export function detectFrameSlots(image, limit) {
  const probe = document.createElement("canvas");
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const scale = Math.min(1, 1200 / Math.max(width, height));
  probe.width = Math.max(1, Math.round(width * scale)); probe.height = Math.max(1, Math.round(height * scale));
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, probe.width, probe.height);
  try { return detectSlots(ctx.getImageData(0, 0, probe.width, probe.height), limit); }
  finally { probe.width = probe.height = 0; }
}

// Coordinates and the saved image always share one canvas and one aspect ratio.
// Never flatten transparent PNG/WebP windows into an opaque JPEG.
export async function prepareFrame(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadFrameImage(url);
    const scale = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(im.naturalWidth * scale);
    canvas.height = Math.round(im.naturalHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
    try {
      return { image: encodeFrameCanvas(canvas, file.type === "image/png"), slots: detectFrameSlots(canvas) };
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeFrameCanvas(canvas, preferPng) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 255) { transparent = true; break; }
    }
    let image = canvas.toDataURL(transparent || preferPng ? "image/png" : "image/jpeg", .92);
    if (image.length > MAX_BYTES && !transparent) image = canvas.toDataURL("image/jpeg", .88);
    // A detailed transparent design is often too large as PNG. WebP keeps its transparency
    // exact (the alpha channel is stored losslessly) at a fraction of the size, with colors at
    // a quality that does not show on a 20 × 30 cm print.
    if (image.length > MAX_BYTES && transparent) for (const quality of [.95, .9, .85]) {
      const webp = canvas.toDataURL("image/webp", quality);
      if (!webp.startsWith("data:image/webp")) break; // this browser cannot write WebP
      image = webp;
      if (image.length <= MAX_BYTES) break;
    }
    if (image.length > MAX_BYTES) throw new Error(transparent
      ? "PNG khung quá lớn để lưu mà giữ nền trong suốt. Hãy tối ưu dung lượng PNG rồi thử lại."
      : "Ảnh khung quá lớn. Hãy xuất ảnh nhẹ hơn rồi thử lại.");
    return image;
}

export async function rotateFrame(image, slots, clockwise = true) {
  const source = await loadFrameImage(image);
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalHeight; canvas.height = source.naturalWidth;
  const ctx = canvas.getContext("2d");
  ctx.translate(clockwise ? canvas.width : 0, clockwise ? 0 : canvas.height);
  ctx.rotate(clockwise ? Math.PI / 2 : -Math.PI / 2);
  ctx.drawImage(source, 0, 0);
  return { image: encodeFrameCanvas(canvas, /^data:image\/(png|webp)/.test(image)),
    slots: quarterTurnRegions(slots, clockwise) };
}
