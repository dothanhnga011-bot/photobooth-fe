// Run explicitly: node test/staff-kiosk.browser.mjs
// Real Admin and room components; isolated API fixtures, no live accounts or data.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { Admin } from '/src/admin.jsx';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import '/src/tailwind.css';
  createRoot(document.getElementById('root')).render(
    React.createElement(MemoryRouter, null,
      React.createElement(StudioContext.Provider, { value: { settings: { name: 'Fixture Studio' }, error: '' } },
        React.createElement(ToastProvider, null, React.createElement(Admin)))));
`;

const roomFixtures = [
  {
    _id: "room-1",
    name: "Phòng 01",
    branch: "Chi nhánh Nguyễn Trãi",
    description: "Tầng 1",
    active: true,
  },
  {
    _id: "room-2",
    name: "Phòng 02",
    branch: "Chi nhánh Nguyễn Trãi",
    description: "Tầng 2",
    active: true,
  },
  {
    _id: "room-off",
    name: "Phòng đã tắt",
    branch: "Chi nhánh cũ",
    description: "",
    active: false,
  },
];
const deviceToken = "fixture-device.token_01-keep";
const defaultStaffPermissions = ["orders:export", "print:operate", "rooms:setup"];
let staffPermissions = defaultStaffPermissions;
let server;
let browser;
let page;
let role = "staff";
let rooms;
let devices;
// Số liệu kho ảnh trả cho /api/admin/storage (mặc định chưa có số liệu).
let storageSummary = {};
let requests = [];
let unexpected = [];
let pageErrors = [];
const screenshots = join(tmpdir(), "photobooth-fe-staff-kiosk-review");
// Đơn hàng trang Đơn hàng nhận được khi xem theo khoảng ngày (mặc định không có đơn).
let orderFixtures = [];

async function readJson(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : undefined;
}

before(async () => {
  const bundle = await build({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    define: { "import.meta.env.VITE_API_URL": '""' },
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: "/__staff_kiosk_fixture__.jsx",
        output: {
          format: "iife",
          name: "StaffKioskReview",
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      tailwindcss(),
      {
        name: "staff-kiosk-regression-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/__staff_kiosk_fixture__.jsx")
            return "\0staff-kiosk-fixture.jsx";
        },
        load(id) {
          if (id === "\0staff-kiosk-fixture.jsx") return fixture;
        },
      },
    ],
  });
  const assets = new Map(
    bundle.output.map((asset) => [
      `/${asset.fileName}`,
      asset.type === "chunk" ? asset.code : asset.source,
    ]),
  );
  const script = bundle.output.find((asset) => asset.type === "chunk").fileName;
  const styles = bundle.output.filter((asset) =>
    asset.fileName.endsWith(".css"),
  );
  const logo = await readFile(
    new URL("../public/logo-m-384.jpg", import.meta.url),
  );
  server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://fixture").pathname;
    if (path === "/logo-m-384.jpg") {
      response.setHeader("Content-Type", "image/jpeg");
      response.end(logo);
      return;
    }
    if (path.startsWith("/api/")) {
      const entry = {
        path,
        search: new URL(request.url, "http://fixture").searchParams,
        method: request.method,
        body: await readJson(request),
      };
      requests.push(entry);
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      const send = (value, status = 200) => {
        response.statusCode = status;
        response.end(JSON.stringify(value));
      };
      if (path === "/api/auth/me") {
        send({
          _id: "fixture-user",
          name: role === "staff" ? "Lễ tân thử nghiệm" : "Quản trị thử nghiệm",
          email: "fixture@local.test",
          role,
          // Quyền mặc định của lễ tân (không có xem doanh thu / hủy đơn).
          permissions: role === "staff" ? staffPermissions : undefined,
        });
        return;
      }
      if (path === "/api/admin/storage") {
        send(storageSummary);
        return;
      }
      if (path === "/api/admin/stats") {
        send({ today: 0, printQueue: 0, todayRevenue: 0 });
        return;
      }
      if (path === "/api/admin/stats/revenue") {
        send({
          month: new URL(request.url, "http://fixture").searchParams.get(
            "month",
          ),
          days: [],
          tickets: 0,
          revenue: 0,
        });
        return;
      }
      if (path === "/api/admin/bookings" || path === "/api/admin/print-jobs") {
        send(path === "/api/admin/bookings" && entry.search.has("from") ? orderFixtures : []);
        return;
      }
      if (path === "/api/admin/rooms/live") {
        send({ now: Date.now(), rooms: [] });
        return;
      }
      // Trang mở đầu (Tổng hợp) cũng đọc số liệu tổng hợp.
      if (path === "/api/admin/stats/summary") {
        send({
          revenue: 0, previousRevenue: 0, revenueGrowth: null,
          orders: 0, previousOrders: 0, ordersGrowth: null,
          transfer: 0, cash: 0, sheets: 0, extraSheets: 0,
          themes: [], packages: [], rooms: [],
        });
        return;
      }
      if (path === "/api/admin/print-jobs/stream") {
        response.setHeader("Content-Type", "text/event-stream");
        response.end(": fixture\n\n");
        return;
      }
      if (path === "/api/admin/revenue") {
        send([]);
        return;
      }
      // Print agent cạnh máy Instax đã báo về: còn 2 tấm phim.
      if (path === "/api/admin/print-jobs/printers") {
        send([{ branch: "Chi nhánh Nguyễn Trãi", at: new Date().toISOString(),
          instax: { ready: true, film: 2, battery: 70, charging: false, message: "" },
          agent: { running: true, at: new Date().toISOString(), printSizes: ["full", "instax", "strip"] } },
        // Máy DNP của Phòng 01 (chương trình in trên mini PC của phòng): máy in đang tắt, 1 tờ chờ.
        { branch: "Chi nhánh Nguyễn Trãi", room: "room-1", roomName: "Phòng 01", at: null, instax: null,
          agent: { running: true, at: new Date().toISOString(), printSizes: ["full", "strip"] },
          dnp: { ready: false, state: "Mất kết nối (máy in tắt hoặc rút cáp USB)", jobs: 1, cut: "queue",
            printer: "DS-RX1", stripPrinter: "DS-RX1 - cat doi 2x6", at: new Date().toISOString() } }]);
        return;
      }
      const printerMatch = path.match(/^\/api\/admin\/rooms\/([^/]+)\/printer$/);
      if (printerMatch && entry.method === "POST") {
        const room = rooms.find((item) => item._id === printerMatch[1]);
        send({ token: `printer-token.${room._id}`, name: room.name, branch: room.branch });
        return;
      }
      if (path === "/api/admin/rooms" && entry.method === "GET") {
        // Match the permission-scoped API: staff receives active rooms only.
        send(role === "admin" ? rooms : rooms.filter((room) => room.active));
        return;
      }
      const deviceMatch = path.match(/^\/api\/admin\/rooms\/([^/]+)\/device$/);
      if (deviceMatch) {
        const id = deviceMatch[1];
        if (entry.method === "POST" && !devices.has(id)) {
          devices.set(id, {
            token: `${deviceToken}.${id}`,
            name: rooms.find((room) => room._id === id).name,
          });
        }
        send(
          devices.get(id) || { message: "Chưa có liên kết kiosk." },
          devices.has(id) ? 200 : 404,
        );
        return;
      }
      const roomMatch = path.match(/^\/api\/admin\/rooms\/([^/]+)$/);
      if (roomMatch && entry.method === "PUT" && role === "admin") {
        rooms = rooms.map((room) =>
          room._id === roomMatch[1] ? { ...room, ...entry.body } : room,
        );
        send(rooms.find((room) => room._id === roomMatch[1]));
        return;
      }
      const permanent = path.match(/^\/api\/admin\/rooms\/([^/]+)\/permanent$/);
      if (permanent && entry.method === "DELETE" && role === "admin") {
        rooms = rooms.filter((room) => room._id !== permanent[1]);
        send({ ok: true });
        return;
      }
      if (path === "/api/admin/rooms" && entry.method === "POST" && role === "admin") {
        const created = { _id: `room-${rooms.length + 1}`, active: true, ...entry.body };
        rooms = [...rooms, created];
        send(created);
        return;
      }
      unexpected.push(`${entry.method} ${path}`);
      send(
        { message: `Unexpected fixture request: ${entry.method} ${path}` },
        404,
      );
      return;
    }
    if (assets.has(path)) {
      response.setHeader(
        "Content-Type",
        path.endsWith(".css") ? "text/css" : "text/javascript",
      );
      response.end(assets.get(path));
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styles.map((asset) => `<link rel="stylesheet" href="/${asset.fileName}">`).join("")}</head><body><div id="root"></div><script src="/${script}"></script></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function mount(nextRole = "staff", width = 1440, permissions = defaultStaffPermissions, storage = {}) {
  role = nextRole;
  staffPermissions = permissions;
  rooms = structuredClone(roomFixtures);
  devices = new Map([["room-1", { token: deviceToken, name: "Phòng 01" }]]);
  storageSummary = storage;
  requests = [];
  unexpected = [];
  pageErrors = [];
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  await page.goto(`http://127.0.0.1:${server.address().port}/admin`);
  await page
    .getByRole("navigation", { name: "Quản lý studio", includeHidden: true })
    .waitFor({ state: "attached" });
  if (width < 600)
    await page
      .getByRole("button", { name: "Menu quản lý", exact: true })
      .click();
}

