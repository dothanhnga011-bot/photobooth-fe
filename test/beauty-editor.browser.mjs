import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from '../../photobooth-be/node_modules/playwright/index.mjs';

let server,browser,base;
const fixture=`
  import React,{useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {BeautyEditor} from '/src/album/selfbooth/BeautyEditor.jsx';
  import {createStudioMedia} from '/src/album/studio-media.js';
  import {normalizeAdjust} from '/src/beauty-settings.js';
  import '/src/tailwind.css';
  const media=createStudioMedia('beauty-fixture');
  const photo={id:'p1',number:1,kind:'original'};
  window.printEdit=async()=>{
    const canvas=await media.edited(photo,window.adjust,'print');
    const size=[canvas.width,canvas.height];canvas.width=canvas.height=0;return size;
  };
  function App(){
    const [a,setA]=useState(normalizeAdjust());
    window.adjust=a;
    return React.createElement('div',{className:'sb-album'},React.createElement(BeautyEditor,{
      token:'beauty-fixture',media,photo,adjust:a,onChange:setA,onClose:()=>{window.closedEditor=true},onFavorite:()=>{},onDelete:()=>{}
    }));
  }
  createRoot(document.getElementById('root')).render(React.createElement(App));
`;
before(async()=>{
  await mkdir(resolve('.cache/beauty'),{recursive:true});
  const bundle=await build({
    root:fileURLToPath(new URL('..',import.meta.url)).replace(/^[a-z]:/,drive=>drive.toUpperCase()),
    configFile:false,logLevel:'error',esbuild:{jsx:'automatic'},
    define:{'process.env.NODE_ENV':'"development"','import.meta.env.VITE_API_URL':'""'},
    build:{write:false,minify:false,rollupOptions:{input:'virtual:beauty-editor.jsx'}},
    plugins:[tailwindcss(),{name:'beauty-editor-fixture',enforce:'pre',resolveId:id=>id.startsWith('virtual:')?'\0'+id:null,
      load:id=>id==='\0virtual:beauty-editor.jsx'?fixture:null}],
  });
  const assets=new Map(bundle.output.map(a=>['/'+a.fileName,a.code||a.source]));
  const entry=bundle.output.find(a=>a.isEntry).fileName,css=bundle.output.filter(a=>a.fileName.endsWith('.css'));
  const portrait=await readFile(new URL('../src/admin/assets/rx1-preview-default.jpg',import.meta.url));
  server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path.startsWith('/api/albums/beauty-fixture/photos/')){res.setHeader('Content-Type','image/jpeg');return res.end(portrait)}
    const type=path.endsWith('.css')?'text/css':path.endsWith('.wasm')?'application/wasm':path.endsWith('.woff2')?'font/woff2':path.endsWith('.js')?'application/javascript':'application/octet-stream';
    if(assets.has(path)){res.setHeader('Content-Type',type);return res.end(assets.get(path))}
    if(/^\/fonts\/[\w-]+\.woff2$/.test(path)){res.setHeader('Content-Type',type);return res.end(await readFile(new URL('../public'+path,import.meta.url)))}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><div id="root"></div>${css.map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('')}<script type="module" src="/${entry}"></script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve))});

async function open(viewport={width:390,height:844},{failModel=false,failWorker=false}={}){
  const page=await browser.newPage({viewport,isMobile:viewport.width<700,hasTouch:viewport.width<700});
  const errors=[],workers=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('worker',worker=>workers.push(worker.url()));
  if(failModel)await page.route(/face_landmarker.*\.task/,route=>route.fulfill({status:503,body:'Offline'}));
  if(failWorker)await page.route(/image-processing\.worker.*\.js/,route=>route.abort());
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('.sb-editor canvas')?.width>300);
  return {page,errors,workers};
}
const checksum=page=>page.locator('.sb-editor canvas').evaluate(canvas=>{
  const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let sum=0;for(let i=0;i<data.length;i++)sum=(Math.imul(sum,31)+data[i])|0;return sum;
});
async function waitReady(page){await page.getByText('Đã nhận diện 1 khuôn mặt',{exact:false}).waitFor({timeout:30000})}
async function waitPaint(page){await page.waitForFunction(()=>!document.querySelector('.sb-editor-note'))}

