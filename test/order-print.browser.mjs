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
let server, browser, page, detail, requests, local, errors, failRead, failArchive, png;
const captures = join(tmpdir(), "photobooth-order-print-review");
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom'; import {StudioContext,ToastProvider} from '/src/studio.jsx';
import {PrintOrderDialog} from '/src/admin/print-order-dialog.jsx'; import '/src/tailwind.css';
import {directKioskPrint,kioskPrintState,runKioskPrints} from '/src/kiosk/compose.js';
import {readSetting} from '/src/capture-store.js';
window.runLocalKioskPrint=directKioskPrint;window.kioskPrintState=kioskPrintState;window.readSetting=readSetting;window.flushKioskPrints=runKioskPrints;
const booking=${JSON.stringify(BOOKING)};
const frame={_id:'frame',name:'Khung thử',active:true,printSize:'full',image:'/frame.png',slots:[{x:.05,y:.05,w:.9,h:.9,kind:'photo',photo:1}]};
function App(){const [open,setOpen]=React.useState(true); return React.createElement('main',{className:'admin-shell'},
open?React.createElement(PrintOrderDialog,{booking,onClose:()=>setOpen(false),onExtra:b=>{window.selling=b;setOpen(false)},onPrinted:()=>window.printed=(window.printed||0)+1}):React.createElement('p',null,'Đã đóng'));}
createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,
React.createElement(StudioContext.Provider,{value:{frames:[frame]}},React.createElement(ToastProvider,null,React.createElement(App)))));
`;
before(async () => {
  png = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#efd1db" } }).png().toBuffer();
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
    if (url.pathname === "/frame.png" || /\/prints\//.test(url.pathname)) { res.writeHead(200, { "Content-Type": "image/png" }); res.end(png); return; }
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const binary = req.headers["content-type"] === "application/octet-stream";
      const body = binary ? bytes : bytes.length ? JSON.parse(bytes) : null;
      requests.push({ path: url.pathname, method: req.method, body, headers: req.headers });
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
async function mount({ jobs = [JOB], width = 1440, readError = false, archiveError = false } = {}) {
  await page?.close(); requests = []; local = []; errors = []; failRead = readError; failArchive = archiveError;
  detail = { booking: { ...BOOKING, photoCount: 4 }, jobs: structuredClone(jobs) };
  page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://127.0.0.1:8789/**", async (route) => {
    const req = route.request(); local.push({ path: new URL(req.url()).pathname, body: req.postDataBuffer(), headers: req.headers() });
    await route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(req.url().endsWith("/health") ? { directPrint: 2 } : { sent: true }) });
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

test("manual composition renders original-resolution PNG and uses the RX1 agent, with no browser print popup", async () => {
  await mount({ jobs: [] });
  await page.getByRole("button", { name: "Ghép ảnh để in", exact: true }).click();
  await page.getByLabel("Thêm ảnh từ máy quầy").setInputFiles({ name: "guest.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Đặt ảnh 1 vào ô 1" }).click();
  await page.getByAltText("Tờ in đã ghép").waitFor();
  await page.getByLabel("Số bộ in", { exact: true }).selectOption("2");
  await page.screenshot({ path: join(captures, "manual-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.getByRole("dialog").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await page.screenshot({ path: join(captures, "manual-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "In qua RX1 & lưu file", exact: true }).click();
  await page.getByRole("dialog", { name: "In ảnh đơn 973019" }).waitFor();
  const saved = requests.find((entry) => entry.path.endsWith("/print-file"));
  assert.ok(saved);
  const metadata = await sharp(saved.body).metadata();
  assert.deepEqual([metadata.width, metadata.height, metadata.format], [2400, 3600, "png"]);
  assert.equal(saved.headers["x-print-copies"], "2");
  assert.equal(local.filter((entry) => entry.path === "/print").length, 1);
  assert.equal(browser.contexts().flatMap((context) => context.pages()).length, 1);
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
