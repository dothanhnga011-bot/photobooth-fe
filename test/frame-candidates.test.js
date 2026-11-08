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
const instax = [frame("Instax 2", "instax", 2), frame("Instax 1", "instax", 1)];
const names = (list) => list.map((f) => f.name).sort();

test("khổ lớn hiện mọi khung lớn, không chỉ khung đúng số ảnh của gói", () => {
  const list = frameCandidates([...big, ...small, ...instax], { count: 4, printSize: "full" });
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

test("Instax vẫn chọn layout theo số ảnh của gói", () => {
  const list = frameCandidates([...big, ...instax], { count: 2, printSize: "instax" });
  assert.deepEqual(names(list), ["Instax 2"]);
});

test("số ảnh cần chọn theo số ô của khung đang xem, không quá số ảnh đã chụp", () => {
  assert.equal(frameNeed(big[0], { count: 4, printSize: "full", shots: 12 }), 5);
  assert.equal(frameNeed(big[3], { count: 4, printSize: "full", shots: 12 }), 6);
  assert.equal(frameNeed(big[3], { count: 4, printSize: "full", shots: 4 }), 4);
  assert.equal(frameNeed(small[1], { count: 4, printSize: "strip", shots: 12 }), 3);
  assert.equal(frameNeed(instax[0], { count: 1, printSize: "instax", shots: 8 }), 1);
  assert.equal(frameNeed(undefined, { count: 4, printSize: "full", shots: 12 }), 4);
});
