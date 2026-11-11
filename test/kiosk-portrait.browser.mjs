// The guest flow on the shop's portrait touch screen (1080 × 1920): every screen a guest sees in a
// photobooth or polaroid room fills the screen without scrolling, with big touch targets.
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
  import React, { useState } from 'react';
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
  import { KioskLayouts } from '/src/kiosk/KioskPolaroid.jsx';
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
  const layouts = [
    { _id: 'one', name: '1 ảnh to', printSize: 'instax', price: 100000, selectCount: 1, duration: 3 },
    { _id: 'two', name: '2 ảnh', printSize: 'instax', price: 100000, selectCount: 2, duration: 3 },
  ];
  const settings = { name: 'Mellow', kiosk: { idleImage: picture(400, 500, ['#d9a38f', '#8a6450']) } };
  const screen = new URLSearchParams(location.search).get('screen');
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
      case 'layouts': return <KioskLayouts layouts={layouts} instax={{ ready: true }} busy={false} error="" onStart={none} onBack={none} />;
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

test("polaroid layouts: full-width layout cards with a big arrow", async () => {
  const m = await portrait("layouts", { card: ".kiosk-layout", go: ".kiosk-layout-go", foot: FOOT });
  assert.equal(m.pageScrolls, false);
  assert.deepEqual([m.card.count, m.card.rows], [2, 2]);
  assert.ok(m.card.minWidth >= 800, `thẻ rộng ${m.card.minWidth} px`);
  assert.ok(m.go.minWidth >= 80, `nút mũi tên ${m.go.minWidth} px`);
  footOk(m, 1);
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
