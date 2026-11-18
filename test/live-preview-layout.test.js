import assert from "node:assert/strict";
import { test } from "node:test";
import { livePreviewLayout, visibleClip, visibleRegion } from "../src/kiosk/live-preview-layout.js";

const cases = [
  [1920, 1080, 1064, 900],
  [1920, 1080, 1904, 450],
  [1920, 1080, 374, 388],
  [1280, 960, 1064, 900],
  [1280, 960, 1904, 450],
];

for (const [sourceWidth, sourceHeight, width, height] of cases) {
  test(`HDMI bands stay outside ${width}×${height} preview from ${sourceWidth}×${sourceHeight}`, () => {
    const layout = livePreviewLayout(sourceWidth, sourceHeight, width, height);
    const scale = layout.width / sourceWidth;
    const tolerance = 1e-6;

    assert.ok(Math.abs(layout.height / sourceHeight - scale) < tolerance);
    assert.ok(Math.abs(layout.left + layout.width / 2 - width / 2) < tolerance);
    assert.ok(layout.left <= tolerance);
    assert.ok(layout.left + layout.width >= width - tolerance);

    // The visible viewport lies entirely between the two embedded HUD bands.
    const firstVisibleSourceRow = -layout.top / scale;
    const lastVisibleSourceRow = (height - layout.top) / scale;
    assert.ok(firstVisibleSourceRow >= sourceHeight * 0.08 - tolerance);
    assert.ok(lastVisibleSourceRow <= sourceHeight * 0.88 + tolerance);
  });
}

test("unready or invalid camera dimensions do not produce a broken layout", () => {
  for (const dimensions of [
    [0, 1080, 800, 600],
    [1920, 0, 800, 600],
    [1920, 1080, 0, 600],
    [1920, 1080, 800, 0],
    [NaN, 1080, 800, 600],
    [1920, Infinity, 800, 600],
    [1920, 1080, -1, 600],
  ])
    assert.equal(livePreviewLayout(...dimensions), null);
});

test("extra crop hides camera info at every edge and stays centred", () => {
  const layout = livePreviewLayout(1920, 1080, 1366, 768, 0.15);
  const scale = layout.width / 1920;
  // Mép trái / phải của khung nhìn nằm trong vùng đã cắt 15% mỗi bên.
  assert.ok(-layout.left / scale >= 1920 * 0.15 - 1e-6);
  assert.ok((1366 - layout.left) / scale <= 1920 * 0.85 + 1e-6);
  assert.ok(-layout.top / scale >= 1080 * 0.15 - 1e-6);
  assert.ok((768 - layout.top) / scale <= 1080 * 0.85 + 1e-6);
});

test("portrait split screen: the whole visible camera frame fits the top half, info edges clipped", () => {
  // Nửa trên màn đứng 1080 × 960: phần còn thấy của HDMI 1920 × 1080 vừa đủ bề ngang, không cắt hai bên.
  const layout = livePreviewLayout(1920, 1080, 1080, 960, 0.08, "contain");
  const region = visibleRegion(0.08);
  const scale = layout.width / 1920;
  const visibleWidth = 1920 * region.w * scale;
  assert.ok(Math.abs(visibleWidth - 1080) < 1e-6, "the visible width fills the screen width exactly");
  assert.ok(1080 * region.h * scale <= 960 + 1e-6, "and its height fits inside the top half");
  // Cover (màn ngang) vẫn phủ kín khung xem như trước.
  const cover = livePreviewLayout(1920, 1080, 1080, 960, 0.08);
  assert.ok(1080 * region.h * (cover.width / 1920) >= 960 - 1e-6);
  assert.equal(visibleClip(0.08), "inset(8.000% 8.000% 12.000% 8.000%)");
});

for (const [width, height] of [[1366, 768], [540, 480], [320, 420]]) {
  test(`rotated HDMI fits and stays centred, including mirrored portrait at ${width}×${height}`, () => {
    for (const rotation of [0, 90, 180, 270]) for (const mirror of [false, true]) {
      const layout = livePreviewLayout(1920, 1080, width, height, .08, 'contain', rotation, mirror);
      const region = visibleRegion(.08), scale = layout.width / 1920;
      const radians = rotation * Math.PI / 180;
      // Map the four clipped sensor corners through the actual CSS operation:
      // rotation about the element centre, followed by a screen-horizontal flip.
      const corners = [region.x, region.x + region.w].flatMap(x => [region.y, region.y + region.h].map(y => {
        const dx = (x - .5) * layout.width, dy = (y - .5) * layout.height;
        return {
          x: layout.left + layout.width / 2 + (dx * Math.cos(radians) - dy * Math.sin(radians)) * (mirror ? -1 : 1),
          y: layout.top + layout.height / 2 + dx * Math.sin(radians) + dy * Math.cos(radians),
        };
      }));
      const left = Math.min(...corners.map(c => c.x)), right = Math.max(...corners.map(c => c.x));
      const top = Math.min(...corners.map(c => c.y)), bottom = Math.max(...corners.map(c => c.y));
      assert.ok(left >= -1e-6 && right <= width + 1e-6 && top >= -1e-6 && bottom <= height + 1e-6, `${rotation}°, mirror ${mirror}: no lost edge`);
      assert.ok(Math.abs((left + right) / 2 - width / 2) < 1e-6);
      assert.ok(Math.abs((top + bottom) / 2 - height / 2) < 1e-6);
      assert.ok(Math.abs(layout.height / 1080 - scale) < 1e-6, 'no stretching');
      assert.ok(Math.abs(right - left - width) < 1e-6 || Math.abs(bottom - top - height) < 1e-6, 'use the largest size that contains the whole visible frame');
    }
  });
}

