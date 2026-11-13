import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDetectionViews,
  detectFaceLandmarks,
  mapLandmarks,
} from "../src/face-detection.js";

const close = (actual, expected, tolerance = 1e-7) => {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} differs from ${expected}`,
  );
};

function faceFixture(width = 1920, height = 2560) {
  const points = Array.from({ length: 478 }, (_value, index) => ({
    x: width * (0.5 + 0.18 * Math.sin(index)),
    y: height * (0.55 + 0.21 * Math.cos(index)),
  }));
  points[234] = { x: width * 0.25, y: height * 0.55 };
  points[454] = { x: width * 0.75, y: height * 0.55 };
  points[33] = { x: width * 0.35, y: height * 0.4 };
  points[263] = { x: width * 0.65, y: height * 0.4 };
  points[168] = { x: width * 0.5, y: height * 0.43 };
  points[152] = { x: width * 0.5, y: height * 0.8 };
  return points;
}

function normalize(points, view) {
  const { a, b, c, d, e, f } = view.transform;
  return points.map(({ x, y }) => ({
    x: (a * x + c * y + e) / view.width,
    y: (b * x + d * y + f) / view.height,
  }));
}

function canvasAdapter() {
  const canvases = [];
  const createCanvas = () => {
    const canvas = {
      width: 0,
      height: 0,
      transforms: [],
      draws: [],
      backgrounds: [],
    };
    const context = {
      setTransform: (...matrix) => canvas.transforms.push(matrix),
      drawImage: (...args) => canvas.draws.push(args),
      fillRect: (...args) =>
        canvas.backgrounds.push({ args, color: context.fillStyle }),
    };
    canvas.getContext = () => context;
    canvases.push(canvas);
    return canvas;
  };
  return { createCanvas, canvases };
}

test("large phone portraits use bounded detection bitmaps with padding and tilt fallbacks", () => {
  const views = createDetectionViews(1920, 2560);
  assert.ok(views.every((view) => view.width <= 1024 && view.height <= 1024));
  assert.equal(views[0].padded, false);
  close(views[0].width / views[0].height, 1920 / 2560);
  assert.ok(
    views.slice(1).every((view) => view.padded && view.width === view.height),
  );
  assert.ok(views.some((view) => view.rotation === 90));
  assert.ok(views.some((view) => view.rotation === -90));
  assert.ok(views.some((view) => view.rotation === 180));
  const padded = views.find((view) => view.padded && view.rotation === 0);
  assert.ok(padded.transform.e > 0 && padded.transform.f > 0);
});

test("every rotated and padded detection view maps landmarks precisely back to original pixels", () => {
  const points = [...faceFixture(), { x: -23, y: 2740 }];
  for (const view of createDetectionViews(1920, 2560)) {
    const mapped = mapLandmarks(normalize(points, view), view);
    mapped.forEach((point, index) => {
      close(point.x, points[index].x);
      close(point.y, points[index].y);
    });
  }
});

test("landmarks map without distortion when small or unusually wide photos require rounded canvas sizes", () => {
  for (const [width, height] of [
    [403, 601],
    [4097, 731],
    [723, 4112],
  ]) {
    const points = faceFixture(width, height);
    for (const view of createDetectionViews(width, height)) {
      const mapped = mapLandmarks(normalize(points, view), view);
      mapped.forEach((point, index) => {
        close(point.x, points[index].x);
        close(point.y, points[index].y);
      });
    }
  }
});

test("close-up padding recovers a face after the first view misses it and stops immediately", async () => {
  const width = 1920;
  const height = 2560;
  const source = { width, height };
  const points = faceFixture(width, height);
  const views = createDetectionViews(width, height);
  const adapter = canvasAdapter();
  let calls = 0;
  let yielded = 0;
  const result = await detectFaceLandmarks(
    source,
    {
      detect(canvas) {
        const index = calls++;
        assert.equal(canvas.width, views[index].width);
        assert.equal(canvas.height, views[index].height);
        assert.deepEqual(
          canvas.transforms[0],
          Object.values(views[index].transform),
        );
        return {
          faceLandmarks: index === 1 ? [normalize(points, views[index])] : [],
        };
      },
    },
    { ...adapter, yieldFrame: async () => yielded++ },
  );
  assert.equal(calls, 2);
  assert.equal(yielded, 2);
  assert.equal(result.length, 1);
  result[0].forEach((point, index) => {
    close(point.x, points[index].x);
    close(point.y, points[index].y);
  });
  assert.deepEqual(source, { width, height });
  assert.ok(
    adapter.canvases.every(
      (canvas) => canvas.width === 1 && canvas.height === 1,
    ),
  );
  assert.ok(adapter.canvases.every((canvas) => canvas.draws[0][0] === source));
});

test("upside-down fallback returns both faces in original coordinates", async () => {
  const source = { width: 800, height: 1100 };
  const points = faceFixture(source.width, source.height);
  const secondFace = points.map(({ x, y }) => ({ x: x + 35, y: y - 20 }));
  const views = createDetectionViews(source.width, source.height);
  const successIndex = views.findIndex((view) => view.rotation === 180);
  let calls = 0;
  const result = await detectFaceLandmarks(
    source,
    {
      detect() {
        const index = calls++;
        return {
          faceLandmarks:
            index === successIndex
              ? [
                  normalize(points, views[index]),
                  normalize(secondFace, views[index]),
                ]
              : [],
        };
      },
    },
    { ...canvasAdapter(), yieldFrame: async () => {} },
  );
  assert.equal(calls, successIndex + 1);
  assert.equal(result.length, 2);
  for (const [faceIndex, original] of [points, secondFace].entries()) {
    result[faceIndex].forEach((point, index) => {
      close(point.x, original[index].x);
      close(point.y, original[index].y);
    });
  }
});

test("invalid or incomplete meshes cannot prevent a later valid fallback detection", async () => {
  const source = { width: 360, height: 480 };
  const points = faceFixture(source.width, source.height);
  const views = createDetectionViews(source.width, source.height);
  let calls = 0;
  const result = await detectFaceLandmarks(
    source,
    {
      detect() {
        const index = calls++;
        if (index === 0) return { faceLandmarks: [[{ x: 0.5, y: 0.5 }]] };
        if (index === 1) {
          const invalid = normalize(points, views[index]);
          invalid[50].x = NaN;
          return { faceLandmarks: [invalid] };
        }
        return { faceLandmarks: [normalize(points, views[index])] };
      },
    },
    { ...canvasAdapter(), yieldFrame: async () => {} },
  );
  assert.equal(calls, 3);
  assert.equal(result.length, 1);
  close(result[0][50].x, points[50].x);
});

test("successful empty inference exhausts fallbacks while runtime failure remains an error", async () => {
  const source = { width: 360, height: 480 };
  let emptyCalls = 0;
  const result = await detectFaceLandmarks(
    source,
    {
      detect: () => {
        emptyCalls++;
        return { faceLandmarks: [] };
      },
    },
    { ...canvasAdapter(), yieldFrame: async () => {} },
  );
  assert.deepEqual(result, []);
  assert.equal(
    emptyCalls,
    createDetectionViews(source.width, source.height).length,
  );
  let failures = 0;
  await assert.rejects(
    detectFaceLandmarks(
      source,
      {
        detect: () => {
          failures++;
          throw new Error("model execution failed");
        },
      },
      { ...canvasAdapter(), yieldFrame: async () => {} },
    ),
    /model execution failed/,
  );
  assert.equal(failures, 1);
});

test("HTML image detection uses natural dimensions and rejects empty images before inference", async () => {
  const source = {
    width: 90,
    height: 120,
    naturalWidth: 360,
    naturalHeight: 480,
  };
  const adapter = canvasAdapter();
  let calls = 0;
  await detectFaceLandmarks(
    source,
    {
      detect: () => {
        calls++;
        return { faceLandmarks: [] };
      },
    },
    { ...adapter, yieldFrame: async () => {} },
  );
  assert.deepEqual(adapter.canvases[0].draws[0].slice(1), [0, 0, 360, 480]);
  assert.equal(calls, createDetectionViews(360, 480).length);
  await assert.rejects(
    detectFaceLandmarks(
      { width: 0, height: 0 },
      {
        detect: () => {
          throw new Error("must not run");
        },
      },
      { ...canvasAdapter(), yieldFrame: async () => {} },
    ),
    RangeError,
  );
  for (const size of [0, -2, NaN, Infinity]) {
    assert.throws(() => createDetectionViews(size, 480), RangeError);
  }
});