// Không lỗi script và không có yêu cầu API nào ngoài dữ liệu giả (nếu có, trang sẽ hiện toast lỗi).
function assertClean() {
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpected, []);
}

async function openRooms() {
  await page
    .getByRole("navigation", { name: "Quản lý studio" })
    .getByRole("button", { name: "Quản lý máy", exact: true })
    .click();
  await page.getByRole("row").filter({ hasText: "Phòng 01" }).waitFor();
}

const roomRow = (name) => page.getByRole("row").filter({ hasText: name });
const kioskDialog = () =>
  page.getByRole("dialog", { name: "Cài máy chụp", exact: true });
const deviceRequests = () =>
  requests.filter((entry) => entry.path.endsWith("/device"));

test("staff can access active rooms and branches without room administration controls", async () => {
  await mount();
  const nav = page.getByRole("navigation", { name: "Quản lý studio" });
  // Lễ tân không có quyền xem doanh thu: không có Thống kê doanh thu, Thiết lập hay Tài khoản.
  assert.deepEqual(await nav.getByRole("button").allTextContents(), [
    "Tổng hợp",
    "Đơn hàng",
    "Quản lý máy",
    "Dung lượng ảnh",
  ]);
  assert.equal(await nav.getByRole("group").count(), 1);
  assert.equal(await nav.getByRole("group", { name: "Tổng quan" }).count(), 1);
  assert.equal(await nav.getByText("Thiết lập", { exact: true }).count(), 0);
  await openRooms();
  assert.equal(await page.getByRole("row").count(), 3);
  assert.equal(
    await page.getByText("Phòng đã tắt", { exact: true }).count(),
    0,
  );
  assert.match(await roomRow("Phòng 01").innerText(), /Chi nhánh Nguyễn Trãi/);
  assert.equal(
    await page.getByRole("button", { name: "Thêm mới", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /^Chỉnh sửa / }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /^Ngừng sử dụng / }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /^Cài máy chụp cho / }).count(),
    2,
  );
  assert.deepEqual(
    requests.filter((entry) => entry.method !== "GET"),
    [],
  );
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: join(screenshots, "rooms-staff-1440.png"),
    fullPage: true,
  });
  assertClean();
});

