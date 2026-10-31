// Run explicitly: node test/admin-catalog.browser.mjs
// Real admin components and CSS; local API fixtures, no live database or photos.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

// Packages ("Bảng giá") are the generic ResourceManager; frames ("Khung ảnh") have their own page.
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { ResourceManager } from '/src/admin/resources.jsx';
  import { FramesManager } from '/src/admin/frames.jsx';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import '/src/tailwind.css';
  const root = createRoot(document.getElementById('root'));
  let run = 0;
  const studio = {
    settings: { themes: [{ name: 'Hoa' }, { name: 'Mùa hè' }] },
    rooms: [{ branch: 'Chi nhánh A' }, { branch: 'Chi nhánh B' }],
    // The public catalog is reloaded after every change so kiosks see it.
    reload: () => { window.catalogReloads++; },
  };
  window.mountCatalog = (resource) => {
    window.notifications = [];
    window.catalogReloads = 0;
    const notify = (message) => window.notifications.push(message);
    const title = resource === 'packages' ? 'Bảng giá' : 'Khung ảnh';
    const content = resource === 'packages'
      ? React.createElement(ResourceManager, {
          resource,
          notify,
          me: { _id: 'fixture-admin', email: 'admin@fixture.local', role: 'admin' },
        })
      : React.createElement(FramesManager, { notify });
    root.render(React.createElement(StudioContext.Provider, { key: ++run, value: studio },
      React.createElement(ToastProvider, null,
        React.createElement('div', { className: 'admin-shell' },
          React.createElement('aside', { className: 'admin-sidebar' },
            React.createElement('div', { className: 'sidebar-brand' }, 'NXC / STUDIO'),
            React.createElement('nav', null,
              React.createElement('button', { className: resource === 'packages' ? 'active' : '' }, 'Bảng giá'),
              React.createElement('button', { className: resource === 'frames' ? 'active' : '' }, 'Khung ảnh'))),
          React.createElement('main', { className: 'admin-main' },
            React.createElement('header', { className: 'admin-header' },
              React.createElement('div', null,
                React.createElement('h2', null, title))),
            React.createElement('div', { className: 'admin-content' }, content))))));
  };
