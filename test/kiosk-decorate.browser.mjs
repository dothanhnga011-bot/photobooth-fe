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

const RED = [220, 30, 30, 255], PINK = [240, 120, 160, 255], BLUE = [30, 60, 220, 255], GREEN = [40, 170, 90, 255];
const SLOTS = [
  { x: 0.05, y: 0.05, w: 0.9, h: 0.42, kind: "photo", photo: 1 },
  { x: 0.05, y: 0.53, w: 0.9, h: 0.42, kind: "photo", photo: 2 },
];
const inside = (x, y) => SLOTS.some((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
// Khung 2 : 3 viền hồng, ô ảnh trắng.
const frameImage = png(200, 300, (x, y) => (inside(x / 200, y / 300) ? [255, 255, 255, 255] : PINK));
// Ảnh khung xem nhanh (thumb) của khung thứ hai viền xanh lá: ô trong mục Khung dùng thumb, bản in dùng ảnh gốc.
const frameThumb = png(200, 300, (x, y) => (inside(x / 200, y / 300) ? [255, 255, 255, 255] : GREEN));
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
  import '/src/kiosk/decor-fonts.js';
  const studio = ${JSON.stringify({ settings: SETTINGS, packages: [], frames: [FRAME, { ...FRAME, _id: "frame-second", name: "Khung thứ hai", thumb: dataUrl(frameThumb) }], stickers: [STICKER, STAR] })};
  // Tiệm chưa tải nhãn dán nào (?stickers=0): máy chụp ẩn mục Nhãn dán.
  if (new URLSearchParams(location.search).get('stickers') === '0') studio.stickers = [];
  // ?frames=16: nhiều khung chia hai chủ đề (như tiệm có 16 khung tờ nhỏ).
  const many = Number(new URLSearchParams(location.search).get('frames'));
  if (many) studio.frames = Array.from({ length: many }, (_, i) => ({ ...studio.frames[i % 2],
    _id: 'frame-' + i, name: 'Khung ' + (i + 1), order: i, themeName: i < many / 2 ? 'LIMIT' : 'Noel' }));
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
    // Chọn đủ ảnh: tự mở mục kế tiếp — Khung (mọi khung ghép sẵn ảnh vừa chọn).
    await page.waitForFunction(() => document.querySelector("#select-tab-frames")?.getAttribute("aria-selected") === "true");
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

test("with a single frame (a Polaroid layout) the frame arrows are hidden: there is nothing to switch", async () => {
  const { page, errors } = await selectScreen({ query: "?frames=1" });
  try {
    await page.locator(".select-frame-stage").waitFor();
    const arrows = page.locator(".frame-arrow");
    assert.equal(await arrows.count(), 2);
    assert.deepEqual(await arrows.evaluateAll((list) => list.map((b) => getComputedStyle(b).visibility)), ["hidden", "hidden"]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("one photo can fill several slots; tapping its slot on the frame removes it; Chọn lại starts over", async () => {
  const { page, errors } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    const photosTab = page.getByRole("tab", { name: /^Chọn ảnh/ });
    // Cùng một ảnh cho cả hai ô của khung.
    await shots.nth(0).click();
    await shots.nth(0).click();
    assert.deepEqual((await saved(page)).selected, ["p1", "p1"]);
    await photosTab.click();
    assert.equal(await shots.nth(0).getAttribute("aria-label"), "Ảnh ở ô 1, 2");
    assert.equal(await shots.nth(0).locator(".select-order").innerText(), "1·2");
    assert.equal(await shots.nth(1).isDisabled(), true, "every slot is filled");
    // Chạm ô thứ hai trên khung xem trước: bỏ ảnh ở ô đó, rồi chọn ảnh khác cho ô đó.
    await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)"));
    const box = await page.getByRole("img", { name: /Khung ảnh xem trước/ }).boundingBox();
    await page.mouse.click(box.x + 0.5 * box.width, box.y + 0.74 * box.height);
    assert.deepEqual((await saved(page)).selected, ["p1"]);
    await shots.nth(1).click();
    assert.deepEqual((await saved(page)).selected, ["p1", "p2"]);
    await photosTab.click();
    await page.getByRole("button", { name: "Chọn lại", exact: true }).click();
    assert.deepEqual((await saved(page)).selected, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("names and signatures: soft bundled fonts and a symbol palette, with the fonts loaded before drawing", async () => {
  const { page, errors } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    await page.getByRole("tab", { name: /Thêm chữ/ }).click();
    const fonts = page.getByRole("group", { name: "Kiểu chữ" });
    for (const label of ["Chữ ký", "Mềm mại", "Bo tròn"]) await fonts.getByRole("button", { name: label, exact: true }).waitFor();
    await fonts.getByRole("button", { name: "Chữ ký", exact: true }).click();
    const keyboard = page.getByRole("group", { name: "Bàn phím" });
    for (const key of "an") await keyboard.getByRole("button", { name: key, exact: true }).click();
    const marks = page.getByRole("group", { name: "Ký tự trang trí" });
    await marks.getByRole("button", { name: "Thêm .", exact: true }).click();
    await marks.getByRole("button", { name: "Thêm __ ♡ __", exact: true }).click();
    await marks.getByRole("button", { name: "Thêm ☆", exact: true }).click();
    await page.getByRole("button", { name: /Thêm chữ vào khung/ }).click();
    const sticker = (await saved(page)).decor.stickers.at(-1);
    assert.deepEqual([sticker.type, sticker.text, sticker.font], ["text", "an.__ ♡ __☆", "vibes"]);
    // Font viết tay và font ký hiệu đi kèm đã tải xong (khung vẽ bằng chúng, không ra ô vuông).
    await page.waitForFunction(() => {
      const loaded = (family) => [...document.fonts].some((f) => f.family.replace(/["']/g, "") === family && f.status === "loaded");
      return loaded("Great Vibes") && loaded("Noto Sans Symbols 2");
    }, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(tmpdir(), "photobooth-fe-select-text.png") });
    // Màn của tiệm (ngang 1920 × 1080, dọc 1080 × 1920): mục Thêm chữ vừa một màn, không phải cuộn.
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(tmpdir(), `photobooth-fe-select-text-${viewport.width}.png`) });
      const fit = await page.evaluate(() => ({ scrolls: document.documentElement.scrollHeight > innerHeight + 1,
        print: document.querySelector(".kiosk-next")?.getBoundingClientRect().bottom <= innerHeight }));
      assert.deepEqual(fit, { scrolls: false, print: true }, `text tab at ${viewport.width} × ${viewport.height}`);
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the Khung tab shows every frame with the guest's photos; tapping one switches the big preview", async () => {
  const { page, errors } = await selectScreen({ viewport: { width: 1920, height: 1080 } });
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    await page.waitForFunction(() => document.querySelector("#select-tab-frames")?.getAttribute("aria-selected") === "true");
    const choices = page.getByRole("radiogroup", { name: "Chọn khung" }).getByRole("radio");
    assert.deepEqual(
      await choices.evaluateAll((radios) => radios.map((r) => [r.getAttribute("aria-label"), r.getAttribute("aria-checked")])),
      [["Khung thử · khung 1", "true"], ["Khung thứ hai · khung 2", "false"]],
    );
    await page.waitForFunction(() => document.querySelectorAll(".frame-choice.is-ready").length === 2);
    const tiles = await page.evaluate(() => [...document.querySelectorAll(".frame-choice canvas")].map((c) => {
      const ctx = c.getContext("2d");
      const at = (x, y) => [...ctx.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data].slice(0, 3);
      const box = c.getBoundingClientRect();
      return { photo: at(0.5, 0.26), edge: at(0.02, 0.5), size: [c.width, c.height], shown: Math.round(box.width) };
    }));
    const close = (actual, expected, tolerance = 24) => actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
    // Mỗi ô là khung ghép sẵn ảnh khách (đỏ) ở cạnh dài 360 px; viền lấy từ ảnh khung xem nhanh nếu có.
    assert.deepEqual(tiles.map((t) => t.size), [[240, 360], [240, 360]]);
    assert.ok(tiles.every((t) => close(t.photo, RED)), JSON.stringify(tiles));
    assert.ok(close(tiles[0].edge, PINK) && close(tiles[1].edge, GREEN), JSON.stringify(tiles));
    assert.ok(tiles.every((t) => t.shown >= 140), `ô rộng ${tiles.map((t) => t.shown)}`);
    const layout = await page.evaluate(() => ({
      tabRows: new Set([...document.querySelectorAll(".select-tabs [role=tab]")].map((t) => Math.round(t.getBoundingClientRect().top))).size,
      pageScrolls: document.documentElement.scrollHeight > innerHeight + 1,
    }));
    assert.deepEqual(layout, { tabRows: 1, pageScrolls: false });
    await page.screenshot({ path: join(tmpdir(), "photobooth-fe-select-frames-1920.png") });

    await choices.nth(1).click();
    assert.equal(await choices.nth(1).getAttribute("aria-checked"), "true");
    await page.getByText("Khung thứ hai · khung 2/2", { exact: true }).waitFor();
    const session = await saved(page);
    assert.equal(session.frameIndex, 1);
    assert.equal(session.selected.length, 2, "đổi khung giữ nguyên ảnh đã chọn");
    // Nút ‹ › vẫn đổi khung và ô đang chọn đi theo.
    await page.getByRole("button", { name: "Khung trước", exact: true }).click();
    assert.equal(await choices.nth(0).getAttribute("aria-checked"), "true");
    // Màn 1366 × 768: 6 mục vẫn một hàng (bỏ biểu tượng) và mục Khung không làm trang cao hơn mục Chọn ảnh.
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(tmpdir(), "photobooth-fe-select-frames-1366.png") });
    const measure = () => page.evaluate(() => ({
      tabRows: new Set([...document.querySelectorAll(".select-tabs [role=tab]")].map((t) => Math.round(t.getBoundingClientRect().top))).size,
      height: document.documentElement.scrollHeight,
    }));
    const onFrames = await measure();
    await page.getByRole("tab", { name: /Chọn ảnh/ }).click();
    await page.getByRole("group", { name: "Ảnh đã chụp" }).waitFor();
    assert.deepEqual(onFrames, await measure());
    assert.equal(onFrames.tabRows, 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("16 frames in two themes fit the Khung panel on 1920 × 1080; a theme chip narrows the grid", async () => {
  const { page, errors } = await selectScreen({ query: "/?frames=16", viewport: { width: 1920, height: 1080 } });
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    await page.waitForFunction(() => document.querySelector("#select-tab-frames")?.getAttribute("aria-selected") === "true");
    const chips = page.getByRole("group", { name: "Chủ đề khung" }).getByRole("button");
    assert.deepEqual(await chips.allInnerTexts(), ["Tất cả", "LIMIT", "Noel"]);
    const choices = page.getByRole("radiogroup", { name: "Chọn khung" }).getByRole("radio");
    assert.equal(await choices.count(), 16);
    // Ghép lần lượt từng ô: đủ 16 ô.
    await page.waitForFunction(() => document.querySelectorAll(".frame-choice.is-ready").length === 16);
    const layout = await page.evaluate(() => {
      const grid = document.querySelector(".frame-choices").getBoundingClientRect();
      const cells = [...document.querySelectorAll(".frame-choice")].map((c) => c.getBoundingClientRect());
      return {
        width: Math.round(Math.min(...cells.map((c) => c.width))),
        visible: cells.filter((c) => c.top >= grid.top - 1 && c.bottom <= grid.bottom + 1).length,
        pageScrolls: document.documentElement.scrollHeight > innerHeight + 1,
      };
    });
    assert.ok(layout.width >= 140, `ô rộng ${layout.width} px`);
    assert.ok(layout.visible >= 12, `thấy ngay ${layout.visible}/16 khung`);
    assert.equal(layout.pageScrolls, false);
    await page.screenshot({ path: join(tmpdir(), "photobooth-fe-select-frames16-1920.png") });

    await chips.nth(2).click();
    assert.equal(await chips.nth(2).getAttribute("aria-pressed"), "true");
    assert.equal(await choices.count(), 8);
    assert.equal(await choices.first().getAttribute("aria-label"), "Noel · khung 9");
    await choices.first().click();
    await page.getByText("Noel · khung 9/16", { exact: true }).waitFor();
    assert.equal((await saved(page)).frameIndex, 8);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("portrait 1080 × 1920 touch screen: big preview on top, one row of tabs, 12 photos and 16 frames fit without scrolling", async () => {
  const { page, errors } = await selectScreen({ query: "/?frames=16", shots: 12, viewport: { width: 1080, height: 1920 } });
  try {
    const grid = page.getByRole("group", { name: "Ảnh đã chụp" });
    await grid.getByRole("button").nth(11).locator("img").waitFor();
    await page.waitForFunction(() => document.querySelector(".select-grid")?.classList.contains("is-fitted"));
    await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)"));
    const measure = (cellSelector, gridSelector) => page.evaluate(([cellSelector, gridSelector]) => {
      const box = (el) => el.getBoundingClientRect();
      const preview = box(document.querySelector(".decor-canvas"));
      const tabs = [...document.querySelectorAll(".select-tabs [role=tab]")].map(box);
      const area = box(document.querySelector(gridSelector));
      const cells = [...document.querySelectorAll(cellSelector)].map(box);
      return {
        previewHeight: Math.round(preview.height),
        previewAboveTabs: preview.bottom <= tabs[0].top,
        tabRows: new Set(tabs.map((t) => Math.round(t.top))).size,
        tabHeight: Math.round(tabs[0].height),
        cellWidth: Math.round(Math.min(...cells.map((c) => c.width))),
        allVisible: cells.every((c) => c.top >= area.top - 1 && c.bottom <= area.bottom + 1),
        pageScrolls: document.documentElement.scrollHeight > innerHeight + 1,
      };
    }, [cellSelector, gridSelector]);
    const photos = await measure(".select-shot", ".select-grid");
    await page.screenshot({ path: join(tmpdir(), "photobooth-fe-portrait-photos.png") });
    assert.ok(photos.previewHeight >= 600, `khung xem trước cao ${photos.previewHeight} px`);
    assert.ok(photos.cellWidth >= 220, `ảnh rộng ${photos.cellWidth} px`);
    assert.ok(photos.tabHeight >= 72, `mục cao ${photos.tabHeight} px`);
    assert.deepEqual({ ...photos, previewHeight: 0, cellWidth: 0, tabHeight: 0 },
      { previewHeight: 0, previewAboveTabs: true, tabRows: 1, tabHeight: 0, cellWidth: 0, allVisible: true, pageScrolls: false });

    await grid.getByRole("button").nth(0).click();
    await grid.getByRole("button").nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll(".frame-choice.is-ready").length === 16);
    const frames = await measure(".frame-choice", ".frame-choices");
    await page.screenshot({ path: join(tmpdir(), "photobooth-fe-portrait-frames.png") });
    assert.ok(frames.cellWidth >= 140, `khung rộng ${frames.cellWidth} px`);
    assert.equal(frames.allVisible, true, "thấy cả 16 khung");
    assert.equal(frames.pageScrolls, false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("PROBE tabs", async () => {
  const { page } = await selectScreen({ shots: 12, viewport: { width: 1080, height: 1920 } });
  try {
    const grid = page.getByRole("group", { name: "Ảnh đã chụp" });
    await grid.getByRole("button").nth(0).click();
    await grid.getByRole("button").nth(1).click();
    for (const [name, file] of [["Chỉnh ảnh", "adjust"], ["Màu ảnh", "color"], ["Thêm chữ", "text"], ["Nhãn dán", "stickers"]]) {
      await page.getByRole("tab", { name: new RegExp(name) }).click();
      if (file === "adjust") await page.locator(".adjust-photo").first().click();
      await page.waitForTimeout(300);
      const clip = await page.evaluate(() => {
        const panel = document.querySelector(".select-tab-panel").getBoundingClientRect();
        const kids = [...document.querySelectorAll(".select-tab-panel *")].map((e) => e.getBoundingClientRect().bottom);
        return { panelBottom: Math.round(panel.bottom), contentBottom: Math.round(Math.max(...kids)), foot: Math.round(document.querySelector(".flow-foot").getBoundingClientRect().top) };
      });
      console.log("PROBE", file, JSON.stringify(clip));
      await page.screenshot({ path: join(tmpdir(), `photobooth-fe-portrait-${file}.png`) });
    }
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

// Từ 14/11 phòng Polaroid / Selfbooth cũng chụp Fujifilm X-T3 qua X Acquire (in tờ 20 × 30 máy DS820).
test("Polaroid staff setup and startup scripts select the Fujifilm X-T3 like Photobooth; no Canon left", async () => {
  const { page, errors } = await selectScreen();
  try {
    await page.evaluate(() => window.showCameraSetup('polaroid'));
    await page.locator('.kiosk-settings > summary').click();
    await page.getByRole('button', { name: /Hướng dẫn: kết nối Fujifilm X-T3/ }).click();
    await page.getByText(/Mở FUJIFILM X Acquire/).waitFor();
    assert.ok(!(await page.locator('.guide-body').innerText()).includes('EOS Utility'));
    assert.equal(await page.getByRole('link', { name: 'Tải FUJIFILM X Acquire' }).count(), 1);
    assert.equal(await page.getByRole('link', { name: 'Tải Canon EOS Utility' }).count(), 0);
    assert.equal(await page.getByText('Máy đọc tiền (ICT)', { exact: true }).count(), 0);
    const polaroid = await page.evaluate(() => window.makeKioskScripts('polaroid'));
    const payload = /rem NXC_FUJI_ACQUIRE_BASE64:([A-Za-z0-9+/=]+)/.exec(polaroid.windows);
    assert.ok(payload);
    assert.ok(Buffer.from(payload[1], 'base64').toString('utf8').includes('C:\\PhotoBooth\\Fujifilm'));
    assert.ok(!polaroid.windows.includes('NXC_EOS_UTILITY_BASE64:'));
    assert.ok(polaroid.mac.includes('FUJIFILM X Acquire'));
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
    // Chọn đủ ảnh: tự mở mục kế tiếp (Khung); màu ảnh ở mục Màu ảnh.
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
    // Chọn đủ ảnh: tự mở mục kế tiếp (Khung); màu ảnh ở mục Màu ảnh.
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
    // Chọn đủ ảnh: tự mở mục kế tiếp (Khung); màu ảnh ở mục Màu ảnh.
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
      ["Chọn ảnh", "Khung", "Chỉnh ảnh", "Màu ảnh", "Thêm chữ"],
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
    // Chọn đủ ảnh: mục Khung tự mở; sang Chỉnh ảnh để kéo ảnh trên khung.
    await page.waitForFunction(() => document.querySelector("#select-tab-frames")?.getAttribute("aria-selected") === "true");
    await page.getByRole("tab", { name: /Chỉnh ảnh/ }).click();
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
