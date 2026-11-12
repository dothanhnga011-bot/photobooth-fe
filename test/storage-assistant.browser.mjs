// Run explicitly: node test/storage-assistant.browser.mjs
// Real React controls, polling, and CSS; deterministic storage API responses.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

const MB = 1048576;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { Admin } from '/src/admin.jsx';
  import { StorageAssistant } from '/src/admin/storage-assistant.jsx';
  import { StorageMonitorProvider } from '/src/admin/storage-monitor.jsx';
  import { ToastProvider } from '/src/studio.jsx';
  import '/src/tailwind.css';
  const root = createRoot(document.getElementById('root'));
  let run = 0;
  window.mountStorage = (canManageStorage = true) => {
    root.render(React.createElement(ToastProvider, { key: ++run },
      React.createElement(StorageMonitorProvider, null,
      React.createElement('div', { className: 'admin-shell' },
        React.createElement('aside', { className: 'admin-sidebar' }),
        React.createElement('main', { className: 'admin-main' },
          React.createElement('div', { className: 'admin-content' },
            React.createElement(StorageAssistant, { canManageStorage })))))));
  };
  window.mountAdmin = () => {
    root.render(React.createElement(ToastProvider, { key: ++run },
      React.createElement(MemoryRouter, null, React.createElement(Admin))));
  };
`;

function summary(limitMB = null, expiredFiles = 3) {
  const mediaBytes = 850 * MB;
  const databaseBytes = 50 * MB;
  const limitBytes = limitMB === null ? null : limitMB * MB;
  return {
    checkedAt: new Date().toISOString(),
    bytesPerMB: MB,
    ttlHours: 24,
    media: {
      files: 17,
      bytes: mediaBytes,
      groups: {
        photos: { files: 7, bytes: 450 * MB },
        originals: { files: 7, bytes: 300 * MB },
        printSheets: { files: 3, bytes: 100 * MB },
        videos: { files: 0, bytes: 0 },
        other: { files: 0, bytes: 0 },
      },
    },
    database: {
      available: true,
      name: "storage-test",
      dataBytes: 40 * MB,
      indexBytes: 10 * MB,
      usedBytes: databaseBytes,
      error: null,
    },
    cluster: {
      available: true,
      dataBytes: 40 * MB,
      indexBytes: 10 * MB,
      usedBytes: databaseBytes,
      databaseCount: 1,
      error: null,
    },
    quota: {
      limitMB,
      limitBytes,
      scope: "cluster",
      source: "setting",
      remainingBytes:
        limitBytes === null ? null : Math.max(0, limitBytes - databaseBytes),
      usagePercent:
        limitBytes === null ? null : (databaseBytes / limitBytes) * 100,
      level:
        limitBytes === null
          ? "unknown"
          : databaseBytes / limitBytes >= 0.9
            ? "critical"
            : databaseBytes / limitBytes >= 0.8
              ? "warning"
              : "normal",
    },
    expired: {
      photos: expiredFiles ? 1 : 0,
      printJobs: expiredFiles ? 1 : 0,
      files: expiredFiles,
      bytes: expiredFiles ? 12 * MB : 0,
    },
    retention: {
      nextImageExpiresAt: new Date(
        Date.now() + 2 * 60 * 60 * 1000,
      ).toISOString(),
    },
  };
}

// Empty answers of the admin API, by path. The real shell mounts whichever page a test opens.
function adminPage(path) {
  switch (path) {
    case "/api/admin/stats":
      return { todayRevenue: 0, today: 0, printQueue: 0, occupancy: [] };
    case "/api/admin/stats/summary":
      return {
        revenue: 0, previousRevenue: 0, revenueGrowth: null,
        orders: 0, previousOrders: 0, ordersGrowth: null,
        transfer: 0, cash: 0, sheets: 0, extraSheets: 0,
        themes: [], packages: [], rooms: [],
      };
    case "/api/admin/stats/chart":
      return { unit: "day", points: [] };
    case "/api/admin/rooms/live":
      return { now: Date.now(), rooms: [] };
    case "/api/admin/settings":
      return { enabledFilters: [], customFilters: [] };
    case "/api/admin/settings/rx1-output":
      return { configured: true, settings: { gamma: 1.5, maxResolution: true } };
    case "/api/admin/bookings":
    case "/api/admin/rooms":
    case "/api/admin/packages":
    case "/api/admin/frames":
    case "/api/admin/themes":
    case "/api/admin/stickers":
    case "/api/admin/users":
    // Quản lý máy: chưa có print agent Instax nào báo về.
    case "/api/admin/print-jobs/printers":
      return [];
    case "/api/admin/screens":
      return [
        {
          _id: "screen-default", isDefault: true, name: "Cấu hình chung", rooms: [],
          title: "", subtitle: "", interval: 5, active: true, images: [],
        },
      ];
  }
}

let server;
let browser;
let page;
let currentSummary;
let storageError;
let authRole = "admin";
let authPermissions;
let authError = false;
let mutationSummary = null;
let holdStorageReads = false;
let heldStorageResponses = [];
let requests = [];
let unexpected = [];
let pageErrors = [];
let customers = [];

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : null;
}

before(async () => {
  const bundle = await build({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: "/__storage_fixture__.jsx",
        output: {
          format: "iife",
          name: "StorageRegression",
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      tailwindcss(),
      {
        name: "storage-assistant-regression-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/__storage_fixture__.jsx") return "\0storage-fixture.jsx";
        },
        load(id) {
          if (id === "\0storage-fixture.jsx") return fixture;
        },
      },
    ],
  });
  const assets = new Map(
    bundle.output.map((chunk) => [
      `/${chunk.fileName}`,
      chunk.type === "chunk" ? chunk.code : chunk.source,
    ]),
  );
  const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
  for (const name of [
    "logo-m-384.jpg",
    "fonts/be-vietnam-pro.css",
    ...[400, 500, 600, 700].map((weight) => `fonts/be-vietnam-pro-${weight}.woff2`),
  ])
    assets.set(`/${name}`, await readFile(join(publicRoot, name)));
  const script = bundle.output.find((chunk) => chunk.type === "chunk").fileName;
  const styles = bundle.output.filter((chunk) =>
    chunk.fileName.endsWith(".css"),
  );
  server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://fixture").pathname;
    if (path.startsWith("/api/")) {
      const entry = {
        method: request.method,
        path,
        body: await readJson(request),
      };
      requests.push(entry);
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      if (path === "/api/auth/me") {
        if (authError) {
          response.statusCode = 401;
          response.end(JSON.stringify({ message: "Chưa đăng nhập." }));
        } else {
          response.end(
            JSON.stringify({
              _id: "fixture-admin",
              name: "Quản trị NXC",
              role: authRole,
              permissions: authPermissions,
            }),
          );
        }
        return;
      }
      if (path === "/api/admin/storage" && entry.method === "GET") {
        if (holdStorageReads) {
          heldStorageResponses.push(response);
          return;
        }
        if (storageError) {
          response.statusCode = 503;
          response.end(JSON.stringify({ message: storageError }));
        } else response.end(JSON.stringify(currentSummary));
        return;
      }
      if (path === "/api/admin/storage/customers" && entry.method === "GET") {
        response.end(JSON.stringify(customers));
        return;
      }
      if (path.startsWith("/api/admin/storage/customers/") && entry.method === "DELETE") {
        const id = path.split("/").pop();
        customers = customers.filter((row) => row.id !== id);
        response.end(JSON.stringify({ files: 5, photos: 2, printJobs: 0, summary: currentSummary }));
        return;
      }
      if (
        path === "/api/admin/storage/cleanup-expired" &&
        entry.method === "POST"
      ) {
        const freedBytes = currentSummary.expired.bytes;
        currentSummary = mutationSummary ?? {
          ...currentSummary,
          media: {
            ...currentSummary.media,
            files: currentSummary.media.files - currentSummary.expired.files,
            bytes: currentSummary.media.bytes - freedBytes,
          },
          expired: { photos: 0, printJobs: 0, files: 0, bytes: 0 },
        };
        response.end(JSON.stringify({ freedBytes, summary: currentSummary }));
        return;
      }
      if (path === "/api/admin/settings/select-time" && entry.method === "PUT") {
        response.end(JSON.stringify({ selectSeconds: entry.body.selectSeconds }));
        return;
      }
      if (path === "/api/admin/print-jobs/stream") {
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Cache-Control", "no-cache");
        response.write(": fixture connected\n\n");
        return;
      }
      if (entry.method === "GET" && adminPage(path) !== undefined) {
        response.end(JSON.stringify(adminPage(path)));
        return;
      }
      unexpected.push(`${entry.method} ${path}`);
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "Unexpected API request" }));
      return;
    }
    if (assets.has(path)) {
      response.setHeader(
        "Content-Type",
        path.endsWith(".css") ? "text/css" :
          path.endsWith(".jpg") ? "image/jpeg" :
            path.endsWith(".woff2") ? "font/woff2" : "text/javascript",
      );
      response.end(assets.get(path));
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fonts/be-vietnam-pro.css">${styles.map((asset) => `<link rel="stylesheet" href="/${asset.fileName}">`).join("")}<div id="root"></div><script src="/${script}"></script>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  await createPage();
});

after(async () => {
  releaseStorageReads();
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function createPage({ clock = false } = {}) {
  await page?.close();
  page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1")
      return route.continue();
    return route.abort();
  });
  if (clock) {
    const time = new Date("2026-10-07T05:00:00Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
  }
}

function releaseStorageReads() {
  holdStorageReads = false;
  for (const response of heldStorageResponses) {
    if (!response.destroyed) response.end(JSON.stringify(currentSummary));
  }
  heldStorageResponses = [];
}

async function mount({
  limitMB = null,
  expiredFiles = 3,
  canManage = true,
  error = null,
  data = null,
} = {}) {
  currentSummary = data ?? summary(limitMB, expiredFiles);
  storageError = error;
  mutationSummary = null;
  requests = [];
  unexpected = [];
  pageErrors = [];
  await page.goto(`http://127.0.0.1:${server.address().port}/storage-test`);
  await page.waitForFunction(() => typeof window.mountStorage === "function");
  await page.evaluate((canManage) => window.mountStorage(canManage), canManage);
  await page.getByRole("heading", { name: "Trợ lí Minh" }).waitFor();
  if (error) await page.getByText(error, { exact: false }).first().waitFor();
  else {
    await page.locator(".storage-mongo").waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".storage-loading"),
    );
  }
}

