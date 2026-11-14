// The guest flow on the shop's portrait touch screen (1080 × 1920): every screen a guest sees in a
// photobooth or polaroid room fills the screen without scrolling, with big touch targets. The polaroid
// room (now the Selfbooth room) uses the same plain Mellow look: no gold ornament border since 13/11.
// Each screen is mounted on its own (?screen=…) with fixture props; screenshots go to the temp folder.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build, transformWithEsbuild } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base;
const fixture = `
  import React, { useEffect, useRef, useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import '@fontsource/playfair-display/latin-700.css';
  import '@fontsource/playfair-display/vietnamese-700.css';
  import '@fontsource/playfair-display/latin-900.css';
  import '@fontsource/playfair-display/vietnamese-900.css';
  import '@fontsource/patrick-hand/latin-400.css';
  import '@fontsource/patrick-hand/vietnamese-400.css';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { KioskEntry } from '/src/kiosk/KioskEntry.jsx';
  import { KioskCode, KioskPackages, KioskPayChoice, KioskPrintCount, KioskPayment } from '/src/kiosk/KioskSale.jsx';
  import { KioskShoot } from '/src/kiosk/KioskShoot.jsx';
  import { KioskDone } from '/src/kiosk/KioskDone.jsx';
  import '/src/tailwind.css';
  // Ảnh mẫu vẽ bằng canvas: ảnh màn chờ (4 : 5) và ảnh đã ghép (tờ 2 : 3).
  const picture = (w, h, colors) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    colors.forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(0, (h / colors.length) * i, w, h / colors.length); });
    return c.toDataURL('image/png');
  };
  const packs = [
    { _id: 'strip', name: 'Gói 70k · 2 ảnh nhỏ', printSize: 'strip', price: 70000, prints: 1, shots: 12 },
    { _id: 'full', name: 'Gói 100k · 2 ảnh lớn', printSize: 'full', price: 100000, prints: 2, shots: 16 },
    { _id: 'instax', name: 'Gói Instax', printSize: 'instax', price: 120000, prints: 2, shots: 10 },
  ];
  const settings = { name: 'Mellow', kiosk: { idleImage: picture(400, 500, ['#d9a38f', '#8a6450']) } };
  const screen = new URLSearchParams(location.search).get('screen');
  // Phòng Polaroid: giao diện cổ điển (Kiosk.jsx đặt thuộc tính này trên <html>).
  // Màn chụp: hình trực tiếp giả lập 16 : 9 (luồng từ canvas) và ba ảnh đã chụp.
  function Shoot() {
    const video = useRef(null);
    useEffect(() => {
      const c = document.createElement('canvas');
      c.width = 1920; c.height = 1080;
      const ctx = c.getContext('2d');
      const paint = () => {
        const g = ctx.createLinearGradient(0, 0, 1920, 1080);
        g.addColorStop(0, '#6d8fb3'); g.addColorStop(1, '#d9b38c');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080);
        ctx.fillStyle = '#f4e1c6'; ctx.beginPath(); ctx.arc(960, 430, 190, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(700, 660, 520, 420);
      };
      paint();
      video.current.srcObject = c.captureStream(10);
      const timer = setInterval(paint, 100);
      return () => clearInterval(timer);
    }, []);
    const [shots, setShots] = useState(() => [['#c98f7a', '#7d5a48'], ['#8fb3c9', '#48627d'], ['#d9c27a', '#7d6a48']]
      .map((colors, i) => ({ key: 'shot' + i, preview: picture(1500, 1000, colors) })));
    // Khách vừa bấm dây: một ảnh mới tới (test gọi window.addShot()).
    window.addShot = () => setShots((list) => [...list, { key: 'shot' + list.length, preview: picture(1500, 1000, ['#7ac98f', '#2f6a3d']) }]);
    return <KioskShoot videoRef={video} zoom={0} ready phase="shoot" preCount={0} showCountdown={false}
      sessionLeft={172} taken={shots.length} quota={0} shots={shots} flash={0} receiving={false} ending={false}
      onEnd={() => {}} onReopenCamera={() => {}} />;
  }
  function App() {
    const [code, setCode] = useState('12');
    const [sheets, setSheets] = useState(1);
    const none = () => {};
    switch (screen) {
      case 'idle': return <KioskEntry roomId="room" onTap={none} />;
      case 'method': return <KioskPayChoice onCode={none} onCash={none} onBack={none} />;
      case 'code': return <KioskCode code={code} setCode={setCode} onSubmit={(e) => e.preventDefault()} onBack={none}
        busy={false} error="" device="fixture-device" cameraReady={true} />;
      case 'size': return <KioskPackages packages={packs} instax={{ ready: true }} onPick={none} onCode={none} onBack={none} />;
      case 'print': return <KioskPrintCount pack={packs[0]} sheets={sheets} extraPrintPrice={20000} onChange={setSheets} onNext={none} onBack={none} />;
      case 'pay': return <KioskPayment pack={packs[0]} total={70000} sheets={1} bills={[]} onBill={none} onPaid={none} onSkip={none}
        onBack={none} onIdle={none} testMode={false} busy={false} error="" cameraReady={true} cashReady={false} />;
      case 'polaroid-idle': return <KioskEntry roomId="room" onTap={none} />;
      case 'polaroid-code': return <KioskCode code={code} setCode={setCode} onSubmit={(e) => e.preventDefault()} onBack={none}
        busy={false} error="" device="fixture-device" cameraReady={true} polaroid />;
      case 'polaroid-shoot': return <Shoot />;
      case 'ptb-shoot': return <Shoot />;
      case 'studio-done': return <KioskDone left={90} pending={0} nextGuest={none} done={{
        url: 'https://mellowptb.com/album/fixture', code: '123456', photos: 12, prints: 1, printSize: 'large', studio: true }} />;
      case 'polaroid-done': return <KioskDone left={90} pending={0} nextGuest={none} done={{
        composite: picture(1800, 1200, ['#c98f7a', '#8fb3c9']), url: 'https://mellowptb.com/album/fixture',
        code: '123456', prints: 1, print: { status: 'printing' }, printSize: 'instax', framed: true }} />;
      case 'done': return <KioskDone left={90} pending={0} nextGuest={none} done={{
        composite: picture(1200, 1800, ['#f07aa0', '#dc1e1e', '#f07aa0', '#dc1e1e']), url: 'https://mellowptb.com/album/fixture',
        code: '123456', prints: 2, print: { status: 'printing' }, printSize: 'strip', framed: true, video: null, videoPending: true }} />;
      default: return <p>?</p>;
    }
  }
  createRoot(document.getElementById('root')).render(
    <StudioContext.Provider value={{ settings, screens: [], packages: packs }}><ToastProvider><App /></ToastProvider></StudioContext.Provider>);
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, assetsInlineLimit: 100_000_000, rollupOptions: { input: "virtual:portrait.jsx" } },
    plugins: [tailwindcss(), {
      name: "portrait-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:portrait.jsx" ? fixture : null,
      transform: (code, id) => id === "\0virtual:portrait.jsx"
        ? transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" }) : null,
    }],
  });
  const assets = new Map(bundle.output.map((a) => ["/" + a.fileName, a.code || a.source]));
  const entry = bundle.output.find((a) => a.isEntry).fileName;
  const css = bundle.output.filter((a) => a.fileName.endsWith(".css"));
  const logo = await readFile(new URL("../public/logo-m-384.jpg", import.meta.url));
  server = createServer((req, res) => {
    if (req.url.startsWith("/logo-m-384.jpg")) {
      res.setHeader("Content-Type", "image/jpeg");
      res.end(logo);
    } else if (assets.has(req.url)) {
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

// Mở một màn (mặc định 1080 × 1920), chụp ảnh, trả về số đo của các phần tử cần kiểm tra:
// số phần tử, cạnh nhỏ nhất, số hàng (các đỉnh khác nhau).
async function portrait(screen, selectors = {}, viewport = { width: 1080, height: 1920 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?screen=${screen}`);
  await page.waitForFunction(() => document.querySelector("#root > *"));
  await page.evaluate(() => document.fonts.ready);
  // Màn chụp: đợi hình trực tiếp có khung đầu tiên (CameraPreview mới đặt kích thước và hiện video).
  await page.waitForFunction(() => [...document.querySelectorAll("video")].every((v) => v.style.visibility === "visible"));
  await page.waitForTimeout(300);
  const tag = viewport.width > viewport.height ? "landscape" : "portrait";
  await page.screenshot({ path: join(tmpdir(), `photobooth-fe-${tag}-${screen}.png`) });
  const sizes = await page.evaluate((selectors) => {
    // Máy chụp là giấy kraft trơn (13/11 chủ tiệm bỏ hoạ tiết): không phần tử nào còn nền sao / chùm sao.
    const stars = [...document.querySelectorAll("*")].flatMap((e) => [null, "::before", "::after"]
      .filter((pseudo) => /star/i.test(getComputedStyle(e, pseudo).backgroundImage))
      .map((pseudo) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}${pseudo || ""}`));
    // 13/11 chủ tiệm bỏ khung viền hoa văn vàng: không màn máy chụp nào còn góc hoa văn.
    const corners = document.querySelectorAll(".classic-corners, .ornament-corner").length;
    const out = { pageScrolls: document.documentElement.scrollHeight > innerHeight + 1, stars, corners };
    for (const [name, selector] of Object.entries(selectors)) {
      const boxes = [...document.querySelectorAll(selector)].map((e) => e.getBoundingClientRect());
      out[name] = boxes.length ? {
        count: boxes.length,
        minHeight: Math.round(Math.min(...boxes.map((b) => b.height))),
        minWidth: Math.round(Math.min(...boxes.map((b) => b.width))),
        // Thẻ nghiêng nhẹ (giấy dán) lệch đỉnh vài px: đỉnh cách nhau dưới 30 px tính cùng hàng.
        rows: boxes.map((b) => b.top).sort((a, b) => a - b)
          .filter((top, i, tops) => i === 0 || top - tops[i - 1] > 30).length,
      } : null;
    }
    return out;
  }, selectors);
  await page.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(sizes.stars, [], `${screen}: còn hoạ tiết sao trên màn máy chụp`);
  assert.equal(sizes.corners, 0, `${screen}: còn khung viền hoa văn vàng`);
  return sizes;
}

const FOOT = ".flow-foot .button";
// Nút dưới cùng: cao ≥ 72 px, cùng một hàng.
const footOk = (m, count) => {
  assert.equal(m.foot.count, count);
  assert.ok(m.foot.minHeight >= 72, `nút dưới cao ${m.foot.minHeight} px`);
  assert.equal(m.foot.rows, 1, "các nút dưới cùng nằm một hàng");
};

test("idle: big polaroid on top, title and a big 'Chạm để bắt đầu' below", async () => {
  const m = await portrait("idle", { photo: ".kiosk-polaroid", start: ".kiosk-sticker" });
  assert.equal(m.pageScrolls, false);
  assert.ok(m.photo.minWidth >= 600, `ảnh rộng ${m.photo.minWidth} px`);
  assert.ok(m.start.minHeight >= 90, `nút bắt đầu cao ${m.start.minHeight} px`);
});

test("pay choice: the two methods are full-width cards stacked on top of each other", async () => {
  const m = await portrait("method", { card: ".kiosk-method", foot: FOOT });
  assert.equal(m.pageScrolls, false);
  assert.deepEqual([m.card.count, m.card.rows], [2, 2]);
  assert.ok(m.card.minWidth >= 800 && m.card.minHeight >= 300, JSON.stringify(m.card));
  footOk(m, 1);
});

test("code entry: a big code box and keypad", async () => {
  const m = await portrait("code", { key: ".voucher-keypad button", box: "#kiosk-code", foot: FOOT });
  assert.equal(m.pageScrolls, false);
  assert.equal(m.key.count, 12);
  assert.ok(m.key.minHeight >= 96 && m.key.minWidth >= 200, JSON.stringify(m.key));
  assert.ok(m.box.minHeight >= 96, `ô mã cao ${m.box.minHeight} px`);
  footOk(m, 1);
});

test("sheet type: two big cards per row, back / code / next on one row", async () => {
  const m = await portrait("size", { card: ".kiosk-size", foot: FOOT });
  assert.equal(m.pageScrolls, false);
  assert.deepEqual([m.card.count, m.card.rows], [3, 2]);
  assert.ok(m.card.minWidth >= 380, `thẻ rộng ${m.card.minWidth} px`);
  footOk(m, 3);
});

test("print count: big − / + buttons; back and pay on one row", async () => {
  const m = await portrait("print", { step: ".kiosk-counter button", foot: FOOT });
  assert.equal(m.pageScrolls, false);
  assert.ok(m.step.minWidth >= 132, `nút − / + rộng ${m.step.minWidth} px`);
  footOk(m, 2);
});

test("bill reader: big totals and a pointer down to the bill acceptor", async () => {
  const m = await portrait("pay", { board: ".pay-board > div", foot: FOOT });
  assert.equal(m.pageScrolls, false);
  assert.ok(m.board.count === 3 && m.board.minHeight >= 120, JSON.stringify(m.board));
  footOk(m, 1);
});

test("polaroid (Selfbooth) room: plain Mellow idle screen, no gold border", async () => {
  const m = await portrait("polaroid-idle", { start: ".kiosk-sticker" });
  assert.equal(m.pageScrolls, false);
  assert.ok(m.start.minHeight >= 90, `nút bắt đầu cao ${m.start.minHeight} px`);
});

test("polaroid (Selfbooth) room: plain Mellow code card, big keypad", async () => {
  const m = await portrait("polaroid-code", { key: ".voucher-keypad button", box: "#kiosk-code", foot: FOOT });
  assert.equal(m.pageScrolls, false);
  assert.equal(m.key.count, 12);
  assert.ok(m.key.minHeight >= 96 && m.key.minWidth >= 200, JSON.stringify(m.key));
  assert.ok(m.box.minHeight >= 96, `ô mã cao ${m.box.minHeight} px`);
  footOk(m, 1);
  const wide = await portrait("polaroid-code", { key: ".voucher-keypad button" }, { width: 1920, height: 1080 });
  assert.equal(wide.pageScrolls, false);
});

test("polaroid (Selfbooth) shoot, landscape: the Mellow layout of the PTB room, no border around the live view", async () => {
  const m = await portrait("polaroid-shoot", {
    stage: ".shoot-stage", rail: ".shoot-rail", thumbs: ".shoot-thumbs img", end: ".shoot-end", live: ".shoot-stage video",
  }, { width: 1920, height: 1080 });
  assert.equal(m.pageScrolls, false);
  assert.ok(m.rail.minWidth >= 440 && m.rail.minWidth <= 470, `cột ảnh rộng ${m.rail.minWidth} px`);
  assert.ok(Math.abs(m.live.minWidth - m.stage.minWidth) <= 4, JSON.stringify({ live: m.live, stage: m.stage }));
  assert.ok(m.end.minHeight >= 64, `nút Chụp xong cao ${m.end.minHeight} px`);
});

test("PTB shoot, landscape: the photo column is twice as wide and a new photo shows over the live view for 1.5 s", async () => {
  const m = await portrait("ptb-shoot", { rail: ".shoot-rail", thumbs: ".shoot-thumbs img", live: ".shoot-stage video", stage: ".shoot-stage" },
    { width: 1920, height: 1080 });
  assert.equal(m.pageScrolls, false);
  // Cột ảnh trước rộng 228 px ở màn 1920: giờ gấp đôi.
  assert.ok(m.rail.minWidth >= 440 && m.rail.minWidth <= 470, `cột ảnh rộng ${m.rail.minWidth} px`);
  assert.ok(m.thumbs.minWidth >= 400, `ảnh nhỏ rộng ${m.thumbs.minWidth} px`);
  // Hình trực tiếp thấy đủ khung (không cắt hai bên): rộng bằng vùng hình, không tràn ra ngoài.
  assert.ok(Math.abs(m.live.minWidth - m.stage.minWidth) <= 4 && m.live.minHeight <= 1080, JSON.stringify({ live: m.live, stage: m.stage }));

  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`${base}/?screen=ptb-shoot`);
    await page.waitForFunction(() => [...document.querySelectorAll("video")].every((v) => v.style.visibility === "visible"));
    assert.equal(await page.locator(".shoot-review").count(), 0, "photos already taken are not replayed");
    await page.evaluate(() => window.addShot());
    await page.locator(".shoot-review.is-shown").waitFor({ timeout: 2000 });
    assert.equal(await page.locator(".shoot-review-no").innerText(), "Ảnh 4");
    const shownAt = Date.now();
    await page.locator(".shoot-review").waitFor({ state: "detached", timeout: 4000 });
    const shownMs = Date.now() - shownAt;
    assert.ok(shownMs >= 1200 && shownMs <= 2300, `ảnh hiện ${shownMs} ms`);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("polaroid shoot, portrait: live view on top, the latest photo below", async () => {
  const m = await portrait("polaroid-shoot", { latest: ".shoot-latest img", end: ".shoot-end", live: ".shoot-stage video" });
  assert.equal(m.pageScrolls, false);
  assert.ok(m.live.minWidth >= 1070, JSON.stringify(m.live));
  assert.ok(m.latest.minHeight >= 600, JSON.stringify(m.latest));
  assert.ok(m.end.minHeight >= 56, `nút Chụp xong cao ${m.end.minHeight} px`);
});

test("polaroid QR screen, landscape: no video, so the composite and the QR code fill the screen", async () => {
  const m = await portrait("polaroid-done", { qr: ".done-qr svg", photo: ".done-card img", cards: ".done-card", foot: FOOT },
    { width: 1920, height: 1080 });
  assert.equal(m.pageScrolls, false);
  assert.deepEqual([m.cards.count, m.cards.rows], [2, 1]);
  assert.ok(m.qr.minWidth >= 440, `mã QR rộng ${m.qr.minWidth} px`);
  assert.ok(m.photo.minWidth >= 560, `ảnh ghép rộng ${m.photo.minWidth} px`);
});

test("Selfbooth room QR screen: one big QR to choose, beautify and print on the phone, on both screen shapes", async () => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    const m = await portrait("studio-done", { qr: ".done-qr svg", title: ".done-title", cards: ".done-card", foot: FOOT }, viewport);
    assert.equal(m.pageScrolls, false, `${viewport.width}`);
    assert.equal(m.cards.count, 1, "only the QR card");
    assert.ok(m.qr.minWidth >= 440, `mã QR rộng ${m.qr.minWidth} px`);
    assert.equal(m.title.count, 1);
    assert.equal(m.foot.count, 1);
  }
});

test("QR screen: the message on top, a big QR code, then the composite and the video", async () => {
  const m = await portrait("done", { qr: ".done-qr svg", photo: ".done-card img", title: ".done-title", cards: ".done-card", foot: FOOT });
  assert.equal(m.pageScrolls, false);
  assert.ok(m.qr.minWidth >= 400, `mã QR rộng ${m.qr.minWidth} px`);
  assert.ok(m.photo.minHeight >= 450, `ảnh ghép cao ${m.photo.minHeight} px`);
  assert.equal(m.cards.rows, 2, "QR on its own row, composite + video below");
  footOk(m, 1);
});

test("a landscape screen keeps the side-by-side layout", async () => {
  const m = await portrait("method", { card: ".kiosk-method" }, { width: 1920, height: 1080 });
  assert.deepEqual([m.card.count, m.card.rows], [2, 1]);
  const done = await portrait("done", { cards: ".done-card" }, { width: 1920, height: 1080 });
  assert.equal(done.cards.rows, 1);
});