test("a receptionist's menu and room buttons follow the permissions the server grants", async () => {
  await mount("staff", 1440, ["revenue:view", "orders:export"]);
  const nav = page.getByRole("navigation", { name: "Quản lý studio" });
  assert.deepEqual(await nav.getByRole("button").allTextContents(), [
    "Tổng hợp",
    "Thống kê doanh thu",
    "Đơn hàng",
    "Quản lý máy",
    "Dung lượng ảnh",
  ]);
  await openRooms();
  // Không có quyền cài máy chụp (rooms:setup): vẫn thấy danh sách máy nhưng không có nút cài.
  assert.equal(await page.getByRole("row").count(), 3);
  assert.equal(
    await page.getByRole("button", { name: /^Cài máy chụp cho / }).count(),
    0,
  );
  assertClean();
});

test("opening a configured kiosk uses the returned device token and displays QR and installers", async () => {
  await mount();
  await openRooms();
  await roomRow("Phòng 01")
    .getByRole("button", { name: "Cài máy chụp cho Phòng 01", exact: true })
    .click();
  const dialog = kioskDialog();
  await dialog.waitFor();
  await dialog.getByRole("link", { name: "Mở máy chụp" }).waitFor();
  const url = `http://127.0.0.1:${server.address().port}/kiosk?device=${encodeURIComponent(deviceToken)}`;
  assert.equal(
    await dialog.getByRole("link", { name: "Mở máy chụp" }).getAttribute("href"),
    url,
  );
  assert.equal(await dialog.locator('svg[width="220"]').count(), 1);
  assert.equal(
    await dialog.getByRole("button", { name: "File cài cho Windows" }).count(),
    1,
  );
  assert.equal(
    await dialog.getByRole("button", { name: "File cài cho Mac" }).count(),
    1,
  );
  // Máy in DNP của phòng: một file cài cho mini PC cắm máy in, mang mã máy in của đúng phòng này.
  const printerSetup = dialog.getByRole("region", { name: "Máy in DNP của phòng" });
  assert.match(await printerSetup.innerText(), /tờ to.*in nguyên\s+tờ 10 × 15.*tờ nhỏ.*máy tự cắt đôi/s);
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    printerSetup.getByRole("button", { name: "File cài máy in (Windows)" }).click(),
  ]);
  assert.equal(file.suggestedFilename(), "cai-may-in-phong-01.bat");
  const bat = await readFile(await file.path(), "utf8");
  const config = JSON.parse(Buffer.from(/^rem NXC_PRINT_CONFIG_BASE64:(\S+)/m.exec(bat)[1], "base64").toString("utf8"));
  assert.deepEqual(config, {
    api: `http://127.0.0.1:${server.address().port}`, token: "printer-token.room-1", room: "Phòng 01",
  });
  const agent = Buffer.from(/^rem NXC_PRINT_AGENT_BASE64:(\S+)/m.exec(bat)[1], "base64").toString("utf8");
  assert.match(agent, /^﻿# NXC Photobooth - chương trình in tự động cho máy DNP DS-RX1/);
  await page.getByRole("status").filter({ hasText: "Đã tải file cài máy in" }).first().waitFor();
  const [colorDownload] = await Promise.all([
    page.waitForEvent("download"),
    printerSetup.getByRole("button", { name: "Đồng bộ màu RX1 (Windows)" }).click(),
  ]);
  assert.equal(colorDownload.suggestedFilename(), "cai-mau-RX1.bat");
  const colorBat = await readFile(await colorDownload.path(), "utf8");
  const colorTool = Buffer.from(/^rem NXC_COLOR_BASE64:(\S+)/m.exec(colorBat)[1], "base64").toString("utf8");
  assert.match(colorTool, /function Set-Rx1QueueColor/);
  assert.match(colorTool, /RestoreBackup/);
  assert.doesNotMatch(colorBat, /NXC_PRINT_CONFIG_BASE64|printer-token\.room-1/);
  await mkdir(screenshots, { recursive: true });
  await printerSetup.scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: join(screenshots, "room-setup-printer.png") });
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  // Issuance can return a fresh JWT; the UI must use the current response.
  const freshToken = `${deviceToken}.fresh`;
  devices.set("room-1", { token: freshToken, name: "Phòng 01" });
  await roomRow("Phòng 01")
    .getByRole("button", { name: "Cài máy chụp cho Phòng 01", exact: true })
    .click();
  await dialog.waitFor();
  await dialog.getByRole("link", { name: "Mở máy chụp" }).waitFor();
  assert.equal(
    await dialog.getByRole("link", { name: "Mở máy chụp" }).getAttribute("href"),
    `http://127.0.0.1:${server.address().port}/kiosk?device=${encodeURIComponent(freshToken)}`,
  );
  assert.deepEqual(
    deviceRequests().map((entry) => entry.method),
    ["POST", "POST"],
  );
  assertClean();
});

