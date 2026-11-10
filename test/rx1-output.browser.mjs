import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";
const sharp = createRequire(new URL("../../photobooth-be/package.json", import.meta.url))("sharp");
let server, browser, page, assets, js, css, settings, configured, applied, requests, failSave, failLoad;
const captures = join(tmpdir(), "photobooth-rx1-settings-review");
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';
import {ToastProvider} from '/src/studio.jsx';import {Rx1OutputManager} from '/src/admin/rx1-output.jsx';import '/src/tailwind.css';
createRoot(document.getElementById('root')).render(React.createElement(ToastProvider,null,
React.createElement('main',{className:'admin-shell',style:{padding:20,display:'block'}},React.createElement('h1',null,'Màu in RX1'),
React.createElement(Rx1OutputManager,{notify:message=>window.notice=message}))));`;
before(async () => {
  const bundle = await build({ configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "/__rx1_fixture.jsx", output: { format: "iife", inlineDynamicImports: true } } },
    plugins: [tailwindcss(), { name: "rx1-fixture", resolveId: (id) => id === "/__rx1_fixture.jsx" ? "\0rx1-fixture.jsx" : null,
      load: (id) => id === "\0rx1-fixture.jsx" ? fixture : null }],
  });
  assets = new Map(bundle.output.map((asset) => [`/${asset.fileName}`, asset.type === "chunk" ? asset.code : asset.source]));
  js = bundle.output.find((asset) => asset.type === "chunk").fileName;
  css = bundle.output.filter((asset) => asset.fileName.endsWith(".css")).map((asset) => `<link rel="stylesheet" href="/${asset.fileName}">`).join("");
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    const json = (body, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks); const body = bytes.length ? JSON.parse(bytes) : null;
      requests.push({ path: url.pathname, method: req.method, body });
      if (url.pathname === "/api/admin/settings/rx1-output") {
        if (failLoad) return json({ message: "API không tồn tại." }, 404);
        if (req.method === "PUT") {
          if (failSave) return json({ message: "Không lưu được cấu hình" }, 500);
          settings = body; configured = true;
        }
        return json({ configured, settings });
      }
      if (url.pathname === "/api/admin/print-jobs/printers") return json([{ room: "room", roomName: "PTB · RX1", branch: "Tiệm",
        agent: { running: true }, rx1Output: { ...applied, at: applied.at || new Date().toISOString() } }]);
      return json({ message: "Unexpected API" }, 404);
    }
    if (assets.has(url.pathname)) { res.writeHead(200, { "Content-Type": url.pathname.endsWith(".css") ? "text/css" : /\.jpe?g$/.test(url.pathname) ? "image/jpeg" : "text/javascript" }); return res.end(assets.get(url.pathname)); }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<div id="root"></div><script src="/${js}"></script></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  await mkdir(captures, { recursive: true });
});
after(async () => { await browser?.close(); await new Promise((resolve) => server.close(resolve)); });
async function mount({ width = 1440, loadError = false } = {}) {
  await page?.close();
  settings = { gamma: 1.5, maxResolution: true }; applied = { gamma: 1.3, maxResolution: true };
  configured = false; failSave = false; failLoad = loadError; requests = [];
  page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  if (!loadError) await page.getByLabel("Độ tối bản in (gamma)").waitFor();
}
test("gamma is previewed locally, saved centrally and shows the printer acknowledgement", async () => {
  await mount();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('canvas[aria-label="Ảnh nguồn"]')?.height === 600);
  const previewHash = async () => createHash("sha256").update(
    await page.getByLabel("Ảnh nguồn", { exact: true }).evaluate((canvas) => canvas.toDataURL())).digest("hex");
  const defaultFrame = await previewHash();
  const png = await sharp({ create: { width: 200, height: 280, channels: 3, background: "#808080" } }).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "preview.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => document.querySelector('canvas[aria-label="Ảnh nguồn"]')?.height === 280);
  const pixel = () => page.getByLabel("Ảnh xem thử gamma").evaluate((canvas) => canvas.getContext("2d").getImageData(1, 1, 1, 1).data[0]);
  assert.ok(Math.abs(await pixel() - 91) <= 1);
  await page.getByRole("button", { name: "1.30", exact: true }).click();
  assert.ok(Math.abs(await pixel() - 104) <= 1);
  assert.equal(await page.getByRole("button", { name: "1.50 · Mặc định", exact: true }).count(), 1);
  assert.equal(requests.filter((req) => req.method === "PUT").length, 0, "preview and presets never change saved settings");
  await page.getByRole("button", { name: "2.20", exact: true }).click();
  assert.ok(Math.abs(await pixel() - 56) <= 1);
  assert.equal(await page.getByLabel("Thanh chỉnh gamma").getAttribute("min"), "1.00");
  assert.equal(await page.getByLabel("Thanh chỉnh gamma").getAttribute("max"), "2.20");
  await page.getByRole("button", { name: "1.80", exact: true }).click();
  await page.getByRole("button", { name: "Lưu cấu hình màu in", exact: true }).click();
  await page.getByText("Đang chờ nhận mức mới", { exact: true }).waitFor();
  assert.deepEqual(settings, { gamma: 1.8, maxResolution: true });
  assert.equal(await page.getByRole("button", { name: "1.80 · Mặc định", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "1.50", exact: true }).count(), 1);
  applied = { ...settings };
  await page.getByRole("button", { name: "Làm mới trạng thái" }).click();
  await page.getByText("Đã nhận cấu hình", { exact: true }).waitFor();
  applied.at = "2020-01-01T00:00:00Z";
  await page.getByRole("button", { name: "Làm mới trạng thái" }).click();
  await page.getByText("Đang chờ bộ in đồng bộ", { exact: true }).waitFor();
  applied.at = new Date().toISOString();
  await page.getByRole("button", { name: "Làm mới trạng thái" }).click();
  await page.getByText("Đã nhận cấu hình", { exact: true }).waitFor();
  assert.equal(requests.some((req) => /\/print$|\/reprint$|\/print-file$/.test(req.path)), false);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('canvas[aria-label="Ảnh nguồn"]')?.height === 600);
  assert.equal(await previewHash(), defaultFrame,
    "reloading restores the original default image after a temporary upload");
  assert.equal(await page.getByLabel("Độ tối bản in (gamma)").inputValue(), "1.80", "restoring the preview does not reset saved gamma");
  assert.equal(await page.getByRole("button", { name: "1.80 · Mặc định", exact: true }).count(), 1);
  await page.screenshot({ path: join(captures, "desktop.png"), fullPage: true });
  assert.deepEqual(errors, []);
});
test("out-of-range gamma and failed saves never claim that a new configuration was saved", async () => {
  await mount({ width: 390 });
  await page.getByLabel("Độ tối bản in (gamma)").fill("1.83");
  await page.getByRole("button", { name: "Lưu cấu hình màu in" }).click();
  await page.getByRole("button", { name: "1.83 · Mặc định", exact: true }).waitFor();
  await page.getByLabel("Độ tối bản in (gamma)").fill("0.99");
  assert.equal(await page.getByRole("button", { name: "Lưu cấu hình màu in" }).isDisabled(), true);
  await page.getByLabel("Độ tối bản in (gamma)").fill("2.21");
  assert.equal(await page.getByRole("button", { name: "Lưu cấu hình màu in" }).isDisabled(), true);
  await page.getByLabel("Độ tối bản in (gamma)").fill("1.40");
  failSave = true;
  await page.getByRole("button", { name: "Lưu cấu hình màu in" }).click();
  await page.getByText("Không lưu được cấu hình", { exact: true }).waitFor();
  assert.equal(configured, true);
  assert.equal(settings.gamma, 1.83);
  assert.equal(await page.getByRole("button", { name: "1.83 · Mặc định", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "1.40 · Mặc định", exact: true }).count(), 0);
  await page.screenshot({ path: join(captures, "mobile.png"), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    JSON.stringify(await page.locator('*').evaluateAll((elements) => elements.filter((el) => el.getBoundingClientRect().right > innerWidth).slice(0, 8).map((el) => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width })))));
  await page.reload();
  await page.getByRole("button", { name: "1.83 · Mặc định", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Độ tối bản in (gamma)").inputValue(), "1.83");
});

test("driver tools download self-contained Windows helpers without saving settings or sending a print", async () => {
  await mount();
  const source = await readFile(new URL("../src/admin/installers/open-rx1-driver.ps1", import.meta.url), "utf8");
  for (const [label, name, mode] of [
    ["Tải công cụ mở driver", "mo-driver-RX1.bat", "preferences"],
    ["Tải công cụ mở thuộc tính / ICC", "mo-thuoc-tinh-RX1.bat", "properties"],
    ["Tải công cụ đồng bộ ICM", "cai-mau-RX1.bat", null],
  ]) {
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    const file = await downloaded;
    assert.equal(file.suggestedFilename(), name);
    const stream = await file.createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bat = Buffer.concat(chunks).toString("utf8");
    if (mode) {
      assert.ok(bat.includes(`-Mode ${mode}`));
      const payload = /^rem NXC_RX1_DRIVER_BASE64:([A-Za-z0-9+/=]+)\r$/m.exec(bat)[1];
      assert.equal(Buffer.from(payload, "base64").toString("utf8"), source);
    } else assert.match(bat, /NXC_COLOR_BASE64:/);
    await page.getByRole("status").filter({ hasText: `Đã tải ${name}.` }).waitFor();
  }
  assert.equal(requests.some((request) => request.method !== "GET"), false);
});
test("an older backend without this API leaves configuration controls unavailable", async () => {
  await mount({ loadError: true });
  await page.getByText("Cần cập nhật máy chủ để dùng chức năng màu in RX1, rồi tải lại trang.", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Độ tối bản in (gamma)").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Tải công cụ mở driver", exact: true }).count(), 0);
  assert.equal(requests.filter((req) => req.method === "PUT").length, 0);
});
