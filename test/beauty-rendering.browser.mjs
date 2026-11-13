// Run explicitly: node test/beauty-rendering.browser.mjs
// Real browser canvas tests: no model download and no customer photograph required.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server;
let browser;
let page;

before(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const path = url.pathname;
    if (path === "/__portrait_test__") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><title>Portrait canvas regression tests</title>
        <script type="importmap">{"imports":{"@mediapipe/tasks-vision/":"/__test_mediapipe__/"}}</script>`);
      return;
    }
    // Mirror Vite's ?url imports without loading WASM/model assets: rendering
    // tests inject landmarks and deliberately never initialize the detector.
    if (
      (path.startsWith("/src/assets/") ||
        path.startsWith("/__test_mediapipe__/")) &&
      url.searchParams.has("url")
    ) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(`export default ${JSON.stringify(path)};`);
      return;
    }
    if (!/^\/src\/[a-zA-Z0-9_./-]+$/.test(path)) {
      response.writeHead(404).end();
      return;
    }
    try {
      response.setHeader("Content-Type", "text/javascript");
      response.end(
        await readFile(fileURLToPath(new URL(`..${path.endsWith(".js") ? path : `${path}.js`}`, import.meta.url))),
      );
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${server.address().port}/__portrait_test__`,
  );
  await page.evaluate(async () => {
    const { applyBeauty, DEFAULT_ADJUST } = await import("/src/beauty.js");
    const oval = [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
      378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
      162, 21, 54, 103, 67, 109,
    ];
    const leftEye = [
      33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161,
      246,
    ];
    const rightEye = [
      263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388,
      466,
    ];
    const leftBrow = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
    const rightBrow = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
    const lips = [
      61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0,
      37, 39, 40, 185,
    ];

    function fixture(offsetX = 0, offsetY = 0) {
      const width = 360;
      const height = 480;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const pixels = context.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4;
          // A spatial pattern makes any genuine resampling measurable.
          pixels.data[index] = 166 + (x % 29);
          pixels.data[index + 1] = 122 + (y % 23);
          pixels.data[index + 2] = 94 + ((x + y) % 19);
          pixels.data[index + 3] = 255;
        }
      }
      context.putImageData(pixels, 0, 0);
      const face = Array.from({ length: 478 }, () => ({ x: 180, y: 232 }));
      const ellipse = (indices, cx, cy, rx, ry, start = -Math.PI / 2) => {
        indices.forEach((index, step) => {
          const angle = start + (step / indices.length) * Math.PI * 2;
          face[index] = {
            x: cx + rx * Math.cos(angle),
            y: cy + ry * Math.sin(angle),
          };
        });
      };
      ellipse(oval, 180, 232, 104, 120);
      ellipse(leftEye, 125, 202, 27, 10);
      ellipse(rightEye, 235, 202, 27, 10);
      ellipse(leftBrow, 125, 181, 30, 7);
      ellipse(rightBrow, 235, 181, 30, 7);
      ellipse(lips, 180, 292, 34, 12);
      face[168] = { x: 180, y: 202 };
      face[50] = { x: 118, y: 248 };
      face[129] = { x: 157, y: 242 };
      face[280] = { x: 242, y: 248 };
      face[358] = { x: 203, y: 242 };
      for (const point of face) {
        point.x += offsetX;
        point.y += offsetY;
      }
      return { source: canvas, face, width, height, before: pixels.data };
    }

    function render(adjust, offsetX = 0, offsetY = 0, withFace = true) {
      const sample = fixture(offsetX, offsetY);
      const output = applyBeauty(
        sample.source,
        withFace ? [sample.face] : [],
        adjust,
      );
      const after = output
        .getContext("2d")
        .getImageData(0, 0, sample.width, sample.height).data;
      return { ...sample, after, output };
    }

    function changed(sample, rect = [0, 0, sample.width, sample.height]) {
      let pixels = 0;
      let totalDifference = 0;
      let alphaChanged = 0;
      for (let y = rect[1]; y < rect[3]; y++) {
        for (let x = rect[0]; x < rect[2]; x++) {
          const index = (y * sample.width + x) * 4;
          const difference = [0, 1, 2].reduce(
            (sum, channel) =>
              sum +
              Math.abs(
                sample.after[index + channel] - sample.before[index + channel],
              ),
            0,
          );
          if (difference) pixels++;
          totalDifference += difference;
          if (sample.after[index + 3] !== sample.before[index + 3])
            alphaChanged++;
        }
      }
      return { pixels, totalDifference, alphaChanged };
    }

    window.portraitTest = {
      fixture,
      render,
      changed,
      applyBeauty,
      DEFAULT_ADJUST,
    };
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test("neutral settings preserve the original pixels and canvas size", async () => {
  const result = await page.evaluate(() => {
    const { render, changed, DEFAULT_ADJUST } = window.portraitTest;
    const sample = render(DEFAULT_ADJUST);
    return {
      changes: changed(sample),
      dimensions: [sample.output.width, sample.output.height],
    };
  });
  assert.deepEqual(result.dimensions, [360, 480]);
  assert.deepEqual(result.changes, {
    pixels: 0,
    totalDifference: 0,
    alphaChanged: 0,
  });
});

