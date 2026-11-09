import assert from "node:assert/strict";
import { test } from "node:test";
import { filterRegion } from "../src/color-filters.js";
import {
  STICKER_SCALE,
  clampScale,
  filterChoices,
  filterPhotos,
  filterStepsFor,
  photoAt,
  photoFilterId,
  placedStickers,
  stickerArea,
} from "../src/kiosk/decor.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("colour choices: original first, then the shop's active filters, then enabled built-ins", () => {
  const settings = {
    enabledFilters: ["original", "mono", "warm"],
    customFilters: [
      { id: "abc12345", name: "Trắng hồng", brightness: 110, contrast: 100, saturate: 90, sepia: 0, hueRotate: 0, active: true },
      { id: "off00000", name: "Đang tắt", brightness: 120, contrast: 100, saturate: 100, sepia: 0, hueRotate: 0, active: false },
    ],
  };
  const choices = filterChoices(settings);
  assert.deepEqual(choices.map((c) => c.id), ["original", "custom:abc12345", "warm", "mono"]);
  assert.deepEqual(choices.map((c) => c.label), ["Gốc", "Trắng hồng", "Ấm", "Trắng đen"]);
  assert.equal(choices[0].steps, null);
  assert.equal(choices[0].css, "none");
  assert.deepEqual(choices[1].steps, [["brightness", 1.1], ["saturate", 0.9]]);
  assert.equal(choices[1].css, "brightness(1.1) saturate(0.9)");
  assert.deepEqual(filterStepsFor("mono", settings), [["saturate", 0]]);
  // Không cấu hình gì: mọi bộ lọc có sẵn.
  assert.equal(filterChoices({}).length, 7);
});

test("a colour the shop turned off or deleted after the guest chose it prints as the original", () => {
  assert.equal(filterStepsFor("mono", { enabledFilters: ["original", "warm"] }), null);
  assert.equal(filterStepsFor("custom:gone0000", { customFilters: [] }), null);
  assert.equal(filterStepsFor("original", {}), null);
  assert.equal(filterStepsFor(undefined, {}), null);
  // Filter tự tạo để nguyên mọi chỉ số: không đổi màu.
  const neutral = { id: "same0000", name: "Như gốc", brightness: 100, contrast: 100, saturate: 100, sepia: 0, hueRotate: 0 };
  assert.equal(filterStepsFor("custom:same0000", { customFilters: [neutral] }), null);
});

// Canvas giả: một ảnh RGBA nhỏ, đọc / ghi từng vùng như CanvasRenderingContext2D.
function fakeContext(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(color, i);
  return {
    canvas: { width, height },
    data,
    getImageData(x, y, w, h) {
      assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height, "đọc ngoài canvas");
      const out = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++)
        out.set(data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
      return { data: out, width: w, height: h };
    },
    putImageData(image, x, y) {
      for (let row = 0; row < image.height; row++)
        data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y + row) * width + x) * 4);
    },
  };
}

test("the colour filter only changes the photo area and stays inside the canvas", () => {
  const ctx = fakeContext(10, 8, [220, 30, 30, 255]);
  // Ô nới ra ngoài mép (slotRect nới 1 px): chỉ xử lý phần nằm trong canvas.
  filterRegion(ctx, -1, 2, 6, 20, [["saturate", 0]]);
  const at = (x, y) => [...ctx.data.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 3)];
  const gray = at(0, 2);
  assert.ok(gray.every((v) => Math.abs(v - 70) <= 1), `trắng đen: ${gray}`);
  assert.deepEqual(at(4, 7), gray);
  assert.deepEqual(at(5, 2), [220, 30, 30]);
  assert.deepEqual(at(0, 1), [220, 30, 30]);
  // Không có công thức màu: giữ nguyên.
  const untouched = fakeContext(4, 4, [10, 20, 30, 255]);
  filterRegion(untouched, 0, 0, 4, 4, null);
  assert.deepEqual([...untouched.data.subarray(0, 3)], [10, 20, 30]);
});

const photo = (x, y, number, w = 0.4, h = 0.2) => ({ x, y, w, h, kind: "photo", photo: number });

test("twin strips on one sheet: a sticker goes where the guest puts it, without a copy on the other strip", () => {
  // Khách tự dán từng nhãn (muốn có ở dải kia thì dán thêm một nhãn): vùng đặt là cả khung.
  const frame = { slots: [photo(0.05, 0.05, 1), photo(0.05, 0.3, 2), photo(0.55, 0.05, 1), photo(0.55, 0.3, 2)] };
  const area = stickerArea(frame);
  assert.deepEqual(area, { x: 0, y: 0, w: 1, h: 1, shift: null });
  const placed = placedStickers([{ id: "a", text: "⭐", u: 0.25, v: 0.25, scale: 0.2 }], area);
  assert.equal(placed.length, 1);
  near(placed[0].x, 0.25);
  near(placed[0].y, 0.25);
  assert.equal(placed[0].text, "⭐");
});