const mutations = () =>
  requests.filter((request) => !["GET", "HEAD"].includes(request.method));
// No script errors and no request the fixture did not expect (the page would show an error toast).
function assertClean() {
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpected, []);
}
const storageReads = () =>
  requests.filter((request) => request.path === "/api/admin/storage");
async function assertReadOnlyLimits() {
  const assistant = page.locator(".storage-assistant");
  assert.equal(
    await assistant.getByRole("spinbutton", { includeHidden: true }).count(),
    0,
  );
  assert.equal(await assistant.getByText(/Điều chỉnh mức theo dõi/).count(), 0);
  assert.equal(
    await assistant
      .getByRole("button", {
        name: /Lưu giới hạn|Bỏ giới hạn|Gói Free 512 MB|Lưu mức cảnh báo R2|Bỏ mức cảnh báo R2/,
        includeHidden: true,
      })
      .count(),
    0,
  );
}

async function openBreakdown() {
  const detail = page.locator("details.storage-breakdown");
  if (!(await detail.evaluate((element) => element.open)))
    await detail.locator("summary").click();
}

async function refresh() {
  const previous = storageReads().length;
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await waitFor(() => storageReads().length > previous);
}

async function waitFor(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for a fixture API request");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("unknown storage quota remains unknown without editable limits or fabricated defaults", async () => {
  await mount();
  await page.getByText("Chưa biết giới hạn", { exact: true }).waitFor();
  const text = await page.locator(".storage-assistant").innerText();
  assert.match(text, /850/);
  assert.match(text, /50/);
  assert.doesNotMatch(text, /Còn lại\s*0\s*MB/);
  assert.doesNotMatch(text, /Mở phần điều chỉnh|Mức theo dõi: 512 MB/);
  await assertReadOnlyLimits();
  await refresh();
  assert.deepEqual(mutations(), []);
  assert.equal(currentSummary.quota.limitMB, null);
  assertClean();
});

