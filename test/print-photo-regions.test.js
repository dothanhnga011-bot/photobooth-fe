// Vị trí các ô ảnh trên tờ in DNP mà máy chụp gửi cho bộ in (làm nét đủ phần ảnh, chữ / khung một nửa).
import test from "node:test";
import assert from "node:assert/strict";
// compose.js mở hàng chờ ảnh (IndexedDB) khi nạp; trong Node chỉ cần một bản giả không làm gì.
globalThis.indexedDB ??= { open: () => ({}) };
const { printPhotoRegions } = await import("../src/kiosk/compose.js");

const canvas = (width, height) => ({ width, height });
const slots = [
  { x: 0.05, y: 0.05, w: 0.9, h: 0.42, kind: "photo", photo: 1 },
  { x: 0.05, y: 0.53, w: 0.9, h: 0.42, kind: "photo", photo: 2 },
];

test("a full-sheet frame sends its own photo slots", () => {
  assert.deepEqual(printPhotoRegions({ printSize: "full", slots }, canvas(1200, 1800)), [
    [0.05, 0.05, 0.9, 0.42], [0.05, 0.53, 0.9, 0.42],
  ]);
});

test("a single-strip frame prints two strips per sheet, so each slot appears on the left and right half", () => {
  const strip = [{ x: 0.1, y: 0.05, w: 0.8, h: 0.2, kind: "photo", photo: 1 }];
  assert.deepEqual(printPhotoRegions({ printSize: "strip", slots: strip }, canvas(600, 1800)), [
    [0.05, 0.05, 0.4, 0.2], [0.55, 0.05, 0.4, 0.2],
  ]);
});

test("regions stay inside the sheet and are capped at 40", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ x: 0.9, y: (i % 10) / 10, w: 0.2, h: 0.05, kind: "photo", photo: i + 1 }));
  const regions = printPhotoRegions({ printSize: "full", slots: many }, canvas(1200, 1800));
  assert.equal(regions.length, 40);
  assert.ok(regions.every(([x, y, w, h]) => x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9 && w > 0 && h > 0));
});
