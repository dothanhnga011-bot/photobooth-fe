// Kiosk photo selection with colour (filter) and stickers, through to the composite and print upload.
// Isolated API fixtures; the photos, frame and sticker are generated solid-colour PNGs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

// PNG RGBA tối giản: color(x, y) → [r, g, b, a].
function png(width, height, color) {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(color(x, y), y * row + 1 + x * 4);
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bit
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const dataUrl = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;

const RED = [220, 30, 30, 255], PINK = [240, 120, 160, 255], BLUE = [30, 60, 220, 255];
const SLOTS = [
  { x: 0.05, y: 0.05, w: 0.9, h: 0.42, kind: "photo", photo: 1 },
  { x: 0.05, y: 0.53, w: 0.9, h: 0.42, kind: "photo", photo: 2 },
];
const inside = (x, y) => SLOTS.some((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
// Khung 2 : 3 viền hồng, ô ảnh trắng.
const frameImage = png(200, 300, (x, y) => (inside(x / 200, y / 300) ? [255, 255, 255, 255] : PINK));
const photoImage = png(300, 200, () => RED);
const stickerImage = png(60, 60, () => BLUE);
const brandLogo = await readFile(new URL('../public/logo-m-384.jpg', import.meta.url));

const FRAME = { _id: "frame-decor", name: "Khung thử", printSize: "full", active: true, image: dataUrl(frameImage), slots: SLOTS };
const STICKER = { _id: "sticker-blue", name: "Tim xanh", image: dataUrl(stickerImage), thumb: dataUrl(stickerImage) };
const STAR = { _id: "sticker-star", name: "Sao vàng", image: dataUrl(png(40, 40, () => [240, 190, 40, 255])), thumb: "" };
const SETTINGS = { enabledFilters: ["original", "mono"], customFilters: [],
  kioskTexts: { "select.frameHint": "Bấm mũi tên để chọn frame tiếp theo nhé" } };

let server, browser, base;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { Kiosk } from '/src/kiosk/Kiosk.jsx';
  import { KioskCode } from '/src/kiosk/KioskSale.jsx';
  import { KioskSettings } from '/src/kiosk/KioskSettings.jsx';
  import { windowsScript, macScript } from '/src/admin/kiosk-autostart.js';
  import '/src/tailwind.css';
  const studio = ${JSON.stringify({ settings: SETTINGS, packages: [], frames: [FRAME, { ...FRAME, _id: "frame-second", name: "Khung thứ hai" }], stickers: [STICKER, STAR] })};
  // Tiệm chưa tải nhãn dán nào (?stickers=0): máy chụp ẩn mục Nhãn dán.
  if (new URLSearchParams(location.search).get('stickers') === '0') studio.stickers = [];
  const root = createRoot(document.getElementById('root'));
  const wrap = child => React.createElement(React.StrictMode, null,
    React.createElement(MemoryRouter, { initialEntries: ['/kiosk?device=fixture-device'] },
      React.createElement(StudioContext.Provider, { value: studio },
        React.createElement(ToastProvider, null, child))));
  root.render(wrap(React.createElement(Kiosk)));
  window.showCodeScreen = () => root.render(wrap(React.createElement('main', { className: 'kiosk-shell' },
    React.createElement(KioskCode, { code: '123456', setCode: () => {}, onSubmit: event => event.preventDefault(),
      onBack: () => {}, device: 'fixture', cameraReady: true }))));
  window.showCameraSetup = kind => root.render(wrap(React.createElement('main', { className: 'kiosk-shell' },
    React.createElement(KioskSettings, { cameras: [{ deviceId: 'hdmi', label: 'USB Video' }], cameraId: 'hdmi',
      roomInfo: { kind }, zoom: 0, mirror: true, toast: { success() {}, error() {} } }))));
  window.makeKioskScripts = kind => ({
    windows: windowsScript('https://studio.example/kiosk?device=fixture', 'Room', kind),
    mac: macScript('https://studio.example/kiosk?device=fixture', 'Room', kind),
  });
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:kiosk-decorate.jsx" } },
    plugins: [tailwindcss(), {
      name: "kiosk-decorate-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:kiosk-decorate.jsx" ? fixture : null,
    }],
  });
  const assets = new Map(bundle.output.map((a) => ["/" + a.fileName, a.code || a.source]));
  const entry = bundle.output.find((a) => a.isEntry).fileName;
  const css = bundle.output.filter((a) => a.fileName.endsWith(".css"));
  server = createServer((req, res) => {
    if (/^\/logo-m(?:-384)?\.jpg/.test(req.url)) {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.end(brandLogo);
    }
    if (assets.has(req.url)) {
      res.setHeader("Content-Type", req.url.endsWith(".css") ? "text/css" : "application/javascript");
      res.end(assets.get(req.url));
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<div id="root"></div>${css.map((a) => `<link rel="stylesheet" href="/${a.fileName}">`).join("")}<script type="module" src="/${entry}"></script>`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

async function selectScreen({ query = "", shots = 3, prints = 1, viewport = { width: 1366, height: 768 }, holdPrint = false } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [], uploads = { composite: null, print: null };
  let releasePrint;
  const printerReady = new Promise((resolve) => { releasePrint = resolve; });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route('http://127.0.0.1:8789/**', async route => {
    if (new URL(route.request().url()).pathname === '/print') {
      uploads.print = route.request().headers()['x-print-sheets'];
      if (holdPrint) await printerReady;
      return route.fulfill({ json: { sent: true, message: 'Fixture spool accepted' }, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return route.fulfill({ json: { directPrint: 2 }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const booking = {
    _id: "fixture-booking", code: "123456", packageName: "Gói thử", shots, selectCount: 2,
    prints, printSize: "full", status: "checked_in", captureDuration: 10,
    captureStartedAt: new Date(Date.now() - 600000).toISOString(),
    captureEndsAt: new Date(Date.now() - 1000).toISOString(),
    photos: Array.from({ length: shots }, (_, i) => ({ id: `p${i + 1}`, kind: "original" })),
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (/\/albums\/fixture-album\/photos\//.test(path))
      return route.fulfill({ body: photoImage, contentType: "image/png" });
    if (path.endsWith("/kiosk/composite")) {
      uploads.composite = route.request().postDataBuffer();
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/albums/fixture-album/print-pack")) {
      uploads.print = route.request().headers()["x-print-sheets"];
      return route.fulfill({ json: { _id: "job", code: "123456", spoolStatus: "sent", status: "pending" } });
    }
    if (path.endsWith("/albums/fixture-album/print"))
      return route.fulfill({ json: { _id: "job", code: "123456", spoolStatus: "sent", status: "pending" } });
    await route.fulfill({ json: path.endsWith("/kiosk/ping") ? { room: { _id: "room", flip: "device", payment: "counter" } }
      : path.endsWith("/health") ? { ok: true } : { booking } });
  });
  await page.addInitScript((booking) => {
    if (sessionStorage.getItem("photo-capture-fixture-device")) return;
    sessionStorage.setItem("photo-capture-fixture-device", JSON.stringify({
      captureToken: "fixture-capture", accessToken: "fixture-album", booking,
      phase: "select", selected: [], selectEndsAt: Date.now() + 150000, mode: "remote",
    }));
  }, booking);
  await page.goto(base + query);
  return { page, errors, uploads, releasePrint };
}
const saved = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("photo-capture-fixture-device")));

// Đọc màu một số điểm (tỉ lệ 0–1) của ảnh JPEG đã gửi lên.
async function samples(page, jpeg, points) {
  return page.evaluate(async ({ b64, points }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      colors: points.map(([x, y]) =>
        [...ctx.getImageData(Math.round(x * bitmap.width) - 2, Math.round(y * bitmap.height) - 2, 5, 5).data]
          .reduce((sum, v, i) => (sum[i % 4] += v / 25, sum), [0, 0, 0, 0]).slice(0, 3).map(Math.round)),
    };
  }, { b64: jpeg.toString("base64"), points });
}

test("QR-only sessions render the 20 MP guest composite without allocating an unused RX1 sheet", async () => {
  const { page, errors, uploads } = await selectScreen({ prints: 0 });
  try {
    await page.evaluate(() => {
      window.renderTargets = [];
      const native = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        if (kind === "2d") window.renderTargets.push([this.width, this.height]);
        return native.call(this, kind, ...args);
      };
    });
    const photos = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await photos.nth(0).click(); await photos.nth(1).click();
    await page.getByRole("button", { name: "Nhận ảnh", exact: true }).click();
    for (let i = 0; i < 100 && !uploads.composite; i++) await page.waitForTimeout(100);
    assert.ok(uploads.composite);
    assert.equal(uploads.print, null);
    const targets = await page.evaluate(() => window.renderTargets);
    assert.equal(targets.some(([w, h]) => w === 2400 && h === 3600), false);
    const { width, height } = await samples(page, uploads.composite, []);
    assert.ok(width * height > 19_980_000 && width * height <= 20_000_000);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the 20 MP album composite uploads while the local RX1 acknowledgement is still pending", async () => {
  const { page, errors, uploads, releasePrint } = await selectScreen({ holdPrint: true });
  try {
    const photos = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await photos.nth(0).click(); await photos.nth(1).click();
    await page.getByRole("button", { name: "In ảnh", exact: true }).click();
    for (let i = 0; i < 100 && !uploads.composite; i++) await page.waitForTimeout(100);
    assert.ok(uploads.print, 'the local print has started');
    assert.ok(uploads.composite, 'album preparation must not await a slow print response');
    const { width, height } = await samples(page, uploads.composite, []);
    assert.ok(width * height > 19_980_000 && width * height <= 20_000_000);
    assert.deepEqual(errors, []);
  } finally { releasePrint(); await page.close(); }
});

test("guests pick photos, a colour and a sticker; the print shows exactly that", async () => {
  const { page, errors, uploads } = await selectScreen();
  try {
    await page.getByRole("heading", { name: /để chọn ảnh & trang trí/ }).waitFor();
    const tab = (name) => page.getByRole("tab", { name: new RegExp(name) });
    assert.equal(await tab("Chọn ảnh").getAttribute("aria-selected"), "true");
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    // Chọn đủ ảnh: tự mở mục kế tiếp — Chỉnh ảnh (phóng to / dời ảnh trong ô).
    await page.waitForFunction(() => document.querySelector("#select-tab-adjust")?.getAttribute("aria-selected") === "true");
    await tab("Màu ảnh").click();
    await page.getByRole("radiogroup", { name: "Màu ảnh" }).waitFor();
    const colors = page.getByRole("radiogroup", { name: "Màu ảnh" }).getByRole("radio");
    assert.deepEqual(await colors.allInnerTexts(), ["Gốc", "Trắng đen"]);
    await page.getByRole("radio", { name: "Trắng đen" }).click();
    assert.equal(await page.getByRole("radio", { name: "Trắng đen" }).getAttribute("aria-checked"), "true");
    assert.equal((await saved(page)).decor.filter, "mono");

    await tab("Nhãn dán").click();
    await page.getByText("Chạm một nhãn dán bên dưới để dán lên khung.").waitFor();
    const palette = page.getByRole("group", { name: "Thêm nhãn dán" });
    // Chỉ nhãn dán của tiệm (Thiết lập → Nhãn dán), không có bộ biểu tượng dựng sẵn.
    assert.deepEqual(
      await palette.getByRole("button").evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label"))),
      ["Thêm nhãn dán Tim xanh", "Thêm nhãn dán Sao vàng"],
    );
    await palette.getByRole("button", { name: "Thêm nhãn dán Tim xanh" }).click();
    await page.getByRole("button", { name: "To hơn" }).click();
    let sticker = (await saved(page)).decor.stickers[0];
    assert.equal(sticker.src, STICKER.image);
    assert.ok(Math.abs(sticker.scale - 0.24) < 1e-9, `cỡ ${sticker.scale}`);

    // Kéo nhãn dán trên khung xem trước tới giữa ô ảnh thứ nhất.
    const canvas = page.getByRole("img", { name: /Khung ảnh xem trước/ });
    await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)"));
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + sticker.u * box.width, box.y + sticker.v * box.height);
    await page.mouse.down();
    await page.mouse.move(box.x + 0.5 * box.width, box.y + 0.26 * box.height, { steps: 8 });
    await page.mouse.up();
    sticker = (await saved(page)).decor.stickers[0];
    assert.ok(Math.abs(sticker.u - 0.5) < 0.02 && Math.abs(sticker.v - 0.26) < 0.02, `vị trí ${sticker.u}, ${sticker.v}`);

    // Thêm rồi xóa một biểu tượng: chỉ còn nhãn dán xanh.
    await palette.getByRole("button", { name: "Thêm nhãn dán Sao vàng" }).click();
    await page.getByRole("button", { name: "Xóa nhãn dán" }).click();
    assert.equal((await saved(page)).decor.stickers.length, 1);

    await page.getByRole("button", { name: "In ảnh" }).click();
    await page.waitForFunction(() => document.querySelector(".done-title"));
    for (let i = 0; i < 100 && (!uploads.composite || !uploads.print); i++) await page.waitForTimeout(100);
    assert.ok(uploads.composite, "chưa gửi ảnh ghép vào album");
    assert.equal(uploads.print?.split(",").length, 1, "gói 1 tờ in → 1 tờ gửi máy in");
    const { width, height, colors: [onSticker, onPhoto, onFrame] } =
      await samples(page, uploads.composite, [[0.5, 0.26], [0.15, 0.12], [0.02, 0.5]]);
    assert.ok(width * height > 19_980_000 && width * height <= 20_000_000);
    const close = (actual, expected, tolerance = 24) =>
      actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
    // Nhãn dán vẽ sau màu ảnh: vẫn xanh. Ảnh đỏ thành xám (trắng đen). Viền khung giữ màu hồng.
    assert.ok(close(onSticker, BLUE), `nhãn dán: ${onSticker}`);
    assert.ok(close(onPhoto, [70, 70, 70]), `ảnh trắng đen: ${onPhoto}`);
    assert.ok(close(onFrame, PINK), `viền khung: ${onFrame}`);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the frame hint uses admin text and arrow navigation still switches frames", async () => {
  const { page, errors } = await selectScreen();
  try {
    await page.getByText(SETTINGS.kioskTexts["select.frameHint"], { exact: true }).waitFor();
    await page.getByRole("button", { name: "Khung sau", exact: true }).click();
    await page.getByText("Khung thứ hai · khung 2/2", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Khung trước", exact: true }).click();
    assert.match(await page.locator(".select-frame-name").innerText(), /khung 1\/2/);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("code entry uses larger touch text without overflowing short and full-HD kiosk screens", async () => {
  const { page, errors } = await selectScreen();
  try {
    await page.evaluate(() => window.showCodeScreen());
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 1024, height: 600 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const input = document.querySelector('#kiosk-code'), keypad = document.querySelector('.voucher-keypad button');
        const card = document.querySelector('.code-card').getBoundingClientRect();
        return { input: parseFloat(getComputedStyle(input).fontSize), keypad: parseFloat(getComputedStyle(keypad).fontSize),
          height: keypad.getBoundingClientRect().height, inside: card.left >= 0 && card.right <= innerWidth,
          submitVisible: document.querySelector('.code-card button[type=submit]').getBoundingClientRect().bottom <= innerHeight };
      });
      assert.ok(layout.input >= 32, JSON.stringify(layout));
      assert.ok(layout.keypad >= 24);
      assert.ok(layout.height >= 46);
      assert.equal(layout.inside, true);
      assert.equal(layout.submitVisible, true);
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: join(tmpdir(), 'photobooth-code-larger.png') });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("Polaroid staff setup and startup scripts select Canon; Photobooth retains Fujifilm", async () => {
  const { page, errors } = await selectScreen();
  try {
    await page.evaluate(() => window.showCameraSetup('polaroid'));
    await page.locator('.kiosk-settings > summary').click();
    await page.getByRole('button', { name: /Hướng dẫn: kết nối Canon EOS R100/ }).click();
    await page.getByText(/Cài EOS Utility hỗ trợ EOS R100/).waitFor();
    assert.ok((await page.locator('.guide-body').innerText()).includes('RS-60E3'));
    assert.equal(await page.getByRole('link', { name: 'Tải Canon EOS Utility' }).count(), 1);
    assert.equal(await page.getByText('Máy đọc tiền (ICT)', { exact: true }).count(), 0);
    const canon = await page.evaluate(() => window.makeKioskScripts('polaroid'));
    const payload = /rem NXC_EOS_UTILITY_BASE64:([A-Za-z0-9+/=]+)/.exec(canon.windows);
    assert.ok(payload);
    const decoded = Buffer.from(payload[1], 'base64').toString('utf8');
    assert.ok(decoded.includes('C:\\PhotoBooth\\Canon'));
    assert.ok(decoded.includes('EOS Utility 3.exe'));
    assert.ok(!canon.windows.includes('NXC_FUJI_ACQUIRE_BASE64:'));
    assert.ok(canon.mac.includes('open -a "EOS Utility"'));
    await page.evaluate(() => window.showCameraSetup('photobooth'));
    assert.equal(await page.getByRole('link', { name: 'Tải FUJIFILM X Acquire' }).count(), 1);
    assert.equal(await page.getByText('Máy đọc tiền (ICT)', { exact: true }).count(), 1);
    const fuji = await page.evaluate(() => window.makeKioskScripts('photobooth'));
    assert.ok(fuji.windows.includes('NXC_FUJI_ACQUIRE_BASE64:'));
    assert.ok(!fuji.windows.includes('NXC_EOS_UTILITY_BASE64:'));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a colour can go to one photo only (tap it in the frame or pick its number), or to all photos", async () => {
  const { page, errors, uploads } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    // Chọn đủ ảnh: tự mở mục kế tiếp (Chỉnh ảnh); màu ảnh ở mục Màu ảnh.
    await page.getByRole("tab", { name: /Chỉnh ảnh/ }).waitFor();
    await page.getByRole("tab", { name: /Màu ảnh/ }).click();
    const targets = page.getByRole("radiogroup", { name: "Áp dụng màu cho" });
    await targets.waitFor();
    assert.equal(await targets.getByRole("radio", { name: "Tất cả ảnh" }).getAttribute("aria-checked"), "true");
    // Chạm vào ô ảnh thứ hai trên khung: chọn ảnh 2.
    await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)"));
    const box = await page.getByRole("img", { name: /Khung ảnh xem trước/ }).boundingBox();
    await page.mouse.click(box.x + 0.5 * box.width, box.y + 0.74 * box.height);
    assert.equal(await targets.getByRole("radio", { name: "Ảnh 2" }).getAttribute("aria-checked"), "true");
    await page.getByRole("radio", { name: "Trắng đen" }).click();
    let decor = (await saved(page)).decor;
    const [first, second] = (await saved(page)).selected;
    assert.deepEqual(decor.photoFilters, { [second]: "mono" });
    assert.equal(decor.filter, "original");
    assert.match(await targets.getByRole("radio", { name: "Ảnh 2" }).innerText(), /Trắng đen/);
    // Ảnh 1 vẫn màu gốc.
    await targets.getByRole("radio", { name: "Ảnh 1" }).click();
    assert.equal(await page.getByRole("radio", { name: "Gốc" }).getAttribute("aria-checked"), "true");
    assert.equal(first in (await saved(page)).decor.photoFilters, false);

    await page.getByRole("button", { name: "In ảnh" }).click();
    for (let i = 0; i < 100 && !uploads.composite; i++) await page.waitForTimeout(100);
    assert.ok(uploads.composite, "chưa gửi ảnh ghép vào album");
    const { colors: [top, bottom] } = await samples(page, uploads.composite, [[0.5, 0.26], [0.5, 0.74]]);
    const close = (actual, expected, tolerance = 24) => actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
    assert.ok(close(top, RED), `ảnh 1 giữ màu gốc: ${top}`);
    assert.ok(close(bottom, [70, 70, 70]), `ảnh 2 trắng đen: ${bottom}`);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("choosing a colour for all photos clears the per-photo colours", async () => {
  const { page, errors } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    // Chọn đủ ảnh: tự mở mục kế tiếp (Chỉnh ảnh); màu ảnh ở mục Màu ảnh.
    await page.getByRole("tab", { name: /Chỉnh ảnh/ }).waitFor();
    await page.getByRole("tab", { name: /Màu ảnh/ }).click();
    const targets = page.getByRole("radiogroup", { name: "Áp dụng màu cho" });
    await targets.getByRole("radio", { name: "Ảnh 1" }).click();
    await page.getByRole("radio", { name: "Trắng đen" }).click();
    await targets.getByRole("radio", { name: "Tất cả ảnh" }).click();
    await page.getByText("Chọn màu ở đây sẽ áp cho tất cả ảnh (bỏ màu riêng của từng ảnh).").waitFor();
    await page.getByRole("radio", { name: "Gốc" }).click();
    const decor = (await saved(page)).decor;
    assert.deepEqual([decor.filter, decor.photoFilters], ["original", {}]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("two fingers resize a sticker on the touch screen; one finger then keeps dragging it", async () => {
  const { page, errors } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    await page.getByRole("tab", { name: /Nhãn dán/ }).click();
    await page.getByRole("button", { name: "Thêm nhãn dán Tim xanh" }).click();
    await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)"));
    const before = (await saved(page)).decor.stickers[0];
    const box = await page.getByRole("img", { name: /Khung ảnh xem trước/ }).boundingBox();
    const at = (u, v) => ({ x: box.x + u * box.width, y: box.y + v * box.height });
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: points.map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 4, radiusY: 4, force: 1 })),
    });
    const center = at(before.u, before.v);
    // Ngón 1 trên nhãn dán, ngón 2 cạnh đó rồi mở rộng gấp đôi khoảng cách.
    await touch("touchStart", [[1, center]]);
    await touch("touchStart", [[1, center], [2, { x: center.x + 30, y: center.y }]]);
    for (const dx of [40, 50, 60]) await touch("touchMove", [[1, center], [2, { x: center.x + dx, y: center.y }]]);
    // touchEnd nhấc các ngón được liệt kê: nhấc ngón 2, ngón 1 kéo tiếp nhãn dán rồi nhấc.
    await touch("touchEnd", [[2, { x: center.x + 60, y: center.y }]]);
    for (const dy of [10, 20, 30]) await touch("touchMove", [[1, { x: center.x, y: center.y + dy }]]);
    await touch("touchEnd", [[1, { x: center.x, y: center.y + 30 }]]);
    const after = (await saved(page)).decor.stickers[0];
    assert.ok(Math.abs(after.scale - 0.4) < 0.01, `cỡ sau khi mở 2 ngón: ${after.scale}`);
    assert.ok(Math.abs((after.v - before.v) * box.height - 30) < 3, `kéo tiếp: ${before.v} → ${after.v}`);
    assert.ok(Math.abs(after.u - before.u) < 0.01);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("colour and stickers survive a reload during selection", async () => {
  const { page, errors } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(2).click();
    // Chọn đủ ảnh: tự mở mục kế tiếp (Chỉnh ảnh); màu ảnh ở mục Màu ảnh.
    await page.getByRole("tab", { name: /Chỉnh ảnh/ }).waitFor();
    await page.getByRole("tab", { name: /Màu ảnh/ }).click();
    await page.getByRole("radio", { name: "Trắng đen" }).click();
    await page.getByRole("tab", { name: /Nhãn dán/ }).click();
    await page.getByRole("button", { name: "Thêm nhãn dán Sao vàng" }).click();
    await page.reload();
    await page.getByRole("heading", { name: /để chọn ảnh & trang trí/ }).waitFor();
    // Đã đủ ảnh từ trước: không tự chuyển mục, khách vẫn thấy ảnh đã chọn.
    assert.equal(await page.getByRole("tab", { name: /Chọn ảnh/ }).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("tab", { name: /Chọn ảnh/ }).innerText().then((t) => t.includes("2/2")), true);
    await page.getByRole("tab", { name: /Màu ảnh/ }).click();
    assert.equal(await page.getByRole("radio", { name: "Trắng đen" }).getAttribute("aria-checked"), "true");
    await page.getByRole("tab", { name: /Nhãn dán/ }).click();
    await page.getByRole("button", { name: "Xóa hết nhãn dán (1)" }).click();
    assert.deepEqual((await saved(page)).decor.stickers, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("without any shop sticker the kiosk hides the sticker tab (no built-in emoji set)", async () => {
  const { page, errors } = await selectScreen({ query: "/?stickers=0" });
  try {
    await page.getByRole("heading", { name: /để chọn ảnh & trang trí/ }).waitFor();
    assert.deepEqual(
      await page.getByRole("tab").evaluateAll((tabs) => tabs.map((t) => t.textContent.replace(/\d+\/\d+/, "").trim())),
      ["Chọn ảnh", "Chỉnh ảnh", "Màu ảnh", "Thêm chữ"],
    );
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a photo is dragged on the frame and shrunk below 100%; the print shows the frame background around it", async () => {
  const { page, errors, uploads } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    // Chọn đủ ảnh: mở mục Chỉnh ảnh.
    await page.waitForFunction(() => document.querySelector("#select-tab-adjust")?.getAttribute("aria-selected") === "true");
    await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)"));
    const box = await page.getByRole("img", { name: /Khung ảnh xem trước/ }).boundingBox();
    // Kéo ảnh 1 sang phải ngay trên khung.
    const start = { x: box.x + 0.5 * box.width, y: box.y + 0.26 * box.height };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y, { steps: 6 });
    await page.mouse.up();
    const [first] = (await saved(page)).selected;
    await page.waitForFunction((key) =>
      JSON.parse(sessionStorage.getItem("photo-capture-fixture-device")).decor?.transforms?.[key]?.x > 0, first);
    // Thu nhỏ dưới 100 % (tới 50 %): thấy cả ảnh, phần ô còn trống là nền khung.
    const zoomOut = page.getByRole("button", { name: /Thu nhỏ/ });
    for (let i = 0; i < 10 && await zoomOut.isEnabled(); i++) await zoomOut.click();
    assert.equal(await zoomOut.isDisabled(), true);
    await page.locator(".adjust-zoom span", { hasText: "50%" }).waitFor();
    const t = (await saved(page)).decor.transforms[first];
    assert.ok(Math.abs(t.zoom - 0.5) < 0.001 && t.x > 0, JSON.stringify(t));

    await page.getByRole("button", { name: "In ảnh" }).click();
    for (let i = 0; i < 100 && !uploads.composite; i++) await page.waitForTimeout(100);
    assert.ok(uploads.composite, "chưa gửi ảnh ghép vào album");
    const { colors: [edge, middle] } = await samples(page, uploads.composite, [[0.08, 0.26], [0.55, 0.26]]);
    assert.ok(edge.slice(0, 3).every((v) => v > 200), `mép ô ảnh 1 là nền trắng của khung: ${edge}`);
    assert.ok(middle[0] > 180 && middle[1] < 80, `ảnh 1 (đỏ) vẫn ở giữa ô: ${middle}`);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});


test("12 photos fill the 'Chọn ảnh' panel on the shop's 1920 × 1080 screen: big, all visible, no scrolling", async () => {
  const { page, errors } = await selectScreen({ shots: 12, viewport: { width: 1920, height: 1080 } });
  try {
    const grid = page.getByRole("group", { name: "Ảnh đã chụp" });
    await grid.getByRole("button").nth(11).locator("img").waitFor();
    await page.waitForFunction(() => document.querySelector(".select-grid")?.classList.contains("is-fitted"));
    const layout = () => grid.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const cells = [...element.querySelectorAll(".select-shot")].map((cell) => cell.getBoundingClientRect());
      return {
        columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
        width: Math.round(cells[0].width),
        inside: cells.every((cell) => cell.top >= box.top - 1 && cell.bottom <= box.bottom + 1),
        scrolls: element.scrollHeight > element.clientHeight + 1,
        unused: Math.round(box.bottom - cells.at(-1).bottom),
        pageScrolls: document.documentElement.scrollHeight > innerHeight + 1,
      };
    });
    const first = await layout();
    // Ô cao: 3 cột × 4 hàng cho ảnh to nhất (trước đây 6 cột ảnh rộng ~150 px, nửa dưới ô trống).
    assert.equal(first.columns, 3);
    assert.ok(first.width >= 240, `ảnh rộng ${first.width} px`);
    assert.equal(first.inside, true, "every photo is visible");
    assert.equal(first.scrolls, false);
    assert.equal(first.pageScrolls, false);
    assert.ok(first.unused < 60, `little space left under the photos (${first.unused} px)`);
    await page.screenshot({ path: join(tmpdir(), "photobooth-fe-select-1920.png") });
    // Sang mục khác rồi quay lại: lưới vẫn vừa khít như cũ.
    await page.getByRole("tab", { name: /Màu ảnh|Thêm chữ/ }).first().click();
    await page.getByRole("tab", { name: /Chọn ảnh/ }).click();
    await page.waitForFunction(() => document.querySelector(".select-grid")?.classList.contains("is-fitted"));
    assert.deepEqual(await layout(), first);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