`;

function frameImage(color, motif) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><rect width="600" height="900" fill="${color}"/><rect x="50" y="60" width="500" height="340" rx="8" fill="#fffdf8"/><rect x="50" y="420" width="500" height="340" rx="8" fill="#fffdf8"/><text x="300" y="825" text-anchor="middle" font-size="34" fill="#423e3a" font-family="serif">${motif}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// What the API returns for a package: every field the form needs and validates.
const packageDefaults = {
  shots: 12,
  selectCount: 4,
  countdownSeconds: 10,
  printSize: "full",
  branches: [],
};
const packageFixtures = [
  {
    _id: "package-1",
    name: "Chụp một mình",
    description: "Một chút thời gian dành cho chính bạn.",
    price: 70000,
    duration: 10,
    prints: 1,
    active: true,
    ...packageDefaults,
  },
  {
    _id: "package-2",
    name: "Cặp đôi",
    description: "Lưu lại khoảnh khắc cùng người thương.",
    price: 120000,
    duration: 20,
    prints: 2,
    active: true,
    ...packageDefaults,
  },
  {
    _id: "package-3",
    name: "Hội bạn",
    description: "Gói chụp nhóm cho một buổi hẹn vui.",
    price: 180000,
    duration: 30,
    prints: 3,
    active: false,
    ...packageDefaults,
  },
];
const themeFixtures = [{ name: "Hoa" }, { name: "Mùa hè" }];
const frameFixtures = [
  {
    _id: "frame-1",
    name: "Đêm hoa",
    themeName: "Hoa",
    order: 1,
    printSize: "full",
    image: frameImage("#e8d2d0", "BLOOM / 01"),
    slots: [
      { x: 0.083, y: 0.067, w: 0.834, h: 0.377 },
      { x: 0.083, y: 0.467, w: 0.834, h: 0.377 },
    ],
    active: true,
  },
  {
    _id: "frame-2",
    name: "Vườn hồng",
    themeName: "Hoa",
    order: 2,
    printSize: "strip",
    image: frameImage("#d5ded1", "BLOOM / 02"),
    slots: [{ x: 0.083, y: 0.067, w: 0.834, h: 0.377 }],
    active: false,
  },
  {
    _id: "frame-3",
    name: "Nắng xanh",
    themeName: "Mùa hè",
    order: 1,
    printSize: "full",
    image: frameImage("#e0dfbd", "SUNNY DAYS"),
    slots: [{ x: 0.083, y: 0.067, w: 0.834, h: 0.377 }],
    active: true,
  },
  {
    _id: "frame-4",
    name: "Kỷ niệm",
    themeName: "",
    order: 0,
    printSize: "full",
    image: frameImage("#dad9e1", "MEMORIES"),
    slots: [{ x: 0.083, y: 0.067, w: 0.834, h: 0.377 }],
    active: true,
  },
];
// The editor sends only these fields back (the server owns the rest).
const frameBody = ({ _id, ...editable }) => editable;

let server;
let browser;
let page;
let data;
let requests = [];
let unexpected = [];
let pageErrors = [];
const screenshotDirectory = join(tmpdir(), "photobooth-fe-admin-catalog-review");

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
        input: "/__catalog_fixture__.jsx",
        output: {
          format: "iife",
          name: "CatalogReview",
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      tailwindcss(),
      {
        name: "admin-catalog-regression-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/__catalog_fixture__.jsx") return "\0catalog-fixture.jsx";
        },
        load(id) {
          if (id === "\0catalog-fixture.jsx") return fixture;
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
      const send = (value, status = 200) => {
        response.statusCode = status;
        response.end(JSON.stringify(value));
      };
      if (path === "/api/admin/themes" && entry.method === "GET") {
        send(data.themes);
        return;
      }
      if (path === "/api/admin/themes" && entry.method === "POST") {
        data.themes.push({ name: entry.body.name, kind: entry.body.kind || "photobooth" });
        send(data.themes, 201);
        return;
      }
      const move = path.match(/^\/api\/admin\/frames\/([^/]+)\/move$/);
      if (move && entry.method === "POST") {
        const frame = data.frames.find((item) => item._id === move[1]);
        const group = data.frames
          .filter((item) => item.themeName.trim() === frame.themeName.trim())
          .sort((a, b) => a.order - b.order || a._id.localeCompare(b._id));
        const ids = group.map((item) => item._id);
        if (ids.join() !== entry.body.expectedIds.join()) {
          send({ message: "Danh sách khung vừa thay đổi." }, 409);
          return;
        }
        const index = ids.indexOf(frame._id);
        const next = index + (entry.body.direction === "up" ? -1 : 1);
        [group[index], group[next]] = [group[next], group[index]];
        group.forEach((item, i) => {
          item.order = i + 1;
        });
        send(data.frames);
        return;
      }
      const match = path.match(
        /^\/api\/admin\/(packages|frames)(?:\/([^/]+))?$/,
      );
      if (!match) {
        unexpected.push(`${entry.method} ${path}`);
        send({ message: "Unexpected fixture request" }, 404);
        return;
      }
      const [, resource, id] = match;
      if (entry.method === "GET")
        send(
          id ? data[resource].find((item) => item._id === id) : data[resource],
        );
      else if (entry.method === "PUT") {
        data[resource] = data[resource].map((item) =>
          item._id === id ? { ...item, ...entry.body } : item,
        );
        send(data[resource].find((item) => item._id === id));
      } else if (entry.method === "POST") {
        const item = { ...entry.body, _id: `${resource}-new-${data[resource].length}` };
        data[resource].push(item);
        send(item);
      } else if (entry.method === "DELETE") {
        if (resource === "frames")
          data.frames = data.frames.filter((item) => item._id !== id);
        else
          data.packages = data.packages.map((item) =>
            item._id === id ? { ...item, active: false } : item,
          );
        send({ ok: true });
      } else {
        unexpected.push(`${entry.method} ${path}`);
        send({ message: "Unexpected fixture method" }, 405);
      }
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
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
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

const CARDS = { packages: ".package-card", frames: ".frames-grid > li" };

async function mount(resource, overrides = {}) {
  data = {
    packages: structuredClone(packageFixtures),
    frames: structuredClone(frameFixtures),
    themes: structuredClone(themeFixtures),
    ...overrides,
  };
  requests = [];
  unexpected = [];
  pageErrors = [];
  await page.goto(`http://127.0.0.1:${server.address().port}/catalog`);
  await page.waitForFunction(() => typeof window.mountCatalog === "function");
  // Khổ ảnh & bảng giá nhớ tab Photobooth / Polaroid đang xem: mỗi test bắt đầu ở tab Photobooth.
  await page.evaluate(() => localStorage.removeItem("admin-service-tab"));
  await page.evaluate((resource) => window.mountCatalog(resource), resource);
  await page.locator(CARDS[resource]).first().waitFor();
}