test("staff can create a kiosk link for a room that has never been configured", async () => {
  await mount();
  await openRooms();
  await roomRow("Phòng 02")
    .getByRole("button", { name: "Cài máy chụp cho Phòng 02", exact: true })
    .click();
  const dialog = kioskDialog();
  await dialog.waitFor();
  await dialog.getByRole("link", { name: "Mở máy chụp" }).waitFor();
  assert.match(
    await dialog.getByRole("link", { name: "Mở máy chụp" }).getAttribute("href"),
    /device=fixture-device\.token_01-keep\.room-2$/,
  );
  // Lễ tân không bật / tắt chế độ thử tiền mặt (khách chụp không trả tiền): chỉ quản trị viên.
  const testMode = dialog.getByRole("checkbox", { name: /Chế độ thử/ });
  assert.equal(await testMode.isDisabled(), true);
  await dialog.getByText(/chỉ quản trị viên bật \/ tắt/).waitFor();
  assert.deepEqual(deviceRequests()[0].body, {});
  assert.deepEqual(
    deviceRequests().map((entry) => entry.method),
    ["POST"],
  );
  assert.deepEqual(
    requests
      .filter((entry) => entry.method !== "GET")
      .map((entry) => entry.path),
    ["/api/admin/rooms/room-2/device"],
  );
  assertClean();
});

