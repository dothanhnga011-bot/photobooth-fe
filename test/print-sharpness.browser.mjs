// Độ nét tờ in DNP, đo bằng code thật (renderPrintFrame + worker Lanczos3): ảnh gốc 6240 × 4160 có sọc mảnh,
// khung 1200 × 1800 có sọc ở lề; tờ 2400 × 3600 co về lưới máy in 1240 điểm như phần mềm in (cùng Lanczos3).
// Đo độ tương phản còn lại ở 0,4 chu kỳ / điểm máy in (chi tiết tóc, mi mắt, chữ nhỏ trên khung).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build } from "vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, page;
const fixture = `
  import { renderPrintFrame } from '/src/kiosk/compose.js';
  import { lanczosResample, resampleImage } from '/src/kiosk/lanczos.js';
  const DEVICE = 1240, devScale = DEVICE / 2400;
  const amplitude = (row, f) => { const m = row.reduce((a, b) => a + b, 0) / row.length; let re = 0, im = 0;
    row.forEach((v, x) => { re += (v - m) * Math.cos(2 * Math.PI * f * x); im -= (v - m) * Math.sin(2 * Math.PI * f * x); });
    return (2 / row.length) * Math.hypot(re, im); };
  // Ảnh cắt phủ ô lệch tần số rất nhỏ: lấy đỉnh trong ±2 %.
  const peak = (row, f) => { let best = 0; for (let g = f * 0.98; g <= f * 1.02; g += f * 0.0005) best = Math.max(best, amplitude(row, g)); return best; };
  const gray = (w, h, value) => { const c = new OffscreenCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = value(x, y), o = (y * w + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255; }
    ctx.putImageData(img, 0, 0); return c; };
  const SLOT = { x: 0.1001, y: 0.0833, w: 0.8002, h: 0.3557, kind: 'photo', photo: 1 };
  let assets;
  async function setup() {
    if (assets) return assets;
    const perDev = 6240 / (SLOT.w * 2400 * devScale);
    // Ảnh gốc: sọc 0,4 chu kỳ / điểm máy in ở nửa trên; nửa dưới: trái tối, phải sáng (kiểm tra lật gương).
    const photo = await gray(6240, 4160, (x, y) => y < 2080 ? Math.round(128 + 100 * Math.sin(2 * Math.PI * (0.4 / perDev) * x)) : (x < 3120 ? 40 : 220))
      .convertToBlob({ type: 'image/png' });
    // Khung: lề dưới (y 1500–1700) có sọc 0,4 chu kỳ / điểm máy in.
    const art = await gray(1200, 1800, (x, y) => y >= 1500 && y < 1700 ? Math.round(128 + 100 * Math.sin(2 * Math.PI * (0.4 * DEVICE / 1200) * x)) : 240)
      .convertToBlob({ type: 'image/png' });
    return (assets = { photo, frame: { _id: 'f', name: 'probe', printSize: 'full', image: URL.createObjectURL(art), slots: [SLOT] } });
  }
  window.sheet = async (sharp) => {
    const { photo, frame } = await setup();
    const sheet = await renderPrintFrame(frame, [{ key: 'a', image: photo, mirrored: false }], 'tok', '', { scale: 2, strict: true, sharp });
    const data = sheet.getContext('2d').getImageData(0, 0, sheet.width, sheet.height).data;
    const devH = Math.round(sheet.height * devScale);
    const dev = lanczosResample(data, sheet.width, sheet.height, DEVICE, devH);
    const row = (y, x0, x1) => { const r = []; for (let x = x0; x < x1; x++) r.push(dev[(y * DEVICE + x) * 4 + 1]); return r; };
    const sx0 = Math.ceil(SLOT.x * DEVICE) + 20, sx1 = Math.floor((SLOT.x + SLOT.w) * DEVICE) - 20;
    return {
      photo: peak(row(Math.round((SLOT.y + SLOT.h / 4) * devH), sx0, sx1), 0.4) / 100,
      frame: peak(row(Math.round(1600 / 1800 * devH), 30, DEVICE - 30), 0.4) / 100,
    };
  };
  // Khung nhỏ 2 dải: 4 ô + 4 ô bản sao, ảnh co gần 6 lần (đi đường gộp 2 × 2), ảnh thứ hai lật gương.
  window.strip = async () => {
    const { photo, frame } = await setup();
    const slots = [];
    for (let i = 0; i < 2; i++) slots.push({ x: 0.03, y: 0.03 + i * 0.4, w: 0.44, h: 0.36, kind: 'photo', photo: i + 1 });
    for (let i = 0; i < 2; i++) slots.push({ x: 0.53, y: 0.03 + i * 0.4, w: 0.44, h: 0.36, kind: 'photo', photo: i + 1 });
    const shots = [{ key: 'a', image: photo, mirrored: false }, { key: 'b', image: photo, mirrored: true }];
    const sheet = await renderPrintFrame({ ...frame, _id: 's', printSize: 'strip', slots }, shots, 'tok', '', { scale: 2, strict: true, sharp: true });
    const ctx = sheet.getContext('2d');
    const at = (fx, fy) => ctx.getImageData(Math.round(fx * sheet.width), Math.round(fy * sheet.height), 1, 1).data[1];
    // Nửa dưới ảnh: trái tối / phải sáng; ảnh lật gương thì ngược lại. Ô bản sao giống ô gốc.
    return { plain: [at(0.1, 0.35), at(0.4, 0.35)], mirrored: [at(0.1, 0.75), at(0.4, 0.75)], copy: [at(0.6, 0.75), at(0.9, 0.75)] };
  };
  // Vẽ thu đúng 2 : 1 với làm mượt "low" phải là trung bình 2 × 2 (resampleImage dựa vào điều này).
  window.box = () => {
    const stripes = gray(64, 8, (x) => (x % 4 < 2 ? 0 : 255)), checker = gray(64, 8, (x, y) => ((x + y) % 2 ? 255 : 0));
    const half = (source) => { const c = new OffscreenCanvas(32, 4), ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low'; ctx.drawImage(source, 0, 0, 32, 4);
      return Array.from(ctx.getImageData(0, 1, 32, 1).data.filter((_, i) => i % 4 === 1)); };
    // Cả đường resampleImage: ảnh 6240 điểm co về 1000 (gộp 2 × 2 rồi Lanczos3) vẫn giữ sọc 0,4.
    const fs = 0.4 * 1000 / 6240;
    const wide = gray(6240, 24, (x) => Math.round(128 + 100 * Math.sin(2 * Math.PI * fs * x)));
    const out = resampleImage(wide, { width: 1000, height: 4 }, { x: 0, y: 0, w: 6240, h: 24 }, (w, h) => new OffscreenCanvas(w, h));
    const row = []; for (let x = 20; x < 980; x++) row.push(out.data[(2 * 1000 + x) * 4 + 1]);
    return { stripes: half(stripes), checker: half(checker), kept: peak(row, 0.4) / 100 };
  };
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:print-sharpness.js" } },
    plugins: [{ name: "print-sharpness", enforce: "pre", resolveId: (id) => (id.startsWith("virtual:") ? "\0" + id : null),
      load: (id) => (id === "\0virtual:print-sharpness.js" ? fixture : null) }],
  });
  const assets = new Map(bundle.output.map((a) => ["/" + a.fileName, a.code || a.source]));
  const entry = bundle.output.find((a) => a.isEntry).fileName;
  server = createServer((req, res) => {
    if (assets.has(req.url)) { res.setHeader("Content-Type", "application/javascript"); return res.end(assets.get(req.url)); }
    res.setHeader("Content-Type", "text/html"); res.end(`<script type="module" src="/${entry}"></script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.sheet);
});
after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

