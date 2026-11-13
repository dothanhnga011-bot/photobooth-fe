// Phòng Selfbooth trên điện thoại (4 bước như Selfbooth): khách quét QR → Chọn ảnh (thả tim, làm đẹp) → Chọn
// khung → Thêm ảnh (ảnh nào vào ô nào, kéo / phóng) → In (tấm Instax gửi tới máy in cạnh máy chụp). Đồng hồ do
// máy chủ đặt (edit-start); hết giờ tự gửi in.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
// Ảnh số n một màu riêng: đọc màu ở giữa ô của ảnh in để biết ảnh nào vào ô nào.
const COLORS = { 1: [220, 40, 40, 255], 2: [40, 180, 60, 255], 3: [40, 80, 220, 255], 4: [230, 200, 30, 255] };
const photos = Object.fromEntries(Object.entries(COLORS).map(([n, c]) => [n, png(300, 400, () => c)]));

let server, browser, base, portrait;
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter, Route, Routes } from 'react-router-dom';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { AlbumPage } from '/src/pages.jsx';
  import { TEST_FRAMES, drawTestFrame, testFrameRegions } from '/src/admin/polaroid-presets.js';
  import '/src/kiosk/decor-fonts.js';
  import '/src/tailwind.css';
  // ?trial: dùng đúng 2 khung thử Mellow mà nút "Tạo 2 khung thử" trong quản trị tạo ra.
  (async () => {
    const frames = new URLSearchParams(location.search).has('trial')
      ? await Promise.all(TEST_FRAMES.map(async (design, i) => ({
        _id: 'trial' + i, name: design.name, printSize: 'instax', active: true, order: 0, dateColor: '#4b332a',
        image: await drawTestFrame(design), slots: testFrameRegions(design),
      })))
      : ${JSON.stringify(FRAMES)};
    window.fixtureFrames = frames;
    const studio = { settings: {}, packages: [], frames };
    createRoot(document.getElementById('root')).render(
      React.createElement(MemoryRouter, { initialEntries: ['/album/fixture-album'] },
        React.createElement(StudioContext.Provider, { value: studio },
          React.createElement(ToastProvider, null,
            React.createElement(Routes, null, React.createElement(Route, { path: '/album/:token', element: React.createElement(AlbumPage) }))))));
  })();
