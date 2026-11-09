import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build } from "vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base, videoBytes;
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGxoAAAAASUVORK5CYII=", "base64");
const storage = "https://fixture.r2.cloudflarestorage.com/media/";
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { ToastProvider } from '/src/studio.jsx';
  import { AlbumViewer } from '/src/album/AlbumViewer.jsx';
  import { composePreview, renderPrintFrame } from '/src/kiosk/compose.js';
  window.renderGuestFrame = renderPrintFrame;
  window.composeFramePreview = composePreview;
  const root = createRoot(document.getElementById('root'));
  window.showAlbum = booking => root.render(React.createElement(ToastProvider, null,
    React.createElement(AlbumViewer, { token: 'fixture', booking })));
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:album-media.jsx" } },
    plugins: [{
      name: "album-media-fixture", enforce: "pre",
      resolveId: id => id.startsWith("virtual:") ? "\0" + id : null,
      load: id => id === "\0virtual:album-media.jsx" ? fixture : null,
    }],
  });
  const assets = new Map(bundle.output.map(asset => ["/" + asset.fileName, asset.code || asset.source]));
  const entry = bundle.output.find(asset => asset.isEntry).fileName;
  server = createServer((req, res) => {
    res.setHeader("Content-Type", assets.has(req.url) ? "application/javascript" : "text/html; charset=utf-8");
    res.end(assets.get(req.url) || `<div id="root"></div><script type="module" src="/${entry}"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(base);
  videoBytes = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 48;
    const ctx = canvas.getContext("2d"), stream = canvas.captureStream(30), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? "#2288cc" : "#cc8822";
      ctx.fillRect(0, 0, 64, 48);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    recorder.stop(); await stopped;
    stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  }));
  await page.close();
});

after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

function booking(signature = "first") {
  const until = new Date(Date.now() + 300000).toISOString();
  return {
    code: "123456", status: "completed", printSheets: 0,
    video: { size: videoBytes.length, mimeType: "video/webm", links: { until, original: `${storage}video.webm?sig=${signature}` } },
    composite: { links: { until, original: `${storage}composite.jpg?sig=${signature}`, thumbnail: `${storage}thumb.jpg?sig=${signature}` } },
    photos: [{ id: "photo", kind: "original", links: { until, preview: `${storage}preview.jpg?sig=${signature}`, thumbnail: `${storage}photo-thumb.jpg?sig=${signature}` } }],
  };
}

test("album displays R2 media directly and refreshed links do not restart a playing video", async () => {
  const page = await browser.newPage(), errors = [], apiCalls = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { apiCalls.push(route.request().url()); return route.abort(); });
  await page.route(storage + "**", route => route.fulfill({
    contentType: route.request().url().includes("video.webm") ? "video/webm" : "image/png",
    body: route.request().url().includes("video.webm") ? videoBytes : imageBytes,
  }));
  try {
    await page.goto(base);
    await page.evaluate(value => window.showAlbum(value), booking());
    const composite = page.locator(".album-viewer-stage img.album-viewer-main");
    await composite.waitFor();
    assert.equal(await composite.getAttribute("src"), storage + "composite.jpg?sig=first");
    await page.getByRole("tab", { name: "Video tua nhanh" }).click();
    await page.waitForFunction(() => document.querySelector("video")?.videoWidth === 64);
    await page.evaluate(() => { window.playingVideo = document.querySelector("video"); window.playingVideo.pause(); });
    await page.evaluate(value => window.showAlbum(value), booking("refreshed"));
    assert.equal(await page.locator("video").getAttribute("src"), storage + "video.webm?sig=first");
    assert.equal(await page.evaluate(() => window.playingVideo === document.querySelector("video")), true);
    await page.getByRole("tab", { name: "Ảnh 1", exact: true }).click();
    assert.equal(await page.locator(".album-viewer-stage img.album-viewer-main").getAttribute("src"), storage + "preview.jpg?sig=refreshed");
    assert.deepEqual(apiCalls, [], "viewing uses no API byte relay");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("unavailable or expired R2 media falls back to the authenticated image and video streams", async () => {
  const page = await browser.newPage(), calls = [];
  await page.route(storage + "**", route => route.abort());
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    calls.push(url.pathname + url.search);
    return url.searchParams.has("direct") ? route.fulfill({ status: 503, body: "storage unavailable" })
      : route.fulfill({ contentType: url.pathname.endsWith("video") ? "video/webm" : "image/png",
        body: url.pathname.endsWith("video") ? videoBytes : imageBytes });
  });
  try {
    await page.goto(base);
    await page.evaluate(value => window.showAlbum(value), booking());
    await page.waitForFunction(() => {
      const image = document.querySelector(".album-viewer-stage img.album-viewer-main");
      return image?.complete && image.naturalWidth > 0 && image.getAttribute("src") === "/api/albums/fixture/composite";
    });
    await page.getByRole("tab", { name: "Video tua nhanh" }).click();
    await page.waitForFunction(() => document.querySelector("video")?.videoWidth === 64);
    assert.equal(await page.locator("video").getAttribute("src"), "/api/albums/fixture/video");
    assert.ok(calls.includes("/api/albums/fixture/video?direct=1"));
    assert.ok(calls.includes("/api/albums/fixture/video"));
  } finally { await page.close(); }
});

test("a newly uploaded composite replaces the legacy print sheet already on screen", async () => {
  const page = await browser.newPage();
  await page.route(storage + "**", route => route.fulfill({ contentType: "image/png", body: imageBytes }));
  await page.route("**/api/**", route => new URL(route.request().url()).pathname.endsWith("/print")
    ? route.fulfill({ json: { _id: "legacy-sheet" } })
    : route.fulfill({ contentType: "image/png", body: imageBytes }));
  try {
    await page.goto(base);
    const old = booking();
    delete old.composite; delete old.video;
    await page.evaluate(value => window.showAlbum(value), old);
    await page.waitForFunction(() => document.querySelector(".album-viewer-stage img.album-viewer-main")?.getAttribute("src") ===
      "/api/albums/fixture/prints/legacy-sheet?direct=1");
    await page.evaluate(value => window.showAlbum(value), booking());
    await page.waitForFunction(expected => document.querySelector(".album-viewer-stage img.album-viewer-main")?.getAttribute("src") === expected,
      storage + "composite.jpg?sig=first");
    assert.equal(await page.getByRole("tab", { name: "Ảnh ghép khung" }).locator("img").getAttribute("src"),
      storage + "thumb.jpg?sig=first");
  } finally { await page.close(); }
});

test("the big photo shows its thumbnail at once while the sharp version loads, and the next photo is fetched ahead", async () => {
  const page = await browser.newPage(), requested = [], errors = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.abort());
  await page.route(storage + "**", async route => {
    const url = route.request().url();
    requested.push(new URL(url).pathname.split("/").pop());
    // Ảnh nét của ảnh 1 tải chậm (mạng điện thoại).
    if (url.includes("/preview.jpg")) await held;
    await route.fulfill({ contentType: "image/png", body: imageBytes }).catch(() => {});
  });
  try {
    await page.goto(base);
    const album = booking();
    const { until } = album.photos[0].links;
    album.photos.push({ id: "second", kind: "original",
      links: { until, preview: `${storage}preview-2.jpg?sig=first`, thumbnail: `${storage}photo-thumb-2.jpg?sig=first` } });
    await page.evaluate(value => window.showAlbum(value), album);
    await page.getByRole("tab", { name: "Ảnh 1", exact: true }).click();
    const placeholder = page.locator(".album-viewer-placeholder");
    await placeholder.waitFor();
    assert.equal(await placeholder.getAttribute("src"), storage + "photo-thumb.jpg?sig=first",
      "the same thumbnail as in the strip below, so it is already in the browser cache");
    assert.equal(await page.locator(".album-viewer-main").getAttribute("src"), storage + "preview.jpg?sig=first");
    assert.ok(requested.includes("preview-2.jpg"), "the neighbouring photo was fetched before it was opened");
    release();
    await placeholder.waitFor({ state: "detached" });
    assert.equal(await page.locator(".album-viewer-main").evaluate(img => img.complete && img.naturalWidth > 0), true);
    assert.deepEqual(errors, []);
  } finally { release(); await page.close(); }
});

test("iPhone Save all shares prepared guest JPEGs and never the unmirrored camera links", async () => {
  const page = await browser.newPage({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1" });
  const requests = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: () => true });
    Object.defineProperty(navigator, "share", { value: async ({ files }) => {
      window.shared = await Promise.all(files.map(async file => ({ name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] })));
    } });
  });
  await page.route("**/api/**", route => route.abort());
  await page.route(storage + "**", route => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: "image/jpeg", body: imageBytes,
      headers: { "Access-Control-Allow-Origin": "*" } });
  });
  try {
    await page.goto(base);
    const value = booking();
    value.video = undefined;
    value.photos[0].links.original = storage + "camera-unmirrored.jpg";
    value.photos[0].links.download = storage + "guest-mirrored.jpg";
    await page.evaluate(value => window.showAlbum(value), value);
    await page.getByRole("button", { name: "Lưu tất cả (2)", exact: true }).click();
    await page.waitForFunction(() => window.shared?.length === 2);
    const shared = await page.evaluate(() => window.shared);
    assert.deepEqual(shared.map(file => file.name), ["NXC-123456-anh-ghep.jpg", "NXC-123456-01.jpg"]);
    assert.deepEqual(Buffer.from(shared[1].bytes), imageBytes);
    assert.ok(requests.includes(storage + "guest-mirrored.jpg"));
    assert.ok(!requests.includes(storage + "camera-unmirrored.jpg"));
    await page.getByRole("tab", { name: "Ảnh 1", exact: true }).click();
    await page.getByRole("button", { name: "Lưu ảnh", exact: true }).click();
    await page.waitForFunction(() => window.shared?.length === 1);
    assert.equal((await page.evaluate(() => window.shared))[0].name, "NXC-123456-01.jpg");
  } finally { await page.close(); }
});

test("browser downloads request the guest endpoint and pending originals cannot be saved as previews", async () => {
  const page = await browser.newPage();
  await page.route(storage + "**", route => route.fulfill({ contentType: "image/png", body: imageBytes }));
  await page.route("**/api/**", route => route.fulfill({ contentType: "image/jpeg", body: imageBytes,
    headers: { "Content-Disposition": 'attachment; filename="NXC-123456-01.jpg"' } }));
  try {
    await page.goto(base);
    const value = booking();
    await page.evaluate(value => window.showAlbum(value), value);
    await page.getByRole("tab", { name: "Ảnh 1", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Lưu ảnh", exact: true }).click();
    const result = await download;
    const url = new URL(result.url());
    assert.equal(url.pathname, "/api/albums/fixture/photos/photo");
    assert.equal(url.searchParams.get("download"), "1");
    assert.equal(url.searchParams.get("direct"), "1");
    assert.equal(result.suggestedFilename(), "NXC-123456-01.jpg");
    value.photos[0].originalPending = true;
    await page.evaluate(value => window.showAlbum(value), value);
    assert.equal(await page.getByRole("button", { name: "Lưu ảnh", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Lưu tất cả (3)", exact: true }).isDisabled(), true);
  } finally { await page.close(); }
});

test("new guest composites render near 20 MP for portrait, landscape, single strips and Instax frames", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(base);
    const sizes = await page.evaluate(async () => {
      const results = [];
      for (const [width, height, printSize] of [[2, 3, "full"], [3, 2, "full"], [1, 3, "strip"], [3, 2, "instax"]]) {
        const background = document.createElement("canvas");
        background.width = width; background.height = height;
        background.getContext("2d").fillRect(0, 0, width, height);
        const frame = { image: background.toDataURL(), printSize, slots: [] };
        const guest = await window.renderGuestFrame(frame, [], "token", "", { pixels: 20_000_000, strict: true });
        results.push({ width: guest.width, height: guest.height, ratio: width / height });
        guest.width = guest.height = 0;
        const print = await window.renderGuestFrame(frame, [], "token", "", { scale: 2 });
        results.at(-1).printPixels = print.width * print.height;
        print.width = print.height = 0;
      }
      return results;
    });
    for (const size of sizes) {
      assert.ok(size.width * size.height <= 20_000_000);
      assert.ok(size.width * size.height > 19_980_000);
      assert.ok(Math.abs(size.width / size.height - size.ratio) < 0.002);
      assert.ok(size.printPixels <= 8_640_000, "physical print sizes retain their existing resolution");
    }
  } finally { await page.close(); }
});

test("print rendering preserves preview colours and highlights without extra sharpening", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(base);
    const diff = await page.evaluate(async () => {
      const camera = document.createElement("canvas");
      camera.width = 1200; camera.height = 1800;
      const ctx = camera.getContext("2d"), data = ctx.createImageData(camera.width, camera.height);
      for (let y = 0; y < camera.height; y++) for (let x = 0; x < camera.width; x++) {
        const i = (y * camera.width + x) * 4;
        data.data.set((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? [248, 230, 201, 255] : [222, 211, 190, 255], i);
      }
      ctx.putImageData(data, 0, 0);
      const image = await new Promise(resolve => camera.toBlob(resolve, "image/png"));
      const background = document.createElement("canvas");
      background.width = 2; background.height = 3;
      const frame = { image: background.toDataURL(), printSize: "full", slots: [{ x: 0, y: 0, w: 1, h: 1, kind: "photo" }] };
      const preview = await window.composeFramePreview(frame, [camera], "print");
      const print = await window.renderGuestFrame(frame, [{ key: "photo", image }], "token", "", { strict: true });
      const before = preview.getContext("2d").getImageData(0, 0, 1200, 1800).data;
      const after = print.getContext("2d").getImageData(0, 0, 1200, 1800).data;
      let max = 0, changed = 0;
      for (let i = 0; i < before.length; i++) {
        const difference = Math.abs(before[i] - after[i]);
        max = Math.max(max, difference);
        if (difference) changed++;
      }
      camera.width = camera.height = preview.width = preview.height = print.width = print.height = 0;
      return { max, changed };
    });
    assert.deepEqual(diff, { max: 0, changed: 0 });
  } finally { await page.close(); }
});
