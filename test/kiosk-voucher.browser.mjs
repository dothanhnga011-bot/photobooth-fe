import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base;
const captures = resolve('.cache/polaroid-selfbooth');
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { Kiosk } from '/src/kiosk/Kiosk.jsx';
  import '/src/tailwind.css';
  const packs = [
    { _id: 'pack-strip', name: 'Khung nhỏ', printSize: 'strip', price: 70000, prints: 1, shots: 4 },
    { _id: 'pack-full', name: 'Khung to', printSize: 'full', price: 100000, prints: 2, shots: 4 },
    // Layout của phòng Polaroid (gói khổ Instax): bán ở quầy thành mã chụp, không bán ở máy.
    { _id: 'pack-polaroid-2', name: 'Polaroid đôi', printSize: 'instax', price: 100000, prints: 1, shots: 8, countdownSeconds: 10, selectCount: 2 },
    { _id: 'pack-polaroid-1', name: '1 ảnh to', printSize: 'instax', price: 100000, prints: 1, shots: 8, countdownSeconds: 10, selectCount: 1 },
  ];
  // Chữ trên máy chụp tiệm đã sửa (Thiết lập → Chữ trên máy chụp).
  const kioskTexts = { 'polaroid.codeTitle': 'Nhập mã Polaroid' };
  createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,
    { initialEntries: ['/kiosk?device=fixture-device'] },
    React.createElement(StudioContext.Provider,
      { value: { settings: { extraPrintPrice: 20000, kioskTexts }, screens: [], packages: packs, frames: [] } },
      React.createElement(ToastProvider, null, React.createElement(Kiosk)))));
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:voucher.jsx" } },
    plugins: [tailwindcss(), {
      name: "voucher-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:voucher.jsx" ? fixture : null,
    }],
  });
  const assets = new Map(bundle.output.map((a) => ["/" + a.fileName, a.code || a.source]));
  const entry = bundle.output.find((a) => a.isEntry).fileName;
  const styles = bundle.output.filter(a => a.fileName.endsWith('.css'));
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.webp') ? 'image/webp'
      : path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.woff2') ? 'font/woff2' : 'application/javascript';
    if (assets.has(path)) {
      res.setHeader("Content-Type", type);
      res.end(assets.get(path));
    } else if (/^\/fonts\/[\w-]+\.woff2$/.test(path) || path === '/logo-m-384.jpg') {
      res.setHeader('Content-Type', type);
      res.end(await readFile(new URL('../public' + path, import.meta.url)));
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`${styles.map(a => `<link rel="stylesheet" href="/${a.fileName}">`).join('')}<div id="root"></div><script type="module" src="/${entry}"></script>`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  await mkdir(captures, { recursive: true });
});

after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

const booking = { _id: "booking-1", code: "123456", status: "checked_in", packageName: "Khung to", prints: 2,
  shots: 4, captureDuration: 10, photos: [] };

// Máy chụp có thư mục ảnh (OPFS giả lập) và API giả: ping trả phòng, claim / sale mở lượt chụp.
async function openKiosk(room, handlers = {}, { sale = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((sale) => {
    window.showDirectoryPicker = async () => navigator.storage.getDirectory();
    // Lượt mua dở còn lưu trên máy (vd. từ lúc phòng còn là phòng đút tiền).
    if (sale && !sessionStorage.getItem("sale-seeded")) {
      localStorage.setItem("kiosk-sale", JSON.stringify(sale));
      sessionStorage.setItem("sale-seeded", "1");
    }
  }, sale);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const handler = Object.entries(handlers).find(([end]) => path.endsWith(end));
    if (handler) return handler[1](route, JSON.parse(route.request().postData()));
    return route.fulfill({ json: path.endsWith("/kiosk/ping") ? { room }
      : path.endsWith("/health") ? { ok: true } : { booking } });
  });
  // Màn đầu tiên sau “Chạm để bắt đầu” theo loại phòng máy chủ báo về.
  const pinged = page.waitForResponse((r) => r.url().endsWith("/api/kiosk/ping"));
  await page.goto(base);
  await pinged;
  await page.getByText("Cài đặt máy chụp (nhân viên)").click();
  await page.getByRole("button", { name: "Chọn thư mục ảnh" }).click();
  await page.getByRole('button', { name: 'Đóng thông báo' }).first().waitFor();
  await page.getByRole('button', { name: 'Đóng thông báo' }).evaluateAll(buttons => buttons.forEach(button => button.click()));
  await page.locator('.toast').waitFor({ state: 'detached' });
  await page.getByRole("button", { name: "Chạm để bắt đầu" }).click();
  return { page, errors };
}

