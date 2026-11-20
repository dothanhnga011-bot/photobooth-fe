// Gợi ý ảnh đẹp ở album Selfbooth: cười tươi, không ai nhắm mắt, đủ người; số ảnh theo số ô của bộ khung.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SUGGESTIONS, pickSuggestions, suggestionTarget, summarizeFaces } from "../src/album/selfbooth/photo-suggestions.js";

const face = (smile, blink = 0.1) => ({ smile, blink });
const entry = (number, faces) => ({ id: `p${number}`, number, ...summarizeFaces(faces) });

test("a photo's score: average smile, the least open eye, and whether anyone has their eyes closed", () => {
  assert.deepEqual(summarizeFaces([]), { faces: 0 });
  assert.deepEqual(summarizeFaces([face(0.9, 0.1), face(0.5, 0.3)]), { faces: 2, smile: 0.7, open: 0.7, closed: false });
  assert.equal(summarizeFaces([face(0.99, 0.1), face(0.9, 0.8)]).closed, true, "one person blinking spoils the photo");
  assert.equal(summarizeFaces([face(0.95, 0.45)]).closed, false, "a big smile squints but the eyes are open");
});

test("as many suggestions as the chosen frame set has slots; before choosing, enough for the smallest set", () => {
  assert.equal(suggestionTarget({ total: 5, packCapacity: 15 }), 0, "small albums: guests look through them all");
  assert.equal(suggestionTarget({ total: 120, packCapacity: 15, packCapacities: [4, 15, 38] }), 15);
  assert.equal(suggestionTarget({ total: 120, packCapacities: [38, 15, 21] }), 15);
  assert.equal(suggestionTarget({ total: 9 }), 3, "no frame sets: about a third of the album");
  assert.equal(suggestionTarget({ total: 300 }), MAX_SUGGESTIONS);
});

const SESSION = [
  entry(1, [face(0.9), face(0.8)]),
  entry(2, [face(0.95), face(0.9)]), // tốt hơn ảnh 1, chụp liền sau
  entry(3, [face(0.99, 0.8), face(0.9)]), // có người nhắm mắt
  entry(4, [face(0.2, 0.2), face(0.1)]),
  entry(5, [face(0.99)]), // thiếu một người
  entry(6, [face(0.7), face(0.7, 0.2)]),
  entry(7, []),
  entry(8, [face(0.85), face(0.8)]),
  entry(9, [face(0.6, 0.3), face(0.5, 0.2)]),
];

test("the best smiles with everyone's eyes open, different moments first, skipping closed eyes and missing people", () => {
  assert.deepEqual(pickSuggestions(SESSION, 9, 3), ["p2", "p8", "p6"]);
  assert.deepEqual(pickSuggestions(SESSION, 9, 2), ["p2", "p8"]);
  // Bộ 4 ô: ba khoảnh khắc khác nhau rồi lấy thêm ảnh 1 (chụp liền ảnh 2) cho đủ.
  assert.deepEqual(pickSuggestions(SESSION, 9, 4), ["p2", "p8", "p6", "p1"]);
  // Bộ nhiều ô hơn số ảnh đẹp: gợi ý mọi ảnh đẹp, không bao giờ ảnh nhắm mắt hay thiếu người.
  assert.deepEqual(pickSuggestions(SESSION, 9, 15), ["p2", "p8", "p6", "p1", "p9", "p4"]);
  assert.deepEqual(pickSuggestions(SESSION.slice(0, 5), 5, 15), [], "fewer than 6 photos: no suggestions");
});

test("long sessions spread suggestions out: shots within 3 frames count as the same moment", () => {
  const entries = Array.from({ length: 90 }, (_, i) => entry(i + 1, [face(i % 10 === 0 ? 0.99 : 0.5), face(0.5)]));
  const picked = pickSuggestions(entries, 90, 15);
  assert.equal(picked.length, 15);
  const numbers = picked.map((id) => Number(id.slice(1))).sort((a, b) => a - b);
  assert.ok(numbers.every((n, i) => i === 0 || n - numbers[i - 1] >= 3), numbers.join());
  assert.deepEqual(picked.slice(0, 9), ["p1", "p11", "p21", "p31", "p41", "p51", "p61", "p71", "p81"], "the nine big smiles come first");
});
