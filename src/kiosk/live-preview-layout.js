import { previewRotation } from './preview-orientation.js';

// Chỉ cắt/xoay vùng xem HDMI; ảnh JPEG nhận từ máy ảnh không đi qua bước này.
// Máy ảnh xuất kèm thông số (thước phơi sáng, khung lưới) ở các mép hình HDMI: cắt bỏ các mép
// đó. `zoom` (0–0,3) là phần cắt thêm ở mỗi cạnh do nhân viên chỉnh trong Cài đặt máy chụp.
const TOP = 0.08;
const BOTTOM = 0.12;
export const CROP_KEY = "hdmi-crop";
export const DEFAULT_CROP = 0.08;

export const readCrop = () => {
  const value = Number(globalThis.localStorage?.getItem(CROP_KEY));
  return Number.isFinite(value) && value >= 0 && value <= 0.3
    ? value
    : DEFAULT_CROP;
};

// Vùng còn thấy được của khung hình nguồn (tỉ lệ 0–1 theo chiều ngang / dọc).
export function visibleRegion(zoom = 0) {
  const side = Math.max(0, Math.min(0.3, zoom));
  const top = Math.max(TOP, side);
  const bottom = Math.max(BOTTOM, side);
  return { x: side, y: top, w: 1 - side * 2, h: 1 - top - bottom };
}

// fit "cover": phần hình còn thấy phủ kín khung xem (cắt bớt hai bên / trên dưới nếu khác tỉ lệ);
// "contain": thấy đủ phần hình đó, khung xem có thể còn viền đen (màn đứng chia đôi).
export function livePreviewLayout(sourceWidth, sourceHeight, width, height, zoom = 0, fit = "cover", rotation = 0, mirror = false) {
  if (
    ![sourceWidth, sourceHeight, width, height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;

  const region = visibleRegion(zoom);
  const visibleWidth = sourceWidth * region.w;
  const visibleHeight = sourceHeight * region.h;
  const angle = previewRotation(rotation) / 90;
  const cos = [1, 0, -1, 0][angle], sin = [0, 1, 0, -1][angle];
  const turnedWidth = Math.abs(cos) * visibleWidth + Math.abs(sin) * visibleHeight;
  const turnedHeight = Math.abs(sin) * visibleWidth + Math.abs(cos) * visibleHeight;
  const scale = (fit === "contain" ? Math.min : Math.max)(width / turnedWidth, height / turnedHeight);
  // The cropped HDMI centre differs from the sensor centre (unequal top/bottom
  // HUD bands). Rotate that offset too, then mirror horizontally on the screen.
  const dx = sourceWidth * (region.x + region.w / 2 - .5);
  const dy = sourceHeight * (region.y + region.h / 2 - .5);
  const offsetX = (dx * cos - dy * sin) * (mirror ? -1 : 1);
  const offsetY = dx * sin + dy * cos;
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
    left: (width - sourceWidth * scale) / 2 - offsetX * scale,
    top: (height - sourceHeight * scale) / 2 - offsetY * scale,
  };
}

// Che phần mép có thông số (ngoài vùng còn thấy) trên chính thẻ video / canvas — cần khi "contain",
// vì khi đó vùng còn thấy không phủ kín khung xem nên mép video lộ ra trong khung.
export function visibleClip(zoom = 0) {
  const r = visibleRegion(zoom);
  const pct = (n) => `${(n * 100).toFixed(3)}%`;
  return `inset(${pct(r.y)} ${pct(1 - r.x - r.w)} ${pct(1 - r.y - r.h)} ${pct(r.x)})`;
}

