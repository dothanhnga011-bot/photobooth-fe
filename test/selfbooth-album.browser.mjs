// Album phòng Selfbooth trên điện thoại, giống album của web Selfbooth: khách quét QR → 01 Ảnh (thư viện: thả tim,
// làm đẹp, xoá, thêm ảnh từ điện thoại) → 02 Chủ đề (một bộ khung) → 03 Ghép ảnh (mọi khung của bộ, ô nghiêng
// của khung chép từ Selfbooth) → 04 Kết quả (mỗi khung một tấm Instax Wide, chọn tấm rồi gửi in tới máy cạnh máy
// chụp). Đồng hồ do máy chủ đặt (edit-start); hết giờ tự gửi in.
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
// Khung Instax Wide 1800 × 1200, hai ô ảnh trong suốt.
const SLOTS = [
  { x: 0.03, y: 0.07, w: 0.455, h: 0.86, kind: "photo", photo: 1 },
  { x: 0.515, y: 0.07, w: 0.455, h: 0.86, kind: "photo", photo: 2 },
];
const inside = (x, y) => SLOTS.some((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
const frameArt = (border) => dataUrl(png(360, 240, (x, y) => (inside(x / 360, y / 240) ? [0, 0, 0, 0] : border)));
// Ô nghiêng như khung chép từ Selfbooth: ô phải xoay 12°.
const TILTED = [SLOTS[0], { ...SLOTS[1], x: 0.55, y: 0.15, w: 0.38, h: 0.7, angle: 12 }];
const FRAMES = [
  // Bộ "Hoa": 2 khung × 2 ô — mỗi khung một tấm Instax.
  { _id: "white", name: "Trắng", themeName: "Hoa", order: 1, printSize: "instax", active: true, image: frameArt([255, 255, 255, 255]), slots: SLOTS },
  { _id: "pink", name: "Hồng", themeName: "Hoa", order: 2, printSize: "instax", active: true, image: frameArt([240, 150, 180, 255]), slots: SLOTS },
  { _id: "tilt", name: "Nghiêng", themeName: "Selfbooth", order: 1, printSize: "instax", active: true, image: frameArt([250, 240, 225, 255]), slots: TILTED },
];
// Ảnh số n một màu riêng: đọc màu ở giữa ô của ảnh in để biết ảnh nào vào ô nào.
const COLORS = { 1: [220, 40, 40, 255], 2: [40, 180, 60, 255], 3: [40, 80, 220, 255], 4: [230, 200, 30, 255] };
const photos = Object.fromEntries(Object.entries(COLORS).map(([n, c]) => [n, png(300, 400, () => c)]));

let server, browser, base, portrait;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter, Route, Routes } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { AlbumPage } from '/src/pages.jsx';
  import { TEST_FRAMES, drawTestFrame, testFrameRegions } from '/src/admin/polaroid-presets.js';
  import '/src/kiosk/decor-fonts.js';
  import '/src/tailwind.css';
  // ?trial: dùng đúng 2 khung thử Mellow mà nút "Tạo 2 khung thử" trong quản trị tạo ra.
  (async () => {
    const frames = new URLSearchParams(location.search).has('trial')
      ? await Promise.all(TEST_FRAMES.map(async (design, i) => ({
        _id: 'trial' + i, name: design.name, printSize: 'instax', active: true, order: 0, dateColor: '#4b332a',
        image: await drawTestFrame(design), slots: testFrameRegions(design),
      })))
      : ${JSON.stringify(FRAMES)};
    window.fixtureFrames = frames;
    const studio = { settings: {}, packages: [], frames };
    createRoot(document.getElementById('root')).render(
      React.createElement(MemoryRouter, { initialEntries: ['/album/fixture-album'] },
        React.createElement(StudioContext.Provider, { value: studio },
          React.createElement(ToastProvider, null,
            React.createElement(Routes, null, React.createElement(Route, { path: '/album/:token', element: React.createElement(AlbumPage) }))))));
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
      load: (id) => (id === "\0virtual:selfbooth.jsx" ? fixture : null) }],
  });
  const assets = new Map(bundle.output.map((a) => ["/" + a.fileName, a.code || a.source]));
  const entry = bundle.output.find((a) => a.isEntry).fileName;
  const css = bundle.output.filter((a) => a.fileName.endsWith(".css"));
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.webp') ? 'image/webp'
      : path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.woff2') ? 'font/woff2' : 'application/javascript';
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