test("a 2 : 1 'low' canvas draw is an exact 2 × 2 average, and the reduced Lanczos path keeps fine detail", async () => {
  const { stripes, checker, kept } = await page.evaluate(() => window.box());
  stripes.forEach((v, i) => assert.ok(Math.abs(v - (i % 2 ? 255 : 0)) <= 1, `stripe ${i}: ${v}`));
  checker.forEach((v) => assert.ok(Math.abs(v - 127.5) <= 1, `checker ${v}`));
  assert.ok(kept >= 0.78, `kept ${kept.toFixed(3)}`);
});

test("DNP sheets: photos and frame art keep far more fine detail with one Lanczos3 pass", async () => {
  const before = await page.evaluate(() => window.sheet(false));
  const after = await page.evaluate(() => window.sheet(true));
  // Đo lúc viết: ảnh 0,73 → 0,82, khung 0,42 → 0,65.
  assert.ok(after.photo >= 0.79, `photo ${after.photo.toFixed(3)}`);
  assert.ok(after.frame >= 0.6, `frame ${after.frame.toFixed(3)}`);
  assert.ok(after.photo - before.photo >= 0.05, JSON.stringify({ before, after }));
  assert.ok(after.frame - before.frame >= 0.15, JSON.stringify({ before, after }));
});

test("strip sheets: copies match their slot and a mirrored photo stays mirrored", async () => {
  const { plain, mirrored, copy } = await page.evaluate(() => window.strip());
  assert.ok(plain[0] < 80 && plain[1] > 180, JSON.stringify(plain));
  assert.ok(mirrored[0] > 180 && mirrored[1] < 80, JSON.stringify(mirrored));
  assert.deepEqual(copy, mirrored);
});