test('real face controls render through a worker, compare without resetting, and export all source pixels',async()=>{
  const {page,errors,workers}=await open();
  try{
    await waitReady(page);const original=await checksum(page);
    await page.getByRole('button',{name:'Tự nhiên',exact:true}).click();
    await waitPaint(page);const edited=await checksum(page);assert.notEqual(edited,original);
    assert.ok(workers.some(url=>url.includes('image-processing.worker')),'rendering runs in a worker');
    await page.getByRole('button',{name:'So sánh ảnh gốc',exact:true}).click();
    assert.equal(await checksum(page),original,'comparison shows the untouched source');
    assert.equal(await page.getByRole('slider',{name:'Mịn da',exact:true}).inputValue(),'30');
    await page.getByRole('button',{name:'Đang xem ảnh gốc',exact:true}).click();
    assert.equal(await checksum(page),edited,'comparison keeps all edits');
    await page.getByRole('slider',{name:'Thu gọn mũi',exact:true}).fill('55');await waitPaint(page);
    const size=await page.evaluate(()=>window.printEdit());
    const previewSize=await page.locator('.sb-editor canvas').evaluate(c=>[c.width,c.height]);
    assert.deepEqual(size,previewSize,'full source dimensions are retained by export');
    await page.screenshot({path:resolve('.cache/beauty/editor-390.png')});
    await page.getByRole('button',{name:'Phóng to ảnh',exact:true}).click();
    await page.screenshot({path:resolve('.cache/beauty/editor-zoom-390.png')});
    await page.getByRole('button',{name:'Phóng to ảnh',exact:true}).click();
    await page.getByRole('button',{name:'Đặt lại',exact:true}).click();await waitPaint(page);
    assert.equal(await checksum(page),original,'reset returns every source pixel');
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('a failed local model can be retried; unavailable face controls never pretend to work',async()=>{
  const {page}=await open(undefined,{failModel:true});
  try{
    await page.getByText('Chưa mở được bộ nhận diện.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('slider',{name:'Mắt to',exact:true}).isDisabled(),true);
    await page.getByRole('tab',{name:'Màu ảnh',exact:true}).click();
    assert.equal(await page.getByRole('radio',{name:'Đen trắng',exact:true}).isDisabled(),false);
    await page.unroute(/face_landmarker.*\.task/);
    await page.getByRole('button',{name:'Nhận diện lại',exact:true}).click();await waitReady(page);
    await page.getByRole('tab',{name:'Mắt',exact:true}).click();
    assert.equal(await page.getByRole('slider',{name:'Mắt to',exact:true}).isDisabled(),false);
  }finally{await page.close()}
});

test('the fallback renders the same beauty when workers are unavailable',async()=>{
  const {page,errors}=await open(undefined,{failWorker:true});
  try{
    await waitReady(page);const original=await checksum(page);
    await page.getByRole('button',{name:'Hồng nhẹ',exact:true}).click();await waitPaint(page);
    assert.notEqual(await checksum(page),original);
    assert.equal(await page.getByRole('slider',{name:'Son môi',exact:true}).inputValue(),'32');
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('small phones and desktop keep the image separate from scrollable controls and Done reachable',async()=>{
  for(const viewport of [{width:320,height:568},{width:1366,height:768}]){
    const {page,errors}=await open(viewport);
    try{
      await waitReady(page);await page.getByRole('button',{name:'Rạng rỡ',exact:true}).click();await waitPaint(page);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const done=await page.getByRole('button',{name:'Xong',exact:true}).boundingBox();
      assert.ok(done.y>=0 && done.y+done.height<=viewport.height+1);
      const photo=await page.locator('.sb-beauty-view').boundingBox(),panel=await page.getByRole('region',{name:'Công cụ làm đẹp'}).boundingBox();
      assert.ok(photo.y+photo.height<=panel.y+1 || photo.x+photo.width<=panel.x+1,'controls never overlap the photograph');
      await page.screenshot({path:resolve(`.cache/beauty/editor-all-${viewport.width}.png`)});
      await page.getByRole('tab',{name:'Trang điểm',exact:true}).click();
      await page.getByRole('slider',{name:'Má hồng',exact:true}).fill('45');await waitPaint(page);
      await page.screenshot({path:resolve(`.cache/beauty/editor-${viewport.width}.png`)});
      assert.deepEqual(errors,[]);
    }finally{await page.close()}
  }
});