async function phone({ secondsLeft = 250, originalPending = false, photoCount = 4, printError = null, lostReply = false,
  viewport = { width: 390, height: 844 }, realPhoto = false, trial = false, prints: quota = 1, desktop = false } = {}) {
  const page = await browser.newPage(desktop ? { viewport } : { viewport, isMobile: true, hasTouch: true });
  const errors = [], prints = [], mediaRequests = [], deletes = [], uploads = [];
  let savedJob = null, failedOnce = false;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  const booking = {
    _id: "b", code: "246810", status: "completed", printSize: "instax", selectCount: 2, prints: quota, printSheets: 0,
    mediaExpiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    photos: Array.from({length:photoCount},(_,i)=>i+1).map((n) => ({ id: `p${n}`, number: n, kind: "original", ...(originalPending && {originalPending:true}) })),
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
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
    const media = path.match(/\/albums\/fixture-album\/photos\/p(\d)/);
    if (media) {
      mediaRequests.push(url.searchParams.get('size'));
      return route.fulfill({ body: realPhoto ? portrait : photos[media[1]], contentType: realPhoto ? 'image/jpeg' : "image/png" });
    }
    if (path.endsWith('/albums/fixture-album/print')) return route.fulfill({json:savedJob});
    if (path.endsWith("/albums/fixture-album/edit-start"))
      return route.fulfill({ json: { editEndsAt: new Date(Date.now() + secondsLeft * 1000).toISOString(), serverTime: Date.now() } });
    if (path.endsWith("/albums/fixture-album/print-pack")) {
      const headers = route.request().headers();
      prints.push({ sizes: headers["x-print-sheets"], frame: decodeURIComponent(headers["x-print-frame"]), key: headers["x-print-key"],
        body: route.request().postDataBuffer() });
      if(printError && !failedOnce){failedOnce=true;return route.fulfill({status:409,json:{message:printError}})}
      const sheets = (headers["x-print-sheets"] || "").split(",").length;
      booking.printSheets += sheets;
      savedJob={_id:'job',status:'pending',printSheets:booking.printSheets};
      if(lostReply && !failedOnce){failedOnce=true;return route.abort('failed')}
      return route.fulfill({ status: 201, json: { _id: "job", status: "pending", prints: booking.prints, printSheets: booking.printSheets } });
    }
    if (path.endsWith("/albums/fixture-album")) return route.fulfill({ json: booking });
    return route.fulfill({ status: 404, json: { message: `unexpected ${path}` } });
  });
  await page.goto(`${base}/album/fixture-album${trial ? "?trial" : ""}`);
  return { page, errors, prints, mediaRequests, deletes, uploads, booking,
    originalsReady:()=>{booking.photos.forEach(p=>delete p.originalPending)} };
}

// Các tấm của một lệnh in (byte nối liền, X-Print-Sheets ghi cỡ từng tấm).
const sheetsOf = (print) => {
  let at = 0;
  return print.sizes.split(",").map(Number).map((size) => print.body.subarray(at, (at += size)));
};
// Màu ở điểm (tỉ lệ 0–1) của một tấm Instax đã gửi in.
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
const tap = async (page, label, fx, fy) => {
  const box = await page.getByLabel(label).boundingBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
};