`;

before(async () => {
  await mkdir(resolve('.cache/main-flows'), { recursive: true });
  portrait = await readFile(new URL('../src/admin/assets/rx1-preview-default.jpg', import.meta.url));
  const bundle = await build({
    // Ổ đĩa viết hoa ("C:", như đường dẫn thật Vite đọc ra cho node_modules): thư mục đang đứng có thể là "c:",
    // khác chữ hoa ổ đĩa thì Vite nạp React (và ngữ cảnh Toast) hai lần.
    root: fileURLToPath(new URL('..', import.meta.url)).replace(/^[a-z]:/, (drive) => drive.toUpperCase()),
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
  viewport = { width: 390, height: 844 }, realPhoto = false, trial = false } = {}) {
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
    const media = path.match(/\/albums\/fixture-album\/photos\/p(\d)/);
    if (media) {
      mediaRequests.push(url.searchParams.get('size'));
      return route.fulfill({ body: realPhoto ? portrait : photos[media[1]], contentType: realPhoto ? 'image/jpeg' : "image/png" });
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
  await page.goto(`${base}/album/fixture-album${trial ? "?trial" : ""}`);
  return { page, errors, prints, mediaRequests, originalsReady:()=>{booking.photos.forEach(p=>delete p.originalPending)} };
}

const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("selfbooth-v1-fixture-album")));
// Màu ở điểm (tỉ lệ 0–1) của ảnh ghép khung trên màn "Đã gửi in!".
const compositeColor = (page, fx, fy) => page.evaluate(async ([fx, fy]) => {
  const img = document.querySelector('img[alt="Ảnh đã ghép khung"]');
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return [...ctx.getImageData(Math.round(fx * canvas.width), Math.round(fy * canvas.height), 1, 1).data].slice(0, 3);
}, [fx, fy]);
const grey = ([r, g, b]) => Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r > 120;
const step = (page) => page.locator('.selfbooth-steps [aria-current="step"]').textContent();

test("the four Selfbooth steps: heart freely, pick a frame, put photos into slots (one photo twice, zoom, drag), print one Instax Wide sheet", async () => {
  const { page, errors, prints } = await phone();
  try {
    await page.getByRole("heading", { name: "Thả tim ảnh bạn thích" }).waitFor();
    assert.match(await page.getByRole("timer").innerText(), /^4:(10|09|08)$/);
    assert.equal((await step(page)).trim(), "Chọn ảnh");
    const next = page.getByRole("button", { name: /Tiếp tục/ });
    assert.equal(await next.isDisabled(), true, "heart at least one photo first");
    assert.equal(await page.getByRole("button", { name: /Chọn khung/ }).isDisabled(), true);
    // Thả tim không giới hạn (như Selfbooth): 3 ảnh cho khung 2 ô.
    for (const n of [4, 2, 1]) await page.getByRole("button", { name: `Thả tim ảnh ${n}` }).click();
    await page.getByRole("button", { name: "Bỏ tim ảnh 1" }).waitFor();
    // Làm đẹp ảnh 4: đổi bộ lọc màu (không cần nhận diện khuôn mặt).
    await page.getByRole("button", { name: "Làm đẹp ảnh 4" }).click();
    const editor = page.getByRole("dialog", { name: "Làm đẹp ảnh 4" });
    for (const label of ["Mịn da", "Trắng da", "Thon mặt (V-Line)", "Má hồng"]) await editor.getByRole("tab", { name: label }).waitFor();
    await editor.getByRole("radio", { name: "Đen trắng" }).click();
    await editor.getByRole("button", { name: /Xong/ }).click();
    let saved = await stored(page);
    assert.deepEqual(saved.hearts, ["p4", "p2", "p1"]);
    assert.equal(saved.adjusts.p4.filter, "mono");
    await page.getByText("Đã làm đẹp").waitFor();
    // Bước 2: chọn khung hồng.
    await next.click();
    await page.getByRole("heading", { name: "Chọn khung" }).waitFor();
    await page.getByRole("radio", { name: /Hồng/ }).click();
    await next.click();
    // Bước 3: thêm ảnh. Mặc định các ô theo thứ tự thả tim (ảnh 4, ảnh 2); ảnh thả tim thứ ba chờ ở dải ảnh.
    await page.getByRole("heading", { name: "Thêm ảnh vào khung" }).waitFor();
    assert.equal((await step(page)).trim(), "Thêm ảnh");
    const stage = page.getByRole("img", { name: "Khung đang ghép" });
    await stage.waitFor();
    assert.equal(await page.locator(".studio-strip li").count(), 3);
    assert.equal(await page.getByRole("radio", { name: /Ô 1/ }).getAttribute("aria-checked"), "true");
    // Ô 2 cũng lấy ảnh 4 (một ảnh vào nhiều ô).
    await page.getByRole("radio", { name: /Ô 2/ }).click();
    await page.getByRole("button", { name: "Đặt ảnh 4 vào ô 2" }).click();
    await page.getByText("Ô 1, 2").waitFor();
    saved = await stored(page);
    assert.deepEqual(saved.slots, ["p4", "p4"]);
    // Phóng ảnh ở ô 2, kéo ảnh ở ô 1 (chạm vào ô 1 trên khung thì ô 1 được chọn).
    await page.getByRole("slider", { name: "Phóng to ảnh ở ô 2" }).fill("150");
    const box = await stage.boundingBox();
    const sx = box.x + box.width * 0.2575, sy = box.y + box.height * 0.5;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 30, sy + 10, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("selfbooth-v1-fixture-album")).transforms?.[0]?.x > 0);
    assert.equal(await page.getByRole("radio", { name: /Ô 1/ }).getAttribute("aria-checked"), "true");
    saved = await stored(page);
    assert.equal(saved.transforms[1].zoom, 1.5);
    assert.ok(saved.transforms[0].x > 0 && saved.transforms[0].x < 1);
    await page.screenshot({ path: resolve(".cache/main-flows/phone-compose-390.png"), fullPage: true });
    // Bước 4: xem lại và in.
    await page.getByRole("button", { name: /Xem lại/ }).click();
    await page.getByRole("heading", { name: "Xem lại & in" }).waitFor();
    await page.getByRole("img", { name: "Ảnh in xem trước" }).waitFor();
    await page.getByRole("button", { name: /In ảnh/ }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 20000 });
    assert.equal(prints.length, 1);
    assert.equal(prints[0].frame, "Hồng");
    assert.equal(prints[0].key, saved.requestKey);
    assert.deepEqual(jpegSize(prints[0].body), [1260, 840], "one Instax Wide sheet");
    assert.equal(Number(prints[0].sizes), prints[0].body.length);
    // Cả hai ô in ảnh 4 đã làm đẹp (đen trắng), không phải ảnh 2 (xanh lá).
    for (const fx of [0.2575, 0.7425]) {
      const color = await compositeColor(page, fx, 0.5);
      assert.ok(grey(color), `slot at ${fx} prints the black & white photo 4: ${color}`);
    }
    // Sau khi in: vẫn lưu được toàn bộ ảnh.
    await page.getByRole("button", { name: /Lưu tất cả/ }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("the two Mellow trial frames from admin go through the whole phone flow", async () => {
  const { page, errors, prints } = await phone({ trial: true });
  try {
    await page.getByRole("heading", { name: "Thả tim ảnh bạn thích" }).waitFor();
    for (const n of [3, 1]) await page.getByRole("button", { name: `Thả tim ảnh ${n}` }).click();
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    // Gói chọn 2 ảnh: chỉ khung thử 2 ô.
    await page.getByRole("radio", { name: "Khung thử Mellow · 2 ảnh" }).waitFor();
    assert.equal(await page.getByRole("radio").count(), 1);
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await page.getByRole("img", { name: "Khung đang ghép" }).waitFor();
    await page.screenshot({ path: resolve(".cache/main-flows/phone-compose-trial.png"), fullPage: true });
    await page.getByRole("button", { name: /Xem lại/ }).click();
    await page.getByRole("button", { name: /In ảnh/ }).click();
    await page.getByRole("heading", { name: "Đã gửi in!" }).waitFor({ timeout: 20000 });
    assert.equal(prints[0].frame, "Khung thử Mellow · 2 ảnh");
    assert.deepEqual(jpegSize(prints[0].body), [1260, 840]);
    // Ảnh 3 (xanh dương) ô trái, ảnh 1 (đỏ) ô phải; nền giấy hồng phấn ở dải chữ dưới.
    const [left, right] = [await compositeColor(page, 0.27, 0.45), await compositeColor(page, 0.73, 0.45)];
    assert.ok(left[2] > 170 && left[0] < 90, `photo 3 on the left: ${left}`);
    assert.ok(right[0] > 170 && right[2] < 90, `photo 1 on the right: ${right}`);
    await page.locator('img[alt="Ảnh đã ghép khung"]').screenshot({ path: resolve(".cache/main-flows/trial-print.png") });
    // Ảnh khung thử: PNG đúng cỡ Instax Wide 1800 × 1200.
    const arts = await page.evaluate(() => window.fixtureFrames.map((f) => f.image));
    for (const [i, art] of arts.entries()) {
      const bytes = Buffer.from(art.split(",")[1], "base64");
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1800, 1200]);
      await writeFile(resolve(`.cache/main-flows/trial-frame-${i + 1}.png`), bytes);
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('phone controls fit narrow screens and the editor keeps the photo and Done button visible', async () => {
  const folder = resolve('.cache/main-flows');
  await mkdir(folder, { recursive: true });
  for (const viewport of [{width:390,height:844},{width:320,height:568}]) {
    const {page,errors} = await phone({viewport,realPhoto:true});
    try {
      await page.getByRole('heading',{name:'Thả tim ảnh bạn thích'}).waitFor();
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
    await page.getByRole('button',{name:'Thả tim ảnh 1'}).click();
    await page.getByRole('button',{name:/Tiếp tục/}).click();
    await page.getByRole('button',{name:/Tiếp tục/}).click();
    await page.getByText(/ảnh được lặp cho đủ ô/).waitFor();
    await page.getByText('Ô 1, 2').waitFor();
    await page.getByRole('button',{name:/Xem lại/}).click();
    await page.getByRole('img',{name:'Ảnh in xem trước'}).waitFor();
    await page.getByRole('button',{name:'In ảnh',exact:true}).click();
    await page.getByRole('heading',{name:'Đã gửi in!'}).waitFor({timeout:20000});
    assert.deepEqual(jpegSize(prints[0].body),[1260,840]);
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});
