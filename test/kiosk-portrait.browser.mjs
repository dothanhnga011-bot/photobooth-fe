// The guest flow on the shop's portrait touch screen (1080 × 1920): every screen a guest sees in a
// photobooth or polaroid room fills the screen without scrolling, with big touch targets. The polaroid
// room (Selfbooth model, classic French theme) also gets a landscape shoot screen: 2/3 live, 1/3 panel.
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
  if (screen.startsWith('polaroid')) document.documentElement.dataset.kioskTheme = 'classic';
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
    const shots = [['#c98f7a', '#7d5a48'], ['#8fb3c9', '#48627d'], ['#d9c27a', '#7d6a48']]
      .map((colors, i) => ({ key: 'shot' + i, preview: picture(1500, 1000, colors) }));
    return <KioskShoot videoRef={video} zoom={0} ready phase="shoot" preCount={0} showCountdown={false}
      sessionLeft={172} taken={shots.length} quota={0} shots={shots} flash={0} receiving={false} ending={false}
      onEnd={() => {}} onReopenCamera={() => {}} classic />;
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
      case 'polaroid-idle': return <KioskEntry roomId="room" onTap={none} classic />;
      case 'polaroid-code': return <KioskCode code={code} setCode={setCode} onSubmit={(e) => e.preventDefault()} onBack={none}
        busy={false} error="" device="fixture-device" cameraReady={true} polaroid />;
      case 'polaroid-shoot': return <Shoot />;
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
    const out = { pageScrolls: document.documentElement.scrollHeight > innerHeight + 1 };
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

test("polaroid room: classic idle screen with ornament corners", async () => {
  const m = await portrait("polaroid-idle", { corner: ".classic-corners .ornament-corner", start: ".kiosk-sticker" });
  assert.equal(m.pageScrolls, false);
  assert.equal(m.corner.count, 4);
  assert.ok(m.corner.minWidth >= 96, `góc hoa văn ${m.corner.minWidth} px`);
  assert.ok(m.start.minHeight >= 90, `nút bắt đầu cao ${m.start.minHeight} px`);
});

test("polaroid room: the code screen replaces the layout picker (classic card, big keypad)", async () => {
  const m = await portrait("polaroid-code", {
    key: ".voucher-keypad button", box: "#kiosk-code", corner: ".code-card .ornament-corner", fleuron: ".ornament-fleuron", foot: FOOT,
  });
  assert.equal(m.pageScrolls, false);
  assert.equal(m.key.count, 12);
  assert.ok(m.key.minHeight >= 96 && m.key.minWidth >= 200, JSON.stringify(m.key));
  assert.ok(m.box.minHeight >= 96, `ô mã cao ${m.box.minHeight} px`);
  assert.equal(m.corner.count, 4);
  assert.equal(m.fleuron.count, 1);
  footOk(m, 1);
  const wide = await portrait("polaroid-code", { key: ".voucher-keypad button", corner: ".code-card .ornament-corner" }, { width: 1920, height: 1080 });
  assert.equal(wide.pageScrolls, false);
  assert.equal(wide.corner.count, 4);
});

test("polaroid shoot, landscape: live view 2/3, a classic side panel 1/3 with the latest photo large", async () => {
  const m = await portrait("polaroid-shoot", {
    stage: ".shoot-stage", rail: ".shoot-rail", latest: ".shoot-latest img", thumbs: ".shoot-thumbs img",
    end: ".shoot-end", corner: ".ornament-corner", live: ".shoot-stage video",
  }, { width: 1920, height: 1080 });
  assert.equal(m.pageScrolls, false);
  assert.ok(Math.abs(m.stage.minWidth - 1280) <= 4, `hình trực tiếp rộng ${m.stage.minWidth} px`);
  assert.ok(Math.abs(m.rail.minWidth - 640) <= 4, `cột bên rộng ${m.rail.minWidth} px`);
  // Thấy đủ khung hình 16 : 9 (không cắt hai bên).
  assert.ok(Math.abs(m.live.minWidth - 1280) <= 4 && Math.abs(m.live.minHeight - 720) <= 4, JSON.stringify(m.live));
  assert.equal(m.latest.count, 1);
  assert.ok(m.latest.minWidth >= 480 && m.latest.minHeight >= 300, JSON.stringify(m.latest));
  assert.deepEqual([m.thumbs.count, m.thumbs.rows], [3, 1]);
  assert.ok(m.end.minHeight >= 60, `nút Chụp xong cao ${m.end.minHeight} px`);
  assert.equal(m.corner.count, 8, "bốn góc quanh hình trực tiếp, bốn góc quanh cột ảnh");
});

test("polaroid shoot, portrait: live view on top, the latest photo below", async () => {
  const m = await portrait("polaroid-shoot", { latest: ".shoot-latest img", end: ".shoot-end", live: ".shoot-stage video" });
  assert.equal(m.pageScrolls, false);
  assert.ok(m.live.minWidth >= 1070, JSON.stringify(m.live));
  assert.ok(m.latest.minHeight >= 600, JSON.stringify(m.latest));
  assert.ok(m.end.minHeight >= 56, `nút Chụp xong cao ${m.end.minHeight} px`);
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