test("cluster quota uses the backend remaining bytes and warning level, independent of photo file size", async () => {
  await mount({ limitMB: 60 });
  await page
    .getByText("Chưa biết giới hạn", { exact: true })
    .waitFor({ state: "hidden" });
  const text = await page.locator(".storage-assistant").innerText();
  assert.match(text, /850/);
  assert.match(text, /10\s*MB/);
  assert.match(text, /83/);
  assert.equal(
    await page.locator(".storage-note-warning[role=alert]").count(),
    1,
  );
  assert.match(
    await page.locator(".storage-mongo").innerText(),
    /Mức theo dõi: 60 MB/,
  );
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("failed initial loads show an error and failed refreshes retain explicitly stale measurements", async () => {
  await mount({ error: "Không đọc được dung lượng máy chủ." });
  assert.equal(await page.getByText("850 MB", { exact: true }).count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Dọn ảnh đã hết hạn", exact: true })
      .count(),
    0,
  );
  storageError = null;
  await refresh();
  await page.locator(".storage-mongo").waitFor();
  assert.match(await page.locator(".storage-assistant").innerText(), /850/);
  storageError = "Lần làm mới thất bại.";
  await refresh();
  await page.getByText(storageError, { exact: false }).first().waitFor();
  assert.match(
    await page.locator(".storage-heading .storage-updated").innerText(),
    /Số liệu cũ/,
  );
  assert.match(await page.locator(".storage-assistant").innerText(), /850/);
  assert.equal(
    await page
      .getByRole("button", { name: "Dọn ảnh đã hết hạn", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.locator(".storage-cleanup-reason").innerText(),
    "Cần số liệu mới trước khi dọn. Bấm Làm mới để kiểm tra lại.",
  );
  assert.deepEqual(mutations(), []);
});

test("unavailable database and Atlas statistics preserve file counts and leave remaining quota unknown", async () => {
  await mount({ limitMB: 60 });
  currentSummary.database = {
    available: false,
    name: "storage-test",
    dataBytes: null,
    indexBytes: null,
    usedBytes: null,
    error: "Máy chủ không cho phép đo dung lượng cơ sở dữ liệu.",
  };
  currentSummary.quota = {
    ...currentSummary.quota,
    remainingBytes: null,
    usagePercent: null,
    scope: "unknown",
    level: "unknown",
  };
  currentSummary.cluster = {
    available: false,
    dataBytes: null,
    indexBytes: null,
    usedBytes: null,
    databaseCount: null,
    error: "MongoDB Atlas chưa cung cấp thống kê cluster.",
  };
  await refresh();
  await page.getByText("Chưa đo được MongoDB", { exact: true }).waitFor();
  await openBreakdown();
  assert.equal(
    await page.locator(".storage-mongo .storage-metric").filter({ hasText: "Dung lượng database ứng dụng" }).locator("strong").innerText(),
    "Chưa đo được",
  );
  assert.equal(
    await page
      .getByText(currentSummary.database.error, { exact: true })
      .count(),
    1,
  );
  assert.match(await page.locator(".storage-assistant").innerText(), /850 MB/);
  assert.equal(await page.getByRole("progressbar").count(), 0);
  assert.deepEqual(mutations(), []);
});

function atlasSummary() {
  const data = summary(512);
  data.media = {
    ...data.media,
    bytes: 8 * MB,
    groups: {
      photos: { files: 7, bytes: 4 * MB },
      originals: { files: 7, bytes: 3 * MB },
      printSheets: { files: 3, bytes: MB },
      videos: { files: 0, bytes: 0 },
      other: { files: 0, bytes: 0 },
    },
  };
  data.database = {
    ...data.database,
    dataBytes: 8 * MB,
    indexBytes: 2 * MB,
    usedBytes: 10 * MB,
  };
  data.cluster = {
    available: true,
    dataBytes: 40.75 * MB,
    indexBytes: 4 * MB,
    usedBytes: 44.75 * MB,
    databaseCount: 2,
    error: null,
  };
  data.quota = {
    ...data.quota,
    source: "config",
    remainingBytes: (512 - 44.75) * MB,
    usagePercent: (44.75 / 512) * 100,
    level: "normal",
  };
  return data;
}

test("live Atlas usage includes other databases and updates the captured 512 MB figures from backend responses", async () => {
  await mount({ data: atlasSummary() });
  const atlasMetric = page.locator(".storage-metric").filter({
    hasText: "Dung lượng MongoDB Atlas",
  });
  assert.equal(await atlasMetric.locator("strong").innerText(), "44,75 MB");
  assert.equal(
    await page.locator(".storage-remaining strong").innerText(),
    "467,25 MB",
  );
  assert.equal(
    await page.locator(".storage-capacity strong").innerText(),
    "8,74%",
  );
  const initialProgress = await page
    .getByRole("progressbar")
    .evaluate((element) => element.value);
  assert.ok(Math.abs(initialProgress - (44.75 / 512) * 100) < 1e-9);
  await page
    .getByText("Đọc trực tiếp từ MongoDB Atlas", { exact: false })
    .waitFor();
  assert.match(
    await page.locator(".storage-mongo").innerText(),
    /Mức theo dõi: 512 MB/,
  );
  // An additional database grows while the application's own database stays at 10 MB.
  currentSummary.cluster.dataBytes = 126.5 * MB;
  currentSummary.cluster.indexBytes = 4 * MB;
  currentSummary.cluster.usedBytes = 130.5 * MB;
  currentSummary.quota.remainingBytes = (512 - 130.5) * MB;
  currentSummary.quota.usagePercent = (130.5 / 512) * 100;
  await refresh();
  await page.getByText("130,5 MB", { exact: true }).first().waitFor();
  assert.equal(await atlasMetric.locator("strong").innerText(), "130,5 MB");
  assert.equal(
    await page.locator(".storage-remaining strong").innerText(),
    "381,5 MB",
  );
  assert.equal(
    await page.locator(".storage-capacity strong").innerText(),
    "25,49%",
  );
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("denied or invalid Atlas statistics cannot substitute app database usage for cluster remaining quota", async () => {
  for (const reason of [
    "Không có quyền đọc atlasSize.",
    "Số liệu atlasSize không hợp lệ.",
  ]) {
    const data = atlasSummary();
    data.cluster = {
      available: false,
      dataBytes: null,
      indexBytes: null,
      usedBytes: null,
      databaseCount: null,
      error: reason,
    };
    data.quota = {
      ...data.quota,
      scope: "unknown",
      remainingBytes: null,
      usagePercent: null,
      level: "unknown",
    };
    await mount({ data });
    await page.getByText("Chưa đo được MongoDB", { exact: true }).waitFor();
    const fallbackMetric = page.locator(".storage-mongo .storage-metric").filter({
      hasText: "Dung lượng database ứng dụng",
    });
    assert.equal(await fallbackMetric.locator("strong").innerText(), "10 MB");
    await openBreakdown();
    assert.match(await page.locator(".storage-database-detail").first().innerText(), /Database ứng dụng: 10 MB/);
    assert.equal(await page.getByText(reason, { exact: true }).count(), 1);
    assert.equal(await page.getByRole("progressbar").count(), 0);
    assert.equal(
      await page.locator(".storage-remaining strong").innerText(),
      "Chưa đo được MongoDB",
    );
    assert.deepEqual(mutations(), []);
    assertClean();
  }
});

test("valid Atlas statistics still show cluster remaining quota when app database statistics are unavailable", async () => {
  const data = atlasSummary();
  data.database = {
    ...data.database,
    available: false,
    dataBytes: null,
    indexBytes: null,
    usedBytes: null,
    error: "Không đọc được dbStats của database ứng dụng.",
  };
  await mount({ data });
  assert.equal(
    await page.locator(".storage-remaining strong").innerText(),
    "467,25 MB",
  );
  assert.equal(await page.getByRole("progressbar").count(), 1);
  assert.equal(
    await page.locator(".storage-capacity strong").innerText(),
    "8,74%",
  );
  await openBreakdown();
  assert.equal(
    await page.getByText(data.database.error, { exact: true }).count(),
    1,
  );
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("staff can read storage but cannot alter limits or clean files", async () => {
  await mount({ canManage: false });
  await assertReadOnlyLimits();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Lưu giới hạn",
        exact: true,
        includeHidden: true,
      })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", {
        name: "Dọn ảnh đã hết hạn",
        exact: true,
        includeHidden: true,
      })
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Xem lệnh đã in", includeHidden: true }).count(),
    0,
    "the print queue page is gone, so the assistant no longer links to it",
  );
  await refresh();
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("expired cleanup requires confirmation and posts only the expiry cleanup endpoint", async () => {
  await mount();
  const cleanup = page.getByRole("button", {
    name: "Dọn ảnh đã hết hạn",
    exact: true,
  });
  const canceled = page.waitForEvent("dialog").then(async (dialog) => {
    assert.match(dialog.message(), /hết hạn/);
    assert.match(dialog.message(), /3 file/);
    assert.match(dialog.message(), /12 MB/);
    await dialog.dismiss();
  });
  await cleanup.click();
  await canceled;
  assert.deepEqual(mutations(), []);
  const confirmed = page
    .waitForEvent("dialog")
    .then((dialog) => dialog.accept());
  await cleanup.click();
  await confirmed;
  await waitFor(() => mutations().length === 1);
  assert.equal(mutations()[0].method, "POST");
  assert.equal(mutations()[0].path, "/api/admin/storage/cleanup-expired");
  assert.equal(mutations()[0].body, null);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Dọn ảnh đã hết hạn"),
      )?.disabled,
  );
  assert.match(await page.locator(".storage-assistant").innerText(), /838/);
  assertClean();
});

test("no expired files disables cleanup while refreshes retain the configured limit", async () => {
  await mount({ limitMB: 60, expiredFiles: 0 });
  assert.equal(
    await page
      .getByRole("button", { name: "Dọn ảnh đã hết hạn", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.locator(".storage-cleanup-reason").innerText(),
    "Chưa có file hết hạn cần dọn.",
  );
  const mongo = page.locator(".storage-mongo");
  assert.match(await mongo.innerText(), /Mức theo dõi: 60 MB/);
  const previous = storageReads().length;
  await page.evaluate(() => window.dispatchEvent(new Event("nxc:print")));
  await waitFor(() => storageReads().length > previous);
  await page.waitForTimeout(100);
  assert.match(await mongo.innerText(), /Mức theo dõi: 60 MB/);
  await refresh();
  await page.waitForTimeout(100);
  assert.match(await mongo.innerText(), /Mức theo dõi: 60 MB/);
  await assertReadOnlyLimits();
  assert.deepEqual(mutations(), []);
});

test("storage assistant fits narrow phones and desktop widths with the production styles", async () => {
  await mount({ limitMB: 60 });
  await openBreakdown();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      storage: document
        .querySelector(".storage-assistant")
        .getBoundingClientRect().right,
    }));
    assert.ok(
      layout.document <= layout.viewport + 1,
      `horizontal page overflow at ${width}px: ${JSON.stringify(layout)}`,
    );
    assert.ok(
      layout.storage <= layout.viewport + 1,
      `assistant exceeds viewport at ${width}px`,
    );
    if (process.env.STORAGE_SCREENSHOTS) {
      await mkdir(process.env.STORAGE_SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: join(process.env.STORAGE_SCREENSHOTS, `storage-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  assertClean();
});

function clusterSummary(usedMB, limitMB = 512) {
  const data = atlasSummary();
  data.cluster.dataBytes = (usedMB - 4) * MB;
  data.cluster.usedBytes = usedMB * MB;
  data.quota = {
    ...data.quota,
    limitMB,
    limitBytes: limitMB * MB,
    remainingBytes: Math.max(0, limitMB - usedMB) * MB,
    usagePercent: (usedMB / limitMB) * 100,
    level:
      usedMB / limitMB >= 0.9
        ? "critical"
        : usedMB / limitMB >= 0.8
          ? "warning"
          : "normal",
  };
  return data;
}

async function mountAdmin({
  data = atlasSummary(),
  error = null,
  role = "admin",
  permissions,
  signedIn = true,
  clock = false,
} = {}) {
  releaseStorageReads();
  await createPage({ clock });
  currentSummary = data;
  storageError = error;
  authRole = role;
  authPermissions = permissions;
  authError = !signedIn;
  mutationSummary = null;
  requests = [];
  unexpected = [];
  pageErrors = [];
  await page.goto(`http://127.0.0.1:${server.address().port}/admin-test`);
  await page.waitForFunction(() => typeof window.mountAdmin === "function");
  const storageResponse = signedIn
    ? page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/admin/storage",
      )
    : null;
  await page.evaluate(() => window.mountAdmin());
  if (signedIn) {
    await page.getByRole("navigation", { name: "Quản lý studio" }).waitFor();
    await storageResponse;
    await page.waitForTimeout(60);
  } else
    await page
      .getByRole("button", { name: "Đăng nhập", exact: true })
      .waitFor();
}

const warning = () => page.locator(".storage-warning");
const assistantCTA = () =>
  page.getByRole("button", {
    name: "Mở trợ lí để dọn ảnh",
    exact: true,
  });
const navButton = (name) =>
  page
    .getByRole("navigation", { name: "Quản lý studio" })
    .getByRole("button", { name, exact: true });
const ADMIN_PAGES = [
  "Thống kê doanh thu",
  "Đơn hàng",
  "Quản lý máy",
  "Màn hình chờ",
  "Chủ đề",
  "Khung ảnh",
  "Khổ ảnh & bảng giá",
  "Nhãn dán",
  "Quản lý filter",
  "Màu in RX1",
  "Tài khoản",
  "Tổng hợp",
];

test("the admin sets how long guests have to pick photos, and Ca trực / Đối soát are gone", async () => {
  await mountAdmin();
  assert.equal(await navButton("Đối soát").count(), 0);
  assert.equal(await page.getByText("Ca trực", { exact: true }).count(), 0, "no shift panel on the overview");
  await navButton("Chữ trên máy chụp").click();
  const time = page.getByRole("region", { name: "Thời gian chọn ảnh" });
  await time.getByText("= 2 phút 30 giây · đang dùng: 2 phút 30 giây").waitFor();
  const save = time.getByRole("button", { name: "Lưu thời gian" });
  assert.equal(await save.isDisabled(), true, "nothing to save yet");
  await time.getByLabel("Số giây (30–900)").fill("20");
  await time.getByText("Nhập số giây từ 30 đến 900.").waitFor();
  assert.equal(await save.isDisabled(), true);
  await time.getByRole("button", { name: "4 phút", exact: true }).click();
  assert.equal(await time.getByLabel("Số giây (30–900)").inputValue(), "240");
  await save.click();
  await time.getByText("= 4 phút · đang dùng: 4 phút").waitFor();
  assert.deepEqual(requests.filter((r) => r.method === "PUT").map((r) => [r.path, r.body]),
    [["/api/admin/settings/select-time", { selectSeconds: 240 }]]);
  assertClean();
});

test("RX1 color controls are admin-only even when staff have every delegated permission", async () => {
  await mountAdmin();
  await navButton("Màu in RX1").click();
  await page.getByLabel("Độ tối bản in (gamma)").waitFor();
  assert.equal(await page.getByRole("button", { name: "Lưu cấu hình màu in", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Tải công cụ mở driver", exact: true }).count(), 1);
  assertClean();
  await mountAdmin({ role: "staff", permissions: ["revenue:view", "orders:export", "orders:cancel", "print:operate", "rooms:setup"] });
  assert.equal(await navButton("Màu in RX1").count(), 0);
  assert.equal(await page.getByLabel("Độ tối bản in (gamma)").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Tải công cụ mở driver", exact: true }).count(), 0);
  assert.equal(requests.some((entry) => entry.path === "/api/admin/settings/rx1-output"), false);
  assertClean();
});

async function pollOnce({ failing = false } = {}) {
  const previous = storageReads().length;
  await page.clock.fastForward(30000);
  await waitFor(() => storageReads().length > previous);
  // A failed read is retried once after a short pause (src/network.js); the paused test
  // clock must move for that pause to end before the failure reaches the screen.
  if (failing) await settleRetry(previous + 2);
}

async function settleRetry(count) {
  const deadline = Date.now() + 5000;
  while (storageReads().length < count) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for the automatic retry");
    await page.clock.fastForward(250);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("real admin warns at 80%, becomes critical at 90%, and reports full capacity at 100%", async () => {
  for (const [usedMB, severity, title, remaining] of [
    [79.99, null, null, null],
    [80, "warning", "Dung lượng lưu trữ gần đầy", "20"],
    [89.99, "warning", "Dung lượng lưu trữ gần đầy", "10,01"],
    [90, "critical", "Dung lượng lưu trữ sắp đầy", "10"],
    [100, "critical", "Dung lượng lưu trữ đã đầy", "0"],
    [105, "critical", "Dung lượng lưu trữ đã đầy", "0"],
  ]) {
    await mountAdmin({ data: clusterSummary(usedMB, 100) });
    if (!severity) assert.equal(await warning().count(), 0);
    else {
      await page.locator(`.storage-warning-${severity}[role=alert]`).waitFor();
      assert.equal(await warning().locator("strong").innerText(), title);
      assert.match(
        await warning().innerText(),
        new RegExp(`Còn ${remaining} MB`),
      );
      assert.equal(await warning().getAttribute("aria-atomic"), "true");
    }
    assert.equal(storageReads().length, 1);
    assert.deepEqual(mutations(), []);
    assertClean();
  }
});

test("warning persists across every admin page and its action opens the controlled storage assistant without a second monitor", async () => {
  await mountAdmin({ data: clusterSummary(460.8) });
  assert.equal(await navButton("Nhật ký hoạt động").count(), 0);
  await page.locator(".storage-warning-critical[role=alert]").waitFor();
  assert.match(
    await warning().innerText(),
    /460,8 \/ 512 MB \(90%\).*Còn 51,2 MB/s,
  );
  for (const name of ADMIN_PAGES) {
    await navButton(name).click();
    await page.locator(".admin-header h2").filter({ hasText: name }).waitFor();
    assert.equal(await warning().count(), 1, `warning disappeared on ${name}`);
  }
  const initialReads = storageReads().length;
  await assistantCTA().click();
  await page
    .getByRole("heading", { name: "Trợ lí Minh", exact: true })
    .waitFor();
  // The warning button opens the assistant's page ("Dung lượng ảnh", also in the menu).
  assert.equal(
    await page.locator(".admin-header h2").innerText(),
    "Dung lượng ảnh",
  );
  assert.equal(await warning().count(), 1);
  assert.equal(
    storageReads().length,
    initialReads,
    "assistant must reuse the global monitor result",
  );
  await navButton("Đơn hàng").click();
  await page.locator(".admin-header h2").filter({ hasText: "Đơn hàng" }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Trợ lí Minh" }).count(),
    0,
  );
  assert.equal(await warning().count(), 1);
  await assistantCTA().click();
  await page
    .getByRole("heading", { name: "Trợ lí Minh", exact: true })
    .waitFor();
  assert.equal(storageReads().length, initialReads);
  assert.equal(
    requests.some((request) => request.path.startsWith("/api/admin/audit")),
    false,
    "admin navigation must never request the removed activity log",
  );
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("global monitoring automatically shows and clears warnings every 30 seconds while ordinary admin pages remain open", async () => {
  await mountAdmin({ data: clusterSummary(400), clock: true });
  assert.equal(await warning().count(), 0);
  assert.equal(storageReads().length, 1);
  currentSummary = clusterSummary(420);
  await pollOnce();
  await page.locator(".storage-warning-warning[role=alert]").waitFor();
  assert.match(await warning().innerText(), /Còn 92 MB/);
  assert.equal(storageReads().length, 2);
  await navButton("Đơn hàng").click();
  currentSummary = clusterSummary(480);
  await pollOnce();
  await page.locator(".storage-warning-critical[role=alert]").waitFor();
  assert.match(await warning().innerText(), /Còn 32 MB/);
  assert.equal(storageReads().length, 3);
  currentSummary = clusterSummary(300);
  await pollOnce();
  await warning().waitFor({ state: "hidden" });
  assert.equal(storageReads().length, 4);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("hidden pages stop storage polling and becoming visible immediately refreshes the global warning", async () => {
  await mountAdmin({ data: clusterSummary(400), clock: true });
  await page.evaluate(() => {
    window.testDocumentHidden = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => window.testDocumentHidden,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  currentSummary = clusterSummary(500);
  await page.clock.fastForward(90000);
  await page.waitForTimeout(50);
  assert.equal(storageReads().length, 1);
  assert.equal(await warning().count(), 0);
  await page.evaluate(() => {
    window.testDocumentHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() => storageReads().length === 2);
  await page.locator(".storage-warning-critical[role=alert]").waitFor();
  assert.match(await warning().innerText(), /Còn 12 MB/);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("unavailable or malformed Atlas measurements produce an unknown state without invented remaining capacity", async () => {
  const unavailable = clusterSummary(500);
  unavailable.cluster = {
    ...unavailable.cluster,
    available: false,
    usedBytes: null,
  };
  unavailable.quota = {
    ...unavailable.quota,
    scope: "unknown",
    remainingBytes: null,
    usagePercent: null,
    level: "unknown",
  };
  const malformed = clusterSummary(500);
  malformed.cluster.usedBytes = "500 MB";
  // A bad quota must not be displayed just because the backend supplied a warning level.
  const malformedQuota = clusterSummary(500);
  malformedQuota.quota.remainingBytes = -1;
  for (const data of [unavailable, malformed, malformedQuota]) {
    await mountAdmin({ data });
    await page.locator(".storage-warning-unknown[role=status]").waitFor();
    assert.equal(
      await warning().locator("strong").innerText(),
      "Chưa kiểm tra được dung lượng lưu trữ",
    );
    assert.doesNotMatch(await warning().innerText(), /Còn .* MB/);
    assert.equal(await page.locator(".storage-warning[role=alert]").count(), 0);
    assert.deepEqual(mutations(), []);
    assertClean();
  }
  await mountAdmin({ data: summary(null) });
  assert.equal(
    await warning().count(),
    0,
    "an unconfigured quota cannot be compared to a storage limit",
  );
});

test("failed global refresh retains the prior warning with a stale label and recovers on the next successful measurement", async () => {
  await mountAdmin({ data: clusterSummary(480), clock: true });
  await page.locator(".storage-warning-critical[role=alert]").waitFor();
  storageError = "Fixture storage service unavailable.";
  await pollOnce({ failing: true });
  await warning()
    .getByText(/Số liệu cũ/)
    .waitFor();
  assert.match(await warning().innerText(), /Còn 32 MB/);
  assert.equal(
    await page.locator(".storage-warning-critical[role=alert]").count(),
    1,
  );
  storageError = null;
  currentSummary = clusterSummary(420);
  await pollOnce();
  await page.locator(".storage-warning-warning[role=alert]").waitFor();
  assert.doesNotMatch(await warning().innerText(), /Số liệu cũ/);
  assert.match(await warning().innerText(), /Còn 92 MB/);
  currentSummary = clusterSummary(300);
  await pollOnce();
  await warning().waitFor({ state: "hidden" });
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("an initial monitor failure is visible on the admin homepage and never claims storage is healthy", async () => {
  await mountAdmin({ error: "Fixture cannot connect to Atlas." });
  await page.locator(".storage-warning-unknown[role=status]").waitFor();
  assert.equal(
    await warning().locator("strong").innerText(),
    "Chưa kiểm tra được dung lượng lưu trữ",
  );
  assert.doesNotMatch(await warning().innerText(), /Còn .* MB/);
  await assistantCTA().click();
  await page
    .getByRole("heading", { name: "Trợ lí Minh", exact: true })
    .waitFor();
  await page.getByText(storageError, { exact: false }).first().waitFor();
  assert.equal(
    await page.locator(".storage-expiry").count(),
    0,
    "without a measurement there is no image expiry to show",
  );
  // The first read and its one automatic retry; nothing else.
  assert.equal(storageReads().length, 2);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("expired cleanup publishes updated warnings immediately even while subsequent refresh requests are pending", async () => {
  await mountAdmin({ data: clusterSummary(90, 100) });
  await page.locator(".storage-warning-critical[role=alert]").waitFor();
  await assistantCTA().click();
  await page
    .getByRole("heading", { name: "Trợ lí Minh", exact: true })
    .waitFor();
  assert.equal(storageReads().length, 1);
  holdStorageReads = true;
  mutationSummary = clusterSummary(70, 100);
  mutationSummary.expired = { files: 0, photos: 0, printJobs: 0, bytes: 0 };
  const confirmed = page
    .waitForEvent("dialog")
    .then((dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Dọn ảnh đã hết hạn", exact: true })
    .click();
  await confirmed;
  await warning().waitFor({ state: "hidden" });
  assert.equal(mutations().length, 1);
  assert.equal(mutations()[0].path, "/api/admin/storage/cleanup-expired");
  assert.equal(
    await page.locator(".storage-remaining strong").innerText(),
    "30 MB",
  );
  assert.match(
    await page.locator(".storage-mongo").innerText(),
    /Mức theo dõi: 100 MB/,
  );
  releaseStorageReads();
  await page
    .getByRole("button", { name: "Dọn ảnh đã hết hạn", exact: true })
    .waitFor();
  assertClean();
});

test("staff also receive the global warning while unauthenticated visitors never start storage monitoring", async () => {
  await mountAdmin({ data: clusterSummary(480), role: "staff" });
  await page.locator(".storage-warning-critical[role=alert]").waitFor();
  await assistantCTA().click();
  await page
    .getByRole("heading", { name: "Trợ lí Minh", exact: true })
    .waitFor();
  await assertReadOnlyLimits();
  assert.equal(
    await page
      .getByRole("button", { name: "Dọn ảnh đã hết hạn", exact: true })
      .count(),
    0,
  );
  assert.equal(storageReads().length, 1);
  assert.deepEqual(mutations(), []);
  assertClean();
  await mountAdmin({ signedIn: false });
  assert.equal(await warning().count(), 0);
  assert.equal(storageReads().length, 0);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("every admin page fits a 320 px phone while the storage warning is showing", async () => {
  await mountAdmin({ data: clusterSummary(460.8) });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.locator(".storage-warning-critical[role=alert]").waitFor();
  const overflowing = [];
  for (const name of ADMIN_PAGES) {
    // On a phone the menu is folded away: open it, then pick the page.
    await page.getByRole("button", { name: "Menu quản lý", exact: true }).click();
    await navButton(name).click();
    await page.locator(".admin-header h2").filter({ hasText: name }).waitFor();
    await page.waitForTimeout(50);
    const layout = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      return {
        document: document.documentElement.scrollWidth,
        viewport,
        wide: [...document.querySelectorAll(".admin-main *")]
          .filter((element) => element.getBoundingClientRect().right > viewport + 1)
          .slice(0, 6)
          .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
      };
    });
    if (layout.document > layout.viewport + 1) overflowing.push({ page: name, ...layout });
  }
  assert.deepEqual(overflowing, []);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("global warning and its action fit narrow mobile and desktop layouts", async () => {
  await mountAdmin({ data: clusterSummary(480) });
  await page.locator(".storage-warning-critical[role=alert]").waitFor();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      warning: document
        .querySelector(".storage-warning")
        .getBoundingClientRect().right,
      warningTop: document
        .querySelector(".storage-warning")
        .getBoundingClientRect().top,
      contentTop: document
        .querySelector(".admin-content")
        .getBoundingClientRect().top,
      action: document
        .querySelector(".storage-warning button")
        .getBoundingClientRect().right,
      wide: [...document.querySelectorAll(".admin-shell *")]
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 6)
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
    }));
    assert.ok(
      layout.document <= layout.viewport + 1,
      `horizontal admin overflow at ${width}px: ${JSON.stringify(layout)}`,
    );
    assert.ok(layout.warning <= layout.viewport + 1);
    assert.ok(layout.action <= layout.viewport + 1);
    // The warning is a note at the top of every page (the Mellow theme does not pin it while scrolling).
    assert.ok(
      layout.warningTop >= layout.contentTop - 1 && layout.warningTop < 400,
      `warning is not at the top of the page at ${width}px: ${JSON.stringify(layout)}`,
    );
    if (process.env.STORAGE_SCREENSHOTS) {
      await page.screenshot({
        path: join(process.env.STORAGE_SCREENSHOTS, `warning-${width}.png`),
        fullPage: true,
      });
    }
  }
  assert.deepEqual(mutations(), []);
  assertClean();
});

const retentionClock = Date.parse("2026-10-07T05:00:00Z");
// The nearest stored image deadline is in the assistant's expiry panel.
const nearestImage = () =>
  page
    .locator(".storage-lifecycle")
    .getByLabel("Ảnh sắp xoá gần nhất", { exact: true });
const expiryLabel = () => nearestImage().locator("strong");

// These tests open the assistant from the storage warning, so their summaries are near the limit.
async function openAssistant() {
  await assistantCTA().click();
  await page
    .getByRole("heading", { name: "Trợ lí Minh", exact: true })
    .waitFor();
}

async function assertRetentionFits() {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      countdown: document
        .querySelector(".storage-expiry")
        .getBoundingClientRect().right,
    }));
    assert.ok(
      layout.document <= layout.viewport + 1,
      `retention page overflow at ${width}px: ${JSON.stringify(layout)}`,
    );
    assert.ok(
      layout.countdown <= layout.viewport + 1,
      `retention countdown exceeds viewport at ${width}px`,
    );
  }
}

function imageRetentionSummary(minutes) {
  const data = clusterSummary(460.8);
  data.retention = {
    nextImageExpiresAt:
      minutes === null
        ? null
        : new Date(retentionClock + minutes * 60000).toISOString(),
  };
  return data;
}

test("nearest stored image deadline comes from shared storage data and counts down with the clock", async () => {
  const data = imageRetentionSummary(120);
  data.checkedAt = new Date(retentionClock).toISOString();
  await mountAdmin({ data, clock: true });
  await openAssistant();
  await nearestImage().waitFor();
  assert.equal(await expiryLabel().innerText(), "2 giờ 00 phút");
  assert.match(await nearestImage().innerText(), /Hết hạn lúc 14:00 07\/10\/2026/);
  assert.match(
    await page.locator(".storage-heading .storage-updated").innerText(),
    /12:00 07\/10\/2026/,
  );
  await assertRetentionFits();
  assert.equal(storageReads().length, 1, "the assistant reuses the storage monitor");
  await page.clock.fastForward(15000);
  assert.equal(
    storageReads().length,
    1,
    "the local expiry countdown cannot introduce a storage poll",
  );
  await page.clock.fastForward(45000);
  await page.waitForFunction(
    () =>
      document.querySelector(".storage-expiry strong")?.textContent ===
      "1 giờ 59 phút",
  );
  assert.equal(
    storageReads().length,
    2,
    "the assistant reuses the provider's 30-second monitor",
  );
  assert.match(await nearestImage().innerText(), /Hết hạn lúc 14:00 07\/10\/2026/);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("nearest image countdown distinguishes overdue files, no stored images, and unavailable deadline measurements", async () => {
  const missing = imageRetentionSummary(120);
  delete missing.retention;
  const invalid = imageRetentionSummary(120);
  invalid.retention.nextImageExpiresAt = "invalid-date";
  for (const [data, expected] of [
    [imageRetentionSummary(-1), "Đã hết hạn, chờ dọn"],
    [imageRetentionSummary(null), "Chưa có ảnh đang lưu"],
    [missing, "Chưa lấy được hạn xoá ảnh"],
    [invalid, "Chưa lấy được hạn xoá ảnh"],
  ]) {
    await mountAdmin({ data, clock: true });
    await openAssistant();
    await nearestImage().waitFor();
    assert.equal(await expiryLabel().innerText(), expected);
    await assertRetentionFits();
    assert.equal(storageReads().length, 1);
    assert.deepEqual(mutations(), []);
    assertClean();
  }
});

test("failed retention refresh keeps the measured deadline labeled stale and recovers with a new deadline", async () => {
  await mountAdmin({ data: imageRetentionSummary(120), clock: true });
  await openAssistant();
  await nearestImage().waitFor();
  storageError = "Fixture retention measurement temporarily unavailable.";
  await pollOnce({ failing: true });
  await nearestImage().getByText(/Số liệu cũ/).waitFor();
  assert.equal(await expiryLabel().innerText(), "2 giờ 00 phút");
  await pollOnce({ failing: true });
  await page.waitForFunction(
    () =>
      document.querySelector(".storage-expiry strong")?.textContent ===
      "1 giờ 59 phút",
  );
  storageError = null;
  currentSummary = imageRetentionSummary(240);
  await pollOnce();
  await page.waitForFunction(
    () =>
      document.querySelector(".storage-expiry strong")?.textContent ===
      "3 giờ 59 phút",
  );
  assert.equal(await nearestImage().getByText(/Số liệu cũ/).count(), 0);
  assert.deepEqual(mutations(), []);
  assertClean();
});

function r2Summary(usedGB = 1, limitGB = 10) {
  const data = clusterSummary(44.75);
  const usedBytes = usedGB * 1e9;
  data.r2 = {
    active: true,
    configured: true,
    available: true,
    bucket: "test-media",
    error: null,
    usedBytes,
    files: 120,
    quota: {
      limitGB,
      limitBytes: limitGB * 1e9,
      remainingBytes: Math.max(0, limitGB * 1e9 - usedBytes),
      usagePercent: (usedGB / limitGB) * 100,
      level:
        usedGB / limitGB >= 0.9
          ? "critical"
          : usedGB / limitGB >= 0.8
            ? "warning"
            : "normal",
    },
  };
  data.media.available = true;
  data.media.stores = {
    gridfs: { files: 17, bytes: data.media.bytes },
    r2: { files: 120, bytes: usedBytes },
  };
  data.media.bytes += usedBytes;
  data.media.files += 120;
  data.media.groups.photos.bytes += usedBytes;
  data.media.groups.photos.files += 120;
  return data;
}

test("R2 warnings use their own budget at 80/90 percent while MongoDB remains below its limit", async () => {
  for (const [usedGB, severity] of [
    [7.99, null],
    [8, "warning"],
    [9, "critical"],
    [11, "critical"],
  ]) {
    await mountAdmin({ data: r2Summary(usedGB) });
    if (!severity) assert.equal(await warning().count(), 0);
    else {
      await page
        .locator(".storage-warning-" + severity + "[role=alert]")
        .waitFor();
      assert.match(await warning().innerText(), /Kho ảnh R2 gần mức cảnh báo/);
      assert.match(
        await warning().innerText(),
        /phí R2 còn phụ thuộc sử dụng trong tháng/,
      );
      await assistantCTA().click();
      await page
        .getByRole("heading", { name: "Kho ảnh Cloudflare R2" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("progressbar", { name: "Phần trăm dung lượng kho ảnh R2" })
          .count(),
        1,
      );
    }
    assertClean();
    assert.deepEqual(mutations(), []);
  }
});

test("admins see the configured R2 and MongoDB limits without adjustment controls or storage mutations", async () => {
  await mount({ data: r2Summary() });
  await assertReadOnlyLimits();
  assert.match(
    await page.locator(".storage-r2").innerText(),
    /Mức theo dõi: 10 GB/,
  );
  assert.equal(
    await page.locator(".storage-r2-remaining strong").innerText(),
    "9 GB",
  );
  assert.match(
    await page.locator(".storage-mongo").innerText(),
    /Mức theo dõi: 512 MB/,
  );
  assert.equal(
    await page.locator(".storage-mongo .storage-remaining strong").innerText(),
    "467,25 MB",
  );
  await refresh();
  assert.match(
    await page.locator(".storage-r2").innerText(),
    /Mức theo dõi: 10 GB/,
  );
  assert.match(
    await page.locator(".storage-mongo").innerText(),
    /Mức theo dõi: 512 MB/,
  );
  assert.equal(currentSummary.r2.quota.limitGB, 10);
  assert.equal(currentSummary.quota.limitMB, 512);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("R2 outages show unknown storage and expiry without inventing empty data or allowing cleanup", async () => {
  const data = r2Summary();
  data.r2.available = false;
  data.r2.usedBytes = null;
  data.r2.error = "Không đọc được kho ảnh R2.";
  data.r2.quota.remainingBytes = data.r2.quota.usagePercent = null;
  data.media.available = false;
  data.retention = { available: false, nextImageExpiresAt: null };
  await mountAdmin({ data });
  await warning().waitFor();
  assert.match(await warning().innerText(), /Chưa kiểm tra được kho ảnh R2/);
  await assistantCTA().click();
  await page.locator(".storage-breakdown summary").getByText("Số liệu chưa đầy đủ", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Dọn ảnh đã hết hạn", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.locator(".storage-cleanup-reason").innerText(),
    "Chưa đo đủ kho ảnh. Chờ kết nối lại rồi mới dọn.",
  );
  assert.equal(
    await page
      .getByRole("progressbar", { name: "Phần trăm dung lượng kho ảnh R2" })
      .count(),
    0,
  );
  assert.equal(await expiryLabel().innerText(), "Chưa lấy được hạn xoá ảnh");
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("R2 storage fits phones and staff cannot edit budgets", async () => {
  await mount({ data: r2Summary(9), canManage: false });
  assert.equal(await page.getByRole("spinbutton", { includeHidden: true }).count(), 0);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    assert.ok(
      layout.content <= layout.width + 1,
      "R2 storage overflow at " + width + "px",
    );
  }
  assertClean();
});

test("active R2 leads the photo area while MongoDB capacity and collapsed file totals stay separate", async () => {
  await mount({ data: r2Summary() });
  const r2 = page.locator(".storage-photo-area .storage-r2");
  const lifecycle = page.locator(".storage-photo-area .storage-lifecycle");
  assert.equal(await r2.count(), 1);
  assert.equal(await lifecycle.count(), 1);
  assert.ok(
    await r2.evaluate((element) =>
      Boolean(
        element.compareDocumentPosition(
          document.querySelector(".storage-lifecycle"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ),
    "the R2 photo measurement must precede the expiry and cleanup area",
  );
  assert.ok(
    await page
      .locator(".storage-photo-area")
      .evaluate((element) =>
        Boolean(
          element.compareDocumentPosition(
            document.querySelector(".storage-mongo"),
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
    "MongoDB capacity follows the photo storage area",
  );
  assert.equal(
    await r2
      .locator(".storage-r2-metrics article")
      .first()
      .locator("strong")
      .innerText(),
    "1 GB",
  );
  assert.match(
    await r2
      .locator(".storage-r2-metrics article")
      .first()
      .locator("small")
      .innerText(),
    /953,67 MB/,
  );
  assert.match(await r2.innerText(), /Còn trong mức theo dõi/);
  const mongo = page.locator(".storage-mongo");
  assert.equal(
    await mongo
      .locator(".storage-metric")
      .filter({ hasText: "Dung lượng MongoDB Atlas" })
      .locator("strong")
      .innerText(),
    "44,75 MB",
  );
  assert.match(
    await mongo.locator(".storage-remaining > span").innerText(),
    /MongoDB/,
  );
  assert.equal(
    await mongo.locator(".storage-remaining strong").innerText(),
    "467,25 MB",
  );
  const breakdown = page.locator("details.storage-breakdown");
  assert.equal(await breakdown.evaluate((element) => element.open), false);
  assert.match(
    await breakdown.locator("summary").innerText(),
    /Chi tiết ảnh đang lưu/,
  );
  assert.match(await breakdown.locator("summary").innerText(), /961,67 MB/);
  assert.match(await breakdown.locator("summary").innerText(), /137 file/);
  assert.equal(await breakdown.locator("dl").isVisible(), false);
  assert.equal(
    await breakdown.locator(".storage-database-detail").first().isVisible(),
    false,
  );
  await assertReadOnlyLimits();
  assert.equal(storageReads().length, 1);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("native file details expand and collapse by keyboard without extra storage requests", async () => {
  await mount({ data: r2Summary() });
  const breakdown = page.locator("details.storage-breakdown");
  assert.equal(await breakdown.evaluate((element) => element.open), false);
  await breakdown.locator("summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await breakdown.evaluate((element) => element.open), true);
  assert.equal(await breakdown.locator("dl").isVisible(), true);
  assert.match(
    await breakdown.locator(".storage-database-detail").first().innerText(),
    /Database ứng dụng: 10 MB/,
  );
  await breakdown.locator("summary").focus();
  await page.keyboard.press("Space");
  assert.equal(await breakdown.evaluate((element) => element.open), false);
  assert.equal(await breakdown.locator("dl").isVisible(), false);
  assert.equal(storageReads().length, 1);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("available flags with missing or invalid usage never invent zero R2 or MongoDB usage", async () => {
  for (const usedBytes of [null, "invalid bytes", -1]) {
    const data = r2Summary();
    data.r2.usedBytes = usedBytes;
    data.cluster.usedBytes = usedBytes;
    data.database.usedBytes = usedBytes;
    await mount({ data });
    const r2Used = page.locator(".storage-r2-metrics article").first().locator("strong");
    assert.equal(await r2Used.innerText(), "Chưa đo được");
    const mongoUsed = page.locator(".storage-mongo .storage-metric").filter({
      hasText: "Dung lượng database ứng dụng",
    }).locator("strong");
    assert.equal(await mongoUsed.innerText(), "Chưa đo được");
    assert.equal(await page.locator(".storage-mongo .storage-remaining strong").innerText(), "Chưa đo được MongoDB");
    assert.equal(await page.getByRole("progressbar").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Dọn ảnh đã hết hạn", exact: true }).isDisabled(), true);
    assert.equal(await page.locator(".storage-cleanup-reason").innerText(), "Chưa đo đủ kho ảnh. Chờ kết nối lại rồi mới dọn.");
    await openBreakdown();
    const databaseText = await page.locator(".storage-database-detail").filter({ hasText: "Database ứng dụng:" }).innerText();
    assert.doesNotMatch(databaseText, /Database ứng dụng: (?:0 MB|NaN|-[\d,]+ MB)/);
    assert.doesNotMatch(await page.locator(".storage-mongo").innerText(), /NaN/);
    assert.doesNotMatch(await page.locator(".storage-r2").innerText(), /NaN/);
    assert.equal(storageReads().length, 1);
    assert.deepEqual(mutations(), []);
    assertClean();
  }
});

test("small R2 usage keeps its actual MB measurement visible", async () => {
  await mount({ data: r2Summary(MB / 1e9) });
  assert.equal(await page.locator(".storage-r2-used strong").innerText(), "1 MB");
  assert.doesNotMatch(await page.locator(".storage-r2-used").innerText(), /(?:^|\s)0 GB/);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("missing R2 file counts leave combined totals incomplete and block expired cleanup", async () => {
  for (const files of [null, "invalid count"]) {
    const data = r2Summary();
    data.r2.files = files;
    await mount({ data });
    assert.match(await page.locator(".storage-breakdown summary").innerText(), /Số liệu chưa đầy đủ/);
    assert.equal(await page.locator(".storage-reclaim strong").innerText(), "Chưa đo đủ");
    assert.equal(await page.getByRole("button", { name: "Dọn ảnh đã hết hạn", exact: true }).isDisabled(), true);
    assert.equal(await page.locator(".storage-cleanup-reason").innerText(), "Chưa đo đủ kho ảnh. Chờ kết nối lại rồi mới dọn.");
    assert.equal(storageReads().length, 1);
    assert.deepEqual(mutations(), []);
    assertClean();
  }
});

test("unavailable retention with a valid date stays unknown in the assistant", async () => {
  const data = r2Summary(9);
  data.retention = {
    available: false,
    nextImageExpiresAt: new Date(retentionClock + 120 * 60000).toISOString(),
  };
  await mountAdmin({ data, clock: true });
  await openAssistant();
  await nearestImage().waitFor();
  assert.equal(await expiryLabel().innerText(), "Chưa lấy được hạn xoá ảnh");
  assert.doesNotMatch(await nearestImage().innerText(), /Hết hạn lúc|14:00|2 giờ/);
  assert.equal(storageReads().length, 1);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("refreshes reflect backend MongoDB limits without changing the independent R2 budget", async () => {
  await mount({ data: r2Summary(8, 10) });
  currentSummary.quota = {
    ...currentSummary.quota,
    limitMB: 768,
    limitBytes: 768 * MB,
    remainingBytes: (768 - 44.75) * MB,
    usagePercent: (44.75 / 768) * 100,
  };
  await refresh();
  await page.waitForFunction(
    () =>
      document.querySelector(".storage-mongo .storage-remaining strong")
        ?.textContent === "723,25 MB",
  );
  assert.match(
    await page.locator(".storage-mongo").innerText(),
    /Mức theo dõi: 768 MB/,
  );
  assert.match(
    await page.locator(".storage-r2").innerText(),
    /Mức theo dõi: 10 GB/,
  );
  assert.equal(
    await page.locator(".storage-r2-remaining strong").innerText(),
    "2 GB",
  );
  assert.equal(currentSummary.r2.quota.limitGB, 10);
  assert.equal(currentSummary.r2.usedBytes, 8e9);
  assert.equal(currentSummary.quota.limitMB, 768);
  await assertReadOnlyLimits();
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("active R2 admin assistant keeps readable limits at all target widths with file details expanded", async () => {
  // The assistant only opens from a storage warning, so both states are near the R2 budget.
  for (const [state, usedGB] of [
    ["warning", 8.5],
    ["critical", 9],
  ]) {
    await mountAdmin({ data: r2Summary(usedGB) });
    await openAssistant();
    await page.locator(".storage-photo-area").waitFor();
    assert.equal(
      await page.locator(".toast-error").count(),
      0,
      "the admin fixture must not inject unrelated API errors",
    );
    await assertReadOnlyLimits();
    assert.equal(
      await page
        .locator("details.storage-breakdown")
        .evaluate((element) => element.open),
      false,
    );
    if (process.env.STORAGE_SCREENSHOTS) {
      await mkdir(process.env.STORAGE_SCREENSHOTS, { recursive: true });
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: join(
            process.env.STORAGE_SCREENSHOTS,
            `assistant-r2-${state}-default-${width}.png`,
          ),
          fullPage: true,
        });
      }
    }
    await openBreakdown();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const layout = await page.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        return {
          viewport,
          document: document.documentElement.scrollWidth,
          controls: [
            ...document.querySelectorAll(
              ".storage-assistant input, .storage-assistant button, .storage-assistant summary",
            ),
          ].map((element) => {
            const box = element.getBoundingClientRect();
            return {
              label: element.textContent || element.id,
              left: box.left,
              right: box.right,
            };
          }),
        };
      });
      assert.ok(
        layout.document <= layout.viewport + 1,
        `${state} R2 assistant overflows ${width}px: ${JSON.stringify(layout)}`,
      );
      for (const control of layout.controls)
        assert.ok(
          control.left >= -1 && control.right <= layout.viewport + 1,
          `control exceeds ${width}px viewport: ${JSON.stringify(control)}`,
        );
      assert.equal(
        await page
          .locator(".storage-r2-remaining")
          .getByText("Mức theo dõi: 10 GB", { exact: true })
          .isVisible(),
        true,
      );
      assert.equal(
        await page
          .locator(".storage-mongo .storage-remaining")
          .getByText("Mức theo dõi: 512 MB", { exact: true })
          .isVisible(),
        true,
      );
      if (process.env.STORAGE_SCREENSHOTS && [390, 1280].includes(width)) {
        await mkdir(process.env.STORAGE_SCREENSHOTS, { recursive: true });
        await page.screenshot({
          path: join(
            process.env.STORAGE_SCREENSHOTS,
            `assistant-r2-${state}-${width}.png`,
          ),
          fullPage: true,
        });
      }
    }
    assert.equal(
      storageReads().length,
      1,
      "expanding file details and resizing reuse the monitor",
    );
    assert.deepEqual(mutations(), []);
    assertClean();
  }
});

test("stored photos per customer: an admin searches and deletes one customer after confirming", async () => {
  const row = (id, code, name, extra = {}) => ({ id, code, name, phone: "0912345678", status: "completed",
    createdAt: "2026-10-23T08:00:00.000Z", photos: 2, printJobs: 0, pendingPrints: 0, files: 5,
    bytes: 31.5 * MB, lastPhotoAt: "2026-10-23T08:10:00.000Z", expiresAt: "2026-10-24T08:00:00.000Z", ...extra });
  customers = [row("b1", "111111", "Lan", { pendingPrints: 1 }), row("b2", "222222", "Minh")];
  await mount({ data: r2Summary(2) });
  // Ảnh đại diện Trợ lí Minh thay icon robot.
  assert.equal(await page.locator(".storage-heading img.assistant-avatar").getAttribute("src"), "/tro-li-minh.webp");
  const list = page.locator(".storage-r2 .storage-customers");
  await list.locator("summary").click();
  await list.getByText("#111111", { exact: false }).waitFor();
  assert.match(await list.innerText(), /2 khách/);
  assert.match(await list.innerText(), /1 lệnh in đang chờ/);
  assert.match(await list.innerText(), /2 ảnh · 31,5 MB/);
  await list.getByRole("searchbox", { name: "Tìm khách" }).fill("minh");
  assert.equal(await list.locator(".storage-customers-list > li").count(), 1);
  await list.getByRole("searchbox", { name: "Tìm khách" }).fill("");

  const dismissed = page.waitForEvent("dialog").then(async (dialog) => {
    assert.match(dialog.message(), /#111111/);
    assert.match(dialog.message(), /Không thể khôi phục/);
    assert.match(dialog.message(), /lệnh in/);
    await dialog.dismiss();
  });
  await list.getByRole("button", { name: "Xoá ảnh của vé #111111", exact: true }).click();
  await dismissed;
  assert.deepEqual(mutations(), [], "cancelling deletes nothing");

  const accepted = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await list.getByRole("button", { name: "Xoá ảnh của vé #111111", exact: true }).click();
  await accepted;
  await page.getByText("Đã xoá ảnh của vé #111111", { exact: false }).waitFor();
  assert.deepEqual(mutations().map((m) => [m.method, m.path]), [["DELETE", "/api/admin/storage/customers/b1"]]);
  assert.equal(await list.locator(".storage-customers-list > li").count(), 1);

  // Lễ tân: danh sách khách (API chỉ dành cho quản trị viên) không hiện.
  await mount({ data: r2Summary(2), canManage: false });
  assert.equal(await page.locator(".storage-customers").count(), 0);
  assert.deepEqual(pageErrors, []);
});