test("downloaded Windows and Mac installers open the same room kiosk", async () => {
  await mount();
  await openRooms();
  await roomRow("Phòng 01")
    .getByRole("button", { name: "Cài máy chụp cho Phòng 01", exact: true })
    .click();
  const dialog = kioskDialog();
  await dialog.waitFor();
  await dialog.getByRole("link", { name: "Mở máy chụp" }).waitFor();
  const url = await dialog
    .getByRole("link", { name: "Mở máy chụp" })
    .getAttribute("href");
  for (const [label, filename] of [
    ["File cài cho Windows", "cai-kiosk-NXC.bat"],
    ["File cài cho Mac", "cai-kiosk-NXC.command"],
  ]) {
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: label, exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), filename);
    const chunks = [];
    for await (const chunk of await download.createReadStream())
      chunks.push(chunk);
    const installer = Buffer.concat(chunks).toString("utf8");
    assert.ok(
      installer.includes(url),
      "Installer must use this room's kiosk URL",
    );
    if (filename.endsWith(".bat")) {
      assert.ok(installer.includes("--start-fullscreen --new-window"));
      assert.ok(!installer.includes("--kiosk "));
      assert.ok(installer.includes("-WindowStyle Hidden"));
      assert.ok(
        installer.includes('--user-data-dir="%LOCALAPPDATA%\\NXC-Kiosk"'),
      );
      const payload = installer.match(
        /^rem NXC_WINDOW_CONTROL_BASE64:([A-Za-z0-9+/=]+)$/m,
      );
      assert.ok(
        payload,
        "Windows installer must include its own corner control",
      );
      const helper = Buffer.from(payload[1], "base64").toString("utf8");
      const source = await readFile(
        new URL(
          "../src/admin/installers/kiosk-window-control.ps1",
          import.meta.url,
        ),
        "utf8",
      );
      assert.equal(
        helper,
        `\ufeff${source}`,
        "Helper must survive encoding including Vietnamese text",
      );
      assert.ok(
        installer.indexOf("exit /b") < installer.indexOf(payload[0]),
        "Embedded helper must not execute as batch commands",
      );
      assert.ok(
        installer
          .split(/\r?\n/)
          .filter((line) => !line.startsWith("rem NXC_WINDOW_CONTROL_BASE64:"))
          .every((line) => line.length < 8191),
        "Executable batch lines must fit the Windows command length limit",
      );
    }
  }
  assertClean();
});

