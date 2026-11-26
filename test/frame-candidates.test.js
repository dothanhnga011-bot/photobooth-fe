import test from "node:test";
import assert from "node:assert/strict";

// compose.js mở hàng chờ ảnh (IndexedDB) khi nạp; trong Node chỉ cần một bản giả không làm gì.
globalThis.indexedDB ??= { open: () => ({}) };
const { frameCandidates, frameNeed } = await import("../src/kiosk/compose.js");

const photo = (i) => ({ x: i * 0.1, y: 0, w: 0.1, h: 0.1 });
const frame = (name, printSize, photos, themeName = "LIMIT") => ({
  _id: name, name, themeName, printSize,
  slots: [...Array.from({ length: photos }, (_, i) => photo(i)), { x: 0.9, y: 0.9, w: 0.1, h: 0.1, kind: "qr" }],
});
const big = [frame("Lớn 5 ô", "full", 5), frame("Lớn 4 ô", "full", 4), frame("Lớn 3 ô", "full", 3), frame("Lớn 6 ô", "full", 6)];
const small = [frame("Nhỏ 4 ô", "strip", 4), frame("Nhỏ 3 ô", "strip", 3)];
const large = [frame("20 × 30 2 ô", "large", 2), frame("20 × 30 1 ô", "large", 1)];
const names = (list) => list.map((f) => f.name).sort();

test("khổ lớn hiện mọi khung lớn, không chỉ khung đúng số ảnh của gói", () => {
  const list = frameCandidates([...big, ...small, ...large], { count: 4, printSize: "full" });
  assert.deepEqual(names(list), names(big));
});

test("gói ảnh nhỏ chỉ hiện khung nhỏ (không lẫn khung lớn)", () => {
  const list = frameCandidates([...big, ...small], { count: 4, printSize: "strip" });
  assert.deepEqual(names(list), names(small));
});

test("chưa có khung nhỏ: vẫn có khung để in (lùi về khung đúng số ảnh)", () => {
  const list = frameCandidates(big, { count: 4, printSize: "strip" });
  assert.deepEqual(names(list), ["Lớn 4 ô"]);
});

test("Selfbooth ưu tiên khung 20 × 30 đúng số ảnh của gói", () => {
  const list = frameCandidates([...big, ...large], { count: 2, printSize: "large" });
  assert.deepEqual(names(list), ["20 × 30 2 ô"]);
});

test("số ô cần chọn đúng số ô của khung đang xem, kể cả khi chụp ít ảnh hơn (một ảnh dùng cho nhiều ô)", () => {
  assert.equal(frameNeed(big[0], { count: 4, printSize: "full", shots: 12 }), 5);
  assert.equal(frameNeed(big[3], { count: 4, printSize: "full", shots: 12 }), 6);
  // Khung đánh số 1–6, khách chụp 4 ảnh: vẫn chọn đủ 6 ô (không tự lặp ảnh 1–4 vào ô 5–6).
  assert.equal(frameNeed(big[3], { count: 4, printSize: "full", shots: 4 }), 6);
  assert.equal(frameNeed(big[3], { count: 4, printSize: "full", shots: 0 }), 0);
  assert.equal(frameNeed(large[0], { count: 3, printSize: "large", shots: 2 }), 2);
  assert.equal(frameNeed(small[1], { count: 4, printSize: "strip", shots: 12 }), 3);
  assert.equal(frameNeed(large[0], { count: 1, printSize: "large", shots: 8 }), 1);
  assert.equal(frameNeed(undefined, { count: 4, printSize: "full", shots: 12 }), 4);
});
