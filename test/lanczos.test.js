import assert from "node:assert/strict";
import { test } from "node:test";
import { lanczosResample, slotMapping, sourceWindow } from "../src/kiosk/lanczos.js";

// Ảnh xám RGBA w × h: value(x, y) 0–255.
const image = (w, h, value) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    px[o] = px[o + 1] = px[o + 2] = value(x, y);
    px[o + 3] = 255;
  }
  return px;
};
const row = (px, w, y) => Array.from({ length: w }, (_, x) => px[(y * w + x) * 4 + 1]);
// Biên độ sọc tần số f (chu kỳ / điểm) trên một hàng, chia cho biên độ gốc.
const contrast = (values, f, amplitude) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let re = 0, im = 0;
  values.forEach((v, x) => { re += (v - mean) * Math.cos(2 * Math.PI * f * x); im -= (v - mean) * Math.sin(2 * Math.PI * f * x); });
  return (2 / values.length) * Math.hypot(re, im) / amplitude;
};

test("same size and whole source: Lanczos3 returns the picture unchanged", () => {
  const src = image(37, 23, (x, y) => (x * 7 + y * 13) % 256);
  const out = lanczosResample(src, 37, 23, 37, 23);
  for (let i = 0; i < src.length; i++) assert.ok(Math.abs(out[i] - src[i]) <= 1, `pixel byte ${i}`);
});

test("a 26 MP photo shrunk into a print slot keeps fine detail (≥ 80 % at 0.4 cycles per print dot)", () => {
  // Hàng ảnh gốc 6240 điểm, sọc đúng 0,4 chu kỳ / điểm sau khi co về 1920 (Lanczos3 thẳng, không gộp).
  const W = 6240, H = 12, OUT = 1920, f = 0.4;
  const fs = f * OUT / W;
  const src = image(W, H, (x) => Math.round(128 + 100 * Math.sin(2 * Math.PI * fs * x)));
  const out = lanczosResample(src, W, H, OUT, 4);
  const kept = contrast(row(out, OUT, 2).slice(20, OUT - 20), f, 100);
  assert.ok(kept >= 0.8, `kept ${kept.toFixed(3)}`);
  const out2 = lanczosResample(src, W, H, 2400, 4);
  assert.ok(contrast(row(out2, 2400, 2).slice(20, 2380), fs * W / 2400, 100) >= 0.9);
});

test("a fractional source window lands exactly: an edge at source x = 100 maps to output x = (100 - start) / scale", () => {
  const src = image(400, 8, (x) => (x < 100 ? 0 : 200));
  // Vùng nguồn bắt đầu ở 40,5, rộng 200 → 100 điểm (tỉ lệ 2): mép ở (100 - 40,5) / 2 = 29,75.
  const out = lanczosResample(src, 400, 8, 100, 4, { x: 40.5, y: 0, w: 200, h: 8 });
  const values = row(out, 100, 2);
  // Điểm i phủ nguồn [40,5 + 2i, 42,5 + 2i): điểm 29 còn tối (bên trái mép), điểm 30 đã sáng.
  assert.ok(values[28] < 30 && values[31] > 170, JSON.stringify(values.slice(26, 34)));
  const crossing = values.findIndex((v) => v >= 100);
  assert.ok(crossing === 29 || crossing === 30, `crossing at ${crossing}`);
});

test("slot mapping: a covering photo fills the whole slot; a shrunk one only the dots it fully covers", () => {
  const canvas = { width: 2400, height: 3600 };
  const rect = { x: 239, y: 299, w: 1924, h: 1284 };
  const photo = { width: 6240, height: 4160 };
  const scale = Math.max(rect.w / photo.width, rect.h / photo.height);
  const left = rect.x + rect.w / 2 - (photo.width * scale) / 2, top = rect.y + rect.h / 2 - (photo.height * scale) / 2;
  const cover = slotMapping(photo, rect, scale, left, top, canvas);
  assert.deepEqual(cover.dest, rect);
  assert.ok(Math.abs(cover.src.x - (rect.x - left) / scale) < 1e-9);
  assert.ok(Math.abs(cover.src.w * scale - rect.w) < 1e-9);
  // Thu nhỏ 50 %: ảnh nằm giữa ô, mép ảnh ở toạ độ lẻ → chỉ các điểm phủ kín.
  const half = scale * 0.5;
  const l2 = rect.x + rect.w / 2 - (photo.width * half) / 2, t2 = rect.y + rect.h / 2 - (photo.height * half) / 2;
  const shrunk = slotMapping(photo, rect, half, l2, t2, canvas);
  assert.equal(shrunk.dest.x, Math.ceil(l2));
  assert.equal(shrunk.dest.x + shrunk.dest.w, Math.floor(l2 + photo.width * half));
  // Ô chạm mép tờ (x = -1): không ghi ra ngoài canvas.
  const edge = slotMapping(photo, { x: -1, y: -1, w: 600, h: 400 }, 0.1, -1, -1, canvas);
  assert.deepEqual([edge.dest.x, edge.dest.y], [0, 0]);
});

test("only the visible part of the source is read, with room for the filter", () => {
  const win = sourceWindow({ x: 1000.4, y: 50, w: 3000, h: 2000 }, { width: 1000, height: 667 }, 6240, 4160);
  // Vùng ảnh hưởng 3 × 3 + 2 = 11 điểm: x 989 … 4012, y 39 … 2061.
  assert.deepEqual(win, { x: 989, y: 39, w: 3023, h: 2022 });
  assert.deepEqual(sourceWindow({ x: 0, y: 0, w: 6240, h: 4160 }, { width: 6240, height: 4160 }, 6240, 4160),
    { x: 0, y: 0, w: 6240, h: 4160 });
});