test("staff mobile navigation closes after opening rooms and kiosk dialog fits the screen", async () => {
  await mount("staff", 390);
  await openRooms();
  assert.equal(
    await page
      .getByRole("button", { name: "Menu quản lý", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: join(screenshots, "rooms-staff-390.png"),
    fullPage: true,
  });
  await roomRow("Phòng 01")
    .getByRole("button", { name: "Cài máy chụp cho Phòng 01", exact: true })
    .click();
  const dialog = kioskDialog();
  await dialog.waitFor();
  await dialog.getByRole("link", { name: "Mở máy chụp" }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const box = await dialog.boundingBox();
  assert.ok(
    box.x >= 0 && box.x + box.width <= 390,
    "Kiosk dialog must fit mobile width",
  );
  await dialog.getByRole("link", { name: "Mở máy chụp" }).scrollIntoViewIfNeeded();
  assert.equal(
    await dialog.getByRole("link", { name: "Mở máy chụp" }).isVisible(),
    true,
  );
  await page.screenshot({
    path: join(screenshots, "kiosk-staff-390.png"),
    fullPage: true,
  });
  assertClean();
});

test("admin keeps inactive rooms, create/edit/deactivate controls, and room editing", async () => {
  await mount("admin");
  await openRooms();
  assert.equal(await page.getByRole("row").count(), 4);
  const printers = await page.getByRole("region", { name: "Máy in" }).innerText();
  assert.match(printers, /Chi nhánh Nguyễn Trãi · Chương trình in tự động đang chạy \(DNP \+ Instax\)/);
  assert.match(printers, /Máy Instax Link WIDE · Sắp hết phim — chuẩn bị hộp phim mới · còn 2 tấm phim · pin 70%/);
  assert.match(printers, /Phòng 01 · Máy in DNP Mất kết nối \(máy in tắt hoặc rút cáp USB\) · 1 tờ đang chờ in · tờ nhỏ in qua hàng in cắt đôi 2 inch/);
  assert.equal(
    await page.getByRole("button", { name: "Thêm mới", exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Chỉnh sửa Phòng đã tắt", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Ngừng sử dụng Phòng 01", exact: true })
      .count(),
    1,
  );
  await page
    .getByRole("button", { name: "Chỉnh sửa Phòng 01", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Chỉnh sửa dữ liệu",
    exact: true,
  });
  await dialog
    .getByLabel("Tên máy / phòng", { exact: true })
    .fill("Phòng 01 cập nhật");
  // Hộp sửa phòng không còn loại phòng và thông tin máy (mã, dòng máy, ngày nhập, ngày hết hạn).
  for (const name of [/Photobooth/, /Polaroid/])
    assert.equal(await dialog.getByRole("radio", { name }).count(), 0);
  for (const label of ["Mã máy", "Dòng máy", "Ngày nhập máy", "Ngày hết hạn", "Chi nhánh / địa chỉ"])
    assert.equal(await dialog.getByLabel(label, { exact: true }).count(), 0);
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await roomRow("Phòng 01 cập nhật").waitFor();
  const mutation = requests.find((entry) => entry.method === "PUT");
  assert.equal(mutation.path, "/api/admin/rooms/room-1");
  assert.equal('branch' in mutation.body, false, 'editing a machine leaves its branch on the server');
  assert.equal(mutation.body.name, "Phòng 01 cập nhật");

  // "Cài máy chụp" mở thẳng liên kết + QR: loại phòng đã chọn lúc thêm phòng, không chọn lại ở đây.
  await roomRow("Phòng 01 cập nhật")
    .getByRole("button", { name: /^Cài máy chụp cho / })
    .click();
  const setup = kioskDialog();
  await setup.getByRole("link", { name: "Mở máy chụp" }).waitFor();
  await setup.getByText("Phòng Photobooth", { exact: true }).waitFor();
  assert.equal(await setup.getByRole("radio").count(), 0);
  assert.equal(await setup.getByRole("button", { name: /Tiếp tục/ }).count(), 0);
  // Mở hộp thoại không gửi chế độ thử (máy chủ trả trạng thái đang lưu).
  assert.deepEqual(deviceRequests().at(-1).body, {});
  // Phòng Photobooth bật chế độ thử tiền mặt ngay trong hộp: lưu lại liên kết với chế độ thử.
  const testMode = setup.getByRole("checkbox", { name: /Chế độ thử/ });
  assert.equal(await testMode.isChecked(), false);
  const before = deviceRequests().length;
  await testMode.check();
  await page.waitForFunction(() => {
    const box = document.querySelector('[role="dialog"] .setup-test input');
    return box && box.checked && !box.disabled;
  });
  assert.equal(deviceRequests().length, before + 1);
  const issued = deviceRequests().at(-1);
  assert.equal(issued.path, "/api/admin/rooms/room-1/device");
  assert.deepEqual(issued.body, { paymentTest: true });
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, "room-setup-1440.png") });
  await setup.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.screenshot({
    path: join(screenshots, "rooms-admin-1440.png"),
    fullPage: true,
  });
  assertClean();
});

