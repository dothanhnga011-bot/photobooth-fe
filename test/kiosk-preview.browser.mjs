// Real browser decoding, cancellation and Blob URL lifetime; no kiosk/printer API calls.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { build } from "vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";
const sharp = createRequire(new URL("../../photobooth-be/package.json", import.meta.url))("sharp");
let server, browser, base, frameBytes;

before(async () => {
  frameBytes = await sharp({ create: { width: 64, height: 96, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ToastProvider} from '/src/studio.jsx';
    import {KioskSelect,useShotBitmaps} from '/src/kiosk/KioskSelect.jsx';
    import {useObjectUrl} from '/src/kiosk/KioskShoot.jsx';
    const root=createRoot(document.getElementById('root'));
    const show=child=>root.render(React.createElement(React.StrictMode,null,React.createElement(ToastProvider,null,child)));
    window.clearProbe=()=>root.render(null);
    window.seedAssets=async()=>{
      const c=document.createElement('canvas');c.width=32;c.height=48;
      const ctx=c.getContext('2d');ctx.fillStyle='#dc1e1e';ctx.fillRect(0,0,32,48);
      window.photoBlob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
      window.photoBitmap=await createImageBitmap(window.photoBlob);
    };
    function BitmapProbe({count,token}){
      const shots=React.useMemo(()=>Array.from({length:count},(_,i)=>({key:String(i),preview:window.photoBlob})),[count]);
      const map=useShotBitmaps(shots,token);
      React.useLayoutEffect(()=>{window.bitmapResult=[...map].map(([key,image])=>({key,width:image.width,height:image.height}));},[map]);
      return null;
    }
    window.showBitmaps=(count,token)=>show(React.createElement(BitmapProbe,{count,token}));
    function PreviewProbe({revision}){
      const frame=React.useMemo(()=>({_id:'frame',image:'/delayed-frame.png',printSize:'full',
        slots:[{x:0.1,y:0.1,w:0.8,h:0.8,photo:1,kind:'photo'}]}),[]);
      const shots=React.useMemo(()=>[{key:'one',preview:window.photoBlob}],[]);
      const bitmaps=React.useMemo(()=>new Map([['one',window.photoBitmap]]),[]);
      return React.createElement(KioskSelect,{shots,bitmaps,count:1,selected:['one'],onToggle:()=>{},secondsLeft:90,
        frames:[frame],index:0,setIndex:()=>{},onConfirm:()=>{},busy:false,prints:0,qrUrl:'',
        filters:[{id:'original',label:'Gốc',steps:null,css:'none'}],
        decor:{transforms:{one:{zoom:1,x:revision/100,y:0}}},onDecor:()=>{},shopStickers:[]});
    }
    window.showPreview=revision=>show(React.createElement(PreviewProbe,{revision}));
    function UrlProbe({source,id}){
      const url=useObjectUrl(source);
      React.useLayoutEffect(()=>{window.urlEvents.push({id,url});window.currentUrl=url;});
      return null;
    }
    window.showUrl=(source,id)=>show(React.createElement(UrlProbe,{source,id}));`;
  const bundle = await build({ configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, rollupOptions: { input: "virtual:preview.jsx" } },
    plugins: [{ name: "preview-fixture", resolveId: id => id === "virtual:preview.jsx" ? "\0preview.jsx" : null,
      load: id => id === "\0preview.jsx" ? fixture : null }],
  });
  const assets = new Map(bundle.output.map(a => [`/${a.fileName}`, a.code || a.source]));
  const entry = bundle.output.find(a => a.isEntry).fileName;
  server = createServer((req, res) => {
    const source = assets.get(req.url);
    res.writeHead(200, { "Content-Type": source ? "text/javascript" : "text/html;charset=utf-8" });
    res.end(source || `<!doctype html><div id="root"></div><script type="module" src="/${entry}"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function mount() {
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => window.seedAssets);
  await page.evaluate(() => window.seedAssets());
  return { page, errors };
}

test("the selection hook decodes twelve real previews three at a time and releases them on leaving", async () => {
  const { page, errors } = await mount();
  try {
    await page.evaluate(() => {
      const native = window.createImageBitmap, close = ImageBitmap.prototype.close;
      const owned = new WeakSet();
      window.decodeStats = { active: 0, peak: 0, started: 0, closed: 0, gates: [] };
      window.createImageBitmap = (...args) => {
        const stats = window.decodeStats; stats.active++; stats.started++; stats.peak = Math.max(stats.peak, stats.active);
        return new Promise(resolve => stats.gates.push(resolve)).then(() => native(...args))
          .then(image => { owned.add(image); return image; }).finally(() => stats.active--);
      };
      ImageBitmap.prototype.close = function () { if (owned.has(this)) window.decodeStats.closed++; return close.call(this); };
      window.showBitmaps(12, "guest");
    });
    for (let group = 1; group <= 4; group++) {
      await page.waitForFunction(count => window.decodeStats.started === count, group * 3);
      await page.evaluate(() => window.decodeStats.gates.splice(0).forEach(resolve => resolve()));
    }
    await page.waitForFunction(() => window.bitmapResult?.length === 12);
    assert.equal(await page.evaluate(() => window.decodeStats.peak), 3);
    assert.ok((await page.evaluate(() => window.bitmapResult)).every(image => image.width === 32 && image.height === 48));
    await page.evaluate(() => window.clearProbe());
    await page.waitForFunction(() => window.decodeStats.closed === 12);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("rapid edits while a frame loads allocate only the final preview canvas", async () => {
  const { page, errors } = await mount();
  let release;
  const requested = new Promise(resolve => {
    page.route("**/delayed-frame.png", route => { release = () => route.fulfill({ body: frameBytes, contentType: "image/png" }); resolve(); });
  });
  try {
    await page.evaluate(() => {
      const native = HTMLCanvasElement.prototype.getContext, seen = new WeakSet();
      const check = AbortSignal.prototype.throwIfAborted;
      window.previewStats = { allocated: 0, cancelled: 0 };
      HTMLCanvasElement.prototype.getContext = function (...args) {
        if (!this.isConnected && this.width === 1200 && this.height === 1800 && !seen.has(this)) {
          seen.add(this); window.previewStats.allocated++;
        }
        return native.apply(this, args);
      };
      AbortSignal.prototype.throwIfAborted = function () {
        if (this.aborted) window.previewStats.cancelled++;
        return check.call(this);
      };
      window.showPreview(0);
    });
    await requested;
    for (let revision = 1; revision <= 7; revision++) {
      await page.evaluate(revision => window.showPreview(revision), revision);
      await page.waitForTimeout(40);
    }
    await release();
    await page.waitForFunction(() => document.querySelector(".decor-canvas:not(.is-loading)")?.width === 1200);
    const stats = await page.evaluate(() => window.previewStats);
    assert.equal(stats.allocated, 1, JSON.stringify(stats));
    assert.ok(stats.cancelled >= 5, JSON.stringify(stats));
    const pixel = await page.locator(".decor-canvas").evaluate(canvas => [...canvas.getContext("2d").getImageData(600, 900, 1, 1).data]);
    assert.deepEqual(pixel, [220, 30, 30, 255]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("photo/video Blob URLs belong to the current source and all are revoked on replacement or unmount", async () => {
  const { page, errors } = await mount();
  try {
    await page.evaluate(() => {
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      window.urlEvents = []; window.createdUrls = []; window.revokedUrls = [];
      URL.createObjectURL = source => { const url = create(source); window.createdUrls.push(url); return url; };
      URL.revokeObjectURL = url => { window.revokedUrls.push(url); revoke(url); };
      window.showUrl(null, "empty");
    });
    await page.waitForFunction(() => window.currentUrl === "");
    await page.evaluate(() => window.showUrl(new Blob(["first"], { type: "video/mp4" }), "first"));
    await page.waitForFunction(() => window.currentUrl?.startsWith("blob:"));
    const first = await page.evaluate(() => window.currentUrl);
    await page.evaluate(() => window.showUrl(new Blob(["second"], { type: "video/mp4" }), "second"));
    await page.waitForFunction(first => window.currentUrl?.startsWith("blob:") && window.currentUrl !== first, first);
    assert.equal(await page.evaluate(first => window.urlEvents.some(event => event.id === "second" && event.url === first), first), false);
    await page.evaluate(() => window.clearProbe());
    await page.waitForFunction(() => window.createdUrls.every(url => window.revokedUrls.includes(url)));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
