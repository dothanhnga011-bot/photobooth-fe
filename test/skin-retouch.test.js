import assert from "node:assert/strict";
import { test } from "node:test";
import {
  featherSkinRegion,
  retouchSkin,
  skinColorWeight,
} from "../src/skin-retouch.js";

function fixture(color, width = 40, height = 32) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...color, 255], i);
  return {
    data,
    width,
    height,
    mask: new Float32Array(width * height).fill(1),
  };
}
function render(sample, adjust, mask = sample.mask) {
  const copy = new Uint8ClampedArray(sample.data);
  retouchSkin(copy, sample.width, sample.height, mask, adjust, 200);
  return copy;
}
const linear = (value) => {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

test("skin confidence covers light and darker skin but rejects blue and green backgrounds", () => {
  for (const color of [
    [220, 183, 157],
    [174, 115, 82],
    [101, 65, 44],
  ])
    assert.ok(skinColorWeight(...color) > 0.8);
  assert.equal(skinColorWeight(30, 75, 180), 0);
  assert.equal(skinColorWeight(30, 160, 70), 0);
});

test("zero settings, an empty mask and transparent pixels preserve every original channel", () => {
  const sample = fixture([174, 115, 82]);
  assert.deepEqual(render(sample, { smooth: 0, whiten: 0 }), sample.data);
  assert.deepEqual(
    render(
      sample,
      { smooth: 100, whiten: 100 },
      new Float32Array(sample.mask.length),
    ),
    sample.data,
  );
  for (let i = 3; i < sample.data.length; i += 4) sample.data[i] = 0;
  assert.deepEqual(render(sample, { smooth: 100, whiten: 100 }), sample.data);
});

test("whitening gently lifts several skin tones while preserving their linear color ratios", () => {
  for (const color of [
    [206, 165, 132],
    [170, 111, 79],
    [106, 65, 44],
  ]) {
    const sample = fixture(color);
    const result = render(sample, { whiten: 100 });
    const gains = color.map(
      (value, channel) => linear(result[channel]) / linear(value),
    );
    assert.ok(
      result[0] > color[0] && result[1] > color[1] && result[2] > color[2],
    );
    assert.ok(
      Math.max(...gains) - Math.min(...gains) < 0.06,
      JSON.stringify({ color, result: [...result.slice(0, 4)], gains }),
    );
    for (let c = 0; c < 3; c++) assert.ok(result[c] - color[c] <= 28);
  }
});

test("whitening protects deep shadows, bright highlights and saturated channels", () => {
  for (const color of [
    [8, 5, 4],
    [251, 249, 247],
    [255, 185, 151],
  ]) {
    const sample = fixture(color);
    assert.deepEqual(render(sample, { whiten: 100 }), sample.data);
  }
});

test("whitening increases gradually with the slider and never decreases a channel", () => {
  const sample = fixture([176, 124, 94]);
  const outputs = [0, 25, 50, 75, 100].map((whiten) =>
    render(sample, { whiten }),
  );
  for (let i = 1; i < outputs.length; i++)
    for (let c = 0; c < 3; c++) assert.ok(outputs[i][c] > outputs[i - 1][c]);
});

test("smoothing reduces fine luminance noise while retaining at least half its texture", () => {
  const sample = fixture([170, 120, 90]);
  for (let y = 0; y < sample.height; y++)
    for (let x = 0; x < sample.width; x++) {
      const delta = (x + y) % 2 ? 4 : -4;
      const offset = (y * sample.width + x) * 4;
      for (let c = 0; c < 3; c++) sample.data[offset + c] += delta;
    }
  const result = render(sample, { smooth: 100 });
  let originalTexture = 0,
    editedTexture = 0;
  for (let y = 5; y < sample.height - 5; y++)
    for (let x = 5; x < sample.width - 5; x++) {
      const index = (y * sample.width + x) * 4;
      originalTexture += Math.abs(sample.data[index] - 170);
      editedTexture += Math.abs(result[index] - 170);
      assert.equal(result[index] - result[index + 1], 50);
      assert.equal(result[index + 1] - result[index + 2], 30);
    }
  assert.ok(editedTexture < originalTexture * 0.9);
  assert.ok(editedTexture >= originalTexture * 0.5);
});

test("smoothing preserves sharp dark edges instead of mixing them into nearby skin", () => {
  const sample = fixture([190, 145, 115]);
  for (let y = 0; y < sample.height; y++)
    for (let x = 0; x < sample.width / 2; x++)
      sample.data.set([35, 25, 20, 255], (y * sample.width + x) * 4);
  const result = render(sample, { smooth: 100 });
  for (let i = 0; i < result.length; i++)
    assert.ok(Math.abs(result[i] - sample.data[i]) <= 1);
});

test("combined edits leave pixels outside the mask and every alpha channel unchanged", () => {
  const sample = fixture([174, 115, 82]);
  const mask = new Float32Array(sample.mask.length);
  for (let y = 8; y < 24; y++)
    for (let x = 10; x < 30; x++) mask[y * sample.width + x] = 1;
  const result = render(sample, { smooth: 100, whiten: 100 }, mask);
  for (let i = 0; i < mask.length; i++) {
    assert.equal(result[i * 4 + 3], sample.data[i * 4 + 3]);
    if (!mask[i])
      assert.deepEqual(
        result.slice(i * 4, i * 4 + 4),
        sample.data.slice(i * 4, i * 4 + 4),
      );
  }
});

test("single-pixel skin areas remain valid with the largest smoothing setting", () => {
  const sample = fixture([170, 120, 90], 1, 1);
  assert.deepEqual(render(sample, { smooth: 100 }), sample.data);
  const result = render(sample, { smooth: 100, whiten: 100 });
  assert.equal(result[3], 255);
  assert.ok(result[0] > 170 && result[0] < 200);
});

test("skin region fades inward gradually without bleeding into background or feature holes", () => {
  const width = 50,
    height = 30;
  const region = new Float32Array(width * height);
  for (let y = 2; y < height - 2; y++)
    for (let x = 2; x < width - 2; x++) region[y * width + x] = 1;
  region[15 * width + 25] = 0;
  featherSkinRegion(region, width, height, 6);
  assert.equal(region[15 * width + 1], 0);
  assert.equal(region[15 * width + 25], 0);
  assert.ok(region[15 * width + 2] < 0.1);
  for (let x = 2; x < 7; x++)
    assert.ok(region[15 * width + x] < region[15 * width + x + 1]);
  assert.equal(region[15 * width + 8], 1);
  assert.ok(region[15 * width + 24] < 0.1);
});
