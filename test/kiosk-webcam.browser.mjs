// Webcam test mode of the kiosk (no Fujifilm camera): isolated API, Chromium's fake camera.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, fakeCamera, base;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { Kiosk } from '/src/kiosk/Kiosk.jsx';
  window.deliverCanonPhoto = async number => {
    const folder = await navigator.storage.getDirectory();
    const file = await folder.getFileHandle('IMG_' + number + '.JPG', { create: true });
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = number === 1 ? '#ed1923' : '#1e32e1'; ctx.fillRect(0, 0, 1200, 800);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .95));
    const write = await file.createWritable(); await write.write(blob); await write.close();
  };
  import '/src/tailwind.css';
  if (new URLSearchParams(location.search).has('canon-folder')) {
    // OPFS is already granted; it is only the fixture's source of camera JPEGs.
    Object.defineProperty(FileSystemHandle.prototype, 'queryPermission', { configurable: true, value: async () => 'granted' });
  }
  // ?frames=1: hai khung có ảnh xem nhanh trên máy chủ (để kiểm tra khung được tải sẵn lúc đang chụp).
  const frame = (id) => ({ _id: id, name: 'Khung ' + id, printSize: 'full', active: true,
    image: '/api/frames/' + id + '/image?v=1', thumb: '/api/frames/' + id + '/image?v=1&size=thumb',
    slots: [{ x: 0.05, y: 0.05, w: 0.9, h: 0.9, kind: 'photo', photo: 1 }] });
  const frames = new URLSearchParams(location.search).has('frames') ? [frame('f1'), frame('f2')] : [];
  createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null,
    React.createElement(MemoryRouter, { initialEntries: ['/kiosk?device=fixture-device'] },
      React.createElement(StudioContext.Provider, { value: { settings: {}, packages: [], frames } },
        React.createElement(ToastProvider, null, React.createElement(Kiosk))))));
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:kiosk-webcam.jsx" } },
    plugins: [tailwindcss(), {
      name: "kiosk-webcam-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:kiosk-webcam.jsx" ? fixture : null,
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith("/src/capture-store.js")) return;
        // Windows headless Chromium crashes when deserializing OPFS handles from
        // IndexedDB. Supply the Canon setting directly; JPEG IO and the actual
        // kiosk folder watcher stay real. All other settings use the real store.
        const declaration = 'export const readSetting = (key) => run(';
        assert.ok(code.includes(declaration));
        return code.replace(declaration, `export const readSetting = (key) =>
          key === 'camera-folder-canon-r100' && new URLSearchParams(location.search).has('canon-folder')
            ? navigator.storage.getDirectory() : run(`);
      },
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
  // Không có camera nào (máy tính không có máy ảnh lẫn webcam) và có webcam giả của Chromium.
  browser = await chromium.launch({ headless: true });
  fakeCamera = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
});

after(async () => {
  await browser?.close();
  await fakeCamera?.close();
  await new Promise((resolve) => server?.close(resolve));
});