test("admin sidebar: one line per page, one icon column, 44 px rows, plain group labels and the storage %", async () => {
  // Kho ảnh đã dùng 84%: mục "Dung lượng ảnh" hiện số % màu vàng.
  const usedBytes = 430 * 1024 * 1024;
  await mount("admin", 1440, defaultStaffPermissions, {
    cluster: { available: true, usedBytes },
    quota: { scope: "cluster", limitMB: 512, usagePercent: 84, remainingBytes: 82 * 1024 * 1024 },
  });
  const nav = page.getByRole("navigation", { name: "Quản lý studio" });
  await nav.locator(".nav-storage").waitFor();
  const measure = () => page.evaluate(() => {
    const items = [...document.querySelectorAll("#admin-navigation button")].map((button) => {
      const text = button.querySelector(".admin-nav-text");
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
      return {
        label: text.textContent,
        height: Math.round(button.getBoundingClientRect().height),
        iconLeft: Math.round(button.querySelector("svg, img").getBoundingClientRect().left),
        oneLine: text.getBoundingClientRect().height < lineHeight * 1.5,
      };
    });
    const labels = [...document.querySelectorAll(".admin-nav-parent")].map((label) => ({
      text: label.textContent, icons: label.querySelectorAll("svg").length,
    }));
    const sidebar = document.querySelector(".admin-sidebar").getBoundingClientRect();
    const main = document.querySelector(".admin-main").getBoundingClientRect();
    return { items, labels, sidebar: Math.round(sidebar.width), mainLeft: Math.round(main.left) };
  });
  const wide = await measure();
  assert.equal(wide.items.length, 14, JSON.stringify(wide.items.map((i) => i.label)));
  assert.deepEqual(wide.items.filter((i) => !i.oneLine).map((i) => i.label), [], "every page name fits on one line");
  assert.ok(wide.items.every((i) => i.height >= 44), JSON.stringify(wide.items.map((i) => [i.label, i.height])));
  assert.equal(new Set(wide.items.map((i) => i.iconLeft)).size, 1, "pages in a group line up with the other pages");
  assert.deepEqual(wide.labels, [{ text: "Tổng quan", icons: 0 }, { text: "Thiết lập", icons: 0 }]);
  assert.equal(wide.mainLeft, wide.sidebar, "the page starts right after the sidebar");
  const badge = nav.locator(".nav-storage");
  assert.equal(await badge.innerText(), "84%");
  assert.match(await badge.getAttribute("class"), /is-warning/);
  await mkdir(screenshots, { recursive: true });
  await page.locator(".admin-sidebar").screenshot({ path: join(screenshots, "sidebar-1440.png") });
  // Laptop 768 px: hàng gọn hơn nhưng tên trang vẫn một dòng.
  await page.setViewportSize({ width: 1366, height: 768 });
  const laptop = await measure();
  assert.deepEqual(laptop.items.filter((i) => !i.oneLine).map((i) => i.label), []);
  assert.ok(laptop.items.every((i) => i.height >= 38), JSON.stringify(laptop.items.map((i) => [i.label, i.height])));
  await page.screenshot({ path: join(screenshots, "sidebar-1366x768.png") });
  assertClean();
  // Điện thoại: menu mở ra không tràn ngang, mỗi mục vẫn ≥ 44 px.
  await mount("admin", 390);
  const phone = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    heights: [...document.querySelectorAll("#admin-navigation button")].map((b) => Math.round(b.getBoundingClientRect().height)),
  }));
  await page.screenshot({ path: join(screenshots, "sidebar-390.png"), fullPage: true });
  assert.equal(phone.overflow, false);
  assert.ok(phone.heights.length === 14 && phone.heights.every((h) => h >= 44), JSON.stringify(phone.heights));
  assertClean();
});

