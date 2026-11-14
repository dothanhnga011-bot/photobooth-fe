import assert from "node:assert/strict";
import test from "node:test";
import { layoutSlots, polaroidPackage } from "../src/polaroid-layouts.js";

const inside = (s) => s.x >= 0 && s.y >= 0 && s.x + s.w <= 1 && s.y + s.h <= 1;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("Polaroid packages are timed like Selfbooth: unlimited shots, the package's minutes, prints and price stay", () => {
  const old = { name: "Chụp đôi", printSize: "instax", selectCount: 2, duration: 12, shots: 8, prints: 2, price: 150000 };
  const normalized = polaroidPackage(old);
  assert.deepEqual([normalized.duration, normalized.prints, normalized.price, normalized.shots], [12, 2, 150000, 0]);
  assert.equal(old.shots, 8, "does not mutate the input");
  const booth = { printSize: "full", selectCount: 4, duration: 15, shots: 12 };
  assert.equal(polaroidPackage(booth), booth);
});

test("every sample layout has one slot per photo, inside the card, never overlapping", () => {
  for (const n of [1, 2, 3, 4, 6]) {
    const slots = layoutSlots(n);
    assert.equal(slots.length, n, `${n} ảnh`);
    assert.ok(slots.every(inside), `${n} ảnh: ô nằm trong thẻ`);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) assert.ok(!overlap(slots[i], slots[j]), `${n} ảnh: ô ${i + 1} và ${j + 1}`);
  }
});

test("the 5-photo layout puts 2 big photos on the left and 3 small ones on the right", () => {
  const [a, b, ...right] = layoutSlots(5);
  assert.equal(a.x, b.x);
  assert.ok(a.w * a.h > right[0].w * right[0].h, "ảnh bên trái to hơn");
  assert.ok(right.every((s) => s.x > a.x + a.w), "3 ảnh bé bên phải");
  assert.deepEqual(right.map((s) => s.x), [right[0].x, right[0].x, right[0].x]);
});

test("other counts still get a grid of the right size", () => {
  assert.equal(layoutSlots(8).length, 8);
  assert.equal(layoutSlots(0).length, 1);
});
