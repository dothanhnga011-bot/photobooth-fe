// Album mở từ mã QR: index.html hỏi máy chủ danh sách ảnh ngay khi trang vừa tới, song song với lúc tải mã
// JS (trên 4G mất ~2 s) — đo bằng bản build thật (index.html thật), mã JS bị làm chậm 1,5 s.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const TOKEN = "a".repeat(48);
const ALBUM = { _id: "b1", code: "135790", status: "completed", printSize: "full", prints: 1, photos: [],
  mediaExpiresAt: new Date(Date.now() + 86400000).toISOString() };
const TYPES = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8",
  ".woff2": "font/woff2", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".png": "image/png" };
let dist, server, browser, base, log, failFirstAlbum;

before(async () => {
  dist = await mkdtemp(join(tmpdir(), "album-prefetch-"));
  const apiUrl = process.env.VITE_API_URL;
  process.env.VITE_API_URL = ""; // như bản Cloudflare: /api cùng địa chỉ web
  try {
    await build({ root, logLevel: "error", build: { outDir: dist, emptyOutDir: true } });
  } finally {
    if (apiUrl === undefined) delete process.env.VITE_API_URL; else process.env.VITE_API_URL = apiUrl;
  }
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const at = Date.now();
    if (url.pathname === `/api/albums/${TOKEN}`) {
      log.album.push(at);
      if (failFirstAlbum && log.album.length === 1) return req.socket.destroy(); // mất mạng giữa chừng
      await new Promise((resolve) => setTimeout(resolve, 300)); // máy chủ + cơ sở dữ liệu
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(ALBUM));
    }
    if (url.pathname === "/api/catalog") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ rooms: [], packages: [], frames: [], settings: {}, stickers: [], screens: [] }));
    }
    if (url.pathname.startsWith("/api/")) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ message: "Không tìm thấy." }));
    }
    const file = url.pathname.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(url.pathname) ? url.pathname : "/index.html";
    let body;
    try { body = await readFile(join(dist, file)); } catch { res.statusCode = 404; return res.end(); }
    // Mã JS chính (React) tải chậm như trên 4G.
    if (/\/assets\/vendor-.*\.js$/.test(file)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      log.vendorSent = Date.now();
    }
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  if (dist) await rm(dist, { recursive: true, force: true });
});

async function openAlbum() {
  log = { album: [], vendorSent: 0 };
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/album/${TOKEN}`);
  await page.getByText(`#${ALBUM.code}`).waitFor({ timeout: 15000 });
  return { page, errors };
}

test("the album list is requested as the page arrives, before the app code, and only once", async () => {
  failFirstAlbum = false;
  const { page, errors } = await openAlbum();
  try {
    assert.equal(log.album.length, 1, "the app adopts the early answer instead of asking again");
    assert.ok(log.vendorSent > 0, "the slow app code was served");
    assert.ok(log.album[0] < log.vendorSent - 1000,
      `asked ${log.vendorSent - log.album[0]} ms before the app code finished downloading`);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("a lost early answer falls back to an ordinary request: the album still opens", async () => {
  failFirstAlbum = true;
  const { page, errors } = await openAlbum();
  try {
    assert.equal(log.album.length, 2, "one early request (lost) and one ordinary retry");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