test("album like Selfbooth: 01 Ảnh → 02 Chủ đề → 03 Ghép ảnh → 04 Kết quả, one Instax sheet per frame of the set", async () => {
  const { page, errors, prints } = await phone({ prints: 2 });
  try {
    await page.getByRole("heading", { name: "Ảnh của bạn" }).waitFor();
    assert.deepEqual((await page.locator(".studio-steps button").allTextContents()).map((t) => t.trim()),
      ["Ảnh", "Chủ đề", "Ghép ảnh", "Kết quả"]);
    assert.equal((await step(page)).trim(), "Ảnh");
    await page.getByRole("heading", { name: "Thư viện ảnh" }).waitFor();
    assert.match((await page.getByRole("timer").textContent()).replace(/\s+/g, " "), /Còn 4:(10|09|08)/);
    assert.equal(await page.getByRole("button", { name: /^Ghép ảnh/ }).first().isDisabled(), true);
    // Thả tim không giới hạn.
    for (const n of ["04", "02", "01"]) await page.getByRole("button", { name: `Thả tim ảnh ${n}` }).click();
    await page.getByText("Thích · 3").waitFor();
    // Chạm ảnh 4 để chỉnh: bộ lọc đen trắng.
    await page.getByRole("button", { name: "Xem & chỉnh ảnh 04" }).click();
    const editor = page.getByRole("dialog", { name: "Chỉnh ảnh 04" });
    for (const label of ["Mịn da", "Trắng da", "Thon mặt (V-Line)", "Má hồng"]) await editor.getByRole("tab", { name: label }).waitFor();
    await editor.getByRole("radio", { name: "Đen trắng" }).click();
    await editor.getByRole("button", { name: /Xong/ }).click();
    let saved = await stored(page);
    assert.deepEqual(saved.hearts, ["p4", "p2", "p1"]);
    assert.equal(saved.adjusts.p4.filter, "mono");
    await page.getByTitle("Đã chỉnh sửa").waitFor();
    // 02 Chủ đề: bộ "Hoa" có 2 khung × 2 ô.
    await page.getByRole("button", { name: /Chọn chủ đề/ }).click();
    await page.getByRole("heading", { name: "Chọn bộ chủ đề" }).waitFor();
    assert.equal((await step(page)).trim(), "Chủ đề");
    await page.getByText("2 bộ khung").waitFor();
    await page.getByRole("button", { name: "Chọn bộ Hoa, 2 khung, 4 ô ảnh" }).click();
    await page.getByText(/Còn thiếu 1 ảnh yêu thích/).waitFor();
    await page.screenshot({ path: resolve(".cache/main-flows/album-themes-390.png"), fullPage: true });
    await page.locator(".theme-action-bar").getByRole("button", { name: /Ghép ảnh/ }).click();
    // Thiếu 1 ảnh yêu thích: tự động ghép bổ sung từ ảnh còn lại (như Selfbooth).
    await page.getByRole("dialog", { name: "Chưa đủ ảnh yêu thích" }).getByRole("button", { name: "Tự động ghép" }).click();
    // 03 Ghép ảnh
    await page.getByRole("heading", { name: "Ghép ảnh vào khung" }).waitFor();
    assert.equal((await step(page)).trim(), "Ghép ảnh");
    saved = await stored(page);
    assert.deepEqual(saved.layouts.white.map((s) => s.photo), ["p1", "p2"]);
    assert.deepEqual(saved.layouts.pink.map((s) => s.photo), ["p4", "p3"]);
    assert.equal(await page.getByRole("tab").count(), 2, "one tab per frame of the set");
    await canvasReady(page);
    // Chạm ô 2 của khung Trắng rồi chạm ảnh 4 bên dưới: một ảnh vào nhiều ô.
    await tap(page, "Khung Trắng", 0.7425, 0.5);
    await page.getByLabel("Ô 2", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Dùng ảnh 04 cho ô đang chọn" }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("selfbooth-album-v2-fixture-album")).layouts.white[1].photo === "p4");
    await page.getByRole("slider", { name: "Phóng to ảnh ở ô 2" }).fill("1.5");
    // Kéo ảnh ở ô 1.
    const box = await page.getByLabel("Khung Trắng").boundingBox();
    const sx = box.x + box.width * 0.2575, sy = box.y + box.height * 0.5;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 30, sy + 10, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("selfbooth-album-v2-fixture-album")).layouts.white[0].x > 0);
    saved = await stored(page);
    assert.equal(saved.layouts.white[1].zoom, 1.5);
    await page.screenshot({ path: resolve(".cache/main-flows/album-compose-390.png"), fullPage: true });
    // 04 Kết quả: 2 khung → 2 tấm Instax; vé 2 tấm nên chọn sẵn cả hai.
    await page.getByRole("button", { name: /Xem kết quả/ }).click();
    await page.getByRole("heading", { name: "Thành phẩm của bạn" }).waitFor();
    await page.locator(".sheet-strip img").nth(1).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.sheet-strip [aria-pressed="true"]').count(), 2);
    await page.screenshot({ path: resolve(".cache/main-flows/album-result-390.png"), fullPage: true });
    await page.getByRole("button", { name: "Gửi in (2 tấm Instax)" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 30000 });
    assert.equal(prints.length, 1);
    assert.equal(prints[0].frame, "Hoa");
    assert.equal(prints[0].key, saved.requestKey);
    const [white, pink] = sheetsOf(prints[0]);
    assert.deepEqual([jpegSize(white), jpegSize(pink)], [[1260, 840], [1260, 840]], "two Instax Wide sheets");
    // Khung Trắng: ảnh 1 (đỏ) | ảnh 4 đã chỉnh đen trắng. Khung Hồng: ảnh 4 đen trắng | ảnh 3 (xanh dương).
    assert.ok(isRed(await sheetColor(page, white, 0.2575, 0.5)));
    assert.ok(grey(await sheetColor(page, white, 0.7425, 0.5)), "photo 4 prints black & white in slot 2");
    assert.ok(grey(await sheetColor(page, pink, 0.2575, 0.5)));
    assert.ok(isBlue(await sheetColor(page, pink, 0.7425, 0.5)));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a frame copied from Selfbooth with a tilted slot is composed and printed with the photo turned into the slot", async () => {
  const { page, errors, prints } = await phone();
  try {
    for (const n of ["03", "01"]) await page.getByRole("button", { name: `Thả tim ảnh ${n}` }).click();
    await page.getByRole("button", { name: /Chọn chủ đề/ }).click();
    await page.getByRole("button", { name: "Chọn bộ Selfbooth, 1 khung, 2 ô ảnh" }).click();
    // Đủ ảnh yêu thích: vào ghép luôn, không hỏi.
    await page.locator(".theme-action-bar").getByRole("button", { name: /Ghép ảnh/ }).click();
    await page.getByRole("heading", { name: "Ghép ảnh vào khung" }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0);
    await canvasReady(page);
    // Chạm vào ô nghiêng chọn được ô 2.
    await tap(page, "Khung Nghiêng", 0.74, 0.5);
    await page.getByLabel("Ô 2", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(".cache/main-flows/album-compose-tilted.png"), fullPage: true });
    await page.getByRole("button", { name: /Xem kết quả/ }).click();
    await page.locator(".sheet-strip img").first().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Gửi in (1 tấm Instax)" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 30000 });
    const [sheet] = sheetsOf(prints[0]);
    assert.deepEqual(jpegSize(sheet), [1260, 840]);
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

test("when the time is up, the first set is filled automatically and goes to the printer by itself", async () => {
  const { page, errors, prints } = await phone({ secondsLeft: 0 });
  try {
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 30000 });
    assert.equal(prints.length, 1);
    // Chưa chọn bộ: bộ đầu tiên ("Hoa"); vé 1 tấm nên chỉ in khung đầu của bộ.
    assert.equal(prints[0].frame, "Hoa");
    const sheets = sheetsOf(prints[0]);
    assert.equal(sheets.length, 1);
    assert.deepEqual(jpegSize(sheets[0]), [1260, 840]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("an expired selection waits for camera originals instead of printing previews", async () => {
  const { page, prints, mediaRequests, originalsReady, errors } = await phone({ secondsLeft: 0, originalPending: true });
  try {
    await page.getByText(/Đang nhận 4 ảnh gốc chất lượng cao/).waitFor();
    await page.waitForTimeout(300);
    assert.equal(prints.length, 0);
    assert.equal(mediaRequests.includes("print"), false);
    originalsReady();
    await page.getByRole("button", { name: /Làm mới/ }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 30000 });
    assert.equal(prints.length, 1);
    assert.ok(mediaRequests.includes("print"));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a print conflict does not pretend paper was sent; the retry resends the exact prepared sheets", async () => {
  const { page, prints, errors } = await phone({ secondsLeft: 0, printError: "Các tờ in của yêu cầu này đã thay đổi. Vui lòng kiểm tra yêu cầu đã gửi." });
  try {
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
  const { page, prints, errors } = await phone({ secondsLeft: 0, lostReply: true });
  try {
    await page.getByRole("button", { name: "Kiểm tra và thử lại" }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Kiểm tra và thử lại" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor();
    assert.equal(prints.length, 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the admin's Mellow trial frames work as one-frame sets", async () => {
  const { page, errors, prints } = await phone({ trial: true });
  try {
    for (const n of ["03", "01"]) await page.getByRole("button", { name: `Thả tim ảnh ${n}` }).click();
    await page.getByRole("button", { name: /Chọn chủ đề/ }).click();
    await page.getByRole("button", { name: /^Chọn bộ Khung thử Mellow · 2 ảnh/ }).click();
    await page.locator(".theme-action-bar").getByRole("button", { name: /Ghép ảnh/ }).click();
    await canvasReady(page);
    await page.getByRole("button", { name: /Xem kết quả/ }).click();
    await page.locator(".sheet-strip img").first().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Gửi in (1 tấm Instax)" }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 30000 });
    const [sheet] = sheetsOf(prints[0]);
    assert.deepEqual(jpegSize(sheet), [1260, 840]);
    // Ảnh 1 (đỏ) ô trái, ảnh 3 (xanh dương) ô phải.
    assert.ok(isRed(await sheetColor(page, sheet, 0.27, 0.45)));
    assert.ok(isBlue(await sheetColor(page, sheet, 0.73, 0.45)));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
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
