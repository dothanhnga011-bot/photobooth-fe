// Phòng Selfbooth trên điện thoại: khách quét QR → thả tim ảnh → làm đẹp → chọn khung → In (tấm Instax gửi
// tới máy in cạnh máy chụp). Đồng hồ do máy chủ đặt (edit-start); hết giờ tự gửi in.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { after, before, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

function png(width, height, color) {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(color(x, y), y * row + 1 + x * 4);
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const dataUrl = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;
// Kích thước ảnh JPEG (khung SOF).
function jpegSize(buf) {
  for (let i = 2; i < buf.length;) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}
// Khung Instax Wide 1800 × 1200, hai ô ảnh trong suốt.
const SLOTS = [
  { x: 0.03, y: 0.07, w: 0.455, h: 0.86, kind: "photo", photo: 1 },
  { x: 0.515, y: 0.07, w: 0.455, h: 0.86, kind: "photo", photo: 2 },
];
const inside = (x, y) => SLOTS.some((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
const frameArt = (border) => dataUrl(png(360, 240, (x, y) => (inside(x / 360, y / 240) ? [0, 0, 0, 0] : border)));
const FRAMES = [
  { _id: "white", name: "Trắng", printSize: "instax", active: true, image: frameArt([255, 255, 255, 255]), slots: SLOTS },
  { _id: "pink", name: "Hồng", printSize: "instax", active: true, image: frameArt([240, 150, 180, 255]), slots: SLOTS },
];
const photo = png(300, 200, (x) => (x < 150 ? [200, 120, 100, 255] : [100, 140, 200, 255]));

let server, browser, base, portrait;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter, Route, Routes } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { AlbumPage } from '/src/pages.jsx';
  import '/src/tailwind.css';
  const studio = ${JSON.stringify({ settings: {}, packages: [], frames: FRAMES })};
  createRoot(document.getElementById('root')).render(
    React.createElement(MemoryRouter, { initialEntries: ['/album/fixture-album'] },
      React.createElement(StudioContext.Provider, { value: studio },
        React.createElement(ToastProvider, null,
          React.createElement(Routes, null, React.createElement(Route, { path: '/album/:token', element: React.createElement(AlbumPage) }))))));
`;

before(async () => {
  portrait = await readFile(new URL('../src/admin/assets/rx1-preview-default.jpg', import.meta.url));
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:selfbooth.jsx" } },
    plugins: [tailwindcss(), { name: "selfbooth-fixture", enforce: "pre",
      resolveId: (id) => (id.startsWith("virtual:") ? "\0" + id : null),
      load: (id) => (id === "\0virtual:selfbooth.jsx" ? fixture : null) }],
  });
  const assets = new Map(bundle.output.map((a) => ["/" + a.fileName, a.code || a.source]));
  const entry = bundle.output.find((a) => a.isEntry).fileName;
  const css = bundle.output.filter((a) => a.fileName.endsWith(".css"));
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.webp') ? 'image/webp'
      : path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.woff2') ? 'font/woff2' : 'application/javascript';
    if (assets.has(path)) {
      res.setHeader("Content-Type", type);
      return res.end(assets.get(path));
    }
    if (/^\/fonts\/[\w-]+\.woff2$/.test(path) || path === '/logo-m-384.jpg') {
      res.setHeader('Content-Type', type);
      return res.end(await readFile(new URL('../public' + path, import.meta.url)));
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><div id="root"></div>${css.map((a) => `<link rel="stylesheet" href="/${a.fileName}">`).join("")}<script type="module" src="/${entry}"></script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

async function phone({ secondsLeft = 250, originalPending = false, photoCount = 4, printError = null, lostReply = false,
  viewport = { width: 390, height: 844 }, realPhoto = false } = {}) {
  const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
  const errors = [], prints = [], mediaRequests = [];
  let savedJob = null, failedOnce = false;
  page.on("pageerror", (e) => errors.push(e.message));
  const booking = {
    _id: "b", code: "246810", status: "completed", printSize: "instax", selectCount: 2, prints: 1, printSheets: 0,
    mediaExpiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    photos: Array.from({length:photoCount},(_,i)=>i+1).map((n) => ({ id: `p${n}`, number: n, kind: "original", ...(originalPending && {originalPending:true}) })),
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (/\/albums\/fixture-album\/photos\/p\d/.test(path)) {
      mediaRequests.push(url.searchParams.get('size'));
      return route.fulfill({ body: realPhoto ? portrait : photo, contentType: realPhoto ? 'image/jpeg' : "image/png" });
    }
    if (path.endsWith('/albums/fixture-album/print')) return route.fulfill({json:savedJob});
    if (path.endsWith("/albums/fixture-album/edit-start"))
      return route.fulfill({ json: { editEndsAt: new Date(Date.now() + secondsLeft * 1000).toISOString(), serverTime: Date.now() } });
    if (path.endsWith("/albums/fixture-album/print-pack")) {
      const headers = route.request().headers();
      prints.push({ sizes: headers["x-print-sheets"], frame: decodeURIComponent(headers["x-print-frame"]), key: headers["x-print-key"],
        body: route.request().postDataBuffer() });
      if(printError && !failedOnce){failedOnce=true;return route.fulfill({status:409,json:{message:printError}})}
      booking.printSheets = 1;
      savedJob={_id:'job',status:'pending',printSheets:1};
      if(lostReply && !failedOnce){failedOnce=true;return route.abort('failed')}
      return route.fulfill({ status: 201, json: { _id: "job", status: "pending", prints: 1, printSheets: 1 } });
    }
    if (path.endsWith("/albums/fixture-album")) return route.fulfill({ json: booking });
    return route.fulfill({ status: 404, json: { message: `unexpected ${path}` } });
  });
  await page.goto(`${base}/album/fixture-album`);
  return { page, errors, prints, mediaRequests, originalsReady:()=>{booking.photos.forEach(p=>delete p.originalPending)} };
}

test("heart two photos, change a colour, pick a frame and print one Instax Wide sheet; a 250-second clock runs", async () => {
  const { page, errors, prints } = await phone();
  try {
    await page.getByRole("heading", { name: "Thả tim ảnh để in" }).waitFor();
    assert.match(await page.getByRole("timer").innerText(), /^4:(10|09|08)$/);
    const next = page.getByRole("button", { name: /Tiếp tục/ });
    assert.equal(await next.isDisabled(), true, "the layout needs two photos");
    await page.getByRole("button", { name: "Thả tim ảnh 4" }).click();
    await page.getByRole("button", { name: "Thả tim ảnh 2" }).click();
    // Đủ ảnh: thả tim thêm thì nhắc bỏ bớt.
    await page.getByRole("button", { name: "Thả tim ảnh 1" }).click();
    await page.getByText("Layout này in 2 ảnh — bỏ tim một ảnh trước nhé.").waitFor();
    // Làm đẹp ảnh 4: đổi bộ lọc màu (không cần nhận diện khuôn mặt).
    await page.getByRole("button", { name: "Làm đẹp ảnh 4" }).click();
    const editor = page.getByRole("dialog", { name: "Làm đẹp ảnh 4" });
    for (const label of ["Mịn da", "Trắng da", "Thon mặt (V-Line)", "Má hồng"]) await editor.getByRole("tab", { name: label }).waitFor();
    await editor.getByRole("radio", { name: "Đen trắng" }).click();
    await editor.getByRole("button", { name: /Xong/ }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("selfbooth-v1-fixture-album")));
    assert.deepEqual(saved.hearts, ["p4", "p2"]);
    assert.equal(saved.adjusts.p4.filter, "mono");
    await page.getByText("Đã làm đẹp").waitFor();
    // Hai khung Instax: chọn khung hồng rồi xem lại và in.
    await next.click();
    await page.getByRole("heading", { name: "Chọn khung" }).waitFor();
    await page.getByRole("radio", { name: /Hồng/ }).click();
    await page.getByRole("button", { name: /Xem lại/ }).click();
    await page.getByRole("img", { name: "Ảnh in xem trước" }).waitFor();
    await page.getByRole("button", { name: /In ảnh/ }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 20000 });
    assert.equal(prints.length, 1);
    assert.equal(prints[0].frame, "Hồng");
    assert.equal(prints[0].key, saved.requestKey);
    assert.deepEqual(jpegSize(prints[0].body), [1260, 840], "one Instax Wide sheet");
    assert.equal(Number(prints[0].sizes), prints[0].body.length);
    // Sau khi in: vẫn lưu được toàn bộ ảnh.
    await page.getByRole("button", { name: /Lưu tất cả/ }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('phone controls fit narrow screens and the editor keeps the photo and Done button visible', async () => {
  const folder = resolve('.cache/main-flows');
  await mkdir(folder, { recursive: true });
  for (const viewport of [{width:390,height:844},{width:320,height:568}]) {
    const {page,errors} = await phone({viewport,realPhoto:true});
    try {
      await page.getByRole('heading',{name:'Thả tim ảnh để in'}).waitFor();
      await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>[...document.querySelectorAll('.studio-photos img')].every(img=>img.complete && img.naturalWidth>0));
      await page.locator('.studio-photos img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'page fits the viewport');
      await page.screenshot({path:resolve(folder,`phone-photos-${viewport.width}.png`),fullPage:true});
      await page.getByRole('button',{name:'Làm đẹp ảnh 4'}).click();
      await page.waitForFunction(()=>document.querySelector('.studio-editor canvas')?.width>300);
      const done=page.getByRole('button',{name:'Xong',exact:true});
      const box=await done.boundingBox();
      await page.screenshot({path:resolve(folder,`phone-editor-${viewport.width}.png`)});
      assert.ok(box.y>=0 && box.y+box.height<=viewport.height,`Done stays on screen: ${JSON.stringify(box)}`);
      const canvas=await page.locator('.studio-editor canvas').boundingBox();
      assert.ok(canvas.height>=100 && canvas.width<=viewport.width,'photo stays usable above the controls');
      const tabs=await page.getByRole('tablist',{name:'Làm đẹp',exact:true}).boundingBox();
      const filters=await page.getByRole('radiogroup',{name:'Bộ lọc màu'}).boundingBox();
      assert.ok(canvas.y+canvas.height<=tabs.y+1 && tabs.y+tabs.height<=filters.y,'image never covers the adjustment controls');
      assert.deepEqual(errors,[]);
    } finally { await page.close(); }
  }
});

test("when the time is up, the photos being chosen (topped up) go to the printer by themselves", async () => {
  const { page, errors, prints } = await phone({ secondsLeft: 0 });
  try {
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 20000 });
    assert.equal(prints.length, 1);
    // Chưa chọn khung: khung đầu tiên của danh sách (xếp theo tên: Hồng, Trắng).
    assert.equal(prints[0].frame, "Hồng");
    assert.deepEqual(jpegSize(prints[0].body), [1260, 840]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('an expired phone selection waits for camera originals instead of printing cached previews',async()=>{
  const {page,prints,mediaRequests,originalsReady,errors}=await phone({secondsLeft:0,originalPending:true});
  try{
    await page.getByText(/Đang nhận 4 ảnh gốc chất lượng cao/).waitFor();
    await page.waitForTimeout(300);
    assert.equal(prints.length,0);
    assert.equal(mediaRequests.includes('print'),false);
    originalsReady();
    await page.getByRole('button',{name:'Làm mới ảnh'}).click();
    await page.getByRole('heading',{name:'Đã gửi in!'}).waitFor({timeout:20000});
    assert.equal(prints.length,1);
    assert.ok(mediaRequests.includes('print'));
    assert.deepEqual(jpegSize(prints[0].body),[1260,840]);
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('a print conflict with the word in does not pretend paper has been sent',async()=>{
  const {page,prints,errors}=await phone({secondsLeft:0,printError:'Các tờ in của yêu cầu này đã thay đổi. Vui lòng kiểm tra yêu cầu đã gửi.'});
  try{
    await page.getByText(/Các tờ in của yêu cầu này đã thay đổi/).waitFor({timeout:20000});
    assert.equal(await page.getByRole('heading',{name:'Đã gửi in!'}).count(),0);
    await page.getByRole('button',{name:'Kiểm tra và thử lại'}).click();
    await page.getByRole('heading',{name:'Đã gửi in!'}).waitFor({timeout:20000});
    assert.equal(prints.length,2);
    assert.equal(prints[0].key,prints[1].key);
    assert.ok(prints[0].body.equals(prints[1].body),'retry keeps the exact already-prepared sheet');
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('a lost print response is recovered by looking up the job, without sending a second sheet',async()=>{
  const {page,prints,errors}=await phone({secondsLeft:0,lostReply:true});
  try{
    await page.getByRole('button',{name:'Kiểm tra và thử lại'}).waitFor({timeout:20000});
    await page.getByRole('button',{name:'Kiểm tra và thử lại'}).click();
    await page.getByRole('heading',{name:'Đã gửi in!'}).waitFor();
    assert.equal(prints.length,1);
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('a layout with only one captured photo still fills its two slots',async()=>{
  const {page,prints,errors}=await phone({photoCount:1});
  try{
    await page.getByText(/Ảnh bạn chọn sẽ được lặp để đủ 2 ô/).waitFor();
    await page.getByRole('button',{name:'Thả tim ảnh 1'}).click();
    await page.getByRole('button',{name:/Tiếp tục/}).click();
    await page.getByRole('button',{name:/Xem lại/}).click();
    await page.getByRole('img',{name:'Ảnh in xem trước'}).waitFor();
    await page.getByRole('button',{name:'In ảnh',exact:true}).click();
    await page.getByRole('heading',{name:'Đã gửi in!'}).waitFor({timeout:20000});
    assert.deepEqual(jpegSize(prints[0].body),[1260,840]);
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});
