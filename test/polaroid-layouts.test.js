import assert from "node:assert/strict";
import test from "node:test";
import { LAYOUT_COUNTS, layoutSlots, polaroidLayout, polaroidPackage } from "../src/polaroid-layouts.js";

const inside = (s) => s.x >= 0 && s.y >= 0 && s.x + s.w <= 1 && s.y + s.h <= 1;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("Polaroid offers unlimited shots with 1 pick in 3 minutes or 2 picks in 5 minutes, preserving prices", () => {
  for (const count of [1, 2]) {
    const old = { name: "Custom", printSize: "instax", selectCount: count, duration: 20, shots: 8, prints: 3, price: 125000 };
    const normalized = polaroidPackage(old);
    assert.equal(normalized.duration, count === 1 ? 3 : 5);
    assert.equal(normalized.selectCount, count);
    assert.equal(normalized.shots, 0);
    assert.equal(normalized.prints, 1);
    assert.equal(normalized.price, old.price);
    assert.equal(old.shots, 8, "does not mutate the input");
  }
  assert.equal(polaroidLayout(4), null);
  const booth = { printSize: "full", selectCount: 4, duration: 15, shots: 12 };
  assert.equal(polaroidPackage(booth), booth);
});

test("every sample layout has one slot per photo, inside the card, never overlapping", () => {
  for (const n of LAYOUT_COUNTS) {
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