test("ordinary frames use the whole frame; uneven or partial copies are not mirrored", () => {
  const whole = { x: 0, y: 0, w: 1, h: 1, shift: null };
  assert.deepEqual(stickerArea({ slots: [photo(0.1, 0.1, 1, 0.8, 0.4), photo(0.1, 0.5, 2, 0.8, 0.4)] }), whole);
  // Chỉ một ô có bản sao.
  assert.deepEqual(stickerArea({ slots: [photo(0.05, 0.05, 1), photo(0.05, 0.3, 2), photo(0.55, 0.05, 1)] }), whole);
  // Bản sao lệch không đều nhau.
  assert.deepEqual(stickerArea({ slots: [photo(0.05, 0.05, 1), photo(0.05, 0.3, 2), photo(0.55, 0.05, 1), photo(0.6, 0.6, 2)] }), whole);
  const [image] = placedStickers([{ id: "b", src: "/api/stickers/1/image", u: 0.25, v: 0.75, scale: 0.2 }], whole);
  // Ảnh nhãn dán cao size × 1,6 (theo khung rộng 1200 px) = 20 % bề rộng khung.
  near((image.size * 1.6) / 1200, 0.2);
  near(image.x, 0.25);
  near(image.y, 0.75);
  assert.equal(image.src, "/api/stickers/1/image");
});

test("stacked strips (one above the other) do not repeat stickers either", () => {
  const frame = { slots: [photo(0.05, 0.05, 1, 0.25, 0.4), photo(0.4, 0.05, 2, 0.25, 0.4), photo(0.05, 0.55, 1, 0.25, 0.4), photo(0.4, 0.55, 2, 0.25, 0.4)] };
  const area = stickerArea(frame);
  assert.deepEqual(area, { x: 0, y: 0, w: 1, h: 1, shift: null });
  assert.equal(placedStickers([{ id: "c", text: "✨", u: 0.5, v: 0.5, scale: 0.1 }], area).length, 1);
});

test("sticker sizes stay between the smallest and largest step", () => {
  assert.equal(clampScale(5), STICKER_SCALE.max);
  assert.equal(clampScale(0.001), STICKER_SCALE.min);
  assert.equal(clampScale(undefined), STICKER_SCALE.initial);
  assert.equal(clampScale(0.3), 0.3);
});

test("each photo keeps its own colour, also in its twin-strip copy; a tap finds the photo", () => {
  const frame = { slots: [photo(0, 0, 1, 0.5, 0.5), photo(0, 0.5, 2, 0.5, 0.5), photo(0.5, 0, 1, 0.5, 0.5), photo(0.5, 0.5, 2, 0.5, 0.5)] };
  const ctx = fakeContext(20, 20, [220, 30, 30, 255]);
  // Ảnh 1 giữ màu gốc, ảnh 2 trắng đen.
  filterPhotos(ctx, frame, [null, [["saturate", 0]]], 20, 20);
  const at = (x, y) => [...ctx.data.subarray((y * 20 + x) * 4, (y * 20 + x) * 4 + 3)];
  assert.deepEqual(at(3, 3), [220, 30, 30]);
  assert.deepEqual(at(15, 3), [220, 30, 30], "the copy of photo 1 stays original");
  assert.ok(at(3, 15).every((v) => Math.abs(v - 70) <= 1), `photo 2: ${at(3, 15)}`);
  assert.ok(at(15, 15).every((v) => Math.abs(v - 70) <= 1), `copy of photo 2: ${at(15, 15)}`);
  assert.equal(photoAt(frame, 0.25, 0.25), 0);
  assert.equal(photoAt(frame, 0.75, 0.75), 1, "a tap on the copy picks the same photo");
  assert.equal(photoAt({ slots: [photo(0.1, 0.1, 1, 0.3, 0.3)] }, 0.9, 0.9), -1);
  // Màu riêng của một tấm đè màu chung; tấm khác theo màu chung.
  const decor = { filter: "warm", photoFilters: { b: "mono" } };
  assert.equal(photoFilterId(decor, "b"), "mono");
  assert.equal(photoFilterId(decor, "a"), "warm");
  assert.equal(photoFilterId(undefined, "a"), "original");
});
