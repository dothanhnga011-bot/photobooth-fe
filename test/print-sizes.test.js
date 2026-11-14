// Phòng Polaroid / Selfbooth in tờ 20 × 30 máy DNP DS820 (khổ "large", từ 14/11); gói / vé Instax cũ vẫn chạy.
import assert from "node:assert/strict";
import test from "node:test";
import { isPolaroidSize, LARGE_SHEET, polaroidPrinter, polaroidUnit, POLAROID_SIZE } from "../src/print-sizes.js";
import { extraPriceFor, isPolaroid, minSheets, pieceUnit, piecesLabel } from "../src/kiosk/print-count.js";
import { frameOutputSize } from "../src/frame-utils.js";
import { polaroidPackage } from "../src/polaroid-layouts.js";

// compose.js mở hàng chờ ảnh (IndexedDB) khi nạp; trong Node chỉ cần một bản giả không làm gì.
globalThis.indexedDB ??= { open: () => ({}) };
const { frameCandidates, frameNeed } = await import("../src/kiosk/compose.js");

test("the Polaroid room prints 20 × 30 sheets on the DS820; old Instax tickets still count as Polaroid", () => {
  assert.equal(POLAROID_SIZE, "large");
  assert.deepEqual(LARGE_SHEET, { w: 2400, h: 3600 });
  assert.deepEqual(["full", "strip", "large", "instax"].map(isPolaroidSize), [false, false, true, true]);
  assert.equal(polaroidUnit("large"), "tờ 20 × 30");
  assert.equal(polaroidUnit("instax"), "tấm Instax");
  assert.match(polaroidPrinter("large"), /DS820/);
});

test("a 20 × 30 package is timed like Selfbooth: at least 1 sheet, the Polaroid extra price, counted in 20 × 30 sheets", () => {
  const pack = { printSize: "large", prints: 0, duration: 7, shots: 9, price: 100000 };
  assert.equal(isPolaroid(pack), true);
  assert.equal(minSheets(pack), 1, "one 20 × 30 sheet, not the 10 × 15 minimum of 2");
  assert.equal(minSheets({ printSize: "full", prints: 0 }), 2);
  assert.equal(extraPriceFor(pack, { extraInstaxPrice: 50000, extraPrintPrice: 20000 }), 50000);
  assert.equal(pieceUnit(pack), "tờ 20 × 30");
  assert.equal(piecesLabel(pack, 2), "2 tờ 20 × 30");
  assert.equal(polaroidPackage(pack).shots, 0, "unlimited shots");
});

test("a 20 × 30 frame renders at 2400 × 3600 (or 3600 × 2400), whatever the size of its image", () => {
  const out = (w, h) => frameOutputSize({ printSize: "large" }, { naturalWidth: w, naturalHeight: h });
  assert.deepEqual(out(1200, 1800), { width: 2400, height: 3600 });
  assert.deepEqual(out(2362, 3543), { width: 2400, height: 3600 });
  assert.deepEqual(out(3600, 2400), { width: 3600, height: 2400 });
  assert.deepEqual(frameOutputSize({ printSize: "full" }, { naturalWidth: 2400, naturalHeight: 3600 }), { width: 1200, height: 1800 });
});

test("20 × 30 tickets use 20 × 30 frames before any 10 × 15 frame, and the package decides how many photos", () => {
  const frame = (name, printSize, slots) => ({
    name, printSize, themeName: "", order: 0,
    slots: Array.from({ length: slots }, (_, i) => ({ x: 0.1, y: 0.1 + i * 0.1, w: 0.2, h: 0.05, kind: "photo", photo: i + 1 })),
  });
  const big = frame("10x15", "full", 4), large = frame("20x30", "large", 17);
  assert.deepEqual(frameCandidates([big, large], { count: 4, printSize: "large" }).map((f) => f.name), ["20x30"]);
  assert.equal(frameNeed(large, { count: 3, printSize: "large", shots: 40 }), 3);
});
