import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build, transformWithEsbuild } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base;
const fixture = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { KioskCode, KioskPackages, KioskPayChoice, KioskPrintCount, KioskPayment } from '/src/kiosk/KioskSale.jsx';
  import { minSheets, saleTotal } from '/src/kiosk/print-count.js';
  import { billAcceptor } from '/src/kiosk/bill-acceptor.js';
  import '/src/tailwind.css';
  const packs = [
    { _id: 'strip', name: 'Gói 70k · 2 ảnh nhỏ', printSize: 'strip', price: 70000, prints: 1, shots: 12 },
    { _id: 'full', name: 'Gói 100k · 2 ảnh lớn', printSize: 'full', price: 100000, prints: 2, shots: 16 },
    { _id: 'old', name: 'Gói cũ một tờ', printSize: 'full', price: 50000, prints: 1, shots: 8 },
  ];
  const extraFor = () => 20000;
  window.billEnabled = () => billAcceptor.enabled;
  function App() {
    const [step, setStep] = useState(new URLSearchParams(location.search).get('step') || 'size');
    const [pack, setPack] = useState(null);
    const [sheets, setSheets] = useState(0);
    const [code, setCode] = useState('');
    const [voucher, setVoucher] = useState('');
    return <>
      {step === 'method' && <KioskPayChoice onCode={() => setStep('code')} onCash={() => setStep('size')} onBack={() => {}} />}
      {step === 'code' && <KioskCode code={code} setCode={setCode} onSubmit={(e) => { e.preventDefault(); setVoucher(code); }}
        onBack={() => setStep('method')} busy={false} error='' device='fixture-device' cameraReady={true} />}
      {step === 'size' && <KioskPackages packages={packs} onPick={(p) => { setPack(p); setSheets(minSheets(p)); setStep('print'); }}
        onCode={() => setStep('code')} onBack={() => {}} />}
      {step === 'print' && <KioskPrintCount pack={pack} sheets={sheets} extraPrintPrice={extraFor(pack)}
        onChange={setSheets} onNext={() => setStep('pay')} onBack={() => setStep('size')} />}
      {step === 'pay' && <KioskPayment pack={pack} total={saleTotal(pack, sheets, extraFor(pack))} sheets={sheets} bills={[]} onBill={() => {}}
        onPaid={() => {}} onSkip={() => {}} onBack={() => setStep('print')} onIdle={() => {}}
        testMode={false} busy={false} error='' cameraReady={true} cashReady={false} />}
      {step === 'paid' && <KioskPayment pack={packs[0]} total={saleTotal(packs[0], 1, 20000)} sheets={1}
        bills={(new URLSearchParams(location.search).get('bills') || '').split(',').filter(Boolean).map((amount) => ({ amount: Number(amount) }))}
        onBill={() => {}} onPaid={() => { window.paidCalls = (window.paidCalls || 0) + 1; }} onSkip={() => {}}
        onBack={() => {}} onIdle={() => {}} testMode={false} busy={false} error='' cameraReady={true} cashReady={false} />}
      <output data-testid="voucher-result">{voucher}</output>
    </>;
  }
  createRoot(document.getElementById('root')).render(<StudioContext.Provider value={{ settings: { name: 'Mellow' }, screens: [], packages: packs }}><ToastProvider><App /></ToastProvider></StudioContext.Provider>);
