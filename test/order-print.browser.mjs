// Real dialogs, binary files and canvas rendering; every printer request is intercepted.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";
const sharp = createRequire(new URL("../../photobooth-be/package.json", import.meta.url))("sharp");

const BOOKING = { _id: "booking-print", code: "973019", accessToken: "album-token", status: "completed", paid: true,
  roomName: "Phòng 01", printSize: "full", prints: 6, printSheets: 2 };
const JOB = { _id: "source", frameName: "Khung hồng", sheetCount: 2, printSize: "strip", spoolStatus: "sent",
  width: 2400, height: 3600, createdAt: new Date().toISOString(), image: "/api/albums/album-token/prints/source" };
let server, browser, page, detail, requests, local, errors, failRead, failArchive, failPrint, png, ovalFrame;
const captures = join(tmpdir(), "photobooth-order-print-review");
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom'; import {StudioContext,ToastProvider} from '/src/studio.jsx';
import {PrintOrderDialog} from '/src/admin/print-order-dialog.jsx'; import '/src/tailwind.css';
import {stageKioskPrint,kioskPrintState,runKioskPrints} from '/src/kiosk/compose.js';
import {readSetting,saveSetting,savePending,removePending} from '/src/capture-store.js';
window.runLocalKioskPrint=async job=>(await stageKioskPrint(job)).printing;window.kioskPrintState=kioskPrintState;window.readSetting=readSetting;window.flushKioskPrints=runKioskPrints;
window.savePending=savePending;window.removePending=removePending;
window.saveSetting=saveSetting;
const booking=${JSON.stringify(BOOKING)};
const frame={_id:'frame',name:'Khung thử',active:true,printSize:'full',
image:window.ovalFrame?'/oval.png':'/frame.png',
slots:window.ovalFrame?Array.from({length:3},(_,i)=>({x:.08,y:.05+.3*i,w:.84,h:.24,kind:'photo',photo:i+1})):[{x:.05,y:.05,w:.9,h:.9,kind:'photo',photo:1}]};
function App(){const [open,setOpen]=React.useState(true); return React.createElement('main',{className:'admin-shell'},
open?React.createElement(PrintOrderDialog,{booking,initialCopies:window.purchasedCopies,onClose:()=>setOpen(false),onExtra:b=>{window.selling=b;setOpen(false)},onPrinted:()=>window.printed=(window.printed||0)+1}):React.createElement('p',null,'Đã đóng'));}
createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,
React.createElement(StudioContext.Provider,{value:{frames:[frame]}},React.createElement(ToastProvider,null,React.createElement(App)))));
`;
before(async () => {
  png = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#efd1db" } }).png().toBuffer();
  ovalFrame = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">
    <mask id="openings"><path fill="white" d="M0 0H600V900H0Z"/>
    ${[153, 423, 693].map(y => `<ellipse cx="300" cy="${y}" rx="252" ry="108"/>`).join("")}</mask>
    <path fill="#25212a" d="M0 0H600V900H0Z" mask="url(#openings)"/></svg>`)).png().toBuffer();
  const bundle = await build({ configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "/__print_fixture.jsx", output: { format: "iife", inlineDynamicImports: true } } },
    plugins: [tailwindcss(), { name: "print-fixture", resolveId: (id) => id === "/__print_fixture.jsx" ? "\0print-fixture.jsx" : null,
      load: (id) => id === "\0print-fixture.jsx" ? fixture : null }],
  });
  const assets = new Map(bundle.output.map((asset) => [`/${asset.fileName}`, asset.type === "chunk" ? asset.code : asset.source]));
  const js = bundle.output.find((asset) => asset.type === "chunk").fileName;
  const css = bundle.output.filter((asset) => asset.fileName.endsWith(".css")).map((asset) => `<link rel="stylesheet" href="/${asset.fileName}">`).join("");
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.pathname === "/oval.png") { res.writeHead(200, { "Content-Type": "image/png" }); res.end(ovalFrame); return; }
    if (url.pathname === "/frame.png" || /\/prints\//.test(url.pathname)) { res.writeHead(200, { "Content-Type": "image/png" }); res.end(png); return; }
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const binary = req.headers["content-type"] === "application/octet-stream";
      const body = binary ? bytes : bytes.length ? JSON.parse(bytes) : null;
      requests.push({ path: url.pathname, search: url.search, method: req.method, body, headers: req.headers });
      if (url.pathname === "/api/albums/album-token/composite") { res.writeHead(200, { "Content-Type": "image/png" }); res.end(png); return; }
      if (url.pathname.endsWith("/prints")) {
        if (failRead) { json({ message: "Không tải được file in" }, 503); return; }
        json(detail); return;
      }
      if (url.pathname === "/api/albums/album-token") { json({ photos: [] }); return; }
      if (url.pathname.endsWith("/reprint") || url.pathname.endsWith("/print-file") || url.pathname.endsWith("/print-archive")) {
        const key = binary ? req.headers["x-print-key"] : body.requestKey;
        if (!detail.jobs.some((job) => job._id === key)) detail.jobs.unshift({ ...JOB, _id: key, sheetCount: binary ? 1 : 2 });
        if (failArchive) { failArchive = false; json({ message: "Mất phản hồi lưu" }, 500); return; }
        json({ _id: key }, 201); return;
      }
      json({ message: `Unexpected ${url.pathname}` }, 404); return;
    }
    if (assets.has(url.pathname)) {
      res.writeHead(200, { "Content-Type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" });
      res.end(assets.get(url.pathname)); return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div id="root"></div><script src="/${js}"></script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  await mkdir(captures, { recursive: true });
});
after(async () => { await page?.close(); await browser?.close(); await new Promise((resolve) => server.close(resolve)); });
async function mount({ jobs = [JOB], width = 1440, readError = false, archiveError = false, printError = false, composite = false, booking = {}, purchasedCopies, oval = false } = {}) {
  await page?.close(); requests = []; local = []; errors = []; failRead = readError; failArchive = archiveError; failPrint = printError;
  detail = { booking: { ...BOOKING, photoCount: 4, ...booking,
    ...(composite && { composite: { url: "/api/albums/album-token/composite", frameName: "Khung hồng" } }) }, jobs: structuredClone(jobs) };
  page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 1000 }, reducedMotion: "reduce" });
  if (purchasedCopies != null) await page.addInitScript(copies => { window.purchasedCopies = copies; }, purchasedCopies);
  if (oval) await page.addInitScript(() => { window.ovalFrame = true; });
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://127.0.0.1:8789/**", async (route) => {
    const req = route.request(); local.push({ path: new URL(req.url()).pathname, body: req.postDataBuffer(), headers: req.headers() });
    const health = req.url().endsWith("/health");
    await route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, status: !health && failPrint ? 503 : 200,
      body: JSON.stringify(health ? { directPrint: 2 } : failPrint ? { sent: false, message: "RX1 hết giấy" } : { sent: true }) });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("dialog").waitFor();
}

