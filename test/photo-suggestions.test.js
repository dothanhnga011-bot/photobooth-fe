// Gợi ý ảnh đẹp ở album Selfbooth: cười tươi, rõ nét, nhìn thẳng, không ai nhắm mắt, đủ người, khoảnh khắc khác
// nhau; số ảnh theo số ô của bộ khung.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SUGGESTIONS, pickSuggestions, pictureDistance, suggestionTarget, summarizePhoto } from "../src/album/selfbooth/photo-suggestions.js";

const face = (smile, blink = 0.1, more = {}) => ({ smile, blink, ...more });
const entry = (number, faces, extra = {}) => ({ id: `p${number}`, number, ...summarizePhoto({ faces, ...extra }) });

test("a photo's score: average smile, least open eye, closed eyes, least sharp and least frontal face, cut faces", () => {
  assert.deepEqual(summarizePhoto({ faces: [] }), { faces: 0 });
  assert.deepEqual(summarizePhoto({ faces: [], hash: "00ff" }), { faces: 0, hash: "00ff" });
  assert.deepEqual(summarizePhoto({ faces: [face(0.9, 0.1), face(0.5, 0.3)] }), { faces: 2, smile: 0.7, open: 0.7, closed: false });
  assert.equal(summarizePhoto({ faces: [face(0.99, 0.1), face(0.9, 0.8)] }).closed, true, "one person blinking spoils the photo");
  assert.equal(summarizePhoto({ faces: [face(0.95, 0.45)] }).closed, false, "a big smile squints but the eyes are open");
  assert.deepEqual(summarizePhoto({ faces: [face(0.8, 0.1, { sharp: 120, facing: 0.9 }), face(0.8, 0.1, { sharp: 40, facing: 0.3, cut: true })], hash: "abcd" }),
    { faces: 2, smile: 0.8, open: 0.9, closed: false, facing: 0.3, sharp: 40, cut: true, hash: "abcd" });
});

test("picture fingerprints: near-identical shots differ by a few bits", () => {
  assert.equal(pictureDistance("ffffffffffffffff", "ffffffffffffffff"), 0);
  assert.equal(pictureDistance("ffffffffffffffff", "fffffffffffffffe"), 1);
  assert.equal(pictureDistance("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(pictureDistance("", "ffffffffffffffff"), Infinity);
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

test("blurry shots are left out, turned-away and edge-cut faces only fill in when there are not enough good ones", () => {
  const sharp = (number, smile, more = {}) =>
    entry(number, [face(smile, 0.1, { sharp: 100, facing: 0.95, ...more.face }), face(smile, 0.1, { sharp: 100, facing: 0.95 })], { hash: more.hash });
  const session = [
    sharp(1, 0.9),
    sharp(4, 0.99, { face: { sharp: 20 } }), // rung tay: mờ hẳn → loại
    sharp(7, 0.95, { face: { facing: 0.2 } }), // một người quay mặt đi
    sharp(10, 0.92, { face: { cut: true } }), // mặt bị cắt ở mép
    sharp(13, 0.8),
    sharp(16, 0.7),
  ];
  assert.deepEqual(pickSuggestions(session, 16, 3), ["p1", "p13", "p16"]);
  assert.deepEqual(pickSuggestions(session, 16, 5), ["p1", "p13", "p16", "p7", "p10"]);
  assert.equal(pickSuggestions(session, 16, 10).includes("p4"), false, "a blurry photo is never suggested");
});

test("moments are told apart by the picture, not only by shot number", () => {
  const shot = (number, smile, hash) => entry(number, [face(smile), face(smile)], { hash });
  const a = "f0f0f0f0f0f0f0f0", b = "0f0f0f0f0f0f0f0f";
  const session = [
    shot(1, 0.9, a),
    shot(2, 0.88, b), // chụp liền sau nhưng đổi dáng hẳn: khoảnh khắc khác
    shot(3, 0.87, a), // y hệt ảnh 1
    shot(20, 0.86, "f0f0f0f0f0f0f0f1"), // cách xa nhưng gần như y hệt ảnh 1 (1 bit)
    shot(30, 0.5, "aaaaaaaaaaaaaaaa"),
    shot(40, 0.4, "5555555555555555"),
  ];
  assert.deepEqual(pickSuggestions(session, 40, 4), ["p1", "p2", "p30", "p40"]);
});

test("long sessions spread suggestions out: shots within 3 frames count as the same moment", () => {
  const entries = Array.from({ length: 90 }, (_, i) => entry(i + 1, [face(i % 10 === 0 ? 0.99 : 0.5), face(0.5)]));
  const picked = pickSuggestions(entries, 90, 15);
  assert.equal(picked.length, 15);
  const numbers = picked.map((id) => Number(id.slice(1))).sort((a, b) => a - b);
  assert.ok(numbers.every((n, i) => i === 0 || n - numbers[i - 1] >= 3), numbers.join());
  assert.deepEqual(picked.slice(0, 9), ["p1", "p11", "p21", "p31", "p41", "p51", "p61", "p71", "p81"], "the nine big smiles come first");
});
