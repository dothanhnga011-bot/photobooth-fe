// Real kiosk flow with an isolated API. No camera or customer data is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { Kiosk } from '/src/kiosk/Kiosk.jsx';
  import { KioskShoot } from '/src/kiosk/KioskShoot.jsx';
  import '/src/tailwind.css';
  const root = createRoot(document.getElementById('root'));
  root.render(React.createElement(React.StrictMode, null,
    React.createElement(MemoryRouter, { initialEntries: ['/kiosk?device=fixture-device'] },
      React.createElement(StudioContext.Provider, { value: { settings: {}, packages: [], frames: [] } },
        React.createElement(ToastProvider, null, React.createElement(Kiosk))))));
  window.showShoot = props => root.render(React.createElement(KioskShoot, {
    videoRef: { current: null }, ready: true, zoom: 0, flash: 0,
    phase: 'shoot', sessionLeft: 3, taken: 0, quota: 3, shots: [], ...props,
  }));
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:wired-capture.jsx" } },
    plugins: [tailwindcss(), {
      name: "wired-capture-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:wired-capture.jsx" ? fixture : null,
    }],
  });
  const assets = new Map(bundle.output.map((a) => ["/" + a.fileName, a.code || a.source]));
  const entry = bundle.output.find((a) => a.isEntry).fileName;
  const css = bundle.output.filter((a) => a.fileName.endsWith(".css"));
  server = createServer((req, res) => {
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

async function booth(phase, { polaroid = false, deferStart = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [], agentRequests = [];
  let releaseStart, startRequests = 0;
  const startGate = new Promise(resolve => { releaseStart = resolve; });
  if (!deferStart) releaseStart();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (r.url().includes("127.0.0.1:8788")) agentRequests.push(r.url()); });
  let booking = {
    _id: "fixture-booking", packageName: "Gói thử", shots: 3, photos: [],
    captureDuration: 10, status: "checked_in",
    ...(polaroid ? { source: "polaroid", printSize: "large" } : {}),
    ...(phase === "shoot" ? {
      captureStartedAt: new Date().toISOString(),
      captureEndsAt: new Date(Date.now() + 600000).toISOString(),
    } : {}),
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/kiosk/start")) {
      startRequests++;
      await startGate;
      booking = {
        ...booking,
        captureStartedAt: new Date().toISOString(),
        captureEndsAt: new Date(Date.now() + 600000).toISOString(),
      };
    }
    await route.fulfill({ json: path.endsWith("/kiosk/ping") ? { room: { _id: "room", flip: "device", kind: polaroid ? "polaroid" : "photobooth" } }
      : path.endsWith("/health") ? { ok: true } : { booking } });
  });
  await page.addInitScript(({ booking, phase }) => {
    sessionStorage.setItem("photo-capture-fixture-device", JSON.stringify({
      captureToken: "fixture-capture", accessToken: "fixture-album", booking,
      phase, mode: "timer", modeEndsAt: Date.now() - 1000,
      readyEndsAt: Date.now() + 60000,
    }));
  }, { booking, phase });
  await page.goto(base);
  return { page, errors, agentRequests, releaseStart, starts: () => startRequests };
}

test("old timer selection resumes in cable mode without sending a camera command", async () => {
  const b = await booth("mode");
  try {
    // Màn chụp sạch: không có chữ hướng dẫn bấm dây đè lên hình trực tiếp.
    await b.page.getByRole("button", { name: "Chụp xong, chọn ảnh" }).waitFor();
    assert.equal(await b.page.getByText("Nhấn nút trên dây bấm để chụp").count(), 0);
    assert.equal(await b.page.getByRole("button", { name: /Hẹn giờ/ }).count(), 0);
    assert.equal(await b.page.getByRole("button", { name: "Bấm chụp", exact: true }).count(), 0);
    await b.page.keyboard.press("Space");
    await b.page.keyboard.press("Enter");
    assert.deepEqual(b.agentRequests, []);
    assert.deepEqual(b.errors, []);
  } finally { await b.page.close(); }
});

test("active old timer session cannot trigger another automatic exposure", async () => {
  const b = await booth("shoot");
  try {
    // Màn chụp sạch: không có chữ hướng dẫn bấm dây đè lên hình trực tiếp.
    await b.page.getByRole("button", { name: "Chụp xong, chọn ảnh" }).waitFor();
    assert.equal(await b.page.getByText("Nhấn nút trên dây bấm để chụp").count(), 0);
    const restored = await b.page.evaluate(() => JSON.parse(sessionStorage.getItem("photo-capture-fixture-device")));
    assert.equal(restored.mode, "remote");
    await b.page.waitForTimeout(1100);
    assert.deepEqual(b.agentRequests, []);
    assert.deepEqual(b.errors, []);
  } finally { await b.page.close(); }
});

for (const phase of ["ready", "mode"]) {
  test(`Canon Polaroid resumes ${phase} without a countdown and waits for session activation`, async () => {
    const b = await booth(phase, { polaroid: true, deferStart: true });
    try {
      await b.page.getByRole("status", { name: "Đang mở lượt chụp" }).waitFor();
      // Even an old 60-second ready timer must not delay /start.
      await b.page.waitForRequest("**/api/kiosk/start", { timeout: 1500 }).catch(e => {
        if (!b.starts()) throw e;
      });
      assert.equal(b.starts(), 1);
      assert.equal(await b.page.locator(".shoot-count").count(), 0);
      assert.equal(await b.page.getByRole("button", { name: "Chụp xong, chọn ảnh" }).count(), 0);
      b.releaseStart();
      await b.page.locator(".shoot-screen.phase-shoot").waitFor({ timeout: 1500 });
      const restored = await b.page.evaluate(() => JSON.parse(sessionStorage.getItem("photo-capture-fixture-device")));
      assert.equal(restored.mode, "remote");
      assert.ok(restored.booking.captureStartedAt);
      assert.equal(restored.readyEndsAt, undefined);
      assert.equal(await b.page.locator(".shoot-count").count(), 0);
      await b.page.keyboard.press("Space");
      await b.page.keyboard.press("Enter");
      assert.equal(await b.page.locator(".shoot-thumbs .shoot-thumb-no").count(), 0);
      assert.deepEqual(b.agentRequests, []);
      assert.deepEqual(b.errors, []);
    } finally { b.releaseStart(); await b.page.close(); }
  });
}

test("Canon cable mode has no exposure countdown at the beginning or end of a session", async () => {
  const b = await booth("shoot", { polaroid: true });
  try {
    await b.page.locator(".shoot-screen.phase-shoot").waitFor();
    for (const props of [
      { phase: "ready", preCount: 3, sessionLeft: 600 },
      { phase: "shoot", sessionLeft: 3 },
    ]) {
      await b.page.evaluate(props => window.showShoot({ ...props, showCountdown: false }), props);
      await b.page.waitForFunction(() => !document.querySelector(".shoot-count"));
      assert.equal(await b.page.locator(".shoot-count").count(), 0);
    }
    await b.page.evaluate(() => window.showShoot({ showCountdown: true }));
    await b.page.locator(".shoot-count", { hasText: "3" }).waitFor();
    assert.deepEqual(b.errors, []);
  } finally { await b.page.close(); }
});
