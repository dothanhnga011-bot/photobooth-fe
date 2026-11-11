import assert from "node:assert/strict";
import { test } from "node:test";
import { timelapseBitrate, timelapseCrop, timelapseSize } from "../src/kiosk/clip-recorder.js";
import { videoConstraints } from "../src/kiosk/camera.js";
import { DEFAULT_CROP, visibleRegion } from "../src/kiosk/live-preview-layout.js";

test("the timelapse keeps the camera's own resolution instead of enlarging the cropped picture", () => {
  // HDMI Full HD cắt mép thông số mặc định: còn 1613 × 864 → video 1536 × 864 (16:9), không kéo lên 1080p.
  assert.deepEqual(timelapseSize(1920, 1080, visibleRegion(DEFAULT_CROP)), [1536, 864]);
  // Nguồn 4K: tối đa Full HD.
  assert.deepEqual(timelapseSize(3840, 2160, visibleRegion(0)), [1920, 1080]);
  // Webcam 720p (chế độ nhẹ, tối đa 720p).
  assert.deepEqual(timelapseSize(1280, 720, visibleRegion(DEFAULT_CROP), 720), [1024, 576]);
  // Chưa đọc được kích thước clip: dùng mức tối đa.
  assert.deepEqual(timelapseSize(0, 0, visibleRegion(0)), [1920, 1080]);
  // Luôn là số chẵn (bộ mã hoá H.264 cần kích thước chẵn).
  const [w, h] = timelapseSize(1366, 768, visibleRegion(0.13));
  assert.equal(w % 2, 0);
  assert.equal(h % 2, 0);
});

test("the timelapse bitrate follows its resolution, so a smaller video uploads faster", () => {
  const mbps = (...args) => Math.round(timelapseBitrate(...args) / 1e5) / 10;
  // 23% crop on HDMI 1080p (6/11): 1034 × 582 → ~6 Mbps instead of 16 (22 MB → ~9 MB for 12 s).
  assert.equal(mbps(1034, 582, 12), 6.3);
  assert.equal(mbps(1536, 864, 12), 13.9);
  assert.equal(mbps(1920, 1080, 12), 16, "Full HD stays at the 16 Mbps ceiling");
  // A long session still fits the 48 MB upload limit; tiny or webcam videos keep their floor / ceiling.
  assert.ok(timelapseBitrate(1920, 1080, 60) * 60 / 8 <= 48 * 1024 * 1024);
  assert.equal(mbps(320, 180, 12), 4);
  assert.equal(mbps(1280, 720, 12, true), 8);
});

test("HDMI crops keep source pixels intact, including fractional margins and an aggressive zoom", () => {
  for (const zoom of [0, DEFAULT_CROP, 0.23, 0.3]) {
    const region = visibleRegion(zoom);
    const [width, height] = timelapseSize(1920, 1080, region);
    const crop = timelapseCrop(1920, 1080, region, width, height);
    assert.equal(crop.width, width);
    assert.equal(crop.height, height);
    assert.equal(crop.resize, false);
    assert.ok(Number.isInteger(crop.x) && Number.isInteger(crop.y));
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 1920 && crop.y + crop.height <= 1080);
  }
  assert.deepEqual(timelapseCrop(1920, 1080, visibleRegion(DEFAULT_CROP), 1536, 864),
    { x: 192, y: 86, width: 1536, height: 864, resize: false });
  const cropped4k = timelapseCrop(3840, 2160, visibleRegion(0), 1920, 1080);
  assert.deepEqual(cropped4k, { x: 384, y: 173, width: 3072, height: 1728, resize: true });
  assert.equal(timelapseCrop(0, 0, visibleRegion(0), 1920, 1080), null);
});

test("HDMI prefers native 1080p; webcam retains its lighter negotiation", () => {
  const hdmi = videoConstraints("capture-card");
  assert.deepEqual(hdmi.video.resizeMode, { ideal: "none" });
  assert.deepEqual(hdmi.video.deviceId, { exact: "capture-card" });
  assert.deepEqual(hdmi.video.height, { ideal: 1080 });
  const webcam = videoConstraints("webcam", true);
  assert.equal(webcam.video.resizeMode, undefined);
  assert.deepEqual(webcam.video.height, { ideal: 720 });
});
