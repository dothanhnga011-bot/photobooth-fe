// Exercise the bundled detector, WASM and actual pixel renderer together.
// Uses the existing in-repo portrait, never a production album or remote CDN.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from '../../photobooth-be/node_modules/playwright/index.mjs';

let server, browser, page;
before(async () => {
  const bundle = await build({
    root: fileURLToPath(new URL('..', import.meta.url)).replace(/^[a-z]:/, drive => drive.toUpperCase()),
    configFile: false, logLevel: 'error',
    build: { write: false, minify: false, rollupOptions: { input: 'virtual:beauty-model' } },
    plugins: [{ name: 'beauty-model-fixture',
      resolveId: id => id === 'virtual:beauty-model' ? '\0' + id : null,
      load: id => id === '\0virtual:beauty-model' ? `
        import { detectFaces, applyBeauty, loadFaceLandmarker, scoreFaces } from '/src/beauty.js';
        import { applyBeautyAsync } from '/src/image-processing.js';
        window.beauty = { detectFaces, applyBeauty, applyBeautyAsync, loadFaceLandmarker, scoreFaces };
      ` : null,
    }],
  });
  const assets = new Map(bundle.output.map(a => ['/' + a.fileName, a.code || a.source]));
  const entry = bundle.output.find(a => a.isEntry).fileName;
  const portrait = await readFile(new URL('../src/admin/assets/rx1-preview-default.jpg', import.meta.url));
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/portrait.jpg') { res.setHeader('Content-Type', 'image/jpeg'); return res.end(portrait); }
    if (assets.has(path)) {
      res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm'
        : path.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
      return res.end(assets.get(path));
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>Bundled face model test</title><script type="module" src="/${entry}"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.beauty);
});

test('worker and compatibility renderer keep the same full-size pixels with all controls combined',async()=>{
  let workers=0;
  const started=()=>workers++;
  page.on('worker',started);
  const result=await page.evaluate(async()=>{
    const img=new Image();img.src='/portrait.jpg';await img.decode();
    const source=document.createElement('canvas');source.width=900;source.height=Math.round(900*img.naturalHeight/img.naturalWidth);
    source.getContext('2d').drawImage(img,0,0,source.width,source.height);
    const faces=await window.beauty.detectFaces(source);
    const adjust={smooth:45,whiten:20,slim:20,eyeSize:30,irisSize:40,nose:40,mouth:20,darkCircles:40,lips:25,blush:20,filter:'warm'};
    const direct=window.beauty.applyBeauty(source,faces,adjust),background=await window.beauty.applyBeautyAsync(source,faces,adjust);
    const a=direct.getContext('2d').getImageData(0,0,source.width,source.height).data,b=background.getContext('2d').getImageData(0,0,source.width,source.height).data;
    let max=0,total=0,alpha=0;
    for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);total+=d;if(i%4===3 && d)alpha++}
    const size=[background.width,background.height];direct.width=direct.height=background.width=background.height=0;
    return {max,mean:total/a.length,alpha,size,expected:[source.width,source.height]};
  });
  page.off('worker',started);
  assert.ok(workers>0,'a real image worker is used');
  assert.deepEqual(result.size,result.expected);
  assert.equal(result.alpha,0);
  assert.ok(result.max<=1 && result.mean<.01,JSON.stringify(result));
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

test('a failed inference discards the broken model so the next recognition attempt works',async()=>{
  const result=await page.evaluate(async()=>{
    const img=new Image();img.src='/portrait.jpg';await img.decode();
    const source=document.createElement('canvas');source.width=900;source.height=Math.round(900*img.naturalHeight/img.naturalWidth);
    source.getContext('2d').drawImage(img,0,0,source.width,source.height);
    const broken=await window.beauty.loadFaceLandmarker();
    let closed=0;const close=broken.close.bind(broken);
    broken.detect=()=>{throw new Error('Simulated graph failure')};
    broken.close=()=>{closed++;close()};
    let code;
    try{await window.beauty.detectFaces(source)}catch(error){code=error.code}
    const faces=await window.beauty.detectFaces(source);
    return {code,closed,faces:faces.length,fresh:await window.beauty.loadFaceLandmarker()!==broken};
  });
  assert.equal(result.code,'FACE_DETECTION_UNAVAILABLE');
  assert.equal(result.closed,1);assert.equal(result.fresh,true);assert.equal(result.faces,1);
});

test('the shipped model detects the portrait and skin/face adjustments change actual output pixels', async () => {
  const result = await page.evaluate(async () => {
    const image = new Image(); image.src = '/portrait.jpg'; await image.decode();
    const source = document.createElement('canvas');
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    source.width = Math.round(image.naturalWidth * scale); source.height = Math.round(image.naturalHeight * scale);
    source.getContext('2d').drawImage(image, 0, 0, source.width, source.height);
    const faces = await window.beauty.detectFaces(source);
    const original = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    const output = window.beauty.applyBeauty(source, faces, { smooth: 70, whiten: 40, slim: 25, blush: 25 });
    const after = output.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    let changed = 0;
    for (let i = 0; i < original.length; i += 4)
      if ([0, 1, 2].some(c => after[i + c] !== original[i + c])) changed++;
    const effects={};
    for(const key of ['smooth','whiten','slim','eyeSize','irisSize','nose','mouth','darkCircles','lips','blush']) {
      const edit=window.beauty.applyBeauty(source,faces,{[key]:70});
      const bytes=edit.getContext('2d').getImageData(0,0,source.width,source.height).data;
      let difference=0;
      for(let i=0;i<original.length;i+=4)if([0,1,2].some(c=>bytes[i+c]!==original[i+c]))difference++;
      effects[key]=difference;
      edit.width=edit.height=0;
    }
    return { faces: faces.length, landmarks: faces[0]?.length, changed, effects, size: [output.width, output.height], expected: [source.width, source.height] };
  });
  assert.equal(result.faces, 1, 'one actual face is detected with the local model');
  assert.equal(result.landmarks, 478);
  assert.ok(result.changed > 200, `face adjustments affect pixels: ${JSON.stringify(result)}`);
  assert.deepEqual(result.size, result.expected);
  for(const [name,changed] of Object.entries(result.effects)) assert.ok(changed>5,`${name} actually changes the portrait: ${JSON.stringify(result.effects)}`);
});

// Gợi ý ảnh đẹp ở album Selfbooth: cùng model chấm cười / nhắm mắt trên ảnh nhỏ 640 px của thư viện.
test('the bundled model scores smile and closed eyes for each face on a 640 px library thumbnail', async () => {
  const faces = await page.evaluate(async () => {
    const img = new Image(); img.src = '/portrait.jpg'; await img.decode();
    const scale = 640 / Math.max(img.naturalWidth, img.naturalHeight);
    const bitmap = await createImageBitmap(img, { resizeWidth: Math.round(img.naturalWidth * scale), resizeHeight: Math.round(img.naturalHeight * scale) });
    try { return await window.beauty.scoreFaces(bitmap); } finally { bitmap.close(); }
  });
  assert.equal(faces.length, 1, JSON.stringify(faces));
  for (const key of ['blink', 'smile', 'width']) assert.ok(faces[0][key] >= 0 && faces[0][key] <= 1, JSON.stringify(faces[0]));
  assert.ok(faces[0].blink < 0.55, 'the sample portrait has open eyes: ' + faces[0].blink);
});