`;

before(async () => {
  const bundle = await build({
    configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:checkout.jsx" } },
    plugins: [tailwindcss(), {
      name: "checkout-fixture", enforce: "pre",
      resolveId: (id) => id.startsWith("virtual:") ? "\0" + id : null,
      load: (id) => id === "\0virtual:checkout.jsx" ? fixture : null,
      transform: (code, id) => id === "\0virtual:checkout.jsx"
        ? transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" }) : null,
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

const shot = (page, name) =>
  process.env.KIOSK_SCREENSHOT && page.screenshot({ path: `${process.env.KIOSK_SCREENSHOT}-${name}.png` });

test("photobooth: the guest picks how to pay — the code from the counter or cash at the kiosk", async () => {
  const page = await browser.newPage({ viewport: { width: 1328, height: 639 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/?step=method");
    await page.getByRole("heading", { name: "Chọn cách thanh toán" }).waitFor();
    await shot(page, "method");
    await page.getByRole("button", { name: /Tiền mặt/ }).click();
    await page.getByRole("heading", { name: "Chọn loại tờ" }).waitFor();
    await page.goto(base + "/?step=method");
    await page.getByRole("button", { name: /Nhập mã/ }).click();
    await page.getByRole("heading", { name: "Nhập mã chụp" }).waitFor();
    await shot(page, "code");
    assert.equal(await page.getByRole("button", { name: /Bắt đầu chụp/ }).isDisabled(), true);
    for (const n of "123456") await page.getByRole("button", { name: n, exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Mã chụp" }).inputValue(), "123456");
    await page.getByRole("button", { name: /Bắt đầu chụp/ }).click();
    assert.equal(await page.getByTestId("voucher-result").innerText(), "123456");
    assert.equal(await page.evaluate(() => window.billEnabled()), false, "a code never opens the bill acceptor");
    await page.getByRole("button", { name: /Quay lại/ }).click();
    await page.getByRole("heading", { name: "Chọn cách thanh toán" }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("prints are counted in pieces from a minimum of two; paying goes straight to the bill reader", async () => {
  const page = await browser.newPage({ viewport: { width: 1328, height: 639 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const count = () => page.locator(".kiosk-counter output").innerText();
  const total = () => page.locator(".kiosk-price strong").innerText();
  const pick = async (name) => {
    await page.getByRole("heading", { name: "Chọn loại tờ" }).waitFor();
    await page.getByRole("button", { name }).click();
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await page.getByRole("heading", { name: "Chọn số lượng" }).waitFor();
  };
  try {
    await page.goto(base);
    await page.getByRole("heading", { name: "Chọn loại tờ" }).waitFor();
    assert.match(await page.getByRole("button", { name: /2 ảnh nhỏ/ }).innerText(), /kèm 2 tờ nhỏ/);
    await shot(page, "size");
    // Khổ nhỏ: 1 tờ 10 × 15 cắt đôi = 2 tờ nhỏ (đã gồm trong gói), mỗi lần + thêm 2 tờ nhỏ.
    await pick(/2 ảnh nhỏ/);
    assert.equal(await count(), "2");
    assert.equal(await page.getByRole("button", { name: "Giảm số bản in" }).isDisabled(), true);
    assert.match(await total(), /70\.000/);
    await shot(page, "prints-strip");
    await page.getByRole("button", { name: "Tăng số bản in" }).click();
    assert.equal(await count(), "4");
    assert.match(await total(), /90\.000/);
    await page.getByRole("button", { name: "Giảm số bản in" }).click();
    assert.equal(await count(), "2");
    // Khổ to: tối thiểu 2 tờ (gói kèm 2 tờ).
    await page.getByRole("button", { name: /Quay lại/ }).click();
    await pick(/2 ảnh lớn/);
    assert.equal(await count(), "2");
    assert.equal(await page.getByRole("button", { name: "Giảm số bản in" }).isDisabled(), true);
    assert.match(await total(), /100\.000/);
    await page.getByRole("button", { name: "Tăng số bản in" }).click();
    assert.equal(await count(), "3");
    assert.match(await total(), /120\.000/);
    // Gói cũ chỉ kèm 1 tờ khổ to: vẫn tối thiểu 2 tờ, tờ thứ hai tính giá in thêm.
    await page.getByRole("button", { name: /Quay lại/ }).click();
    await pick(/Gói cũ/);
    assert.equal(await count(), "2");
    assert.match(await total(), /70\.000/);
    assert.match(await page.locator(".kiosk-price").innerText(), /In tối thiểu 2 tờ/);
    await page.getByRole("button", { name: /Thanh toán tiền mặt/ }).click();
    await page.getByRole("heading", { name: "Đút tiền để bắt đầu chụp" }).waitFor();
    assert.match(await page.locator(".pay-board").innerText(), /70\.000/);
    assert.equal(await page.evaluate(() => window.billEnabled()), false, "no serial port in the test browser");
    await shot(page, "pay");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("exact cash opens the session at once; overpaid cash first tells the guest to collect the change at the counter", async () => {
  const page = await browser.newPage({ viewport: { width: 1328, height: 639 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const paidCalls = () => page.evaluate(() => window.paidCalls || 0);
  try {
    // Đút đúng 70.000 đ: mở lượt chụp ngay, không có lời nhắc tiền thừa.
    await page.goto(base + "/?step=paid&bills=50000,20000");
    await page.waitForFunction(() => window.paidCalls === 1);
    assert.equal(await page.locator(".pay-machine.is-change").count(), 0);

    // Đút 100.000 đ cho gói 70.000 đ: máy không trả tiền thừa — khách đọc lời nhắc trước, rồi mới vào chụp.
    await page.clock.install();
    await page.goto(base + "/?step=paid&bills=100000");
    const notice = page.locator(".pay-machine.is-change p");
    await notice.waitFor();
    assert.match(await notice.innerText(), /đút dư 30\.000.*ra quầy để nhân viên thối lại/s);
    assert.equal(await paidCalls(), 0, "the session waits while the guest reads about the change");
    await page.clock.runFor(4000);
    assert.equal(await paidCalls(), 0);
    await shot(page, "pay-change");
    await page.getByRole("button", { name: /Đã hiểu — vào chụp/ }).click();
    assert.equal(await paidCalls(), 1);
    await page.clock.runFor(15000);
    assert.equal(await paidCalls(), 1, "the countdown never opens a second session");

    // Không ai bấm: hết 10 giây thì tự vào chụp, đúng một lần.
    await page.goto(base + "/?step=paid&bills=100000");
    await notice.waitFor();
    // Từng giây một: mỗi giây React vẽ lại nút đếm ngược rồi mới hẹn giây tiếp theo.
    for (let left = 9; left >= 1; left--) {
      await page.clock.runFor(1000);
      await page.getByRole("button", { name: `Đã hiểu — vào chụp (${left}s)` }).waitFor();
    }
    assert.equal(await paidCalls(), 0);
    await page.clock.runFor(1000);
    await page.waitForFunction(() => window.paidCalls === 1);
    await page.clock.runFor(15000);
    assert.equal(await paidCalls(), 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
