import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
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
  const photos=[{id:'p1',number:1,kind:'original'},{id:'p2',number:2,kind:'original'}];
  window.previewEdges=[];
  const edit=media.edited.bind(media);
  media.edited=(photo,a,size,options)=>{
    if(size==='preview'){window.previewEdges.push(options?.edge||1600);if(window.failEdit)return Promise.reject(new Error('Synthetic render failure'))}
    return edit(photo,a,size,options);
  };
  window.printEdit=async()=>{
    const canvas=await media.edited(photos.find(p=>p.id===window.photoId),window.adjust,'print');
    const size=[canvas.width,canvas.height];canvas.width=canvas.height=0;return size;
  };
  window.testDownloadSource=async()=>{
    const quality=createStudioMedia('quality-fixture'),photo={id:'quality',mirrored:true};
    const download=await quality.edited(photo,{filter:'warm'},'download');
    const ctx=download.getContext('2d'),size=[download.width,download.height];
    const left=[...ctx.getImageData(20,20,1,1).data],right=[...ctx.getImageData(download.width-20,20,1,1).data];
    download.width=download.height=0;
    const print=await quality.edited(photo,{filter:'warm'},'print'),printSize=[print.width,print.height];
    print.width=print.height=0;
    const small=await quality.edited({id:'small',mirrored:false},{filter:'warm'},'download'),smallSize=[small.width,small.height];
    small.width=small.height=0;
    let pending=false;try{await quality.edited({...photo,originalPending:true},{filter:'warm'},'download')}catch{pending=true}
    quality.clear();return {size,left,right,printSize,smallSize,pending};
  };
  function App(){
    const [id,setId]=useState('p1'),[adjusts,setAdjusts]=useState({});
    const photo=photos.find(p=>p.id===id),a=normalizeAdjust(adjusts[id]);
    window.adjust=a;window.photoId=id;
    return React.createElement('div',{className:'sb-album'},React.createElement(BeautyEditor,{
      token:'beauty-fixture',media,photo,photos,adjust:a,onChange:a=>setAdjusts(v=>({...v,[id]:a})),
      onNavigate:setId,onApplyAll:a=>setAdjusts(Object.fromEntries(photos.map(p=>[p.id,a]))),onDownload:()=>{},
      onClose:()=>{window.closedEditor=true},onFavorite:()=>{},onDelete:()=>{}
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
  const sharp=createRequire(new URL('../../photobooth-be/package.json',import.meta.url))('sharp');
  const quality=await sharp({create:{width:4000,height:6000,channels:3,background:'#2040d0'}})
    .composite([{input:{create:{width:2000,height:6000,channels:3,background:'#d02030'}},left:0,top:0}]).jpeg({quality:95}).toBuffer();
  const qualityPreview=await sharp(quality).resize(800,1200).jpeg({quality:95}).toBuffer();
  const qualitySmall=await sharp(quality).resize(320,480).jpeg({quality:95}).toBuffer();
  server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),path=url.pathname;
    if(path.startsWith('/api/albums/beauty-fixture/photos/')){res.setHeader('Content-Type','image/jpeg');return res.end(portrait)}
    if(path.startsWith('/api/albums/quality-fixture/photos/')){res.setHeader('Content-Type','image/jpeg');return res.end(path.endsWith('/small')?qualitySmall:url.searchParams.has('size')?qualityPreview:quality)}
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
    const compare=page.getByRole('button',{name:'Giữ để so sánh',exact:true});
    await compare.focus();await page.keyboard.down('Space');
    assert.equal(await checksum(page),original,'comparison shows the untouched source');
    assert.equal(await page.getByRole('slider',{name:'Mịn da',exact:true}).inputValue(),'30');
    await page.keyboard.up('Space');
    assert.equal(await checksum(page),edited,'comparison keeps all edits');
    await page.getByRole('slider',{name:'Thu gọn mũi',exact:true}).fill('55');await waitPaint(page);
    const size=await page.evaluate(()=>window.printEdit());
    const previewSize=await page.locator('.sb-editor canvas').evaluate(c=>[c.width,c.height]);
    assert.ok(size[0]>=previewSize[0] && size[1]>=previewSize[1],'export never uses the small interactive preview');
    await page.screenshot({path:resolve('.cache/beauty/editor-390.png')});
    await page.getByRole('button',{name:'Phóng to ảnh',exact:true}).click();
    await page.screenshot({path:resolve('.cache/beauty/editor-zoom-390.png')});
    await page.getByRole('button',{name:'Phóng to ảnh',exact:true}).click();
    await page.getByRole('button',{name:'Khôi phục',exact:true}).click();await waitPaint(page);
    assert.equal(await checksum(page),original,'reset returns every source pixel');
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('a failed local model can be retried; unavailable face controls never pretend to work',async()=>{
  const {page}=await open(undefined,{failModel:true});
  try{
    await page.getByText('Chưa mở được bộ nhận diện.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('slider',{name:'Mắt to',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('radio',{name:'Đen trắng',exact:true}).isDisabled(),false);
    await page.unroute(/face_landmarker.*\.task/);
    await page.getByRole('button',{name:'Nhận diện lại',exact:true}).click();await waitReady(page);
    assert.equal(await page.getByRole('slider',{name:'Mắt to',exact:true}).isDisabled(),false);
  }finally{await page.close()}
});

test('the fallback renders the same beauty when workers are unavailable',async()=>{
  const {page,errors}=await open(undefined,{failWorker:true});
  try{
    await waitReady(page);const original=await checksum(page);
    await page.getByRole('button',{name:'Trong trẻo',exact:true}).click();await waitPaint(page);
    assert.notEqual(await checksum(page),original);
    assert.equal(await page.getByRole('slider',{name:'Son môi',exact:true}).inputValue(),'7');
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('small phones and desktop keep the image separate from scrollable controls and Done reachable',async()=>{
  for(const viewport of [{width:320,height:568},{width:320,height:480},{width:667,height:375},{width:1366,height:768}]){
    const {page,errors}=await open(viewport);
    try{
      await waitReady(page);await page.getByRole('button',{name:'Rạng rỡ',exact:true}).click();await waitPaint(page);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const done=await page.getByRole('button',{name:'Xong',exact:true}).boundingBox();
      assert.ok(done.y>=0 && done.y+done.height<=viewport.height+1);
      const photo=await page.locator('.sb-beauty-view').boundingBox(),panel=await page.getByRole('region',{name:'Công cụ làm đẹp'}).boundingBox();
      assert.ok(photo.y+photo.height<=panel.y+1 || photo.x+photo.width<=panel.x+1,'controls never overlap the photograph');
      const controls=await page.locator('.sb-beauty-view button').evaluateAll(buttons=>buttons.map(button=>{
        const b=button.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom};
      }));
      for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
        const a=controls[i],b=controls[j],overlap=Math.min(a.right,b.right)-Math.max(a.x,b.x)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1;
        assert.equal(overlap,false,'photo actions have separate touch targets even on a short phone');
      }
      await page.screenshot({path:resolve(`.cache/beauty/editor-all-${viewport.width}.png`)});
      await page.getByRole('slider',{name:'Má hồng',exact:true}).fill('45');await waitPaint(page);
      await page.screenshot({path:resolve(`.cache/beauty/editor-${viewport.width}.png`)});
      assert.deepEqual(errors,[]);
    }finally{await page.close()}
  }
});

test('dragging uses bounded preview pixels, release restores detail, and applying to all survives navigation', async () => {
  const {page, errors}=await open();
  try {
    await waitReady(page);
    const slider=page.getByRole('slider',{name:'Mịn da',exact:true}),box=await slider.boundingBox();
    await page.mouse.move(box.x+box.width*.35,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.6,box.y+box.height/2);
    await page.waitForFunction(()=>document.querySelector('.sb-editor canvas')?.width>0 && Math.max(document.querySelector('.sb-editor canvas').width,document.querySelector('.sb-editor canvas').height)===640);
    await page.mouse.up();
    await page.waitForFunction(()=>Math.max(document.querySelector('.sb-editor canvas').width,document.querySelector('.sb-editor canvas').height)===1600);
    await waitPaint(page);
    assert.equal(await page.locator('.sb-editor canvas').evaluate(c=>Math.max(c.width,c.height)),1600);
    await page.getByRole('button',{name:'Trong trẻo',exact:true}).click();await waitPaint(page);
    await page.getByRole('button',{name:'Áp dụng cho tất cả ảnh',exact:true}).click();
    await page.getByRole('button',{name:'Ảnh tiếp',exact:true}).click();await waitPaint(page);await waitReady(page);
    assert.equal(await page.evaluate(()=>window.photoId),'p2');
    assert.equal(await page.getByRole('slider',{name:'Mịn da',exact:true}).inputValue(),'45');
    await slider.focus();await page.keyboard.press('ArrowRight');await waitPaint(page);
    assert.equal(await page.evaluate(()=>window.photoId),'p2','range keyboard input never changes photos');
    await page.getByRole('button',{name:'Ảnh trước',exact:true}).click();await waitPaint(page);
    assert.equal(await page.getByRole('slider',{name:'Mịn da',exact:true}).inputValue(),'45');
    assert.ok((await page.evaluate(()=>window.previewEdges)).includes(640));
    assert.deepEqual(errors,[]);
  } finally { await page.mouse.up();await page.close(); }
});

test('edited downloads use camera pixels, respect mirroring and the 20MP cap, and never use a print-size preview', async () => {
  const {page, errors}=await open();
  try {
    const result=await page.evaluate(()=>window.testDownloadSource());
    assert.deepEqual(result.size,[3651,5477]);
    assert.ok(result.size[0]*result.size[1]<=20_000_000);
    assert.deepEqual(result.printSize,[800,1200]);
    assert.deepEqual(result.smallSize,[320,480],'a small source is never enlarged');
    assert.ok(result.left[2]>result.left[0] && result.right[0]>result.right[2],'the camera original mirrors exactly once');
    assert.equal(result.pending,true,'a preview-only photo is never exported as a camera original');
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
});

test('a failed recipe stays a draft until retry renders successfully, instead of leaking into automatic printing', async () => {
  const {page}=await open();
  try {
    await waitReady(page);
    await page.evaluate(()=>{window.failEdit=true});
    await page.getByRole('radio',{name:'Đen trắng',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Synthetic render failure'}).waitFor();
    assert.equal(await page.evaluate(()=>window.adjust.filter),'original');
    assert.equal(await page.getByRole('button',{name:'Xong',exact:true}).isDisabled(),true);
    await page.evaluate(()=>{window.failEdit=false});
    await page.getByRole('button',{name:'Thử lại',exact:true}).click();await waitPaint(page);
    assert.equal(await page.evaluate(()=>window.adjust.filter),'mono');
    assert.equal(await page.getByRole('button',{name:'Xong',exact:true}).isDisabled(),false);
  } finally { await page.close(); }
});