test("a new room picks its kind (photobooth / polaroid) right in the add form", async () => {
  await mount("admin");
  await openRooms();
  await page.getByRole("button", { name: "Thêm mới", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên máy / phòng", { exact: true }).fill("Phòng Polaroid");
  assert.equal(await dialog.getByLabel("Chi nhánh / địa chỉ", { exact: true }).count(), 0);
  const kinds = dialog.getByRole("radiogroup", { name: "Loại phòng" });
  assert.equal(await kinds.getByRole("radio", { name: /Photobooth/ }).isChecked(), true);
  await kinds.getByRole("radio", { name: /Polaroid/ }).check();
  await dialog.getByRole("button", { name: /Lưu|Thêm/ }).last().click();
  await dialog.waitFor({ state: "hidden" });
  const created = requests.find((entry) => entry.method === "POST" && entry.path === "/api/admin/rooms");
  assert.equal(created.body.kind, "polaroid");
  assert.equal('branch' in created.body, false, 'new machines get the shop default on the server');
  await roomRow("Phòng Polaroid").getByText(/Phòng Polaroid ·/).waitFor();
  // Hộp sửa phòng đã có không hiện loại phòng (chỉ chọn lúc thêm).
  await page.getByRole("button", { name: "Chỉnh sửa Phòng Polaroid", exact: true }).click();
  assert.equal(await page.getByRole("dialog").getByRole("radiogroup", { name: "Loại phòng" }).count(), 0);
  assertClean();
});

test("a stopped room can be switched back on or deleted for good", async () => {
  await mount("admin");
  await openRooms();
  const stopped = roomRow("Phòng đã tắt");
  assert.equal(await stopped.getByRole("button", { name: "Ngừng sử dụng Phòng đã tắt", exact: true }).count(), 0);
  // Bật lại: gửi lại thông tin phòng với active = true.
  await stopped.getByRole("button", { name: "Bật lại Phòng đã tắt", exact: true }).click();
  await page.getByText("Đã bật lại phòng “Phòng đã tắt”.").waitFor();
  const restored = requests.find((entry) => entry.method === "PUT");
  assert.equal(restored.body.active, true);
  assert.equal(restored.body.name, "Phòng đã tắt");
  // Phòng đang chạy không có nút xoá hẳn (ngừng sử dụng trước).
  assert.equal(await roomRow("Phòng 01").getByRole("button", { name: /^Xoá hẳn/ }).count(), 0);
  await mount("admin");
  await openRooms();
  page.once("dialog", (dialog) => dialog.accept());
  await roomRow("Phòng đã tắt").getByRole("button", { name: "Xoá hẳn Phòng đã tắt", exact: true }).click();
  await page.getByText("Đã xoá phòng “Phòng đã tắt”.").waitFor();
  assert.ok(requests.some((entry) => entry.method === "DELETE" && entry.path.endsWith("/permanent")));
  assertClean();
});

test("orders open on the last 72 hours and explain where older revenue is retained", async () => {
  await mount();
  const before = requests.length;
  await page
    .getByRole("navigation", { name: "Quản lý studio" })
    .getByRole("button", { name: "Đơn hàng", exact: true })
    .click();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  const firstDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.now() - 72 * 3600_000));
  // Chỉ xét yêu cầu của trang Đơn hàng (trang Tổng hợp cũng đọc đơn, theo ?date=).
  const orders = () => requests.slice(before)
    .filter((entry) => entry.path === "/api/admin/bookings" && entry.search.has("from"));
  await page.getByRole("button", { name: /Chọn tháng hoặc ngày:/ }).waitFor();
  for (let i = 0; i < 40 && !orders().length; i++) await page.waitForTimeout(50);
  const first = orders()[0].search;
  assert.equal(first.get("from"), firstDay);
  assert.equal(first.get("to"), today);
  assert.equal(await page.getByRole("button", { name: "3 ngày gần nhất", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByText(/Tổng thu chi của các ngày cũ vẫn có trong/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Xóa bộ lọc" }).count(), 0);
  await page.getByRole("button", { name: "Hôm nay", exact: true }).click();
  await page.getByRole("button", { name: /Chọn tháng hoặc ngày: Hôm nay/ }).waitFor();
  const latest = () => orders().at(-1).search;
  for (let i = 0; i < 40 && latest().get("from") !== today; i++) await page.waitForTimeout(50);
  assert.equal(latest().get("from"), today);
  assert.equal(latest().get("to"), today);
  await page.getByRole("button", { name: "Xóa bộ lọc" }).click();
  await page.getByRole("button", { name: "3 ngày gần nhất", exact: true }).waitFor();
  for (let i = 0; i < 40 && latest().get("from") !== firstDay; i++) await page.waitForTimeout(50);
  assert.equal(latest().get("from"), firstDay);
  assertClean();
});

test("the orders page opens a room's kiosk in a new tab without going to Quản lý máy", async () => {
  await mount();
  const nav = page.getByRole("navigation", { name: "Quản lý studio" });
  await nav.getByRole("button", { name: "Đơn hàng", exact: true }).click();
  await page.getByRole("button", { name: "Mở máy chụp" }).click();
  const menu = page.getByRole("menu", { name: "Mở máy chụp của phòng" });
  await menu.getByRole("menuitem", { name: /Phòng 01/ }).waitFor();
  // Chỉ phòng đang hoạt động.
  assert.deepEqual(await menu.getByRole("menuitem").locator("strong").allInnerTexts(), ["Phòng 01", "Phòng 02"]);
  const [kiosk] = await Promise.all([page.waitForEvent("popup"), menu.getByRole("menuitem", { name: /Phòng 02/ }).click()]);
  await kiosk.waitForURL(/\/kiosk\?device=/);
  assert.match(kiosk.url(), /device=fixture-device\.token_01-keep\.room-2$/);
  assert.ok(requests.some((entry) => entry.path === "/api/admin/rooms/room-2/device" && entry.method === "POST"));
  await kiosk.close();
  await menu.waitFor({ state: "detached" });
  // Tài khoản không có quyền cài máy chụp: không có nút.
  await mount("staff", 1440, ["orders:export", "print:operate"]);
  await page.getByRole("navigation", { name: "Quản lý studio" }).getByRole("button", { name: "Đơn hàng", exact: true }).click();
  await page.getByRole("button", { name: /Tạo đơn/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Mở máy chụp" }).count(), 0);
  assertClean();
});

test("orders say so when the server's 2000-order cap for a date range is reached", async () => {
  orderFixtures = Array.from({ length: 2000 }, (_, i) => ({
    _id: `order-${i}`, code: String(100000 + i), name: `Khách ${i}`, status: "completed", total: 50000,
    paid: true, createdAt: new Date(Date.now() - i * 60000).toISOString(), packageName: "Gói 1", printSize: "full",
  }));
  try {
    await mount();
    await page
      .getByRole("navigation", { name: "Quản lý studio" })
      .getByRole("button", { name: "Đơn hàng", exact: true })
      .click();
    await page.getByText(/Đang hiện 2\.000 đơn mới nhất/).waitFor();
    assertClean();
  } finally {
    orderFixtures = [];
  }
});