const mutations = () => requests.filter((request) => request.method !== "GET");
const cards = (resource) => page.locator(CARDS[resource]);
const notifications = () => page.evaluate(() => window.notifications);
const catalogReloads = () => page.evaluate(() => window.catalogReloads);

async function expectCount(resource, expected) {
  await page.waitForFunction(
    ({ selector, expected }) =>
      document.querySelectorAll(selector).length === expected,
    { selector: CARDS[resource], expected },
  );
  assert.equal(await cards(resource).count(), expected);
}

// Names of the frames in list order (grouped by theme, then by position inside the theme).
const frameNames = () =>
  page
    .locator(".frames-grid > li .frames-card-image")
    .evaluateAll((buttons) =>
      buttons.map((button) =>
        button.getAttribute("aria-label").replace(/^Sửa khung /, ""),
      ),
    );

async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Catalog must fit the viewport",
  );
}

// No script errors and no request the fixture did not expect (the page would show an error toast).
function assertClean() {
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpected, []);
}

const themeSelect = () =>
  page.getByRole("combobox", { name: /^Chủ đề/ });
const sizeSelect = () =>
  page.getByRole("combobox", { name: /^Kích thước/ });

test("package search and status filters combine without changing stored data", async () => {
  await mount("packages");
  await expectCount("packages", 3);
  await page.getByLabel("Tìm gói chụp", { exact: true }).fill("CAP DOI");
  await expectCount("packages", 1);
  assert.match(await cards("packages").innerText(), /Cặp đôi/);
  await page
    .getByRole("combobox", { name: "Lọc trạng thái", exact: true })
    .selectOption("inactive");
  await expectCount("packages", 0);
  await page.getByLabel("Tìm gói chụp", { exact: true }).fill("");
  await expectCount("packages", 1);
  assert.match(await cards("packages").innerText(), /Hội bạn/);
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("editing a package preserves included prints and other fields in the API payload", async () => {
  await mount("packages");
  await cards("packages")
    .filter({ hasText: "Cặp đôi" })
    .getByRole("button", { name: /Sửa|Chỉnh sửa/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="price"]').fill("135000");
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(mutations(), [
    {
      method: "PUT",
      path: "/api/admin/packages/package-2",
      body: { ...packageFixtures[1], price: 135000 },
    },
  ]);
  assert.match(
    await cards("packages").filter({ hasText: "Cặp đôi" }).innerText(),
    /135/,
  );
  assert.deepEqual(await notifications(), ["Đã cập nhật gói chụp “Cặp đôi”."]);
  assertClean();
});

test("adding a package validates required fields and sends numeric values", async () => {
  await mount("packages");
  await page
    .getByRole("button", { name: /Thêm gói chụp|Thêm gói|Thêm mới/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  assert.deepEqual(
    mutations(),
    [],
    "Empty package name must not reach the API",
  );
  await dialog.locator('input[name="name"]').fill("Ngày vui");
  await dialog
    .locator('textarea[name="description"]')
    .fill("Gói mới dành cho gia đình.");
  await dialog.locator('input[name="price"]').fill("150000");
  await dialog.locator('input[name="duration"]').fill("25");
  await dialog.locator('input[name="prints"]').fill("3");
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(mutations(), [
    {
      method: "POST",
      path: "/api/admin/packages",
      body: {
        name: "Ngày vui",
        description: "Gói mới dành cho gia đình.",
        price: 150000,
        duration: 25,
        prints: 3,
        // Defaults of a new package: 12 shots (cable presses, no countdown), pick 4, full 10 × 15 sheet,
        // every branch.
        shots: 12,
        selectCount: 4,
        printSize: "full",
        branches: [],
        active: true,
      },
    },
  ]);
  await expectCount("packages", 4);
  assertClean();
});

test("packages are grouped by photo size; a small-size package starts with one sheet cut in half", async () => {
  await mount("packages");
  const small = page.getByRole("region", { name: "Khổ nhỏ" });
  const large = page.getByRole("region", { name: "Khổ to" });
  // Tab Photobooth chỉ có khổ nhỏ / khổ to; layout Polaroid ở tab riêng.
  assert.equal(await page.getByRole("tab", { name: /Photobooth/ }).getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("region", { name: "Layout Polaroid" }).count(), 0);
  assert.equal(await large.locator(".package-card").count(), 3);
  assert.match(await small.innerText(), /Chưa có gói khổ nhỏ/);
  // Khổ to kèm 1 tờ: dưới mức tối thiểu 2 tờ, không gửi lên máy chủ.
  await large.locator(".package-card").filter({ hasText: "Chụp một mình" })
    .getByRole("button", { name: /Chỉnh sửa/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await dialog.getByText(/khổ to kèm ít nhất 2 tờ/).first().waitFor();
  assert.deepEqual(mutations(), []);
  await dialog.getByRole("button", { name: "Huỷ" }).click();

  await small.getByRole("button", { name: "Thêm gói khổ nhỏ" }).click();
  assert.equal(await dialog.locator('select[name="printSize"]').inputValue(), "strip");
  assert.equal(await dialog.locator('input[name="prints"]').inputValue(), "1");
  assert.match(await dialog.locator(".kiosk-size-preview").innerText(), /kèm 2 tờ nhỏ/);
  await dialog.locator('input[name="name"]').fill("Gói 70.000đ · 2 ảnh nhỏ");
  await dialog.locator('input[name="price"]').fill("70000");
  await dialog.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const [created] = mutations();
  assert.equal(created.method, "POST");
  assert.equal(created.body.printSize, "strip");
  assert.equal(created.body.prints, 1);
  // Danh sách tải lại sau khi lưu: chờ thẻ mới hiện rồi mới đếm.
  await small.locator(".package-card").first().waitFor();
  assert.equal(await small.locator(".package-card").count(), 1);
  assertClean();
});

test("the Polaroid tab lists only layouts and creates the 6 sample layouts with white Instax Wide frames", async () => {
  await mount("packages");
  await page.getByRole("tab", { name: /Polaroid/ }).click();
  const layouts = page.getByRole("region", { name: "Layout Polaroid" });
  assert.match(await layouts.innerText(), /Chưa có layout Polaroid/);
  assert.equal(await page.getByRole("region", { name: "Khổ to" }).count(), 0);
  assert.match(await page.locator(".extra-price-panel").innerText(), /mỗi tấm Instax Wide/i);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Tạo 6 layout mẫu" }).click();
  await layouts.locator(".package-card").nth(5).waitFor();
  const made = mutations();
  assert.deepEqual(made.map((m) => `${m.method} ${m.path}`), [
    "POST /api/admin/themes",
    ...Array(6).fill("POST /api/admin/frames"),
    ...Array(6).fill("POST /api/admin/packages"),
  ]);
  assert.deepEqual(made[0].body, { name: "Layout trắng", kind: "polaroid" });
  const frames = made.slice(1, 7).map((m) => m.body);
  assert.deepEqual(frames.map((f) => [f.printSize, f.themeName, f.slots.length, f.slots.at(-1).photo]),
    [1, 2, 3, 4, 5, 6].map((n) => ["instax", "Layout trắng", n, n]));
  assert.ok(frames.every((f) => f.image.startsWith("data:image/png;base64,")));
  // Khung trắng là thẻ Instax Wide nằm ngang 1800 × 1200.
  const size = await page.evaluate((src) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
    image.src = src;
  }), frames[4].image);
  assert.deepEqual(size, [1800, 1200]);
  const packs = made.slice(7).map((m) => m.body);
  // Layout mẫu: 5 phút chụp không giới hạn lần bấm, in 1 tấm.
  assert.deepEqual(packs.map((p) => [p.printSize, p.selectCount, p.price, p.prints, p.shots, p.duration]),
    [1, 2, 3, 4, 5, 6].map((n) => ["instax", n, 110000, 1, 0, 5]));
  assert.equal(await layouts.locator(".package-card .layout-art").nth(4).locator("i").count(), 5);
  assert.deepEqual(await notifications(), ["Đã tạo 6 layout và 6 khung trắng mẫu."]);
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: join(screenshotDirectory, "packages-polaroid.png"), fullPage: true });
  // Bấm lại: đã đủ layout và khung 1–6 ảnh, không tạo thêm.
  requests = [];
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Tạo 6 layout mẫu" }).click();
  await page.waitForFunction(() => window.notifications.length === 2);
  assert.deepEqual(mutations(), []);
  // Layout mới: không có ô chọn khổ, số ảnh chọn bằng hình layout. Không có ô số tấm in / số lần
  // chụp: layout in đúng 1 tấm, khách bấm dây không giới hạn trong thời gian chụp (mặc định 5 phút).
  await page.getByRole("button", { name: "Thêm layout" }).first().click();
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.locator('select[name="printSize"]').count(), 0);
  assert.equal(await dialog.locator('input[name="prints"], input[name="shots"]').count(), 0);
  assert.equal(await dialog.locator('input[name="duration"]').inputValue(), "5");
  await dialog.getByRole("radio", { name: "5 ảnh" }).check({ force: true });
  assert.equal(await dialog.locator(".kiosk-layout-preview .layout-art i").count(), 5);
  assert.match(await dialog.locator(".kiosk-layout-preview").innerText(), /5 phút chụp/i);
  await page.screenshot({ path: join(screenshotDirectory, "packages-polaroid-editor.png") });
  await dialog.locator('input[name="name"]').fill("Layout thử");
  await dialog.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(
    mutations().map((m) => [m.method, m.body.printSize, m.body.selectCount, m.body.prints, m.body.shots, m.body.duration]),
    [["POST", "instax", 5, 1, 0, 5]],
  );
  // Tab Photobooth vẫn chỉ có gói 10 × 15.
  await page.getByRole("tab", { name: /Photobooth/ }).click();
  await expectCount("packages", 3);
  assertClean();
});

test("a package can be limited to chosen branches", async () => {
  await mount("packages");
  const card = () => cards("packages").filter({ hasText: "Cặp đôi" });
  assert.match(await card().innerText(), /Cấu hình chung · mọi chi nhánh/);
  await card().getByRole("button", { name: /Chỉnh sửa/ }).click();
  const dialog = page.getByRole("dialog");
  const everyBranch = dialog.getByLabel("Tất cả chi nhánh (cấu hình chung)");
  assert.equal(await everyBranch.isChecked(), true);
  await dialog.getByLabel("Chi nhánh A", { exact: true }).check();
  assert.equal(await everyBranch.isChecked(), false);
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(mutations().map((m) => [m.method, m.body.branches]), [
    ["PUT", ["Chi nhánh A"]],
  ]);
  assert.match(await card().innerText(), /Cấu hình riêng: Chi nhánh A/);
  assertClean();
});

test("frame theme and size filters combine without changing stored data", async () => {
  await mount("frames");
  await expectCount("frames", 4);
  assert.equal(await page.locator(".frames-count").innerText(), "4 khung");
  // Grouped by the theme order in the studio settings, then by position inside the theme.
  assert.deepEqual(await frameNames(), [
    "Đêm hoa",
    "Vườn hồng",
    "Nắng xanh",
    "Kỷ niệm",
  ]);
  await themeSelect().selectOption({ label: "Hoa" });
  await expectCount("frames", 2);
  await sizeSelect().selectOption({ label: "Size nhỏ" });
  await expectCount("frames", 1);
  assert.deepEqual(await frameNames(), ["Vườn hồng"]);
  assert.equal(await page.locator(".frames-count").innerText(), "1 khung");
  await sizeSelect().selectOption({ label: "Size lớn" });
  assert.deepEqual(await frameNames(), ["Đêm hoa"]);
  await sizeSelect().selectOption({ label: "Tất cả" });
  await themeSelect().selectOption({ label: "Khung lẻ" });
  assert.deepEqual(await frameNames(), ["Kỷ niệm"]);
  await themeSelect().selectOption({ label: "Mùa hè" });
  await sizeSelect().selectOption({ label: "Size nhỏ" });
  await expectCount("frames", 0);
  await page
    .getByRole("heading", { name: "Không có khung phù hợp bộ lọc" })
    .waitFor();
  assert.deepEqual(mutations(), []);
  assertClean();
});

test("editing a frame loads the full frame and sends back only the editable fields", async () => {
  await mount("frames");
  await page.getByRole("button", { name: "Sửa Đêm hoa", exact: true }).click();
  await page
    .getByRole("heading", { name: "Cập nhật frame size lớn", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Tên khung", { exact: true }).inputValue(),
    "Đêm hoa",
  );
  // Two photo regions in the fixture: the editor reports the capacity it detected.
  assert.match(await page.locator(".frame-capacity").innerText(), /2/);
  await page.getByLabel("Tên khung", { exact: true }).fill("Đêm hoa mới");
  await page.getByRole("button", { name: "Hoàn thành", exact: true }).click();
  await page
    .getByRole("button", { name: "Sửa Đêm hoa mới", exact: true })
    .waitFor();
  assert.deepEqual(mutations(), [
    {
      method: "PUT",
      path: "/api/admin/frames/frame-1",
      body: { ...frameBody(frameFixtures[0]), name: "Đêm hoa mới" },
    },
  ]);
  assert.deepEqual(await notifications(), ["Đã cập nhật khung “Đêm hoa mới”."]);
  assert.ok((await catalogReloads()) > 0, "the public catalog is reloaded");
  assertClean();
});

test("a frame cannot be saved without a photo region and the editor can be left without saving", async () => {
  await mount("frames");
  await page.getByRole("button", { name: "Sửa Đêm hoa", exact: true }).click();
  await page.getByRole("heading", { name: /Cập nhật frame/ }).waitFor();
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  await cards("frames").first().waitFor();
  assert.deepEqual(mutations(), []);
  await page.getByRole("button", { name: /Thêm mới frame/ }).click();
  await page.getByRole("menuitem", { name: /Size lớn/ }).click();
  await page.getByRole("heading", { name: "Thêm mới frame size lớn", exact: true }).waitFor();
  await page.getByRole("button", { name: "Hoàn thành", exact: true }).click();
  await page.getByText("Vui lòng tải ảnh khung lên.").waitFor();
  assert.deepEqual(mutations(), [], "an empty frame must not reach the API");
  await page.getByRole("button", { name: "Quay lại danh sách khung" }).click();
  await expectCount("frames", 4);
  assertClean();
});

test("turning a frame off keeps all its data and only flips active", async () => {
  await mount("frames");
  await page.getByRole("button", { name: "Tắt Đêm hoa", exact: true }).click();
  await page.getByRole("button", { name: "Bật Đêm hoa", exact: true }).waitFor();
  assert.deepEqual(mutations(), [
    {
      method: "PUT",
      path: "/api/admin/frames/frame-1",
      body: { ...frameBody(frameFixtures[0]), active: false },
    },
  ]);
  assert.deepEqual(await notifications(), [
    "Đã tắt khung — khách không thấy khung này.",
  ]);
  // The inactive frame stays in the list and is marked off.
  assert.match(
    await cards("frames")
      .filter({ has: page.getByRole("button", { name: "Bật Đêm hoa", exact: true }) })
      .innerText(),
    /Đã tắt/,
  );
  assertClean();
});

test("frame deletion honors cancellation and deletes only the confirmed frame", async () => {
  await mount("frames");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Xóa Đêm hoa", exact: true }).click();
  assert.deepEqual(mutations(), []);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Xóa Đêm hoa", exact: true }).click();
  await expectCount("frames", 3);
  assert.deepEqual(mutations(), [
    { method: "DELETE", path: "/api/admin/frames/frame-1", body: null },
  ]);
  assert.deepEqual(data.frames.map((frame) => frame._id).sort(), [
    "frame-2",
    "frame-3",
    "frame-4",
  ]);
  assert.deepEqual(await notifications(), ["Đã xóa khung."]);
  assertClean();
});

test("deleting the last frame of a theme keeps the theme and explains the empty list", async () => {
  await mount("frames");
  await themeSelect().selectOption({ label: "Mùa hè" });
  await expectCount("frames", 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Xóa Nắng xanh", exact: true }).click();
  await expectCount("frames", 0);
  // Themes belong to the studio, not to its frames: the theme stays selectable.
  assert.equal(await themeSelect().inputValue(), "Mùa hè");
  await page
    .getByRole("heading", { name: "Không có khung phù hợp bộ lọc" })
    .waitFor();
  await themeSelect().selectOption({ label: "Tất cả" });
  await expectCount("frames", 3);
  assert.deepEqual(mutations(), [
    { method: "DELETE", path: "/api/admin/frames/frame-3", body: null },
  ]);
  assertClean();
});

test("frames move inside their theme without opening the editor", async () => {
  await mount("frames");
  await page
    .getByRole("button", { name: "Đưa Vườn hồng lên trước", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".frames-grid > li .frames-card-image")
        ?.getAttribute("aria-label") === "Sửa khung Vườn hồng",
  );
  assert.deepEqual(
    data.frames
      .filter((frame) => frame.themeName === "Hoa")
      .sort((a, b) => a.order - b.order)
      .map((frame) => frame._id),
    ["frame-2", "frame-1"],
  );
  assert.deepEqual(await frameNames(), [
    "Vườn hồng",
    "Đêm hoa",
    "Nắng xanh",
    "Kỷ niệm",
  ]);
  assert.deepEqual(mutations(), [
    {
      method: "POST",
      path: "/api/admin/frames/frame-2/move",
      body: { direction: "up", expectedIds: ["frame-1", "frame-2"] },
    },
  ]);
  assert.deepEqual(await notifications(), ["Đã đổi thứ tự khung."]);
  assertClean();
});

test("moving a frame under a filter still sends its complete theme", async () => {
  await mount("frames");
  // Only "Đêm hoa" is visible in its theme, but "Vườn hồng" (the small size) shares the order.
  await sizeSelect().selectOption({ label: "Size lớn" });
  assert.deepEqual(await frameNames(), ["Đêm hoa", "Nắng xanh", "Kỷ niệm"]);
  await page
    .getByRole("button", { name: "Đưa Đêm hoa xuống sau", exact: true })
    .click();
  await page.waitForFunction(() =>
    window.notifications.includes("Đã đổi thứ tự khung."),
  );
  assert.deepEqual(mutations(), [
    {
      method: "POST",
      path: "/api/admin/frames/frame-1/move",
      body: { direction: "down", expectedIds: ["frame-1", "frame-2"] },
    },
  ]);
  assertClean();
});

test("a list changed on another device is reloaded instead of being reordered blindly", async () => {
  await mount("frames");
  // Another device already put "Vườn hồng" in front; this page still shows the old order.
  data.frames.find((frame) => frame._id === "frame-2").order = 0;
  await page
    .getByRole("button", { name: "Đưa Đêm hoa xuống sau", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Danh sách khung vừa thay đổi." })
    .waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".frames-grid > li .frames-card-image")
        ?.getAttribute("aria-label") === "Sửa khung Vườn hồng",
  );
  assert.deepEqual(
    data.frames.find((frame) => frame._id === "frame-1").order,
    1,
    "the stale move changed nothing",
  );
  assert.deepEqual(await frameNames(), [
    "Vườn hồng",
    "Đêm hoa",
    "Nắng xanh",
    "Kỷ niệm",
  ]);
  assertClean();
});

test("catalogs and editors fit desktop and mobile widths with review screenshots", async () => {
  await mkdir(screenshotDirectory, { recursive: true });
  for (const width of [1440, 390, 320]) {
    const height = width === 390 ? 844 : 1000;
    await page.setViewportSize({ width, height });
    for (const resource of ["packages", "frames"]) {
      await mount(resource);
      await noOverflow();
      if (resource === "frames") {
        const geometry = await page
          .locator(".frames-grid > li")
          .evaluateAll((items) =>
            items.map((item) => {
              const box = item.getBoundingClientRect();
              const image = item
                .querySelector(".frames-card-image img")
                .getBoundingClientRect();
              return {
                card: [Math.round(box.left), Math.round(box.right)],
                picture: [Math.round(image.left), Math.round(image.right)],
                fits: box.left >= 0 && box.right <= innerWidth + 1,
                contained:
                  image.left >= box.left - 1 && image.right <= box.right + 1,
                buttons: [...item.querySelectorAll(".frames-card-actions button")].map(
                  (button) => {
                    const r = button.getBoundingClientRect();
                    return [Math.round(r.width), Math.round(r.height)];
                  },
                ),
                // Buttons cut off by the card (overflow: hidden) cannot be pressed.
                clipped: [...item.querySelectorAll(".frames-card-actions button")].filter(
                  (button) => {
                    const r = button.getBoundingClientRect();
                    return r.left < box.left - 1 || r.right > box.right + 1;
                  },
                ).length,
              };
            }),
          );
        assert.ok(
          geometry.every((g) => g.fits && g.contained),
          JSON.stringify({ width, geometry }),
        );
        // Five icon buttons per card, all inside the card and still big enough to hit on a phone.
        assert.ok(
          geometry.every(
            (g) =>
              g.buttons.length === 5 &&
              g.clipped === 0 &&
              g.buttons.every(([w, h]) => w >= 22 && h >= 28),
          ),
          JSON.stringify({ width, geometry }),
        );
      }
      await page.screenshot({
        path: join(screenshotDirectory, `${resource}-${width}.png`),
        fullPage: true,
      });
      if (resource === "packages") {
        await cards(resource)
          .first()
          .getByRole("button", { name: /Sửa|Chỉnh sửa/ })
          .click();
        await page.getByRole("dialog").waitFor();
        await noOverflow();
        const bounds = await page.getByRole("dialog").boundingBox();
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
          "Editor must fit the viewport",
        );
        // Header and Save stay visible while only the fields scroll on mobile.
        const save = page.getByRole("dialog").getByRole("button", {
          name: "Lưu thay đổi",
          exact: true,
        });
        const saveBounds = await save.boundingBox();
        assert.ok(
          saveBounds.y >= bounds.y &&
            saveBounds.y + saveBounds.height <= bounds.y + bounds.height + 1 &&
            saveBounds.y + saveBounds.height <= height + 1,
          "The editor Save button must be visible before any scrolling",
        );
        await save.click({ trial: true });
      } else {
        // The frame editor is a page, not a dialog: it must fit the width and keep its two actions.
        await page
          .getByRole("button", { name: "Sửa Đêm hoa", exact: true })
          .click();
        await page.locator(".frame-editor-page").waitFor();
        await page.locator(".frame-board img").waitFor();
        await noOverflow();
        const board = await page.locator(".frame-board").boundingBox();
        assert.ok(
          board.x >= 0 && board.x + board.width <= width + 1,
          "The frame board must fit the viewport",
        );
        for (const name of ["Hủy", "Hoàn thành"])
          await page.getByRole("button", { name, exact: true }).waitFor();
      }
      await page.screenshot({
        path: join(screenshotDirectory, `${resource}-editor-${width}.png`),
        fullPage: false,
      });
      assertClean();
    }
  }
  console.log(`Catalog review screenshots: ${screenshotDirectory}`);
});