test("photobooth room: touch → pay by code → 6 digits, then 'Bắt đầu chụp' checks the code → shoot screen", async () => {
  const claims = [];
  const { page, errors } = await openKiosk({ _id: "room-1", flip: "device", kind: "photobooth" }, {
    "/kiosk/claim": (route, body) => {
      claims.push(body);
      if (body.code !== "123456") return route.fulfill({ status: 400, json: { message: "Mã chụp không đúng." } });
      return route.fulfill({ json: { booking, captureToken: "fixture-capture", accessToken: "fixture-album" } });
    },
  });
  try {
    await page.getByRole("heading", { name: "Chọn cách thanh toán" }).waitFor();
    await page.getByRole("button", { name: /Nhập mã/ }).click();
    await page.getByRole("heading", { name: "Nhập mã chụp" }).waitFor();
    // Gõ đủ 6 số chưa gửi gì: khách bấm "Bắt đầu chụp" mới kiểm tra mã (13/11 chủ tiệm bỏ tự vào chụp).
    const start = page.getByRole("button", { name: /Bắt đầu chụp/ });
    await page.getByRole("textbox", { name: "Mã chụp" }).fill("000000");
    await page.waitForTimeout(500);
    assert.deepEqual(claims, [], "6 digits alone do not start anything");
    assert.equal(await page.locator(".shoot-screen").count(), 0);
    // Mã sai: báo lỗi và xoá để nhập lại.
    await start.click();
    await page.getByText("Mã chụp không đúng.").first().waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Mã chụp" }).inputValue(), "");
    for (const digit of "123456") await page.getByRole("button", { name: digit, exact: true }).click();
    await page.waitForTimeout(500);
    assert.equal(claims.length, 1, "the keypad's 6th digit does not send the code either");
    await start.click();
    await page.locator(".shoot-screen").waitFor();
    assert.deepEqual(claims.map((c) => c.code), ["000000", "123456"]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("photobooth room: touch → cash → sheet type → count → bill reader; enough money opens the session", async () => {
  const sales = [];
  const { page, errors } = await openKiosk(
    { _id: "room-1", flip: "device", kind: "photobooth", paymentTest: true, cashCheckoutReady: true },
    {
      "/kiosk/sale": (route, body) => {
        sales.push(body);
        return route.fulfill({ status: 201, json: { booking, captureToken: "fixture-capture", accessToken: "fixture-album" } });
      },
    },
  );
  try {
    await page.getByRole("heading", { name: "Chọn cách thanh toán" }).waitFor();
    await page.getByRole("button", { name: /Tiền mặt/ }).click();
    await page.getByRole("heading", { name: "Chọn loại tờ" }).waitFor();
    // Phòng photobooth chỉ bán tờ bé / tờ to; layout Instax là của phòng Polaroid.
    assert.equal(await page.getByRole("button", { name: /Polaroid/ }).count(), 0);
    await page.getByRole("button", { name: /Khung nhỏ/ }).click();
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await page.getByRole("heading", { name: "Chọn số lượng" }).waitFor();
    assert.equal(await page.locator(".kiosk-counter output").innerText(), "2");
    await page.getByRole("button", { name: "Tăng số bản in" }).click();
    assert.equal(await page.locator(".kiosk-counter output").innerText(), "4");
    await page.getByRole("button", { name: /Thanh toán tiền mặt/ }).click();
    await page.getByRole("heading", { name: "Đút tiền để bắt đầu chụp" }).waitFor();
    assert.match(await page.locator(".pay-board").innerText(), /90\.000/);
    // Chế độ thử: giả lập đút 2 tờ 50.000 — đủ 90.000 thì tự mở lượt chụp.
    await page.getByRole("button", { name: /50\.000/ }).click();
    assert.equal(sales.length, 0);
    await page.getByRole("button", { name: /50\.000/ }).click();
    await page.locator(".shoot-screen").waitFor();
    assert.equal(sales.length, 1);
    assert.equal(sales[0].package, "pack-strip");
    assert.equal(sales[0].prints, 2, "two 10 × 15 sheets = four small prints");
    assert.equal(sales[0].expectedTotal, 90000);
    assert.equal(sales[0].skip, true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

const staleSale = (bills = []) => ({
  pack: { _id: "pack-full", name: "Khung to", printSize: "full", price: 100000, prints: 2, shots: 4 },
  prints: 4, extraPrintPrice: 20000, stage: "pay", requestKey: "stale-key", bills,
});

test("a polaroid room drops a cash sale left from the photobooth flow and opens the code screen", async () => {
  const { page, errors } = await openKiosk({ _id: "room-1", flip: "device", kind: "polaroid" }, {}, { sale: staleSale() });
  try {
    await page.getByRole("heading", { name: "Nhập mã Polaroid" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Đút tiền để bắt đầu chụp" }).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("kiosk-sale")), null, "the stale sale is gone");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("money already inserted is never dropped: the bill screen comes back even in a polaroid room", async () => {
  const bills = [{ amount: 50000, at: "2026-10-30T13:00:00.000Z" }];
  const { page, errors } = await openKiosk({ _id: "room-1", flip: "device", kind: "polaroid" }, {}, { sale: staleSale(bills) });
  try {
    await page.getByRole("heading", { name: "Đút tiền để bắt đầu chụp" }).waitFor();
    assert.match(await page.locator(".pay-board").innerText(), /50\.000/);
    assert.notEqual(await page.evaluate(() => localStorage.getItem("kiosk-sale")), null);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("polaroid (Selfbooth) room: touch → enter the code bought at the counter → shoot screen with the gold border", async () => {
  const claims = [];
  const polaroidBooking = { ...booking, packageName: "Polaroid đôi", printSize: "instax", selectCount: 2, prints: 1, captureDuration: 5 };
  const { page, errors } = await openKiosk({ _id: "room-1", flip: "device", kind: "polaroid" }, {
    "/kiosk/claim": (route, body) => {
      claims.push(body);
      // Mã của gói photobooth không mở ở phòng Polaroid (máy chủ báo lỗi, mã vẫn còn).
      if (body.code !== "654321")
        return route.fulfill({ status: 400, json: { message: "Mã này dành cho phòng Photobooth, không dùng ở phòng Polaroid." } });
      return route.fulfill({ json: { booking: polaroidBooking, captureToken: "fixture-capture", accessToken: "fixture-album" } });
    },
    "/kiosk/polaroid": () => assert.fail("the kiosk no longer sells Polaroid layouts itself"),
    "/kiosk/start": route => route.fulfill({ json: { booking: { ...polaroidBooking,
      captureStartedAt: new Date().toISOString(), captureEndsAt: new Date(Date.now() + 5 * 60000).toISOString(),
    } } }),
  });
  try {
    // Không chọn layout, không chọn cách thanh toán: vào thẳng màn nhập mã (chữ tiệm đã sửa).
    await page.getByRole("heading", { name: "Nhập mã Polaroid" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Chọn cách thanh toán" }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "Chọn layout" }).count(), 0);
    assert.match(await page.locator(".flow-head p").innerText(), /thanh toán ở quầy/);
    // Giao diện Mellow chung (không bật giao diện cổ điển), không còn khung viền hoa văn vàng (bỏ 13/11).
    assert.equal(await page.evaluate(() => document.documentElement.dataset.kioskTheme), undefined);
    assert.equal(await page.locator(".code-card .ornament-corner").count(), 0);
    await page.getByRole('button', { name: 'Đóng thông báo' }).evaluateAll(buttons => buttons.forEach(button => button.click()));
    await page.locator('.toast').waitFor({ state: 'detached' });
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 1024, height: 600 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.locator('.code-card').evaluate(card => {
        const box = card.getBoundingClientRect(), submit = card.querySelector('button[type=submit]').getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: submit.bottom, width: innerWidth, height: innerHeight };
      });
      assert.ok(layout.left >= 0 && layout.right <= layout.width && layout.top >= 0 && layout.bottom <= layout.height, JSON.stringify(layout));
      await page.mouse.move(0, 0);
      await page.screenshot({ path: resolve(captures, `code-${viewport.width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    // Quay lại: về màn chờ (phòng Polaroid không có màn chọn cách thanh toán).
    await page.getByRole("button", { name: "Quay lại" }).click();
    await page.getByRole("button", { name: "Chạm để bắt đầu" }).click();
    await page.getByRole("heading", { name: "Nhập mã Polaroid" }).waitFor();
    await page.getByRole("textbox", { name: "Mã chụp" }).fill("123456");
    await page.getByRole("button", { name: /Bắt đầu chụp/ }).click();
    await page.getByText("Mã này dành cho phòng Photobooth").first().waitFor();
    await page.setViewportSize({ width: 1024, height: 600 });
    const submitBottom = await page.locator('.code-card button[type=submit]').evaluate(button => button.getBoundingClientRect().bottom);
    assert.ok(submitBottom <= 600, 'an invalid code must not push the submit button below the kiosk screen');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByRole("textbox", { name: "Mã chụp" }).fill("654321");
    await page.getByRole("button", { name: /Bắt đầu chụp/ }).click();
    // Màn chụp như Selfbooth: hình trực tiếp, cột bên có đồng hồ và ô ảnh vừa chụp.
    await page.locator(".shoot-screen.phase-shoot").waitFor();
    assert.equal(await page.locator(".shoot-stage .ornament-corner").count(), 0);
    assert.match(await page.locator(".shoot-timer").innerText(), /THỜI GIAN CÒN LẠI\s*\d\d:\d\d/);
    assert.deepEqual(claims.map((c) => c.code), ["123456", "654321"]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the shoot timer shows the package's time even when the booth PC clock is 3 minutes slow", async () => {
  // Máy chủ chạy trước máy chụp 3 phút. Gói 5 phút: đồng hồ phải bắt đầu từ 05:00 (trước đây hiện 08:00).
  const skew = 3 * 60000;
  const polaroidBooking = { ...booking, packageName: "Polaroid đôi", printSize: "instax", selectCount: 2, prints: 1, captureDuration: 5 };
  let started = null;
  const startedBooking = () => (started ??= { ...polaroidBooking,
    captureStartedAt: new Date(Date.now() + skew).toISOString(),
    captureEndsAt: new Date(Date.now() + skew + 5 * 60000).toISOString() });
  const { page, errors } = await openKiosk({ _id: "room-1", flip: "device", kind: "polaroid" }, {
    "/kiosk/claim": (route) => route.fulfill({ json: { booking: polaroidBooking, captureToken: "fixture-capture", accessToken: "fixture-album" } }),
    "/kiosk/start": (route) => route.fulfill({ json: { booking: startedBooking(), serverTime: Date.now() + skew } }),
    "/kiosk/state": (route) => route.fulfill({ json: { booking: startedBooking(), serverTime: Date.now() + skew } }),
  });
  try {
    await page.getByRole("heading", { name: "Nhập mã Polaroid" }).waitFor();
    await page.getByRole("textbox", { name: "Mã chụp" }).fill("654321");
    await page.getByRole("button", { name: /Bắt đầu chụp/ }).click();
    await page.locator(".shoot-screen.phase-shoot").waitFor();
    await page.waitForTimeout(1200);
    const shown = await page.locator(".shoot-timer strong").innerText();
    assert.ok(["05:00", "04:59", "04:58", "04:57"].includes(shown), `timer ${shown}`);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