test("a stale empty order row loads its fresh print history, correct paper, page navigation and totals", async () => {
  await mount();
  await page.getByText("Tờ 1/2", { exact: true }).waitFor();
  assert.equal(await page.getByText("Chưa có file in đã lưu").count(), 0);
  await page.getByRole("button", { name: "Tờ sau" }).click();
  assert.match(await page.getByAltText("Tờ 2 của đơn 973019").getAttribute("src"), /sheet=1/);
  await page.getByLabel("Số bộ in lại").selectOption("3");
  assert.match(await page.locator(".order-print-total").innerText(), /6 tờ.*12 dải/s);
  assert.match(await page.getByRole("link", { name: "Tải tất cả tờ (ZIP)" }).getAttribute("href"), /download=1$/);
  await page.screenshot({ path: join(captures, "saved-prints-desktop.png"), fullPage: true });
  assert.deepEqual(errors, []);
});

test("empty state offers composition, while server errors never pretend that the order has no file", async () => {
  await mount({ jobs: [], width: 390 });
  await page.getByText("Chưa có file in đã lưu", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Ghép ảnh để in", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "In lại qua RX1" }).count(), 0);
  const bounds = await page.getByRole("dialog").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await page.screenshot({ path: join(captures, "empty-mobile.png"), fullPage: true });
  await mount({ jobs: [], readError: true });
  await page.getByText("Không tải được file in", { exact: true }).waitFor();
  assert.equal(await page.getByText("Chưa có file in đã lưu", { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});

test("printing one purchased extra sheet from a legacy multi-sheet job sends only the viewed page", async () => {
  await mount({ purchasedCopies: 1 });
  await page.getByRole("button", { name: "Tờ sau" }).click();
  assert.equal(await page.getByLabel("Tờ cần in").inputValue(), "current");
  await page.getByRole("button", { name: "In lại qua RX1" }).click();
  await page.getByText("Đã gửi 1 tờ tới hàng in RX1.", { exact: true }).waitFor();
  const sent = local.filter(entry => entry.path === "/print");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers["x-print-sheets"].split(",").length, 1);
  assert.equal(requests.find(entry => entry.path.endsWith("/reprint")).body.sheet, 1);
  assert.deepEqual(errors, []);
});

test("reprint archives after one local send, and a lost archive response does not print again", async () => {
  await mount({ archiveError: true });
  await page.getByLabel("Số bộ in lại").selectOption("2");
  await page.getByRole("button", { name: "In lại qua RX1" }).click();
  await page.getByRole("button", { name: "Lưu kết quả in", exact: true }).waitFor();
  assert.equal(local.filter((entry) => entry.path === "/print").length, 1);
  assert.equal(local.find((entry) => entry.path === "/print").headers["x-print-sheets"].split(",").length, 4);
  await page.getByRole("button", { name: "Lưu kết quả in", exact: true }).click();
  await page.getByText("Đã gửi 4 tờ tới hàng in RX1.", { exact: true }).waitFor();
  assert.equal(local.filter((entry) => entry.path === "/print").length, 1);
  const saves = requests.filter((entry) => entry.path.endsWith("/reprint"));
  assert.equal(saves.length, 2);
  assert.equal(saves[0].body.requestKey, saves[1].body.requestKey);
  assert.equal(saves[0].body.delivery, "local");
  assert.deepEqual(errors, []);
});

test("manual composition uses the kiosk frame and photo screens, renders an original-resolution PNG and prints on RX1", async () => {
  await mount({ jobs: [] });
  await page.getByRole("button", { name: "Ghép ảnh để in", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Ghép ảnh để in · #973019" });
  await composer.getByText(/Album chưa có ảnh/).waitFor();
  await composer.getByLabel("Thêm ảnh từ máy quầy").setInputFiles({ name: "guest.png", mimeType: "image/png", buffer: png });
  // Màn chọn khung của máy chụp (không đếm giờ), rồi màn chọn ảnh & trang trí.
  await composer.getByText("GHÉP ẢNH TẠI QUẦY · CHỌN KHUNG", { exact: true }).waitFor();
  await composer.getByRole("radiogroup", { name: "Chọn khung" }).getByRole("radio").first().click();
  await composer.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  const shots = composer.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
  await shots.first().click();
  assert.equal(await shots.first().getAttribute("aria-label"), "Ảnh ở ô 1");
  for (const tab of ["Chỉnh ảnh", "Thêm chữ"]) assert.equal(await composer.getByRole("tab", { name: new RegExp(tab) }).count(), 1);
  await composer.getByLabel("Số bộ in", { exact: true }).selectOption("2");
  await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)"));
  await page.screenshot({ path: join(captures, "counter-compose-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const wide = await page.evaluate(() => {
    const c = document.querySelector(".counter-compose");
    if (c.scrollWidth <= c.clientWidth + 1) return "";
    return [...c.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > c.clientWidth + 1)
      .slice(0, 6).map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().width)}`).join(" | ");
  });
  assert.equal(wide, "", "no sideways scrolling on a phone");
  await page.screenshot({ path: join(captures, "counter-compose-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await composer.getByRole("button", { name: "In 2 bộ qua RX1", exact: true }).click();
  await page.getByRole("dialog", { name: "In ảnh đơn 973019" }).waitFor();
  assert.equal(await page.locator(".counter-compose").count(), 0);
  const saved = requests.find((entry) => entry.path.endsWith("/print-file"));
  assert.ok(saved);
  const metadata = await sharp(saved.body).metadata();
  assert.deepEqual([metadata.width, metadata.height, metadata.format], [2400, 3600, "png"]);
  assert.equal(saved.headers["x-print-copies"], "2");
  assert.equal(saved.headers["x-print-delivery"], undefined);
  const sent = local.filter((entry) => entry.path === "/print");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].headers["x-print-photos"] === undefined || /^[\d.,;]+$/.test(sent[0].headers["x-print-photos"]));
  assert.equal(browser.contexts().flatMap((context) => context.pages()).length, 1);
  assert.deepEqual(errors, []);
});

test("manual printing fills three slots with two photos, clears only the tapped slot and keeps the oval borders", async () => {
  await mount({ jobs: [], oval: true });
  await page.getByRole("button", { name: "Ghép ảnh để in", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Ghép ảnh để in · #973019" });
  await composer.getByText(/Album chưa có ảnh/).waitFor();
  const files = await Promise.all([["red", "#d21625"], ["green", "#187a3f"]].map(async ([name, background]) => ({
    name: name + ".png", mimeType: "image/png",
    buffer: await sharp({ create: { width: 480, height: 480, channels: 3, background } }).png().toBuffer(),
  })));
  await composer.getByLabel("Thêm ảnh từ máy quầy").setInputFiles(files);
  await composer.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  const shots = composer.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
  await shots.nth(0).click();
  await shots.nth(0).click();
  await shots.nth(1).click();
  assert.equal(await shots.nth(0).getAttribute("aria-label"), "Ảnh ở ô 1, 2");
  assert.equal(await shots.nth(1).getAttribute("aria-label"), "Ảnh ở ô 3");
  const canvas = composer.locator(".decor-canvas:not(.is-loading)");
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const k = Math.min(rect.width / node.width, rect.height / node.height);
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 - node.height * k * .03 };
  });
  await page.mouse.click(point.x, point.y);
  assert.match(await shots.nth(0).getAttribute("aria-label"), /Ảnh ở ô 1 ·/);
  assert.match(await shots.nth(1).getAttribute("aria-label"), /Ảnh ở ô 3 ·/);
  await shots.nth(0).click();
  await composer.getByLabel("Khi ghép xong").selectOption("save");
  await composer.getByRole("button", { name: "Lưu file in", exact: true }).click();
  await page.getByText("File in đã lưu").waitFor();
  const saved = requests.find(entry => entry.path.endsWith("/print-file"));
  const { data, info } = await sharp(saved.body).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const color = (x, y) => {
    const at = (Math.round(y * info.height) * info.width + Math.round(x * info.width)) * info.channels;
    return [...data.subarray(at, at + 3)];
  };
  assert.deepEqual([color(.5, .17), color(.5, .47), color(.5, .77), color(.1, .065)],
    [[210, 22, 37], [210, 22, 37], [24, 122, 63], [37, 33, 42]]);
  assert.equal(local.filter(entry => entry.path === "/print").length, 0);
  assert.deepEqual(errors, []);
});

test("an order with no saved sheet prints straight from its framed composite and keeps the file", async () => {
  await mount({ jobs: [], composite: true });
  await page.getByRole("heading", { name: "Chưa có file in — in từ ảnh ghép" }).waitFor();
  await page.getByAltText("Ảnh ghép khung của đơn 973019").waitFor();
  await page.screenshot({ path: join(captures, "composite-desktop.png") });
  await page.getByLabel("Số bộ in", { exact: true }).selectOption("3");
  await page.getByRole("button", { name: "In từ ảnh ghép" }).click();
  await page.getByText("Đã gửi 3 tờ tới hàng in RX1 và lưu file in vào đơn.", { exact: true }).waitFor();
  const saved = requests.find((entry) => entry.path.endsWith("/print-file"));
  const metadata = await sharp(saved.body).metadata();
  assert.deepEqual([metadata.width, metadata.height, metadata.format], [2400, 3600, "png"]);
  assert.equal(saved.headers["x-print-copies"], "3");
  assert.equal(saved.headers["x-print-frame"] && decodeURIComponent(saved.headers["x-print-frame"]), "Khung hồng");
  const sent = local.filter((entry) => entry.path === "/print");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers["x-print-sheets"].split(",").length, 3);
  assert.equal(sent[0].headers["x-print-size"], "full");
  // Lần sau mở đơn: file in đã lưu, in lại được ngay.
  await page.getByText("File in đã lưu").waitFor();
  assert.deepEqual(errors, []);

  // Máy quầy không cắm RX1: chỉ lưu file. Vé dải nhỏ → tờ cắt đôi.
  await mount({ jobs: [], composite: true, booking: { printSize: "strip" }, width: 390 });
  await page.getByText(/máy cắt đôi thành 2 dải 5 × 15 cm/).waitFor();
  const bounds = await page.getByRole("dialog").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await page.screenshot({ path: join(captures, "composite-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Chỉ lưu file in", exact: true }).click();
  await page.getByText("Đã lưu file in từ ảnh ghép vào đơn.", { exact: true }).waitFor();
  const kept = requests.find((entry) => entry.path.endsWith("/print-file"));
  assert.equal(kept.headers["x-print-delivery"], "none");
  assert.equal(kept.headers["x-print-size"], "strip");
  assert.equal(local.filter((entry) => entry.path === "/print").length, 0);
  assert.deepEqual(errors, []);
});

test("a 20 × 30 Selfbooth order never offers counter composition", async () => {
  await mount({ jobs: [], composite: true, booking: { printSize: "large" } });
  await page.getByText("Chưa có file in đã lưu", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Ghép ảnh/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "In từ ảnh ghép" }).count(), 0);
  assert.deepEqual(errors, []);
});

test("a sheet RX1 did not print is still saved for the counter, marked failed, and never sent to paper again", async () => {
  await mount({ jobs: [], printError: true });
  const failed = await page.evaluate((image) => window.runLocalKioskPrint({ token: "album-token", printSize: "full", frameName: "Pink", images: [image] })
    .then(() => "", (error) => error.message), `data:image/png;base64,${png.toString("base64")}`);
  assert.equal(failed, "RX1 hết giấy");
  assert.equal(await page.evaluate(() => window.kioskPrintState("album-token").status), "failed");
  await page.evaluate(() => window.flushKioskPrints());
  const archives = requests.filter((entry) => entry.path.endsWith("/print-archive"));
  assert.equal(archives.length, 1);
  assert.equal(archives[0].search, "?result=failed");
  assert.equal(local.filter((entry) => entry.path === "/print").length, 1);
  assert.deepEqual(await page.evaluate(() => window.readSetting("kiosk-print-queue")), []);
  assert.deepEqual(errors, []);
});

test("direct kiosk prints archive in the background; a failed upload never resends paper or changes printed state", async () => {
  await mount({ jobs: [], archiveError: true });
  await page.evaluate((image) => window.runLocalKioskPrint({ token: "album-token", printSize: "full", frameName: "Pink", images: [image] }), `data:image/png;base64,${png.toString("base64")}`);
  assert.equal(await page.evaluate(() => window.kioskPrintState("album-token").status), "printed");
  await page.evaluate(() => window.flushKioskPrints());
  assert.equal(local.filter((entry) => entry.path === "/print").length, 1);
  const archives = requests.filter((entry) => entry.path.endsWith("/print-archive"));
  assert.equal(archives.length, 2);
  assert.deepEqual(await page.evaluate(() => window.readSetting("kiosk-print-queue")), []);
  assert.equal(archives[0].headers["x-print-key"], archives[1].headers["x-print-key"]);
  assert.equal(requests.filter((entry) => entry.path.endsWith("/print-pack")).length, 0);
  assert.equal(await page.evaluate(() => window.kioskPrintState("album-token").status), "printed");
  assert.deepEqual(errors, []);
});

test("print history receives one master even while guest previews and originals are pending", async () => {
  await mount({ jobs: [] });
  await page.evaluate(async () => {
    await window.savePending({ id: 'current-preview', token: 'album-token', stage: 'preview' });
    await window.savePending({ id: 'current-original', token: 'album-token', stage: 'original' });
    await window.savePending({ id: 'older-preview', token: 'older-album', stage: 'preview' });
  });
  await page.evaluate((image) => window.runLocalKioskPrint({ token: 'album-token', printSize: 'full', frameName: 'Pink', images: [image, image, image] }), `data:image/png;base64,${png.toString('base64')}`);
  await page.evaluate(() => window.flushKioskPrints());
  const archives = requests.filter((entry) => entry.path.endsWith('/print-archive'));
  assert.equal(archives.length, 1);
  assert.equal(archives[0].search, '?copies=3');
  assert.deepEqual(archives[0].body, png);
  assert.equal(local.find(entry => entry.path === "/print").headers["x-print-sheets"].split(",").length, 3);
  assert.equal(local.filter((entry) => entry.path === '/print').length, 1);
  assert.deepEqual(errors, []);
});

test("an expired archive is removed even if the guest still has an unavailable original", async () => {
  await mount({ jobs: [] });
  await page.evaluate(async () => {
    await window.savePending({ id: 'unavailable-original', token: 'album-token', stage: 'original' });
    await window.saveSetting('kiosk-print-queue', [{ token: 'album-token', archive: true, images: [], requestKey: crypto.randomUUID(), queuedAt: Date.now() - 25 * 3600000 }]);
    await window.flushKioskPrints();
  });
  assert.deepEqual(await page.evaluate(() => window.readSetting('kiosk-print-queue')), []);
  assert.equal(requests.filter((entry) => entry.path.endsWith('/print-archive')).length, 0);
  assert.equal(local.filter((entry) => entry.path === '/print').length, 0);
  assert.deepEqual(errors, []);
});