// Thử máy bằng webcam: chờ hình trực tiếp sẵn sàng (không có nút chụp trên màn — tiệm dùng dây bấm).
async function liveReady(page) {
  await page.locator(".shoot-screen:not(.no-live)").waitFor({ timeout: 15000 });
  await page.locator(".shoot-webcam-badge", { hasText: "phím Space để chụp" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Chạm để chụp" }).count(), 0, "no tap-to-shoot button");
}

// Ảnh PNG 2 × 3 px làm ảnh khung mẫu.
const FRAME_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR4nGP4ULHgPwgzYDAA9FMSKzMCTzsAAAAASUVORK5CYII=", "base64");

async function booth(launched, { webcam, room = { _id: "room", flip: "device" }, extra = {}, lowPower = false, viewport = { width: 1366, height: 768 }, query = "" }) {
  const context = await launched.newContext({ viewport });
  if (launched === fakeCamera) await context.grantPermissions(["camera"]);
  const page = await context.newPage();
  const errors = [], videos = [], frameImages = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/kiosk/video") && r.method() === "POST")
      videos.push({ type: r.headers()["content-type"], size: r.postDataBuffer()?.length || 0 });
    if (r.url().includes("/api/frames/")) frameImages.push(new URL(r.url()).pathname + new URL(r.url()).search);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const booking = {
    _id: "fixture-booking", packageName: "Gói thử", shots: 3, selectCount: 1, photos: [], ...extra,
    captureDuration: 10, status: "checked_in",
    captureStartedAt: new Date().toISOString(),
    captureEndsAt: new Date(Date.now() + 600000).toISOString(),
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/frames/")) return route.fulfill({ body: FRAME_PNG, contentType: "image/png" });
    // /kiosk/finish trả về chính lượt chụp (không bọc trong { booking }) như máy chủ thật.
    await route.fulfill({ json: path.endsWith("/kiosk/ping") ? { room }
      : path.endsWith("/health") ? { ok: true }
      : path.endsWith("/kiosk/finish") ? { ...booking, status: "completed" } : { booking } });
  });
  await page.addInitScript(({ booking, webcam, lowPower }) => {
    // Ghi lại cách tạo bộ ghi video (thử máy bằng webcam: VP8 phần mềm, bitrate thấp — không H.264).
    window.__recorders = [];
    if (window.MediaRecorder) {
      const Native = window.MediaRecorder;
      window.MediaRecorder = class extends Native {
        constructor(stream, options = {}) {
          super(stream, options);
          window.__recorders.push({ mimeType: options.mimeType || "", bitrate: options.videoBitsPerSecond || 0 });
        }
      };
    }
    if (sessionStorage.getItem("photo-capture-fixture-device")) return;
    localStorage.setItem("kiosk-webcam-test", webcam ? "1" : "0");
    localStorage.setItem("kiosk-low-power", lowPower ? "1" : "0");
    sessionStorage.setItem("photo-capture-fixture-device", JSON.stringify({
      captureToken: "fixture-capture", accessToken: "fixture-album", booking, phase: "shoot", mode: "remote",
    }));
  }, { booking, webcam, lowPower });
  await page.goto(base + (room.kind === 'polaroid' ? '?canon-folder=1' : query));
  return { page, errors, videos, frameImages, close: () => context.close() };
}

test("without any camera the shoot screen explains it and offers the computer webcam for a test", async () => {
  const b = await booth(browser, { webcam: false });
  try {
    const card = b.page.getByRole("status").filter({ hasText: "Chưa có hình trực tiếp" });
    await card.waitFor();
    // Màn chụp sạch: không có chữ hướng dẫn bấm dây đè lên hình trực tiếp.
    await b.page.getByRole("button", { name: "Chụp xong, chọn ảnh" }).waitFor();
    assert.equal(await b.page.getByText("Nhấn nút trên dây bấm để chụp").count(), 0);
    assert.equal(await b.page.getByRole("button", { name: "Chụp xong, chọn ảnh" }).isDisabled(), true);
    await b.page.getByText("Chụp ít nhất 1 tấm").waitFor();
    await b.page.getByText("Ảnh vừa chụp sẽ hiện ở đây").waitFor();
    await card.getByRole("button", { name: /Dùng webcam máy tính/ }).click();
    await b.page.locator(".shoot-webcam-badge", { hasText: "Thử máy bằng webcam" }).waitFor();
    assert.equal(await b.page.evaluate(() => localStorage.getItem("kiosk-webcam-test")), "1");
    // Không có webcam thật: vẫn chưa có hình, chưa có nút chụp trên màn hình.
    assert.equal(await b.page.getByRole("button", { name: "Chạm để chụp" }).count(), 0);
    await b.page.getByRole("button", { name: "Tắt", exact: true }).click();
    assert.equal(await b.page.evaluate(() => localStorage.getItem("kiosk-webcam-test")), "0");
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test("frame images load while the guest is still shooting, so the Khung tab is ready right after", async () => {
  const b = await booth(fakeCamera, { webcam: true, query: "?frames=1" });
  try {
    await liveReady(b.page);
    // Chưa chụp tấm nào, vẫn ở màn chụp: ảnh khung gốc của khung đầu tiên và ảnh xem nhanh của mọi khung đã tải.
    for (let i = 0; i < 100 && b.frameImages.length < 3; i++) await b.page.waitForTimeout(100);
    assert.deepEqual([...new Set(b.frameImages)].sort(), [
      "/api/frames/f1/image?v=1",
      "/api/frames/f1/image?v=1&size=thumb",
      "/api/frames/f2/image?v=1&size=thumb",
    ]);
    assert.equal(await b.page.locator(".shoot-screen").count(), 1);
    assert.equal(await b.page.locator(".shoot-thumbs .shoot-thumb-no").count(), 0, "no photo taken yet");
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test("in webcam test mode the Space key counts down, takes a photo from the webcam and it can be chosen", async () => {
  const b = await booth(fakeCamera, { webcam: true });
  try {
    await liveReady(b.page);
    await b.page.keyboard.press("Space");
    await b.page.getByRole("timer").filter({ hasText: /^3$/ }).waitFor();
    await b.page.locator(".shoot-thumbs .shoot-thumb-no", { hasText: "1" }).waitFor({ timeout: 15000 });
    await mkdir(join(tmpdir(), "photobooth-fe-kiosk-webcam"), { recursive: true });
    await b.page.screenshot({ path: join(tmpdir(), "photobooth-fe-kiosk-webcam", "shoot-landscape.png") });
    const saved = await b.page.evaluate(() => JSON.parse(sessionStorage.getItem("photo-capture-fixture-device")));
    assert.equal(saved.captureOrder.length, 1);
    // Webcam laptop vẫn quay video tua nhanh, nhưng các đoạn quay ở chế độ nhẹ: WebM VP8 (không quay
    // H.264 phần cứng liên tục — đã làm sập tab Chrome trên máy thật).
    const recorders = await b.page.evaluate(() => window.__recorders);
    assert.ok(recorders.length > 0, "the timelapse is recorded");
    for (const r of recorders) {
      assert.match(r.mimeType, /^video\/webm/, `recorder ${r.mimeType}`);
      assert.ok(r.bitrate <= 5_000_000, `bitrate ${r.bitrate}`);
    }
    await b.page.getByRole("button", { name: "Chụp xong, chọn ảnh" }).click();
    await b.page.getByRole("heading", { name: /để chọn ảnh/ }).waitFor({ timeout: 20000 });
    const picks = b.page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await picks.first().waitFor();
    assert.equal(await picks.count(), 1);
    // Chụp xong: video tua nhanh ghép xong và gửi lên album — MP4 khi trình duyệt ghi được (iPhone chỉ
    // lưu MP4 vào app Ảnh), không thì WebM.
    for (let i = 0; i < 300 && !b.videos.length; i++) await b.page.waitForTimeout(100);
    assert.equal(b.videos.length, 1, "the timelapse video is uploaded");
    const mp4 = await b.page.evaluate(() => MediaRecorder.isTypeSupported("video/mp4"));
    const output = mp4 ? /^video\/mp4/ : /^video\/webm/;
    assert.match(b.videos[0].type, output);
    assert.ok(b.videos[0].size > 1000);
    const build = (await b.page.evaluate(() => window.__recorders)).slice(recorders.length);
    assert.ok(build.some((r) => output.test(r.mimeType)), `timelapse build: ${build.map((r) => r.mimeType)}`);
    // The generated video also plays on the QR screen, then releases its local
    // Blob URL when the next customer starts. Upload bytes above stay unchanged.
    await picks.first().click();
    await b.page.getByRole("button", { name: "Nhận ảnh", exact: true }).click();
    await b.page.waitForFunction(() => document.querySelector(".done-screen video")?.readyState >= 2);
    const videoUrl = await b.page.locator(".done-screen video").getAttribute("src");
    assert.match(videoUrl, /^blob:/);
    await b.page.evaluate(() => {
      window.releasedVideos = [];
      const revoke = URL.revokeObjectURL;
      URL.revokeObjectURL = url => { window.releasedVideos.push(url); revoke(url); };
    });
    await b.page.getByRole("button", { name: /Khách tiếp theo/ }).click();
    await b.page.waitForFunction(url => window.releasedVideos.includes(url), videoUrl);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

for (const count of [1, 2]) test(`Polaroid accepts 12 Canon JPEGs beyond its legacy quota and only selects ${count} photos`, async () => {
  const b = await booth(fakeCamera, {
    webcam: false,
    room: { _id: "room", flip: "device", kind: "polaroid" },
    // Even a legacy booking with a countdown must use the physical shutter JPEGs.
    extra: { shots: 2, selectCount: count, countdownSeconds: 3, printSize: "instax" },
  });
  try {
    await b.page.locator('.shoot-screen:not(.no-live)').waitFor();
    await b.page.waitForTimeout(3500);
    assert.equal(await b.page.locator('.shoot-thumbs .shoot-thumb-no').count(), 0, 'HDMI is preview only');
    assert.equal(await b.page.getByRole("button", { name: "Chạm để chụp" }).count(), 0);
    assert.equal(await b.page.getByText("Nhấn nút trên dây bấm để chụp").count(), 0);
    await b.page.evaluate(async () => {
      for (let i = 1; i <= 12; i++) await window.deliverCanonPhoto(i);
    });
    await b.page.waitForFunction(() => document.querySelectorAll('.shoot-thumbs .shoot-thumb-no').length === 12, null, { timeout: 30000 });
    assert.equal(await b.page.locator('.shoot-screen.phase-shoot').count(), 1, 'does not auto-finish at the legacy quota');
    await b.page.getByRole("button", { name: "Chụp xong, chọn ảnh" }).click();
    await b.page.getByRole("heading", { name: /để chọn ảnh/ }).waitFor({ timeout: 30000 });
    const picks = b.page.getByRole("group", { name: "Ảnh đã chụp" }).getByRole("button");
    await picks.nth(11).waitFor();
    assert.equal(await picks.count(), 12);
    for (let i = 0; i < count; i++) await picks.nth(i).click();
    const photoTab = b.page.getByRole('tab', { name: /^Chọn ảnh/ });
    if (await photoTab.count()) await photoTab.click();
    assert.equal(await picks.nth(count).isDisabled(), true, 'cannot pick more than the package allows');
    const saved = await b.page.evaluate(() => JSON.parse(sessionStorage.getItem('photo-capture-fixture-device')));
    assert.equal(saved.selected.length, count);
    // Phòng Polaroid không quay video tua nhanh: khách nhận ảnh gốc qua QR.
    assert.deepEqual(await b.page.evaluate(() => window.__recorders), [], "no timelapse recorder");
    await b.page.waitForTimeout(2000);
    assert.deepEqual(b.videos, [], "no video is uploaded");
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test("low-power mode draws the live view on a canvas, and the shot flash does not stay over it", async () => {
  const b = await booth(fakeCamera, { webcam: true, lowPower: true });
  try {
    await liveReady(b.page);
    // Hình trực tiếp hiện trên canvas (có hình thật), thẻ video vẫn chạy nhưng trong suốt.
    await b.page.waitForFunction(() => {
      const canvas = document.querySelector(".camera-preview-viewport.is-canvas canvas");
      if (!canvas?.width || getComputedStyle(canvas).visibility !== "visible") return false;
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < pixels.length; i += 4 * 997) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) return true;
      return false;
    }, null, { timeout: 15000 });
    assert.equal(await b.page.locator(".camera-preview-viewport video").evaluate((v) => getComputedStyle(v).opacity), "0");
    // Lớp nháy chỉ có 0,4 giây: theo dõi DOM thay vì dò định kỳ (dò thưa có thể bỏ lỡ).
    await b.page.evaluate(() => {
      window.__flashSeen = false;
      new MutationObserver(() => {
        if (document.querySelector(".camera-flash")) window.__flashSeen = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await b.page.keyboard.press("Space");
    await b.page.waitForFunction(() => window.__flashSeen, null, { timeout: 15000 });
    await b.page.locator(".camera-flash").waitFor({ state: "detached", timeout: 3000 });
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});

test("a portrait screen splits in two: the whole camera frame on top, the photo just taken large below", async () => {
  const b = await booth(fakeCamera, { webcam: true, viewport: { width: 540, height: 960 } });
  try {
    await liveReady(b.page);
    await b.page.locator(".shoot-screen.is-portrait").waitFor();
    await b.page.getByText("Ảnh vừa chụp sẽ hiện ở đây").first().waitFor();
    await b.page.keyboard.press("Space");
    const latest = b.page.locator(".shoot-latest img");
    await latest.waitFor({ timeout: 20000 });
    await b.page.waitForFunction(() => document.querySelector(".shoot-latest img")?.naturalWidth > 0);
    const [stage, rail, photo] = await Promise.all([
      b.page.locator(".shoot-stage").boundingBox(),
      b.page.locator(".shoot-rail").boundingBox(),
      latest.boundingBox(),
    ]);
    // Chia đôi màn: nửa trên hình trực tiếp, nửa dưới ảnh vừa chụp.
    assert.ok(Math.abs(stage.height - 480) <= 2 && Math.abs(rail.y - 480) <= 2, JSON.stringify({ stage, rail }));
    assert.ok(photo.y >= rail.y && photo.width >= 480 * 0.85, `ảnh vừa chụp phóng to: ${JSON.stringify(photo)}`);
    // Hình trực tiếp thấy đủ khung: phần còn thấy rộng đúng bằng màn (không bị cắt hai bên).
    const live = await b.page.locator(".camera-preview-viewport video").evaluate((v) => {
      const box = v.getBoundingClientRect();
      // inset(trên phải dưới trái): phần hình còn thấy = bề rộng video trừ phần cắt hai bên.
      // Trình duyệt rút gọn inset(a b c b) thành inset(a b c): trái bằng phải nếu thiếu.
      const [top, right = top, , left = right] = v.style.clipPath.match(/[\d.]+%/g).map(parseFloat);
      return { visible: box.width * (1 - (left + right) / 100), height: box.height };
    });
    assert.ok(Math.abs(live.visible - 540) < 2, `visible width ${live.visible}`);
    await b.page.getByText("Ảnh 1", { exact: true }).waitFor();
    const screenDir = join(tmpdir(), "photobooth-fe-kiosk-webcam");
    await mkdir(screenDir, { recursive: true });
    await b.page.screenshot({ path: join(screenDir, "shoot-portrait.png") });
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});


test("the live view and the photos flip together: like a mirror by default, straight only when the room says so", async () => {
  // Chủ tiệm chọn "như soi gương" (7/11): hình trực tiếp, ảnh và video đều lật, luôn giống nhau.
  const mirrored = await booth(fakeCamera, { webcam: true });
  try {
    await liveReady(mirrored.page);
    await mirrored.page.locator(".camera-preview-viewport.is-mirrored video").waitFor({ state: "attached" });
    assert.equal(await mirrored.page.locator(".camera-preview-viewport video").evaluate((v) => getComputedStyle(v).transform),
      "matrix(-1, 0, 0, 1, 0, 0)", "the screen is mirrored exactly like the photos it saves");
    assert.deepEqual(mirrored.errors, []);
  } finally { await mirrored.close(); }
  const straight = await booth(fakeCamera, { webcam: true, room: { _id: "room", flip: "off" } });
  try {
    await liveReady(straight.page);
    assert.equal(await straight.page.locator(".camera-preview-viewport.is-mirrored").count(), 0);
    assert.equal(await straight.page.locator(".camera-preview-viewport video").evaluate((v) => getComputedStyle(v).transform),
      "none", "not flipped on screen, as the photos are not flipped");
    assert.deepEqual(straight.errors, []);
  } finally { await straight.close(); }
});
