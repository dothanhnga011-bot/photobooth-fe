// Album phòng Selfbooth trên điện thoại, giống album của web Selfbooth: khách quét QR → 01 Ảnh (thư viện: thả tim,
// làm đẹp, xoá, thêm ảnh từ điện thoại) → 02 Chủ đề (một bộ khung) → 03 Ghép ảnh (mọi khung của bộ, ô nghiêng
// của khung chép từ Selfbooth) → 04 Kết quả (mỗi khung một tờ 20 × 30, chọn tờ rồi gửi in lên Hàng chờ in của
// quầy, nhân viên in ra máy DNP DS820). Không tính giờ: chỉ gửi in khi khách bấm Gửi in.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

function png(width, height, color) {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(color(x, y), y * row + 1 + x * 4);
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const dataUrl = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;
// Kích thước ảnh JPEG (khung SOF).
function jpegSize(buf) {
  for (let i = 2; i < buf.length;) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}
// Khung ngang 3 : 2 (tờ 20 × 30 ngang 3600 × 2400), hai ô ảnh trong suốt.
const SLOTS = [
  { x: 0.03, y: 0.07, w: 0.455, h: 0.86, kind: "photo", photo: 1 },
  { x: 0.515, y: 0.07, w: 0.455, h: 0.86, kind: "photo", photo: 2 },
];
const inside = (x, y) => SLOTS.some((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
const frameArt = (border) => dataUrl(png(360, 240, (x, y) => (inside(x / 360, y / 240) ? [0, 0, 0, 0] : border)));
// Ô nghiêng như khung chép từ Selfbooth: ô phải xoay 12°.
const TILTED = [SLOTS[0], { ...SLOTS[1], x: 0.55, y: 0.15, w: 0.38, h: 0.7, angle: 12 }];
const FRAMES = [
  // Bộ "Hoa": 2 khung × 2 ô — mỗi khung một tờ 20 × 30.
  { _id: "white", name: "Trắng", themeName: "Hoa", order: 1, printSize: "large", active: true, image: frameArt([255, 255, 255, 255]), slots: SLOTS },
  { _id: "pink", name: "Hồng", themeName: "Hoa", order: 2, printSize: "large", active: true, image: frameArt([240, 150, 180, 255]), slots: SLOTS },
  { _id: "tilt", name: "Nghiêng", themeName: "Selfbooth", order: 1, printSize: "large", active: true, image: frameArt([250, 240, 225, 255]), slots: TILTED },
];
const TALL_FRAME = {
  ...FRAMES[0], _id: "tall", themeName: "Khung 1",
  image: dataUrl(png(240, 360, (x, y) => y % 120 > 12 && y % 120 < 104 && x > 14 && x < 225
    ? [246, 239, 229, 255] : [72, 46, 36, 255])),
};
// Ảnh số n một màu riêng: đọc màu ở giữa ô của ảnh in để biết ảnh nào vào ô nào.
const COLORS = { 1: [220, 40, 40, 255], 2: [40, 180, 60, 255], 3: [40, 80, 220, 255], 4: [230, 200, 30, 255] };
const photos = Object.fromEntries(Object.entries(COLORS).map(([n, c]) => [n, png(300, 400, () => c)]));

let server, browser, base, portrait;
// Bộ chấm khuôn mặt giả thay cho MediaPipe (gợi ý ảnh đẹp): mặt của từng ảnh lấy ở window.fixtureFaces, dấu vân
// ảnh ở window.fixtureHashes (mặc định mỗi ảnh một dấu khác hẳn: "1111…", "2222…").
const FAKE_FACE_SCORE = `
  export const warmScorer = () => {
    const first = [...document.querySelectorAll('.studio-grid img[loading=eager]')];
    window.fixtureWarmAfterPhotos = first.length > 0 && first.every(img => img.complete && img.naturalWidth);
  };
  export async function loadPhoto(token, photo) {
    window.fixtureLoaded = (window.fixtureLoaded || 0) + 1;
    return { id: photo.id, close() { window.fixtureClosed = (window.fixtureClosed || 0) + 1; } };
  }
  export async function scoreLoaded(loaded) {
    const faces = window.fixtureFaces?.[loaded.id];
    if (faces === "unavailable") throw Object.assign(new Error("no model"), { code: "FACE_DETECTION_UNAVAILABLE" });
    window.fixtureScored = (window.fixtureScored || 0) + 1;
    const digit = (Number(loaded.id.slice(1)) % 15 + 1).toString(16);
    return { faces: faces || [], hash: window.fixtureHashes?.[loaded.id] ?? digit.repeat(16) };
  }
`;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter, Route, Routes } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { AlbumPage } from '/src/pages.jsx';
  import { FrameImageField } from '/src/admin/frame-image-field.jsx';
  import '/src/kiosk/decor-fonts.js';
  import '/src/tailwind.css';
  (async () => {
    const frames = location.search === '?tall-frame' ? [${JSON.stringify(TALL_FRAME)}] : ${JSON.stringify(FRAMES)};
    window.fixtureFrames = frames;
    const studio = { settings: {}, packages: [], frames };
    const FrameFixture = () => {
      const [frame, setFrame] = React.useState({ image: '', slots: [] });
      return React.createElement('div', { className: 'admin-shell' },
        React.createElement('div', { className: 'catalog-editor' },
          React.createElement(FrameImageField, { value: frame, onChange: setFrame })));
    };
    const view = location.search === '?frame-editor' ? React.createElement(FrameFixture) : React.createElement(AlbumPage);
    createRoot(document.getElementById('root')).render(
      React.createElement(MemoryRouter, { initialEntries: ['/album/fixture-album'] },
        React.createElement(StudioContext.Provider, { value: studio },
          React.createElement(ToastProvider, null,
            React.createElement(Routes, null, React.createElement(Route, { path: '/album/:token', element: view }))))));
  })();
`;

before(async () => {
  await mkdir(resolve('.cache/main-flows'), { recursive: true });
  portrait = await readFile(new URL('../src/admin/assets/rx1-preview-default.jpg', import.meta.url));
  const bundle = await build({
    // Ổ đĩa viết hoa ("C:", như đường dẫn thật Vite đọc ra cho node_modules): thư mục đang đứng có thể là "c:",
    // khác chữ hoa ổ đĩa thì Vite nạp React (và ngữ cảnh Toast) hai lần.
    root: fileURLToPath(new URL('..', import.meta.url)).replace(/^[a-z]:/, (drive) => drive.toUpperCase()),
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:selfbooth.jsx" } },
    plugins: [tailwindcss(), { name: "selfbooth-fixture", enforce: "pre",
      resolveId: (id) => (id.startsWith("virtual:") ? "\0" + id : null),
      load: (id) => (id === "\0virtual:selfbooth.jsx" ? fixture
        : id.replace(/\\/g, "/").endsWith("/src/album/selfbooth/face-score.js") ? FAKE_FACE_SCORE : null) }],
  });
  const assets = new Map(bundle.output.map((a) => ["/" + a.fileName, a.code || a.source]));
  const entry = bundle.output.find((a) => a.isEntry).fileName;
  const css = bundle.output.filter((a) => a.fileName.endsWith(".css"));
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.webp') ? 'image/webp'
      : path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.woff2') ? 'font/woff2'
        : path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.task') ? 'application/octet-stream' : 'application/javascript';
    if (assets.has(path)) {
      res.setHeader("Content-Type", type);
      return res.end(assets.get(path));
    }
    if (/^\/fonts\/[\w-]+\.woff2$/.test(path) || path === '/logo-m-384.jpg') {
      res.setHeader('Content-Type', type);
      return res.end(await readFile(new URL('../public' + path, import.meta.url)));
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><div id="root"></div>${css.map((a) => `<link rel="stylesheet" href="/${a.fileName}">`).join("")}<script type="module" src="/${entry}"></script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

async function phone({ faces = null, hashes = null, originalPending = false, photoCount = 4, printError = null, lostReply = false,
  viewport = { width: 390, height: 844 }, realPhoto = false, prints: quota = 1, desktop = false, size = "large", ios = false,
  android = false, shareUnavailable = false, shareError = null,
  holdThumbnail, restoreStep, tallFrame = false, expiredShareTap = false, maxShareFiles = null, quotaConflictUsed = null } = {}) {
  const page = await browser.newPage(desktop ? { viewport } : { viewport, isMobile: true, hasTouch: true,
    ...(ios && { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" }),
    ...(android && { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36" }) });
  const errors = [], prints = [], mediaRequests = [], deletes = [], uploads = [], asked = [], downloads = [];
  let releaseThumbnail;
  const thumbnailGate = new Promise(resolve => { releaseThumbnail = resolve; });
  let savedJob = null, failedOnce = false;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  const booking = {
    _id: "b", code: "246810", status: "completed", printSize: size, selectCount: 2, prints: quota, printSheets: 0,
    mediaExpiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    photos: Array.from({length:photoCount},(_,i)=>i+1).map((n) => ({ id: `p${n}`, number: n, kind: "original", ...(originalPending && {originalPending:true}) })),
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    asked.push(path);
    // Khách xoá ảnh: máy chủ ẩn ảnh và đánh số lại.
    if (path.endsWith("/albums/fixture-album/photos") && method === "DELETE") {
      const { ids } = JSON.parse(route.request().postData());
      deletes.push(ids);
      booking.photos = booking.photos.filter((p) => !ids.includes(p.id)).map((p, i) => ({ ...p, number: i + 1 }));
      return route.fulfill({ json: booking });
    }
    // Thêm ảnh từ điện thoại (không phải JPEG: gửi qua máy chủ).
    if (path.endsWith("/albums/fixture-album/photos") && method === "POST") {
      uploads.push(route.request().headers()["content-type"]);
      const n = booking.photos.length + 1;
      booking.photos = [...booking.photos, { id: "p9", number: n, kind: "original", clientKey: "upload" }];
      return route.fulfill({ status: 201, json: booking });
    }
    const media = path.match(/\/albums\/fixture-album\/photos\/p(\d+)$/);
    if (media) {
      mediaRequests.push(url.searchParams.get('size'));
      if (media[1] === String(holdThumbnail) && url.searchParams.get("size") === "thumbnail") await thumbnailGate;
      const downloadable = url.searchParams.get("download") === "1";
      if (downloadable) downloads.push(Number(media[1]));
      return route.fulfill({ body: realPhoto ? portrait : photos[media[1]] || photos[1],
        headers: downloadable ? { "Content-Disposition": `attachment; filename="anh-${media[1].padStart(2, '0')}.jpg"` } : {},
        contentType: realPhoto ? 'image/jpeg' : "image/png" });
    }
    if (path.endsWith('/albums/fixture-album/print')) return route.fulfill({json:savedJob});
    if (path.endsWith("/albums/fixture-album/print-pack")) {
      const headers = route.request().headers();
      prints.push({ sizes: headers["x-print-sheets"], frame: decodeURIComponent(headers["x-print-frame"]), key: headers["x-print-key"],
        body: route.request().postDataBuffer() });
      if(printError && !failedOnce){failedOnce=true;return route.fulfill({status:409,json:{message:printError}})}
      if (quotaConflictUsed !== null && !failedOnce) {
        failedOnce = true;
        booking.printSheets = quotaConflictUsed;
        return route.fulfill({ status: 409, json: {
          code: "PRINT_QUOTA", message: "Vé còn 1 tờ in. Hãy bỏ chọn bớt.",
          prints: booking.prints, printSheets: booking.printSheets,
        } });
      }
      const sheets = (headers["x-print-sheets"] || "").split(",").length;
      booking.printSheets += sheets;
      savedJob={_id:'job',status:'pending',printSheets:booking.printSheets};
      if(lostReply && !failedOnce){failedOnce=true;return route.abort('failed')}
      return route.fulfill({ status: 201, json: { _id: "job", status: "pending", prints: booking.prints, printSheets: booking.printSheets } });
    }
    if (path.endsWith("/albums/fixture-album")) return route.fulfill({ json: booking });
    return route.fulfill({ status: 404, json: { message: `unexpected ${path}` } });
  });
  if (faces) await page.addInitScript((value) => { window.fixtureFaces = value; }, faces);
  if (hashes) await page.addInitScript((value) => { window.fixtureHashes = value; }, hashes);
  if (restoreStep !== undefined) await page.addInitScript(step => {
    localStorage.setItem("selfbooth-album-v2-fixture-album", JSON.stringify({ step }));
  }, restoreStep);
  if (ios || android) await page.addInitScript(({ expiredShareTap, maxShareFiles, shareUnavailable, shareError }) => {
    window.sharedBatches = [];
    window.allowShare = !expiredShareTap;
    window.shareError = shareError;
    const activation = navigator.userActivation;
    Object.defineProperty(navigator, "userActivation", { value: {
      get isActive() { return window.allowShare && activation.isActive; },
    } });
    navigator.canShare = ({ files }) => !shareUnavailable && (maxShareFiles === null || files.length <= maxShareFiles)
      && files.every(f => f.type === "image/jpeg");
    navigator.share = async ({ files }) => {
      if (!navigator.userActivation.isActive) throw new DOMException("Gesture needed", "NotAllowedError");
      if (window.shareError) throw new DOMException("Unable to open the share sheet", window.shareError);
      window.sharedBatches.push(files.map(f => f.name));
    };
  }, { expiredShareTap, maxShareFiles, shareUnavailable, shareError });
  await page.goto(`${base}/album/fixture-album${tallFrame ? "?tall-frame" : ""}`);
  return { page, errors, prints, mediaRequests, deletes, uploads, booking, asked, downloads, releaseThumbnail,
    originalsReady:()=>{booking.photos.forEach(p=>delete p.originalPending)} };
}

// Các tấm của một lệnh in (byte nối liền, X-Print-Sheets ghi cỡ từng tấm).
const sheetsOf = (print) => {
  let at = 0;
  return print.sizes.split(",").map(Number).map((size) => print.body.subarray(at, (at += size)));
};
// Màu ở điểm (tỉ lệ 0–1) của một tờ đã gửi in.
const sheetColor = (page, jpeg, fx, fy) => page.evaluate(async ([b64, fx, fy]) => {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${b64}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return [...ctx.getImageData(Math.round(fx * canvas.width), Math.round(fy * canvas.height), 1, 1).data].slice(0, 3);
}, [jpeg.toString("base64"), fx, fy]);
const grey = ([r, g, b]) => Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r > 120;
const isRed = ([r, g, b]) => r > 170 && g < 90 && b < 90;
const isBlue = ([r, g, b]) => b > 170 && r < 90;
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("selfbooth-album-v2-fixture-album")));
const step = (page) => page.locator('.studio-steps [aria-current="step"]').textContent();

const canvasReady = (page) => page.waitForFunction(() => document.querySelector(".frame-canvas canvas")?.width > 100);
// Khách tự đi hết các bước với bộ "Selfbooth" (1 khung, 2 ô) rồi xem thành phẩm.
async function toResult(page) {
  for (const n of ["03", "01"]) await page.getByRole("button", { name: `Thả tim ảnh ${n}` }).click();
  await page.getByRole("button", { name: "Chọn khung in", exact: true }).click();
  await page.getByRole("button", { name: "Chọn bộ Selfbooth, 1 khung, 2 ô ảnh" }).click();
  await page.locator(".theme-action-bar").getByRole("button", { name: /Ghép ảnh/ }).click();
  await page.locator(".frame-nav").waitFor();
  await page.getByRole("button", { name: /Xem bản in/ }).click();
  await page.getByRole("heading", { name: "Thành phẩm của bạn" }).waitFor();
}
const tap = async (page, label, fx, fy) => {
  const box = await page.getByLabel(label).boundingBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
};

test("Selfbooth desktop downloads individual JPEG files without a ZIP request", async () => {
  const { page, asked, errors } = await phone({ photoCount: 2, realPhoto: true, desktop: true });
  try {
    const files = [];
    page.on("download", file => files.push(file.suggestedFilename()));
    await page.getByRole("button", { name: "Lưu tất cả ảnh" }).click();
    for (let i = 0; i < 50 && files.length < 2; i++) await page.waitForTimeout(100);
    assert.deepEqual(files.sort(), ["anh-01.jpg", "anh-02.jpg"]);
    assert.equal(asked.some(path => path.endsWith("/download")), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("iPhone-style saving shares every JPEG in one batch even above the old 50-photo limit", async () => {
  const { page, asked, downloads, errors } = await phone({ ios: true, photoCount: 55, realPhoto: true });
  try {
    await page.getByText(/Chọn “Lưu hình ảnh”/).waitFor();
    await page.getByRole("button", { name: "Lưu tất cả ảnh" }).click();
    await page.waitForFunction(() => window.sharedBatches.length === 1);
    await page.getByRole("button", { name: "Lưu tất cả ảnh", exact: true }).waitFor();
    const batches = await page.evaluate(() => window.sharedBatches);
    assert.deepEqual(batches.map(batch => batch.length), [55]);
    assert.equal(new Set(batches.flat()).size, 55);
    assert.equal(downloads.length, 55);
    assert.ok(batches.flat().every(name => name.endsWith(".jpg")));
    assert.equal(asked.some(path => path.endsWith("/download")), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("Android opens the native share sheet without downloading to the Files app", async () => {
  const { page, errors } = await phone({ android: true, photoCount: 2 });
  try {
    const downloads = [];
    page.on("download", file => downloads.push(file.suggestedFilename()));
    await page.getByText(/Chọn ứng dụng Thư viện ảnh/).waitFor();
    await page.getByRole("button", { name: "Lưu tất cả ảnh" }).click();
    await page.waitForFunction(() => window.sharedBatches.length === 1);
    assert.deepEqual(await page.evaluate(() => window.sharedBatches[0]), ["anh-01.jpg", "anh-02.jpg"]);
    assert.deepEqual(downloads, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a mobile browser without file sharing is directed to Safari", async () => {
  const { page, downloads, errors } = await phone({ ios: true, shareUnavailable: true });
  try {
    await page.getByText(/Mở liên kết album trong Safari/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Lưu tất cả ảnh" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Lưu ảnh 01 vào thư viện" }).isDisabled(), true);
    assert.deepEqual(downloads, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a mobile share error keeps the prepared photos and never falls back to file downloads", async () => {
  const { page, downloads, errors } = await phone({ ios: true, photoCount: 2, shareError: "DataError" });
  try {
    const fileDownloads = [];
    page.on("download", file => fileDownloads.push(file.suggestedFilename()));
    await page.getByRole("button", { name: "Lưu tất cả ảnh" }).click();
    await page.getByText(/Chưa mở được bảng chia sẻ/).waitFor();
    const retry = page.getByRole("button", { name: "Lưu 2 ảnh", exact: true });
    await retry.click();
    await page.getByText(/Chưa mở được bảng chia sẻ/).first().waitFor();
    await page.evaluate(() => { window.shareError = null; });
    await retry.click();
    await page.waitForFunction(() => window.sharedBatches.length === 1);
    assert.deepEqual(await page.evaluate(() => window.sharedBatches[0]), ["anh-01.jpg", "anh-02.jpg"]);
    assert.equal(downloads.length, 2, "the retry reuses the already prepared JPEGs");
    assert.deepEqual(fileDownloads, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a phone that accepts fewer files shares a smaller batch and reuses the rest", async () => {
  const { page, downloads, errors } = await phone({ ios: true, photoCount: 14, realPhoto: true, maxShareFiles: 10 });
  try {
    await page.getByRole("button", { name: "Lưu tất cả ảnh" }).click();
    await page.waitForFunction(() => window.sharedBatches.length === 1);
    await page.getByRole("button", { name: "Lưu 4 ảnh còn lại" }).click();
    const batches = await page.evaluate(() => window.sharedBatches);
    assert.deepEqual(batches.map(batch => batch.length), [10, 4]);
    assert.equal(new Set(batches.flat()).size, 14);
    assert.equal(downloads.length, 14);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("an expired iPhone tap leaves the prepared full-quality files ready on the same button", async () => {
  const { page, errors } = await phone({ ios: true, photoCount: 2, realPhoto: true, expiredShareTap: true });
  try {
    await page.getByRole("button", { name: "Lưu tất cả ảnh" }).click();
    const save = page.getByRole("button", { name: "Lưu 2 ảnh", exact: true });
    await save.waitFor();
    assert.deepEqual(await page.evaluate(() => window.sharedBatches), []);
    await page.evaluate(() => { window.allowShare = true; });
    await save.click();
    await page.waitForFunction(() => window.sharedBatches.length === 1);
    assert.deepEqual(await page.evaluate(() => window.sharedBatches[0]), ["anh-01.jpg", "anh-02.jpg"]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a single portrait frame stays inside its preview and above the caption on narrow phones", async () => {
  const { page, errors } = await phone({ tallFrame: true, viewport: { width: 320, height: 568 } });
  try {
    await page.getByRole("button", { name: "Chọn khung in", exact: true }).click();
    const card = page.getByRole("button", { name: "Chọn bộ Khung 1, 1 khung, 2 ô ảnh" });
    await card.waitFor();
    await page.waitForFunction(() => document.querySelector(".theme-preview-frame img")?.naturalHeight === 360);
    const [preview, image, caption] = await Promise.all([
      card.locator(".theme-big-preview").boundingBox(),
      card.locator("img").boundingBox(),
      card.locator(".theme-list-info").boundingBox(),
    ]);
    assert.ok(image.y >= preview.y && image.y + image.height <= caption.y);
    assert.ok(image.x >= preview.x && image.x + image.width <= preview.x + preview.width);
    assert.ok(preview.width > 240, "single frame uses the available screen width");
    const footer = await page.locator(".theme-action-bar").boundingBox();
    assert.ok(footer.y >= caption.y + caption.height, "the action bar leaves the whole frame card visible");
    assert.equal(await card.getAttribute("aria-pressed"), "true");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: resolve(".cache/main-flows/album-theme-portrait-320.png"), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("adding a Selfbooth frame finds its windows and lets the operator draw a small third slot", async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  try {
    await page.goto(`${base}/album/fixture-album?frame-editor`);
    const art = png(360, 240, (x, y) => inside(x / 360, y / 240) ? [0, 0, 0, 0] : [82, 41, 22, 255]);
    await page.getByLabel("Chọn file ảnh khung").setInputFiles({ name: "frame.png", mimeType: "image/png", buffer: art });
    await page.getByText("2 ô ảnh", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Ô ảnh 1", exact: true }).click();
    const box = page.locator('[data-region-index="0"]');
    assert.equal(await box.evaluate(node => getComputedStyle(node).borderTopWidth), "1px");
    assert.equal(await box.locator(".frame-region-hit span").isVisible(), false);
    const corner = box.locator(".frame-region-handle.nw");
    assert.equal(await corner.evaluate(node => getComputedStyle(node, "::after").width), "4px");
    const [slotBounds, handleBounds] = await Promise.all([box.boundingBox(), corner.boundingBox()]);
    assert.ok(handleBounds.x + handleBounds.width / 2 < slotBounds.x);
    await page.getByRole("button", { name: "Vẽ vùng ảnh" }).click();
    assert.equal(await box.locator(".frame-region-hit").isVisible(), false);
    const stage = await page.locator(".frame-region-stage").boundingBox();
    const x = stage.x + stage.width / 2, y = stage.y + 5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 4, y + 4);
    await page.mouse.up();
    await page.getByText("3 ô ảnh", { exact: true }).waitFor();
  } finally { await page.close(); }
});

test("Selfbooth from the gallery to print and back, one 20 × 30 sheet per frame", async () => {
  const { page, errors, prints } = await phone({ prints: 3 });
  try {
    await page.getByRole("heading", { name: "Ảnh của bạn" }).waitFor();
    assert.deepEqual((await page.locator(".studio-steps button").allTextContents()).map((t) => t.trim()),
      ["Ảnh", "Chọn khung", "Ghép ảnh", "Bản in"]);
    assert.equal((await step(page)).trim(), "Ảnh");
    await page.getByRole("heading", { name: "Thư viện ảnh" }).waitFor();
    assert.equal(await page.getByRole("timer").count(), 0, "choosing photos on the phone has no time limit");
    assert.equal(await page.getByRole("button", { name: /^Ghép ảnh/ }).first().isDisabled(), true);
    // Thả tim không giới hạn.
    for (const n of ["04", "02", "01"]) await page.getByRole("button", { name: `Thả tim ảnh ${n}` }).click();
    await page.getByText("Thích · 3").waitFor();
    const favorites = page.getByRole("button", { name: "Ảnh đã thích", exact: true });
    await favorites.click();
    assert.equal(await page.locator(".studio-grid figure").count(), 3);
    await favorites.click();
    assert.equal(await page.locator(".studio-grid figure").count(), 4);
    // Chạm ảnh 4 để chỉnh: bộ lọc đen trắng.
    await page.getByRole("button", { name: "Xem & chỉnh ảnh 04" }).click();
    const editor = page.getByRole("dialog", { name: "Chỉnh ảnh 04" });
    for (const label of ['Mịn da','Sáng da','Thon mặt','Mắt to','Tròng mắt','Thu gọn mũi','Thu gọn miệng','Giảm quầng thâm','Son môi','Má hồng'])
      await editor.getByRole('slider',{name:label,exact:true}).waitFor();
    await editor.getByRole("radio", { name: "Đen trắng" }).click();
    await editor.getByRole("button", { name: /Xong/ }).click();
    let saved = await stored(page);
    assert.deepEqual(saved.hearts, ["p4", "p2", "p1"]);
    assert.equal(saved.adjusts.p4.filter, "mono");
    await page.getByTitle("Đã chỉnh sửa").waitFor();
    await page.getByRole('img',{name:'Ảnh 04 đã chỉnh',exact:true}).waitFor();
    // 02 Chủ đề: bộ "Hoa" có 2 khung × 2 ô.
    await page.getByRole("button", { name: "Chọn khung in", exact: true }).click();
    await page.getByRole("heading", { name: "Chọn bộ khung" }).waitFor();
    assert.equal((await step(page)).trim(), "Chọn khung");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-current") === "step");
    await page.getByText("2 bộ khung").waitFor();
    await page.getByRole("button", { name: "Chọn bộ Hoa, 2 khung, 4 ô ảnh" }).click();
    await page.getByText(/Còn thiếu 1 ảnh yêu thích/).waitFor();
    await page.screenshot({ path: resolve(".cache/main-flows/album-themes-390.png"), fullPage: true });
    await page.locator(".theme-action-bar").getByRole("button", { name: /Ghép ảnh/ }).click();
    // Thiếu 1 ảnh yêu thích: tự động ghép bổ sung từ ảnh còn lại (như Selfbooth).
    await page.getByRole("dialog", { name: "Chưa đủ ảnh yêu thích" }).getByRole("button", { name: "Tự động ghép" }).click();
    // 03 Ghép ảnh — như Selfbooth: thanh "← Trắng · 1/2 | 2/2 ô", không có tiêu đề riêng.
    await page.locator(".frame-nav").waitFor();
    assert.equal((await step(page)).trim(), "Ghép ảnh");
    assert.equal(await page.locator(".frame-nav strong").innerText(), "Trắng · 1/2");
    assert.equal(await page.locator(".frame-nav > span").innerText(), "2/2 ô");
    // Phần đầu album ẩn như Selfbooth; không có đồng hồ (chọn ảnh không tính giờ).
    assert.equal(await page.getByRole("timer").count(), 0);
    assert.equal(await page.locator(".studio-album-title").isVisible(), false);
    saved = await stored(page);
    assert.deepEqual(saved.layouts.white.map((s) => s.photo), ["p1", "p2"]);
    assert.deepEqual(saved.layouts.pink.map((s) => s.photo), ["p4", "p3"]);
    assert.equal(await page.getByRole("tab").count(), 2, "one tab per frame of the set");
    await canvasReady(page);
    // Chạm ô 2 của khung Trắng rồi chạm ảnh 4 bên dưới: một ảnh vào nhiều ô.
    const slot = page.getByRole("button", { name: "Chọn ô 2", exact: true });
    await slot.click();
    assert.equal(await slot.getAttribute("aria-pressed"), "true");
    await page.getByLabel("Ô 2", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Dùng ảnh 04 cho ô đang chọn" }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("selfbooth-album-v2-fixture-album")).layouts.white[1].photo === "p4");
    await page.getByRole("slider", { name: "Phóng to ảnh" }).fill("1.5");
    // Xoay ảnh trong ô (thanh Góc xoay như Selfbooth).
    await page.getByRole("slider", { name: "Góc xoay" }).fill("15");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("selfbooth-album-v2-fixture-album")).layouts.white[1].rotate === 15);
    await page.getByText("15°", { exact: true }).waitFor();
    // Đổi ảnh: danh sách ảnh của ô; chọn ảnh 4 lại cho ô 2 (giữ nguyên ảnh đã chọn).
    await page.getByRole("button", { name: "Đổi ảnh" }).click();
    const sheet = page.getByRole("dialog", { name: "Chọn ảnh cho ô 2" });
    await sheet.getByText("Một ảnh có thể dùng cho nhiều ô.").waitFor();
    await sheet.getByRole("button", { name: "Đóng" }).click();
    await sheet.waitFor({ state: "detached" });
    // Kéo ảnh ở ô 1.
    const framePreview = page.getByLabel("Khung Trắng");
    await framePreview.scrollIntoViewIfNeeded();
    const box = await framePreview.boundingBox();
    const sx = box.x + box.width * 0.2575, sy = box.y + box.height * 0.5;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 30, sy + 10, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("selfbooth-album-v2-fixture-album")).layouts.white[0].x > 0);
    saved = await stored(page);
    assert.equal(saved.layouts.white[1].zoom, 1.5);
    await page.screenshot({ path: resolve(".cache/main-flows/album-compose-390.png"), fullPage: true });
    // Hai khung được chọn, vé còn lại một tờ sau khi gửi in.
    await page.getByRole("button", { name: /Xem bản in/ }).click();
    await page.getByRole("heading", { name: "Thành phẩm của bạn" }).waitFor();
    await page.locator(".sheet-strip img").nth(1).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.sheet-strip [aria-pressed="true"]').count(), 2);
    await page.screenshot({ path: resolve(".cache/main-flows/album-result-390.png"), fullPage: true });
    await page.getByRole("button", { name: "Gửi in (2 tờ)" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 30000 });
    await page.getByText(/tại quầy để nhận ảnh/).waitFor();
    await page.getByRole("button", { name: "In thêm (1 tờ còn lại)" }).waitFor();
    assert.equal(prints.length, 1);
    assert.equal(prints[0].frame, "Hoa");
    assert.equal(prints[0].key, saved.requestKey);
    const [white, pink] = sheetsOf(prints[0]);
    assert.deepEqual([jpegSize(white), jpegSize(pink)], [[3600, 2400], [3600, 2400]], "two 20 × 30 sheets for the DS820");
    // Khung Trắng: ảnh 1 (đỏ) | ảnh 4 đã chỉnh đen trắng. Khung Hồng: ảnh 4 đen trắng | ảnh 3 (xanh dương).
    assert.ok(isRed(await sheetColor(page, white, 0.2575, 0.5)));
    assert.ok(grey(await sheetColor(page, white, 0.7425, 0.5)), "photo 4 prints black & white in slot 2");
    assert.ok(grey(await sheetColor(page, pink, 0.2575, 0.5)));
    assert.ok(isBlue(await sheetColor(page, pink, 0.7425, 0.5)));
    await page.getByRole("button", { name: "Về thư viện ảnh" }).click();
    assert.equal(await page.getByRole("button", { name: "Lưu tất cả ảnh" }).isEnabled(), true);
    await page.getByRole("button", { name: "Bản in", exact: true }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor();
    assert.equal(prints.length, 1, "returning to the receipt does not send another print");
    await page.getByRole("button", { name: "In thêm (1 tờ còn lại)" }).click();
    await page.getByRole("button", { name: "Gửi in (1 tờ)" }).waitFor();
    assert.notEqual((await stored(page)).requestKey, saved.requestKey);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a frame copied from Selfbooth with a tilted slot is composed and printed with the photo turned into the slot", async () => {
  const { page, errors, prints } = await phone();
  try {
    for (const n of ["03", "01"]) await page.getByRole("button", { name: `Thả tim ảnh ${n}` }).click();
    await page.getByRole("button", { name: "Chọn khung in", exact: true }).click();
    await page.getByRole("button", { name: "Chọn bộ Selfbooth, 1 khung, 2 ô ảnh" }).click();
    // Đủ ảnh yêu thích: vào ghép luôn, không hỏi.
    await page.locator(".theme-action-bar").getByRole("button", { name: /Ghép ảnh/ }).click();
    await page.locator(".frame-nav").waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0);
    await canvasReady(page);
    // Chạm vào ô nghiêng chọn được ô 2.
    await tap(page, "Khung Nghiêng", 0.74, 0.5);
    await page.getByLabel("Ô 2", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(".cache/main-flows/album-compose-tilted.png"), fullPage: true });
    await page.getByRole("button", { name: /Xem bản in/ }).click();
    await page.locator(".sheet-strip img").first().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Gửi in (1 tờ)" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 30000 });
    const [sheet] = sheetsOf(prints[0]);
    assert.deepEqual(jpegSize(sheet), [3600, 2400]);
    assert.ok(isRed(await sheetColor(page, sheet, 0.2575, 0.5)), "photo 1 in the straight slot");
    assert.ok(isBlue(await sheetColor(page, sheet, 0.74, 0.5)), "photo 3 in the tilted slot");
    // Góc ô nghiêng (ngoài hình chữ nhật xoay) vẫn là nền khung.
    assert.ok(!isBlue(await sheetColor(page, sheet, 0.56, 0.17)), "the tilted slot's unturned corner stays frame");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the library works like Selfbooth: delete one, delete several, add a photo from the phone", async () => {
  const { page, errors, deletes, uploads } = await phone({ photoCount: 4 });
  try {
    await page.getByText("4 ảnh", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Xóa ảnh 03" }).click();
    await page.getByText("3 ảnh", { exact: true }).waitFor();
    assert.deepEqual(deletes, [["p3"]]);
    // Chọn nhiều → đánh dấu 2 ảnh → Xóa (2).
    await page.getByRole("button", { name: /Chọn nhiều/ }).click();
    await page.getByRole("checkbox", { name: "Đánh dấu ảnh 01" }).click();
    await page.getByRole("checkbox", { name: "Đánh dấu ảnh 02" }).click();
    await page.getByRole("button", { name: "Xóa (2)" }).click();
    await page.getByText("1 ảnh", { exact: true }).waitFor();
    assert.deepEqual(deletes[1].sort(), ["p1", "p2"]);
    // Thêm ảnh từ điện thoại.
    await page.locator('input[type="file"]').setInputFiles({ name: "phone.png", mimeType: "image/png", buffer: photos[2] });
    await page.getByText("2 ảnh", { exact: true }).waitFor();
    assert.equal(uploads.length, 1);
    await page.getByText(/Đã thêm 1 ảnh vào thư viện/).waitFor();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("nothing prints by itself: no timer, no deadline; the guest sends the finished sheet with Gửi in", async () => {
  const { page, errors, prints, asked } = await phone();
  try {
    await page.getByRole("heading", { name: "Thư viện ảnh" }).waitFor();
    await page.waitForTimeout(1500);
    assert.equal(prints.length, 0);
    assert.equal(await page.getByRole("timer").count(), 0);
    assert.equal(asked.some((path) => path.endsWith("/edit-start")), false, "no editing deadline is started");
    await toResult(page);
    await page.locator(".sheet-strip img").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    assert.equal(prints.length, 0, "the finished sheet waits for the guest");
    await page.getByRole("button", { name: "Gửi in (1 tờ)" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 30000 });
    assert.equal(prints.length, 1);
    assert.equal(prints[0].frame, "Selfbooth");
    assert.deepEqual(jpegSize(sheetsOf(prints[0])[0]), [3600, 2400]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the finished sheet waits for camera originals instead of printing previews", async () => {
  const { page, prints, mediaRequests, originalsReady, errors } = await phone({ originalPending: true });
  try {
    await page.getByText("Đang nhận 4 ảnh gốc từ máy chụp.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Lưu tất cả ảnh" }).isDisabled(), true);
    await toResult(page);
    await page.getByText(/Ảnh gốc đang tải lên/).waitFor({ timeout: 30000 });
    assert.equal(prints.length, 0);
    assert.equal(mediaRequests.includes("print"), false);
    originalsReady();
    await page.getByRole("button", { name: /Làm mới/ }).click();
    await page.getByRole("button", { name: "Gửi in (1 tờ)" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 30000 });
    assert.equal(prints.length, 1);
    assert.ok(mediaRequests.includes("print"));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a print conflict does not pretend paper was sent; the retry resends the exact prepared sheets", async () => {
  const { page, prints, errors } = await phone({ printError: "Các tờ in của yêu cầu này đã thay đổi. Vui lòng kiểm tra yêu cầu đã gửi." });
  try {
    await toResult(page);
    await page.getByRole("button", { name: "Gửi in (1 tờ)" }).click();
    await page.getByText(/Các tờ in của yêu cầu này đã thay đổi/).waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole("heading", { name: "Đã gửi in!" }).count(), 0);
    await page.getByRole("button", { name: "Kiểm tra và thử lại" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 30000 });
    assert.equal(prints.length, 2);
    assert.equal(prints[0].key, prints[1].key);
    assert.ok(prints[0].body.equals(prints[1].body), "retry keeps the exact already-prepared sheets");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a lost print reply is recovered by looking up the job, without sending a second sheet", async () => {
  const { page, prints, errors } = await phone({ lostReply: true });
  try {
    await toResult(page);
    await page.getByRole("button", { name: "Gửi in (1 tờ)" }).click();
    await page.getByRole("button", { name: "Kiểm tra và thử lại" }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Kiểm tra và thử lại" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor();
    assert.equal(prints.length, 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a changed print quota tells the guest how many sheets to deselect", async () => {
  const { page, prints, errors } = await phone({ prints: 2, quotaConflictUsed: 1 });
  try {
    for (const n of ["04", "03", "02", "01"]) await page.getByRole("button", { name: `Thả tim ảnh ${n}` }).click();
    await page.getByRole("button", { name: "Chọn khung in", exact: true }).click();
    await page.getByRole("button", { name: "Chọn bộ Hoa, 2 khung, 4 ô ảnh" }).click();
    await page.locator(".theme-action-bar").getByRole("button", { name: "Ghép ảnh" }).click();
    await page.getByRole("button", { name: /Xem bản in/ }).click();
    const sendBoth = page.getByRole("button", { name: "Gửi in (2 tờ)" });
    await sendBoth.click();
    await page.getByText("Bỏ chọn 1 tờ để gửi in.").waitFor();
    assert.equal(await sendBoth.isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Kiểm tra và thử lại" }).count(), 0);
    await page.getByRole("button", { name: "Tấm in 2: Hồng" }).click();
    await page.getByRole("button", { name: "Gửi in (1 tờ)" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor();
    assert.equal(prints.length, 2);
    assert.equal(sheetsOf(prints[1]).length, 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the library suggests as many smiling, eyes-open photos as the frame set has slots; one tap fills the missing hearts", async () => {
  const face = (smile, blink = 0.1) => ({ smile, blink, width: 0.2 });
  const faces = {
    p1: [face(0.9), face(0.8)],
    p2: [face(0.95), face(0.9)], // tốt hơn ảnh 1, chụp liền sau
    p3: [face(0.99, 0.8), face(0.9)], // có người nhắm mắt
    p4: [face(0.2, 0.2), face(0.1)],
    p5: [face(0.99)], // thiếu một người
    p6: [face(0.7), face(0.7, 0.2)],
    p7: [],
    p8: [face(0.85), face(0.8)],
    p9: [face(0.6, 0.3), face(0.5, 0.2)],
  };
  // Ảnh 1 và 2 chụp liên tiếp, gần như y hệt (dấu vân ảnh khác 1 bit).
  const hashes = { p1: "abababababababab", p2: "abababababababaa" };
  const { page, errors } = await phone({ photoCount: 9, realPhoto: true, faces, hashes });
  try {
    const bar = page.locator(".suggest-bar");
    const suggested = async () => (await page.locator(".studio-grid figure.is-suggested .studio-photo").evaluateAll(
      (buttons) => buttons.map((b) => b.getAttribute("aria-label")))).sort();
    // Chưa chọn bộ: theo bộ ít ô nhất của tiệm ("Selfbooth", 2 ô).
    await bar.filter({ hasText: "Gợi ý ảnh đẹp: 2 ảnh" }).waitFor({ timeout: 30000 });
    assert.deepEqual(await suggested(), ["Xem & chỉnh ảnh 02", "Xem & chỉnh ảnh 08"]);
    // Chọn bộ "Hoa" (2 khung × 2 ô = 4 ô) rồi quay lại thư viện: gợi ý đúng 4 ảnh.
    await page.getByRole("button", { name: "Chọn khung in", exact: true }).click();
    await page.getByRole("button", { name: "Chọn bộ Hoa, 2 khung, 4 ô ảnh" }).click();
    await page.getByRole("button", { name: "Quay lại" }).click();
    const hoa = bar.filter({ hasText: "4 ô trong bộ “Hoa”" });
    await hoa.filter({ hasText: "Gợi ý ảnh đẹp: 4 ảnh" }).waitFor();
    // Ảnh 1 trùng khoảnh khắc với ảnh 2 (đẹp hơn): lấy ảnh 9 (khoảnh khắc khác) cho đủ 4 ô.
    assert.deepEqual(await suggested(), ["Xem & chỉnh ảnh 02", "Xem & chỉnh ảnh 06", "Xem & chỉnh ảnh 08", "Xem & chỉnh ảnh 09"]);
    assert.deepEqual([...new Set(await page.locator(".photo-suggested").allInnerTexts())], ["Gợi ý ảnh đẹp"]);
    assert.equal(await page.locator(".photo-suggested").count(), 4);
    await page.screenshot({ path: resolve(".cache/main-flows/album-suggestions-390.png"), fullPage: true });
    // Chỉ xem ảnh gợi ý, rồi xem lại tất cả.
    await hoa.getByRole("button", { name: "Xem ảnh đẹp" }).click();
    assert.equal(await page.locator(".studio-grid figure").count(), 4);
    await hoa.getByRole("button", { name: "Xem tất cả ảnh" }).click();
    assert.equal(await page.locator(".studio-grid figure").count(), 9);
    // Đã thả tim 1 ảnh: chỉ thả thêm 3 ảnh gợi ý đẹp nhất cho đủ 4 ô.
    await page.getByRole("button", { name: "Thả tim ảnh 09" }).click();
    await hoa.getByRole("button", { name: "Thả tim 3 ảnh đẹp" }).click();
    await page.getByText("Thích · 4").waitFor();
    assert.deepEqual((await stored(page)).hearts.sort(), ["p2", "p6", "p8", "p9"]);
    assert.equal(await bar.getByRole("button", { name: /Thả tim \d+ ảnh đẹp/ }).count(), 0, "the set is already full");
    // Mỗi ảnh tải một lần, chấm một lần, giải phóng sau khi chấm.
    assert.deepEqual(await page.evaluate(() => [window.fixtureLoaded, window.fixtureScored, window.fixtureClosed]), [9, 9, 9]);
    // Điểm lưu trên máy: tải lại trang không chấm lại.
    await page.reload();
    await bar.filter({ hasText: "Gợi ý ảnh đẹp: 4 ảnh" }).waitFor();
    assert.equal(await page.evaluate(() => window.fixtureScored || 0), 0, "scores come from this phone's saved results");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("Selfbooth starts face scoring after the first eager thumbnails have loaded", async () => {
  const { page, releaseThumbnail, errors } = await phone({ photoCount: 9, realPhoto: true, holdThumbnail: 9 });
  try {
    await page.waitForFunction(() => [...document.querySelectorAll(".studio-grid img[loading=eager]")].filter(img => img.naturalWidth).length === 3);
    const first = page.getByAltText("Ảnh 09", { exact: true });
    assert.equal(await first.getAttribute("fetchpriority"), "high");
    assert.equal(await first.evaluate(img => img.complete), false);
    assert.equal(await page.evaluate(() => window.fixtureLoaded || 0), 0);
    releaseThumbnail();
    await page.waitForFunction(() => window.fixtureScored === 9);
    assert.equal(await page.evaluate(() => window.fixtureWarmAfterPhotos), true);
    assert.deepEqual(errors, []);
  } finally { releaseThumbnail(); await page.close(); }
});

test("restoring a later album step defers face scoring until returning to the gallery", async () => {
  const { page, errors } = await phone({ photoCount: 9, realPhoto: true, restoreStep: 1 });
  try {
    const back = page.getByRole("button", { name: "Quay lại" });
    await back.waitFor();
    assert.equal(await page.evaluate(() => window.fixtureWarmAfterPhotos), undefined);
    await back.click();
    await page.waitForFunction(() => window.fixtureScored === 9);
    assert.equal(await page.evaluate(() => window.fixtureWarmAfterPhotos), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("no suggestions when the face model cannot load or the album is small; the library still works", async () => {
  const unavailable = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i + 1}`, "unavailable"]));
  for (const options of [{ photoCount: 9, realPhoto: true, faces: unavailable }, { photoCount: 4 }]) {
    const { page, errors } = await phone(options);
    try {
      await page.getByRole("heading", { name: "Thư viện ảnh" }).waitFor();
      await page.waitForTimeout(800);
      assert.equal(await page.locator(".suggest-bar").count(), 0);
      assert.equal(await page.locator(".photo-suggested").count(), 0);
      await page.getByRole("button", { name: "Thả tim ảnh 01" }).click();
      await page.getByText("Thích · 1").waitFor();
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test("the album fits phones (390, 320) and a desktop like the Selfbooth album; the editor keeps Done on screen", async () => {
  const folder = resolve(".cache/main-flows");
  for (const viewport of [{ width: 1160, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const desktop = viewport.width > 800;
    const { page, errors } = await phone({ viewport, realPhoto: true, photoCount: 10, desktop });
    try {
      await page.getByRole("heading", { name: "Thư viện ảnh" }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => [...document.querySelectorAll(".studio-grid img")].every((img) => img.complete && img.naturalWidth > 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "page fits the viewport");
      for (const button of await page.locator(".studio-grid figure").first().locator(".tile-btn").all()) {
        const target = await button.boundingBox();
        assert.ok(target.width >= 44 && target.height >= 44, "photo tools have touch-sized targets");
      }
      const bar = await page.locator(".gallery-bar").boundingBox();
      assert.ok(bar.y + bar.height <= viewport.height + 1, "the bottom bar stays on screen");
      await page.screenshot({ path: resolve(folder, `album-photos-${viewport.width}.png`), fullPage: !desktop });
      if (desktop) continue;
      await page.getByRole("button", { name: "Xem & chỉnh ảnh 04" }).click();
      await page.waitForFunction(() => document.querySelector(".sb-editor canvas")?.width > 300);
      const done = await page.getByRole("button", { name: "Xong", exact: true }).boundingBox();
      await page.screenshot({ path: resolve(folder, `album-editor-${viewport.width}.png`) });
      assert.ok(done.y >= 0 && done.y + done.height <= viewport.height, `Done stays on screen: ${JSON.stringify(done)}`);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});
