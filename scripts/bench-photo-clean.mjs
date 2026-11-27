/* global gc -- có khi chạy node --expose-gc */
// Synthetic camera-original benchmark. No personal photos, network service or .env is used.
// Run from photobooth-fe: node scripts/bench-photo-clean.mjs --baseline=HEAD --iterations=20
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireBackend = createRequire(new URL("../../photobooth-be/package.json", import.meta.url));
const sharp = requireBackend("sharp");
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--(baseline|iterations|warmup|output)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Unknown option: ${arg}`);
  return [match[1], match[2]];
}));
const iterations = Number(options.iterations || 20), warmup = Number(options.warmup || 3);
assert.ok(Number.isInteger(iterations) && iterations >= 10 && iterations <= 100);
assert.ok(Number.isInteger(warmup) && warmup >= 1 && warmup <= 20);
const baselineCommit = execFileSync("git", ["rev-parse", options.baseline || "HEAD"], {
  cwd: root, encoding: "utf8",
}).trim();
const before = execFileSync("git", ["show", `${baselineCommit}:src/kiosk/jpeg-clean.js`], {
  cwd: root, encoding: "utf8",
});
const after = await readFile(join(root, "src/kiosk/jpeg-clean.js"), "utf8");
const cameraImage = await readFile(join(root, "src/kiosk/camera-image.js"), "utf8");
const imageCanvas = await readFile(join(root, "src/image-canvas.js"), "utf8");
const output = resolve(root, options.output || ".cache/bench-photo-clean.json");

async function cameraFixture() {
  const width = 6240, height = 4160, seed = 0x50484f54;
  const raw = Buffer.allocUnsafe(width * height * 3);
  let state = seed;
  for (let i = 0; i < raw.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    raw[i] = state & 255;
  }
  const target = 15 * 1024 * 1024;
  let low = 60, high = 95, selected;
  // Pick a realistic ~15 MiB original; the same JPEG is supplied to both versions.
  while (low <= high) {
    const quality = Math.floor((low + high) / 2);
    const bytes = await sharp(raw, { raw: { width, height, channels: 3 } })
      .withMetadata({ orientation: 6, exif: { IFD0: { Make: "SYNTHETIC", Artist: "benchmark fixture" } } })
      .jpeg({ quality, chromaSubsampling: "4:2:0" }).toBuffer();
    if (!selected || Math.abs(bytes.length - target) < Math.abs(selected.bytes.length - target))
      selected = { quality, bytes };
    if (bytes.length < target) low = quality + 1;
    else high = quality - 1;
  }
  return {
    bytes: selected.bytes,
    info: {
      width, height, pixels: width * height, seed, jpegQuality: selected.quality,
      bytes: selected.bytes.length, sha256: createHash("sha256").update(selected.bytes).digest("hex"),
      source: "Deterministic xorshift RGB noise with synthetic EXIF orientation 6 and sRGB profile",
    },
  };
}

console.log(`Preparing 26 MP synthetic JPEG; comparing ${baselineCommit.slice(0, 12)} with working tree.`);
const fixture = await cameraFixture();
const temporary = await mkdtemp(join(tmpdir(), "photobooth-photo-bench-"));
const fixturePath = join(temporary, "camera.jpg");
await writeFile(fixturePath, fixture.bytes);
const server = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/fixture.jpg") {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", fixture.info.bytes);
    createReadStream(fixturePath).pipe(res);
  } else if (req.url === "/before.js" || req.url === "/after.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(req.url === "/before.js" ? before : after);
  } else if (["/kiosk/camera-image.js", "/image-canvas.js", "/preview-worker.js"].includes(req.url)) {
    res.setHeader("Content-Type", "application/javascript");
    res.end(req.url === "/kiosk/camera-image.js" ? cameraImage : req.url === "/image-canvas.js" ? imageCanvas
      : 'import { prepareCameraImage } from "/kiosk/camera-image.js"; onmessage = async ({ data }) => postMessage(await prepareCameraImage(data, true));');
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Photo cleanup benchmark</title>");
  }
});
let browser;
try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, args: ["--js-flags=--expose-gc"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  console.log(`Benchmarking ${fixture.info.bytes} bytes, ${warmup} warmups and ${iterations} alternating pairs per mode.`);
  const measurements = await page.evaluate(async ({ iterations, warmup }) => {
    const versions = {
      before: (await import("/before.js")).cleanCameraJpeg,
      after: (await import("/after.js")).cleanCameraJpeg,
    };
    const image = await (await fetch("/fixture.jpg")).blob();
    // Match the booth's worker path, using its unchanged 1600 px / JPEG 0.92 preview function.
    const worker = new Worker("/preview-worker.js", { type: "module" });
    const preview = (file) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = reject;
      worker.postMessage(file);
    });
    const previewBlob = await preview(image);
    const previewBitmap = await createImageBitmap(previewBlob);
    const previewInfo = { width: previewBitmap.width, height: previewBitmap.height, bytes: previewBlob.size,
      mimeType: previewBlob.type, source: "Current camera-image.js prepareCameraImage in a module worker" };
    previewBitmap.close();
    const outputs = await Promise.all(Object.values(versions).map((clean) => clean(image).then((blob) => blob.arrayBuffer())));
    const a = new Uint8Array(outputs[0]), b = new Uint8Array(outputs[1]);
    if (a.length !== b.length || a.some((value, i) => value !== b[i]))
      throw new Error("Before/after JPEG bytes differ");
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", outputs[0]))]
      .map((value) => value.toString(16).padStart(2, "0")).join("");
    const modes = {};
    for (const scenario of [
      { name: "cleanup", materialize: false, preview: false },
      { name: "cleanupAndMaterialize", materialize: true, preview: false },
      { name: "previewThenCleanup", materialize: false, preview: true },
    ]) {
      const run = async (name) => {
        // Collection happens outside the measured interval for both versions.
        if (typeof gc === "function") gc();
        const started = performance.now();
        if (scenario.preview) await preview(image);
        const cleaned = await versions[name](image);
        if (scenario.materialize) await cleaned.arrayBuffer();
        return performance.now() - started;
      };
      for (let i = 0; i < warmup; i++) {
        await run(i % 2 ? "after" : "before");
        await run(i % 2 ? "before" : "after");
      }
      const samples = { before: [], after: [] };
      for (let i = 0; i < iterations; i++) {
        const order = i % 2 ? ["after", "before"] : ["before", "after"];
        for (const name of order) samples[name].push(await run(name));
      }
      modes[scenario.name] = samples;
    }
    worker.terminate();
    return { modes, identicalBytes: a.length, sha256: digest, userAgent: navigator.userAgent,
      forcedGcBetweenSamples: typeof gc === "function", preview: previewInfo };
  }, { iterations, warmup });
  const summarize = (values) => {
    const ordered = [...values].sort((a, b) => a - b);
    return {
      medianMs: (ordered[(ordered.length - 1) >> 1] + ordered[ordered.length >> 1]) / 2,
      p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1], minMs: ordered[0], samplesMs: values,
    };
  };
  const timings = Object.fromEntries(Object.entries(measurements.modes).map(([name, samples]) => {
    const old = summarize(samples.before), current = summarize(samples.after);
    return [name, { before: old, after: current, medianReductionPercent: (1 - current.medianMs / old.medianMs) * 100 }];
  }));
  const report = {
    benchmark: "Camera JPEG metadata cleanup in real headless Chromium; local CPU/Blob work only",
    baselineCommit, currentSourceSha256: createHash("sha256").update(after).digest("hex"),
    browser: browser.version(), userAgent: measurements.userAgent, sharp: sharp.versions,
    iterations, warmup, order: "alternating before/after pairs", fixture: fixture.info,
    preview: measurements.preview,
    byteIdentity: { equal: true, bytes: measurements.identicalBytes, sha256: measurements.sha256 },
    forcedGcBetweenSamples: measurements.forcedGcBetweenSamples, timings,
    limits: ["Excludes camera file import, network upload and storage response time",
      "cleanup and cleanupAndMaterialize exclude preview rendering; previewThenCleanup includes the unchanged worker preview path",
      "A synthetic noise image measures byte cleanup, not photo content or compression quality"],
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  for (const [name, values] of Object.entries(timings))
    console.log(`${name}: before ${values.before.medianMs.toFixed(2)} ms, after ${values.after.medianMs.toFixed(2)} ms; median reduction ${values.medianReductionPercent.toFixed(1)}%`);
  console.log(`Identical ${measurements.identicalBytes} output bytes. Report: ${output}`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await unlink(fixturePath);
  await rmdir(temporary);
}
