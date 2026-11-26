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
  kioskTexts: { "select.frameSubtitle": "Chọn một khung bạn thích rồi tiếp tục nhé" } };

let server, browser, base;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { Kiosk } from '/src/kiosk/Kiosk.jsx';
  import { KioskCode } from '/src/kiosk/KioskSale.jsx';
  import { KioskSettings } from '/src/kiosk/KioskSettings.jsx';
  import { BillAcceptorManager } from '/src/admin/bill-acceptor.jsx';
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
  // Thiết lập → Máy nhận tiền (trang quản trị), như trong khung admin.
  window.showBillPage = () => root.render(wrap(React.createElement('main', { className: 'admin-shell', style: { display: 'block', padding: 20 } },
    React.createElement(BillAcceptorManager, { notify() {} }))));
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

async function selectScreen({ query = "", shots = 3, prints = 1, viewport = { width: 1366, height: 768 }, holdPrint = false, phase = "select", seconds = 150, failPreview = false } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [], photoReads = [], uploads = { composite: null, print: null, printCalls: 0, archive: null };
  let releasePrint, failedThumbnail = false;
  const printerReady = new Promise((resolve) => { releasePrint = resolve; });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route('http://127.0.0.1:8789/**', async route => {
    if (new URL(route.request().url()).pathname === '/print') {
      uploads.printCalls++;
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
    if (/\/albums\/fixture-album\/photos\//.test(path)) {
      photoReads.push(path);
      if (failPreview && /\/p1$/.test(path) && url.searchParams.get("direct")) {
        if (url.searchParams.get("size") === "thumbnail") failedThumbnail = true;
        return route.fulfill({ status: 404, json: { message: "Preview unavailable" } });
      }
      return route.fulfill({ body: photoImage, contentType: "image/png" });
    }
    if (path.endsWith("/kiosk/composite")) {
      uploads.composite = route.request().postDataBuffer();
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/print-archive")) {
      uploads.archive = { result: url.searchParams.get("result"), bytes: route.request().postDataBuffer() };
      return route.fulfill({ json: { _id: "saved-job" } });
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
  await page.addInitScript(({booking,phase,seconds}) => {
    if (sessionStorage.getItem("photo-capture-fixture-device")) return;
    sessionStorage.setItem("photo-capture-fixture-device", JSON.stringify({
      captureToken: "fixture-capture", accessToken: "fixture-album", booking,
      phase, selected: [], selectEndsAt: Date.now() + seconds * 1000, mode: "remote",
    }));
  }, {booking,phase,seconds});
  await page.goto(base + query);
  return { page, errors, uploads, releasePrint, photoReads, failedThumbnail: () => failedThumbnail,
    recoverPreview: () => { failPreview = false; } };
}
const saved = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("photo-capture-fixture-device")));

for (const seconds of [1, -1]) test(`expiry on the frame-only screen fills the chosen frame with actual photos and prints once (${seconds < 0 ? 'resumed after expiry' : 'live countdown'})`, async () => {
  const {page,errors,uploads}=await selectScreen({phase:'frame-pick',seconds});
  try {
    await page.waitForFunction(()=>document.querySelector('.done-title'),null,{timeout:15000});
    for(let i=0;i<150&&(!uploads.print||!uploads.composite);i++)await page.waitForTimeout(100);
    assert.ok(uploads.print);assert.ok(uploads.composite);
    assert.equal(uploads.printCalls,1);
    const result=await samples(page,uploads.composite,[[.5,.26],[.5,.74]]);
    for(const color of result.colors)assert.ok(color.every((value,i)=>Math.abs(value-RED[i])<24),'timeout must decode customer photos instead of printing empty slots');
    assert.deepEqual(errors,[]);
  } finally {await page.close()}
});

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

test("QR-only sessions save a master for the counter and a 20 MP album composite without sending paper", async () => {
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
    for (let i = 0; i < 100 && (!uploads.composite || !uploads.archive); i++) await page.waitForTimeout(100);
    assert.ok(uploads.composite);
    assert.equal(uploads.print, null);
    const targets = await page.evaluate(() => window.renderTargets);
    assert.equal(targets.some(([w, h]) => w === 2400 && h === 3600), true);
    assert.equal(uploads.archive?.result, "saved");
    assert.ok(uploads.archive.bytes.length > 0);
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
    assert.equal(await page.getByRole("tab", {name:/Chọn ảnh/}).getAttribute("aria-selected"), "true");
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

test("blank frame selection uses the admin hint and back preserves the shared deadline", async () => {
  const {page,errors}=await selectScreen();
  try {
    const shots=page.getByRole("group",{name:"Ảnh đã chụp"}).getByRole("button");
    await shots.nth(0).click();await shots.nth(1).click();
    const before=await saved(page);
    await page.getByRole("button",{name:"Đổi khung",exact:true}).click();
    await page.getByText(SETTINGS.kioskTexts["select.frameSubtitle"],{exact:true}).waitFor();
    const choices=page.getByRole("radiogroup",{name:"Chọn khung"}).getByRole("radio");
    await choices.nth(1).click();
    await page.getByRole("button",{name:"Tiếp tục",exact:true}).click();
    await page.getByText("Khung thứ hai · khung 2/2",{exact:true}).waitFor();
    const after=await saved(page);
    assert.equal(after.frameIndex,1);assert.deepEqual(after.selected,before.selected);
    assert.equal(after.selectEndsAt,before.selectEndsAt);
    assert.deepEqual(after.decor,before.decor);assert.deepEqual(errors,[]);
  } finally {await page.close()}
});

test("a single blank frame still has an explicit Continue step", async () => {
  const {page,errors}=await selectScreen({query:"?frames=1",phase:"frame-pick"});
  try {
    assert.equal(await page.getByRole("radiogroup",{name:"Chọn khung"}).getByRole("radio").count(),1);
    assert.equal(await page.getByRole("group",{name:"Ảnh đã chụp"}).count(),0);
    await page.getByRole("button",{name:"Tiếp tục",exact:true}).click();
    await page.getByRole("group",{name:"Ảnh đã chụp"}).waitFor();
    assert.equal(await page.locator(".frame-arrow").count(),0);
    assert.equal(await page.getByRole("tab",{name:"Khung",exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  } finally {await page.close()}
});

test("one photo can fill several slots; tapping a slot on the frame empties only that slot", async () => {
  const { page, errors } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    const photosTab = page.getByRole("tab", { name: /^Chọn ảnh/ });
    await shots.nth(0).click();
    assert.equal(await shots.nth(0).getAttribute("aria-label"), "Ảnh ở ô 1 · chạm để thêm vào ô trống");
    // Khách muốn một ảnh ở hai ô: chạm lại ảnh đó — ảnh vào ô trống tiếp theo (trước đây chạm lại là bỏ).
    await shots.nth(0).click();
    assert.deepEqual((await saved(page)).selected, ["p1", "p1"]);
    assert.equal(await shots.nth(0).getAttribute("aria-label"), "Ảnh ở ô 1, 2");
    assert.equal(await shots.nth(0).locator(".select-order").innerText(), "1·2");
    assert.equal(await shots.nth(2).getAttribute("aria-disabled"), "true", "every slot is filled");
    // Khung đủ ảnh: ảnh không bị khoá mờ như nút hỏng; chạm vào thì nhắc cách đổi ảnh, không đổi gì.
    await shots.nth(2).click({ force: true }); // aria-disabled: trình đọc màn hình biết khung đã đủ
    await page.getByText(/Khung đã đủ ảnh\. Muốn đổi ảnh, chạm ô đó trên khung/).waitFor();
    assert.deepEqual((await saved(page)).selected, ["p1", "p1"]);
    // Chạm ô thứ hai trên khung xem trước: bỏ ảnh ở ô đó, ô 1 giữ nguyên.
    await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)"));
    const box = await page.getByRole("img", { name: /Khung ảnh xem trước/ }).boundingBox();
    await page.mouse.click(box.x + 0.5 * box.width, box.y + 0.74 * box.height);
    assert.deepEqual((await saved(page)).selected, ["p1", null]);
    assert.equal(await shots.nth(2).getAttribute("aria-disabled"), null);
    // Ảnh mới vào đúng ô trống.
    await shots.nth(2).click();
    assert.deepEqual((await saved(page)).selected, ["p1", "p3"]);
    await photosTab.click();
    await page.getByRole("button", { name: "Chọn lại", exact: true }).click();
    assert.deepEqual((await saved(page)).selected, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a frame with more slots than photos asks for every numbered slot; one photo can fill them all", async () => {
  const { page, errors } = await selectScreen({ shots: 1 });
  try {
    // Màu điểm giữa ô trên (y 0.26) hoặc ô dưới (y 0.74) của khung xem trước.
    const isRed = (y) => page.evaluate((y) => {
      const canvas = document.querySelector("canvas.decor-canvas:not(.is-loading)");
      if (!canvas) return false;
      const [r, g, b] = canvas.getContext("2d").getImageData(Math.round(canvas.width / 2), Math.round(canvas.height * y), 1, 1).data;
      return r > 180 && g < 80 && b < 80;
    }, y);
    // Khách chụp 1 ảnh, khung đánh số 1–2: vẫn chọn đủ 2 ô (admin đánh số ô nào thì khách chọn ô đó),
    // ô 2 chưa chọn thì để trống — không tự lặp ảnh ô 1.
    await page.getByText(/Đã chọn 0\/2 ô/).waitFor();
    const photo = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button").nth(0);
    await photo.click();
    await page.getByText(/Đã chọn 1\/2 ô/).waitFor();
    await page.waitForFunction(() => document.querySelector("canvas.decor-canvas:not(.is-loading)"));
    for (let i = 0; i < 50 && !(await isRed(0.26)); i++) await page.waitForTimeout(100);
    assert.equal(await isRed(0.26), true, "the chosen slot shows the photo");
    assert.equal(await isRed(0.74), false, "slot 2 waits for its own pick");
    // Chạm lại ảnh đó: lấp ô 2.
    await photo.click();
    for (let i = 0; i < 50 && !(await isRed(0.74)); i++) await page.waitForTimeout(100);
    assert.equal(await isRed(0.74), true, "the same photo fills slot 2");
    const [key] = (await saved(page)).selected;
    assert.deepEqual((await saved(page)).selected, [key, key]);
    // Chạm ô 2 trên khung: chỉ bỏ ô đó.
    const box = await page.getByRole("img", { name: /Khung ảnh xem trước/ }).boundingBox();
    await page.mouse.click(box.x + 0.5 * box.width, box.y + 0.74 * box.height);
    assert.deepEqual((await saved(page)).selected, [key, null]);
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

test("the first screen shows blank catalog frames only, then photos appear beside the chosen composition", async () => {
  const {page,errors,photoReads}=await selectScreen({phase:"frame-pick",viewport:{width:1920,height:1080}});
  try {
    const choices=page.getByRole("radiogroup",{name:"Chọn khung"}).getByRole("radio");
    assert.equal(await choices.count(),2);
    await page.waitForFunction(()=>[...document.querySelectorAll(".ptb-frame-art img")].every(img=>img.naturalWidth>0));
    assert.equal(await page.locator("canvas").count(),0,"the frame step never composes customer photos");
    assert.ok(photoReads.length > 0,"frame selection preloads customer previews without showing them");
    const colors=await page.locator(".ptb-frame-art img").evaluateAll(images=>images.map(img=>{
      const c=document.createElement("canvas");c.width=img.naturalWidth;c.height=img.naturalHeight;
      const ctx=c.getContext("2d");ctx.drawImage(img,0,0);
      return [...ctx.getImageData(Math.round(c.width*.5),Math.round(c.height*.26),1,1).data].slice(0,3);
    }));
    assert.deepEqual(colors,[[255,255,255],[255,255,255]],"photo slots stay blank");
    await choices.nth(1).click();const deadline=(await saved(page)).selectEndsAt;
    await page.reload();assert.equal((await saved(page)).phase,"frame-pick");
    assert.equal(await choices.nth(1).getAttribute("aria-checked"),"true");
    await page.screenshot({path:join(tmpdir(),"photobooth-fe-ptb-frames-first-1920.png")});
    await page.getByRole("button",{name:"Tiếp tục",exact:true}).click();
    const photos=page.getByRole("group",{name:"Ảnh đã chụp"});
    await photos.waitFor();assert.equal(await photos.getByRole("button").count(),3);
    await photos.getByRole("button").nth(0).click();await photos.getByRole("button").nth(1).click();
    assert.equal(await page.getByRole("tab",{name:/Chọn ảnh/}).getAttribute("aria-selected"),"true");
    await page.waitForFunction(()=>document.querySelector(".decor-canvas:not(.is-loading)"));
    const layout=await page.evaluate(()=>{
      const left=document.querySelector(".select-preview").getBoundingClientRect(),right=document.querySelector(".select-panel").getBoundingClientRect();
      return {left:left.right<=right.left,scroll:document.documentElement.scrollHeight>innerHeight+1};
    });
    assert.deepEqual(layout,{left:true,scroll:false});
    assert.equal((await saved(page)).selectEndsAt,deadline);
    await page.screenshot({path:join(tmpdir(),"photobooth-fe-ptb-photos-second-1920.png")});
    assert.deepEqual(errors,[]);
  } finally {await page.close()}
});

test("the featured frame can be changed with arrows or any of the 16 thumbnails", async () => {
  const {page,errors}=await selectScreen({query:"/?frames=16",phase:"frame-pick",viewport:{width:1920,height:1080}});
  try {
    await page.locator(".ptb-frame-feature img").waitFor();
    const choices=page.getByRole("radiogroup",{name:"Chọn khung"}).getByRole("radio");
    assert.equal(await choices.count(),16);
    for (const viewport of [{width:1366,height:768},{width:1920,height:1080}]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(200);
      const layout=await page.evaluate(()=>{
        const rail=document.querySelector(".ptb-frame-rail").getBoundingClientRect();
        const feature=document.querySelector(".ptb-frame-feature").getBoundingClientRect();
        return {above:feature.bottom<=rail.top+1, larger:feature.height>rail.height,scroll:document.documentElement.scrollHeight>innerHeight+1};
      });
      assert.deepEqual(layout,{above:true,larger:true,scroll:false});
      await page.screenshot({path:join(tmpdir(),`photobooth-fe-ptb-frames16-${viewport.width}.png`)});
    }
    await page.getByRole("button",{name:"Khung sau"}).click();
    assert.equal(await choices.nth(1).getAttribute("aria-checked"),"true");
    await page.getByRole("button",{name:"Khung trước"}).click();
    assert.equal(await choices.first().getAttribute("aria-checked"),"true");
    await choices.last().click();
    assert.equal((await saved(page)).frameIndex,15);
    await page.screenshot({path:join(tmpdir(),"photobooth-fe-ptb-frames16-1920.png")});
    assert.deepEqual(errors,[]);
  } finally {await page.close()}
});

test("when a thumbnail is visible but both preview requests fail, retry fills the selected slot", async () => {
  const { page, errors, failedThumbnail, recoverPreview } = await selectScreen({ failPreview: true, phase: "frame-pick" });
  try {
    for (let i = 0; i < 50 && !failedThumbnail(); i++) await page.waitForTimeout(100);
    assert.ok(failedThumbnail());
    await page.getByRole("button", { name: "Tiếp tục" }).click();
    await page.locator(".select-shot").first().click();
    await page.waitForFunction(() => document.querySelector(".select-shot img")?.naturalWidth > 0);
    const retry = page.getByRole("button", { name: "Tải lại ảnh" });
    await retry.waitFor();
    recoverPreview();
    await retry.click();
    await page.waitForFunction(() => {
      const canvas = document.querySelector(".decor-canvas");
      if (!canvas?.width) return false;
      const [r, g, b] = canvas.getContext("2d").getImageData(Math.round(canvas.width * .5), Math.round(canvas.height * .26), 1, 1).data;
      return r > 150 && g < 100 && b < 100;
    });
    assert.equal(await retry.count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("portrait keeps all 12 photos in the editor and all 16 frames in the separate frame step", async () => {
  const {page,errors}=await selectScreen({query:"/?frames=16",shots:12,viewport:{width:1080,height:1920}});
  try {
    await page.waitForFunction(()=>document.querySelector(".select-grid.is-fitted"));
    await page.waitForFunction(()=>document.querySelector(".decor-canvas:not(.is-loading)"));
    await page.waitForFunction(() => {
      const grid = document.querySelector(".select-grid").getBoundingClientRect();
      return [...document.querySelectorAll(".select-shot")].every(cell => cell.getBoundingClientRect().bottom <= grid.bottom + 1);
    });
    const layout=await page.evaluate(()=>{
      const image=document.querySelector(".decor-canvas").getBoundingClientRect();
      const panel=document.querySelector(".select-panel").getBoundingClientRect();
      const grid=document.querySelector(".select-grid").getBoundingClientRect();
      const cells=[...document.querySelectorAll(".select-shot")].map(c=>c.getBoundingClientRect());
      const tabs=[...document.querySelectorAll(".select-tabs [role=tab]")].map(t=>t.getBoundingClientRect());
      return {above:image.bottom<=panel.top+1,rows:new Set(tabs.map(t=>Math.round(t.top))).size,
        photos:cells.every(c=>c.top>=grid.top-1&&c.bottom<=grid.bottom+1),scroll:document.documentElement.scrollHeight>innerHeight+1};
    });
    assert.deepEqual(layout,{above:true,rows:1,photos:true,scroll:false});
    await page.screenshot({path:join(tmpdir(),"photobooth-fe-ptb-photos-second-portrait.png")});
    await page.getByRole("button",{name:"Đổi khung",exact:true}).click();
    await page.locator(".ptb-frame-feature img").waitFor();
    assert.equal(await page.getByRole("radiogroup",{name:"Chọn khung"}).getByRole("radio").count(),16);
    assert.equal(await page.getByRole("button",{name:"Tiếp tục"}).isVisible(),true);
    await page.screenshot({path:join(tmpdir(),"photobooth-fe-ptb-frames-first-portrait.png")});
    assert.deepEqual(errors,[]);
  } finally {await page.close()}
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

// Từ 14/11 phòng Selfbooth cũng chụp Fujifilm X-T3 qua X Acquire (in tờ 20 × 30 máy DS820).
test("Selfbooth staff setup and startup scripts select the Fujifilm X-T3 like Photobooth; no Canon left", async () => {
  const { page, errors } = await selectScreen();
  try {
    await page.evaluate(() => window.showCameraSetup('selfbooth'));
    await page.locator('.kiosk-settings > summary').click();
    await page.getByRole('button', { name: /Hướng dẫn: kết nối Fujifilm X-T3/ }).click();
    await page.getByText(/Mở FUJIFILM X Acquire/).waitFor();
    assert.ok(!(await page.locator('.guide-body').innerText()).includes('EOS Utility'));
    assert.equal(await page.getByRole('link', { name: 'Tải FUJIFILM X Acquire' }).count(), 1);
    assert.equal(await page.getByRole('link', { name: 'Tải Canon EOS Utility' }).count(), 0);
    assert.equal(await page.getByText('Máy nhận tiền (ICT)', { exact: true }).count(), 0);
    const selfbooth = await page.evaluate(() => window.makeKioskScripts('selfbooth'));
    const payload = /rem NXC_FUJI_ACQUIRE_BASE64:([A-Za-z0-9+/=]+)/.exec(selfbooth.windows);
    assert.ok(payload);
    assert.ok(Buffer.from(payload[1], 'base64').toString('utf8').includes('C:\\PhotoBooth\\Fujifilm'));
    assert.ok(!selfbooth.windows.includes('NXC_EOS_UTILITY_BASE64:'));
    assert.ok(selfbooth.mac.includes('FUJIFILM X Acquire'));
    await page.evaluate(() => window.showCameraSetup('photobooth'));
    assert.equal(await page.getByRole('link', { name: 'Tải FUJIFILM X Acquire' }).count(), 1);
    assert.equal(await page.getByText('Máy nhận tiền (ICT)', { exact: true }).count(), 1);
    const fuji = await page.evaluate(() => window.makeKioskScripts('photobooth'));
    assert.ok(fuji.windows.includes('NXC_FUJI_ACQUIRE_BASE64:'));
    assert.ok(!fuji.windows.includes('NXC_EOS_UTILITY_BASE64:'));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the kiosk keeps only the bill acceptor status and a quick test; setup lives in Thiết lập → Máy nhận tiền", async () => {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base);
    await page.evaluate(() => window.showCameraSetup('photobooth'));
    await page.locator('.kiosk-settings > summary').click();
    const box = page.locator('.bill-kiosk');
    await box.waitFor();
    assert.match(await box.getByRole('status').innerText(), /Chưa kết nối/);
    assert.match(await box.innerText(), /Quản trị → Thiết lập → Máy nhận tiền/);
    assert.equal(await box.getByRole('button', { name: 'Kết nối máy nhận tiền' }).count(), 0, "connecting moved to the admin page");
    assert.equal(await box.getByRole('button', { name: 'Thử nhận tiền' }).count(), 0, "no test before the port is open");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }])
  test(`Thiết lập → Máy nhận tiền (${viewport.width} px): one connect button, a 4-step self-check, the setup guide with the circuit program, and fixes`, async () => {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(base);
      await page.evaluate(() => window.showBillPage());
      const connect = page.getByRole('region', { name: 'Kết nối trên máy tính này' });
      await connect.waitFor();
      assert.match(await connect.innerText(), /trên chính máy tính của phòng chụp/);
      const checks = connect.getByRole('list', { name: 'Kiểm tra máy nhận tiền' }).getByRole('listitem');
      assert.equal(await checks.count(), 4);
      assert.match(await checks.nth(1).innerText(), /Chưa chọn cổng — bấm “Kết nối máy nhận tiền”/);
      assert.match(await checks.nth(3).innerText(), /Bấm “Thử nhận tiền” rồi đút một tờ/);
      assert.equal(await connect.getByRole('button', { name: 'Kết nối máy nhận tiền', exact: true }).count(), 1);
      // Chưa mở cổng thì chưa thử nhận tiền được.
      assert.equal(await connect.getByRole('button', { name: 'Thử nhận tiền' }).isDisabled(), true);
      const guide = page.getByRole('region', { name: 'Hướng dẫn lắp & kết nối' });
      assert.equal(await guide.locator('.bill-steps > li').count(), 5);
      assert.equal(await guide.getByRole('link', { name: /bill-acceptor-pulse\.ino/ }).getAttribute('href'), '/downloads/bill-acceptor-pulse.ino');
      assert.equal(await guide.getByRole('link', { name: /Tải chương trình mạch Arduino/ }).getAttribute('href'), '/downloads/bill-acceptor-pulse.ino');
      assert.match(await guide.innerText(), /Không nối 12V vào Arduino/);
      assert.equal(await page.getByRole('region', { name: 'Gỡ lỗi thường gặp' }).locator('dt').count(), 7);
      // Cài đặt nâng cao: nút "Chọn cổng" không dính sát ô chọn kiểu nối.
      await connect.getByText('Cài đặt nâng cao (chọn kiểu nối thủ công)').click();
      const select = await connect.getByLabel('Kiểu kết nối').boundingBox();
      const pick = await connect.getByRole('button', { name: 'Chọn cổng (không tự nhận diện)' }).boundingBox();
      assert.ok(pick.y - (select.y + select.height) >= 16, `the button sits ${pick.y - select.y - select.height}px under the select`);
      await connect.screenshot({ path: join(tmpdir(), `photobooth-fe-bill-advanced-${viewport.width}.png`) });
      // Không tràn ngang trên điện thoại.
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      await page.screenshot({ path: join(tmpdir(), `photobooth-fe-bill-page-${viewport.width}.png`), fullPage: true });
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
    // Chọn đủ ảnh: mục Khung tự mở; sang Chỉnh ảnh để kéo ảnh trên khung.
    assert.equal(await page.getByRole("tab", {name:/Chọn ảnh/}).getAttribute("aria-selected"), "true");
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


test("Xoay trái / Xoay phải turn a photo 90° in its slot, refill the slot, and the print shows it turned", async () => {
  const { page, errors, uploads } = await selectScreen();
  try {
    const shots = page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await shots.nth(0).click();
    await shots.nth(1).click();
    await page.getByRole("tab", { name: /Chỉnh ảnh/ }).click();
    await page.locator(".adjust-photo").first().click();
    const [first] = (await saved(page)).selected;
    const transform = async () => (await saved(page)).decor?.transforms?.[first];
    // Đã thu nhỏ rồi mới xoay: xoay xong ảnh về 100 % và giữa ô (phủ kín ô, không hở viền).
    await page.getByRole("button", { name: /Thu nhỏ/ }).click();
    await page.getByRole("button", { name: "Xoay phải" }).click();
    assert.deepEqual(await transform(), { zoom: 1, x: 0, y: 0, rotate: 90 });
    await page.locator(".adjust-zoom span", { hasText: "100%" }).waitFor();
    await page.getByRole("button", { name: "Xoay trái" }).click();
    await page.getByRole("button", { name: "Xoay trái" }).click();
    assert.equal((await transform()).rotate, 270);
    // Ảnh nhỏ để chọn ảnh xoay theo.
    assert.match(await page.locator(".adjust-photo.is-active img").getAttribute("style"), /rotate\(270deg\) scale\(1\.5\)/);
    // Nút xoay nằm hai bên nút dời, cùng một hàng.
    const [left, pad, right] = await Promise.all([
      page.getByRole("button", { name: "Xoay trái" }).boundingBox(),
      page.locator(".adjust-pan").boundingBox(),
      page.getByRole("button", { name: "Xoay phải" }).boundingBox(),
    ]);
    assert.ok(left.x + left.width <= pad.x && pad.x + pad.width <= right.x, JSON.stringify({ left, pad, right }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(tmpdir(), "photobooth-fe-adjust-rotate.png") });
    // Thu nhỏ 50 %: ảnh ngang 3 : 2 xoay thành dọc nên vẫn phủ hết chiều cao ô ngang (ảnh thẳng chỉ cao nửa ô).
    const zoomOut = page.getByRole("button", { name: /Thu nhỏ/ });
    for (let i = 0; i < 10 && await zoomOut.isEnabled(); i++) await zoomOut.click();
    await page.locator(".adjust-zoom span", { hasText: "50%" }).waitFor();

    await page.getByRole("button", { name: "In ảnh" }).click();
    for (let i = 0; i < 100 && !uploads.composite; i++) await page.waitForTimeout(100);
    assert.ok(uploads.composite, "chưa gửi ảnh ghép vào album");
    const { colors: [top, side] } = await samples(page, uploads.composite, [[0.5, 0.07], [0.2, 0.26]]);
    assert.ok(top[0] > 180 && top[1] < 80, `ảnh xoay phủ tới mép trên của ô: ${top}`);
    assert.ok(side.slice(0, 3).every((v) => v > 200), `hai bên ảnh xoay là nền trắng của khung: ${side}`);
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