test("moving camera preparation off the UI preserves decoded JPEG color and mirroring", async () => {
  const differences = await page.evaluate(async () => {
    const { prepareCameraImageAsync } = await import("/src/image-processing.js");
    const { prepareCameraImage } = await import("/src/kiosk/camera-image.js");
    const sample = window.portraitTest.fixture();
    const file = await new Promise(resolve => sample.source.toBlob(resolve, "image/jpeg", 0.95));
    const pixels = async blob => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      canvas.width = 0;
      return data;
    };
    const differences = [];
    for (const mirror of [false, true]) {
      const actual = await pixels(await prepareCameraImageAsync(file, mirror));
      const expected = await pixels(await prepareCameraImage(file, mirror));
      let max = 0;
      for (let i = 0; i < actual.length; i++) max = Math.max(max, Math.abs(actual[i] - expected[i]));
      differences.push(max);
    }
    return differences;
  });
  assert.deepEqual(differences, [0, 0]);
});

test("temporary album object URLs are not retained in the global frame cache", async () => {
  const result = await page.evaluate(async () => {
    const { loadFrameImage } = await import("/src/frame-utils.js");
    const sample = window.portraitTest.fixture();
    const blob = await new Promise(resolve => sample.source.toBlob(resolve));
    const url = URL.createObjectURL(blob);
    const first = await loadFrameImage(url);
    URL.revokeObjectURL(url);
    const retained = await loadFrameImage(url).then(() => true, () => false);
    return { retained, width: first.naturalWidth };
  });
  assert.equal(result.retained, false);
  assert.equal(result.width, 360, "a displayed consumer stays intact after cache release");
});

test("blush visibly changes both cheeks while eyes, mouth and distant background remain intact", async () => {
  const result = await page.evaluate(() => {
    const { render, changed } = window.portraitTest;
    const sample = render({ blush: 100 });
    return {
      all: changed(sample),
      left: changed(sample, [110, 238, 143, 270]),
      right: changed(sample, [218, 238, 251, 270]),
      eyes: changed(sample, [97, 191, 263, 213]),
      mouth: changed(sample, [145, 286, 215, 303]),
      background: changed(sample, [0, 0, 60, 480]),
    };
  });
  assert.ok(result.left.pixels > 600, JSON.stringify(result));
  assert.ok(result.right.pixels > 600, JSON.stringify(result));
  assert.ok(
    result.left.totalDifference / result.left.pixels > 12,
    JSON.stringify(result),
  );
  assert.ok(
    result.right.totalDifference / result.right.pixels > 12,
    JSON.stringify(result),
  );
  assert.equal(result.eyes.pixels, 0);
  assert.equal(result.mouth.pixels, 0);
  assert.equal(result.background.pixels, 0);
  assert.equal(result.all.alphaChanged, 0);
});

test("slimming genuinely resamples both jaw sides without changing eyes, nose or distant background", async () => {
  const result = await page.evaluate(() => {
    const { render, changed } = window.portraitTest;
    const sample = render({ slim: 100 });
    return {
      all: changed(sample),
      leftJaw: changed(sample, [85, 278, 141, 332]),
      rightJaw: changed(sample, [219, 278, 275, 332]),
      eyes: changed(sample, [99, 193, 261, 210]),
      nose: changed(sample, [174, 222, 186, 265]),
      background: changed(sample, [0, 0, 25, 480]),
      forehead: changed(sample, [80, 0, 280, 160]),
    };
  });
  assert.ok(result.leftJaw.pixels > 1000, JSON.stringify(result));
  assert.ok(result.rightJaw.pixels > 1000, JSON.stringify(result));
  assert.equal(result.eyes.pixels, 0);
  assert.equal(result.nose.pixels, 0);
  assert.equal(result.background.pixels, 0);
  assert.equal(result.forehead.pixels, 0);
  assert.equal(result.all.alphaChanged, 0);
});

