import { fetchMediaBlob, storageLink } from "../../media-delivery.js";
import { loadFaceLandmarker, scoreFaces } from "../../beauty.js";
import { photoUrl } from "../photo-thumb.jsx";

// Chấm một ảnh của album cho gợi ý ảnh đẹp, trên ảnh nhỏ 640 px của thư viện (trình duyệt thường đã tải sẵn khi
// hiện lưới ảnh). Tách hai bước để tải trước vài ảnh trong lúc chấm ảnh đang có (use-photo-suggestions.js):
// loadPhoto (mạng + giải mã) rồi scoreLoaded (nhận diện mặt + đo ảnh, chạy trên máy).

// Tải sẵn bộ nhận diện trong lúc tải các ảnh đầu tiên.
export const warmScorer = () => loadFaceLandmarker().catch(() => {});

export async function loadPhoto(token, photo, signal) {
  const blob = await fetchMediaBlob(photoUrl(token, photo.id, "thumbnail"), {
    signal, link: storageLink(photo, "thumbnail"),
  });
  return createImageBitmap(blob);
}

// Một canvas nhỏ dùng lại cho mọi phép đo (không tạo canvas mới cho từng ảnh).
let canvas;
function context(width, height) {
  canvas ??= typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", { willReadFrequently: true });
}
const luma = (data, i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

// Độ nét vùng mặt: phương sai Laplace trên mặt thu về 96 × 96 (ảnh rung tay / lệch nét cho số nhỏ hẳn so với các
// ảnh khác cùng buổi chụp, cùng ánh sáng).
const SHARP_EDGE = 96;
export function faceSharpness(bitmap, box) {
  if (!box) return null;
  const pad = 0.08;
  const x0 = Math.max(0, box.x0 - pad * (box.x1 - box.x0)) * bitmap.width;
  const y0 = Math.max(0, box.y0 - pad * (box.y1 - box.y0)) * bitmap.height;
  const x1 = Math.min(1, box.x1 + pad * (box.x1 - box.x0)) * bitmap.width;
  const y1 = Math.min(1, box.y1 + pad * (box.y1 - box.y0)) * bitmap.height;
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const ctx = context(SHARP_EDGE, SHARP_EDGE);
  ctx.drawImage(bitmap, x0, y0, x1 - x0, y1 - y0, 0, 0, SHARP_EDGE, SHARP_EDGE);
  const { data } = ctx.getImageData(0, 0, SHARP_EDGE, SHARP_EDGE);
  const g = new Float32Array(SHARP_EDGE * SHARP_EDGE);
  for (let p = 0; p < g.length; p++) g[p] = luma(data, p * 4);
  let sum = 0, squares = 0, count = 0;
  for (let y = 1; y < SHARP_EDGE - 1; y++)
    for (let x = 1; x < SHARP_EDGE - 1; x++) {
      const p = y * SHARP_EDGE + x;
      const lap = 4 * g[p] - g[p - 1] - g[p + 1] - g[p - SHARP_EDGE] - g[p + SHARP_EDGE];
      sum += lap; squares += lap * lap; count++;
    }
  const mean = sum / count;
  return Math.round((squares / count - mean * mean) * 10) / 10;
}

// Dấu vân ảnh 64 bit (dHash 9 × 8 xám, 16 chữ số hex): hai ảnh gần như giống hệt (chụp liên tiếp, cùng dáng)
// chỉ khác nhau vài bit.
export function pictureHash(bitmap) {
  const ctx = context(9, 8);
  ctx.drawImage(bitmap, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  let hex = "";
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) {
      const i = (y * 9 + x) * 4;
      byte = (byte << 1) | (luma(data, i) > luma(data, i + 4) ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// Mặt chạm mép ảnh: bị cắt (khách đứng sát mép khung).
const EDGE = 0.01;
const cutAtEdge = (box) => Boolean(box) && (box.x0 < EDGE || box.y0 < EDGE || box.x1 > 1 - EDGE || box.y1 > 1 - EDGE);

// → { faces: [{ blink, smile, facing, cut, sharp }], hash }
export async function scoreLoaded(bitmap) {
  const faces = await scoreFaces(bitmap);
  return {
    faces: faces.map((face) => ({
      blink: face.blink, smile: face.smile, facing: face.facing,
      cut: cutAtEdge(face.box), sharp: faceSharpness(bitmap, face.box),
    })),
    hash: pictureHash(bitmap),
  };
}