test("slimming moves jaw landmarks inward instead of merely changing their colors", async () => {
  const result = await page.evaluate(() => {
    const { fixture, applyBeauty } = window.portraitTest;
    const sample = fixture();
    const context = sample.source.getContext("2d");
    for (const index of [58, 288]) {
      context.fillStyle = "rgb(30, 50, 250)";
      context.beginPath();
      context.arc(
        sample.face[index].x,
        sample.face[index].y,
        3,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    const centroid = (canvas, right) => {
      const pixels = canvas
        .getContext("2d")
        .getImageData(0, 0, sample.width, sample.height).data;
      let xTotal = 0;
      let yTotal = 0;
      let count = 0;
      for (let y = 0; y < sample.height; y++) {
        for (let x = right ? 180 : 0; x < (right ? 360 : 180); x++) {
          const index = (y * sample.width + x) * 4;
          if (
            pixels[index] < 70 &&
            pixels[index + 1] < 90 &&
            pixels[index + 2] > 230
          ) {
            xTotal += x;
            yTotal += y;
            count++;
          }
        }
      }
      return { x: xTotal / count, y: yTotal / count, count };
    };
    const output = applyBeauty(sample.source, [sample.face], { slim: 100 });
    return {
      leftBefore: centroid(sample.source, false),
      leftAfter: centroid(output, false),
      rightBefore: centroid(sample.source, true),
      rightAfter: centroid(output, true),
    };
  });
  assert.ok(
    result.leftAfter.count > 3 && result.rightAfter.count > 3,
    JSON.stringify(result),
  );
  assert.ok(
    result.leftAfter.x - result.leftBefore.x > 4,
    JSON.stringify(result),
  );
  assert.ok(
    result.rightBefore.x - result.rightAfter.x > 4,
    JSON.stringify(result),
  );
  assert.ok(
    Math.abs(result.leftAfter.y - result.leftBefore.y) < 3,
    JSON.stringify(result),
  );
  assert.ok(
    Math.abs(result.rightAfter.y - result.rightBefore.y) < 3,
    JSON.stringify(result),
  );
});

test("overlapping jaw controls stay bounded and increase gradually with the slider", async () => {
  const result = await page.evaluate(() => {
    const { fixture, applyBeauty } = window.portraitTest;
    const sample = fixture();
    const context = sample.source.getContext("2d");
    const original = context.createImageData(sample.width, sample.height);
    for (let y = 0; y < sample.height; y++) {
      for (let x = 0; x < sample.width; x++) {
        const index = (y * sample.width + x) * 4;
        // The red/green gradient encodes the source position at two-pixel
        // precision, independently measuring the real resampled output.
        original.data[index] = Math.floor(x / 2);
        original.data[index + 1] = Math.floor(y / 2);
        original.data[index + 2] = 80;
        original.data[index + 3] = 255;
      }
    }
    context.putImageData(original, 0, 0);
    const faceWidth = Math.hypot(
      sample.face[454].x - sample.face[234].x,
      sample.face[454].y - sample.face[234].y,
    );
    const amounts = [20, 40, 70, 100];
    const measurements = amounts.map((amount) => {
      const output = applyBeauty(sample.source, [sample.face], {
        slim: amount,
      });
      const pixels = output
        .getContext("2d")
        .getImageData(0, 0, sample.width, sample.height).data;
      let maximum = 0;
      let total = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const displacement =
          2 *
          Math.hypot(
            pixels[index] - original.data[index],
            pixels[index + 1] - original.data[index + 1],
          );
        maximum = Math.max(maximum, displacement);
        total += displacement;
      }
      return { amount, maximum, total };
    });
    const sourceAfter = context.getImageData(
      0,
      0,
      sample.width,
      sample.height,
    ).data;
    return {
      faceWidth,
      measurements,
      sourceUnchanged: sourceAfter.every(
        (value, index) => value === original.data[index],
      ),
    };
  });
  assert.ok(result.sourceUnchanged);
  for (const measurement of result.measurements) {
    // Single control displacement is capped at 7.2% of face width at 100%.
    // Encoding and output rounding add at most three pixels of uncertainty.
    assert.ok(
      measurement.maximum <=
        (result.faceWidth * 0.072 * measurement.amount) / 100 + 3,
      JSON.stringify(result),
    );
  }
  for (let index = 1; index < result.measurements.length; index++) {
    assert.ok(
      result.measurements[index].total > result.measurements[index - 1].total,
      JSON.stringify(result),
    );
  }
  const forty = result.measurements.find(
    (measurement) => measurement.amount === 40,
  );
  const seventy = result.measurements.find(
    (measurement) => measurement.amount === 70,
  );
  assert.ok(
    seventy.total / forty.total > 1.5 && seventy.total / forty.total < 2,
    JSON.stringify(result),
  );
});

test("a tightly cropped face still receives slimming and blush without transparent edge holes", async () => {
  const result = await page.evaluate(() => {
    const { render, changed } = window.portraitTest;
    const sample = render({ slim: 100, blush: 100 }, -92, 110);
    return changed(sample);
  });
  assert.ok(result.pixels > 1500, JSON.stringify(result));
  assert.equal(result.alphaChanged, 0);
});

test("landmarks past the bottom crop boundary do not break the visible face adjustment", async () => {
  const result = await page.evaluate(() => {
    const { render, changed } = window.portraitTest;
    const sample = render({ slim: 100, blush: 100 }, 0, 195);
    return changed(sample);
  });
  assert.ok(result.pixels > 1000, JSON.stringify(result));
  assert.equal(result.alphaChanged, 0);
});

test("a one-pixel warp footprint preserves valid color instead of sampling outside the bitmap", async () => {
  const result = await page.evaluate(() => {
    const { applyBeauty } = window.portraitTest;
    const source = document.createElement("canvas");
    source.width = source.height = 1;
    const context = source.getContext("2d");
    const pixel = context.createImageData(1, 1);
    pixel.data.set([180, 130, 100, 255]);
    context.putImageData(pixel, 0, 0);
    const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    face[234] = { x: 0, y: 0.5 };
    face[454] = { x: 1, y: 0.5 };
    face[168] = { x: 0.5, y: 0 };
    face[152] = { x: 0.5, y: 1 };
    for (const index of [132, 58, 172, 136, 150, 149, 176])
      face[index] = { x: 0, y: 0 };
    for (const index of [361, 288, 397, 365, 379, 378, 400])
      face[index] = { x: 1, y: 0 };
    const output = applyBeauty(source, [face], { slim: 100 });
    return Array.from(output.getContext("2d").getImageData(0, 0, 1, 1).data);
  });
  assert.deepEqual(result, [180, 130, 100, 255]);
});

test("missing landmarks leave geometry and cheek color unchanged", async () => {
  const result = await page.evaluate(() => {
    const { render, changed } = window.portraitTest;
    return changed(render({ slim: 100, blush: 100 }, 0, 0, false));
  });
  assert.equal(result.pixels, 0);
});

test("skin whitening preserves eyes, brows, lips and skin-colored background exactly", async () => {
  const result = await page.evaluate(() => {
    const { render, changed } = window.portraitTest;
    const sample = render({ whiten: 100 });
    let maximumLift = 0;
    for (let i = 0; i < sample.after.length; i += 4)
      for (let c = 0; c < 3; c++)
        maximumLift = Math.max(
          maximumLift,
          sample.after[i + c] - sample.before[i + c],
        );
    return {
      skin: changed(sample, [105, 232, 150, 270]),
      eyes: changed(sample, [120, 199, 130, 206]),
      brows: changed(sample, [120, 179, 130, 183]),
      lips: changed(sample, [170, 289, 190, 297]),
      background: changed(sample, [0, 0, 60, 480]),
      all: changed(sample),
      maximumLift,
    };
  });
  assert.ok(result.skin.pixels > 1000, JSON.stringify(result));
  assert.ok(
    result.maximumLift > 8 && result.maximumLift <= 28,
    JSON.stringify(result),
  );
  for (const part of ["eyes", "brows", "lips", "background"])
    assert.equal(result[part].pixels, 0, part);
  assert.equal(result.all.alphaChanged, 0);
});

test("skin smoothing remains local and preserves protected facial features", async () => {
  const result = await page.evaluate(() => {
    const { render, changed } = window.portraitTest;
    const sample = render({ smooth: 100 });
    return {
      skin: changed(sample, [105, 232, 150, 270]),
      eyes: changed(sample, [120, 199, 130, 206]),
      lips: changed(sample, [170, 289, 190, 297]),
      background: changed(sample, [0, 0, 60, 480]),
      all: changed(sample),
    };
  });
  assert.ok(result.skin.pixels > 300, JSON.stringify(result));
  for (const part of ["eyes", "lips", "background"])
    assert.equal(result[part].pixels, 0, part);
  assert.equal(result.all.alphaChanged, 0);
});

test("without face landmarks skin edits do not retouch matching colors across the photograph", async () => {
  const result = await page.evaluate(() => {
    const { render, changed } = window.portraitTest;
    return changed(render({ smooth: 100, whiten: 100 }, 0, 0, false));
  });
  assert.equal(result.pixels, 0);
});

test("skin edits still work on a cropped face without changing canvas size or transparency", async () => {
  const result = await page.evaluate(() => {
    const { render, changed } = window.portraitTest;
    const sample = render({ smooth: 100, whiten: 100 }, -92, 195);
    return {
      changes: changed(sample),
      size: [sample.output.width, sample.output.height],
    };
  });
  assert.ok(result.changes.pixels > 1000, JSON.stringify(result));
  assert.equal(result.changes.alphaChanged, 0);
  assert.deepEqual(result.size, [360, 480]);
});
