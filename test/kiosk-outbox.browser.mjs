// Native IndexedDB transactions and mocked network responses. No printer/server is contacted.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { build } from "vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base;
before(async () => {
  const fixture = `import * as store from '/src/capture-store.js'; import * as compose from '/src/kiosk/compose.js';
    window.outbox={...store,...compose};`;
  const bundle = await build({ configFile:false, logLevel:"error", define:{"import.meta.env.VITE_API_URL":'""'},
    build:{write:false,rollupOptions:{input:"virtual:outbox.js"}},
    plugins:[{name:"outbox-fixture",resolveId:id=>id==="virtual:outbox.js"?"\0outbox.js":null,
      load:id=>id==="\0outbox.js"?fixture:null}],
  });
  const assets = new Map(bundle.output.map(a=>[`/${a.fileName}`,a.code||a.source]));
  const entry = bundle.output.find(a=>a.isEntry).fileName;
  server = createServer((req,res)=>{
    const source=assets.get(req.url);
    res.writeHead(200,{"Content-Type":source?"text/javascript":"text/html"});
    res.end(source||`<!doctype html><script type="module" src="/${entry}"></script>`);
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});

async function mount({hold=false}={}) {
  const context=await browser.newContext();
  const calls=[], held=[], errors=[];
  let blocking=hold;
  const fulfill=route=>route.fulfill({json:route.request().url().endsWith("/health")?{directPrint:2}:{sent:true,_id:"saved"},
    headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"GET, POST, OPTIONS"}});
  await context.route(/\/api\/|127\.0\.0\.1:8789\//,async route=>{
    const request=route.request();
    calls.push({url:request.url(),method:request.method(),key:request.headers()["x-print-key"]});
    if(blocking && request.url().includes("/api/")) held.push(route);
    else await fulfill(route);
  });
  async function newPage(){
    const page=await context.newPage();page.setDefaultTimeout(8000);
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(base);await page.waitForFunction(()=>window.outbox);
    return page;
  }
  const page=await newPage();
  return {page,newPage,calls,errors,close:()=>context.close(),
    release:async()=>{blocking=false;await Promise.all(held.splice(0).map(fulfill));}};
}

test("queue updates from two kiosk tabs commit atomically and a failed edit retains the old queue",async()=>{
  const f=await mount(), other=await f.newPage();
  try{
    const append=async(page,prefix)=>page.evaluate(async prefix=>{
      await Promise.all(Array.from({length:20},(_,i)=>window.outbox.updateSetting("atomic",current=>[...(current||[]),`${prefix}-${i}`])));
    },prefix);
    await Promise.all([append(f.page,"first"),append(other,"second")]);
    const rows=await f.page.evaluate(()=>window.outbox.readSetting("atomic"));
    assert.equal(rows.length,40);assert.equal(new Set(rows).size,40);
    const after=await f.page.evaluate(async()=>{
      try{await window.outbox.updateSetting("atomic",()=>{throw new Error("edit failed");});}catch{}
      return window.outbox.readSetting("atomic");
    });
    assert.deepEqual(after,rows);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test("three simultaneous photo reads share one scan; writes invalidate it and acknowledgement keeps camera bytes intact",async()=>{
  const f=await mount();
  try{
    const result=await f.page.evaluate(async()=>{
      const api=window.outbox;
      const image=new Blob([new Uint8Array([7,9,11,13])],{type:"image/jpeg"});
      await api.savePending({id:"a",token:"guest",image});
      await api.savePending({id:"b",token:"other",image});
      const native=IDBObjectStore.prototype.getAll;let scans=0;
      IDBObjectStore.prototype.getAll=function(...args){scans++;return native.apply(this,args);};
      try{
        const reads=Array.from({length:3},()=>api.readPending("guest"));
        const shared=reads.every(read=>read===reads[0]);
        const initial=await Promise.all(reads), sharedScans=scans;
        const before=api.readPending("guest");
        const write=api.savePending({id:"c",token:"guest",image});
        const after=api.readPending("guest");
        const [oldRows,,newRows]=await Promise.all([before,write,after]);
        const beforeProbe=scans;
        const probes=await Promise.all([api.hasPending("guest"),api.hasPending("missing")]);
        const probeScans=scans-beforeProbe;
        const stage={...newRows[0],stage:"original",originalAt:123};
        await api.savePending(stage);
        const stored=(await api.readPending("guest")).find(row=>row.id===stage.id);
        return {shared,sharedScans,counts:initial.map(rows=>rows.length),oldCount:oldRows.length,newCount:newRows.length,
          sameRead:before===after,probes,probeScans,bytes:[...new Uint8Array(await stored.image.arrayBuffer())],stage:stored.stage};
      }finally{IDBObjectStore.prototype.getAll=native;}
    });
    assert.equal(result.shared,true);assert.equal(result.sharedScans,1);
    assert.deepEqual(result.counts,[1,1,1]);
    assert.equal(result.oldCount,1);assert.equal(result.newCount,2);assert.equal(result.sameRead,false);
    assert.deepEqual(result.probes,[true,false]);assert.equal(result.probeScans,0);
    assert.deepEqual(result.bytes,[7,9,11,13]);assert.equal(result.stage,"original");
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

for(const kind of ["composite","print"])test(`concurrent ${kind} enqueues and acknowledgements retain every guest's job`,async()=>{
  const f=await mount({hold:true});
  try{
    await f.page.evaluate(async kind=>{
      const api=window.outbox;
      await Promise.all(Array.from({length:6},(_,i)=>kind==="composite"
        ?api.queueKioskComposite({token:`guest-${i}`,captureToken:`capture-${i}`,image:new Blob(["jpeg"],{type:"image/jpeg"})})
        :api.queueKioskPrint({token:`guest-${i}`,images:["data:image/png;base64,AQID"],archive:true})));
    },kind);
    const key=kind==="composite"?"kiosk-composite-queue":"kiosk-print-queue";
    assert.equal((await f.page.evaluate(key=>window.outbox.readSetting(key),key)).length,6);
    await f.release();
    await f.page.evaluate(kind=>kind==="composite"?window.outbox.runKioskComposites():window.outbox.runKioskPrints(),kind);
    assert.deepEqual(await f.page.evaluate(key=>window.outbox.readSetting(key),key),[]);
    assert.equal(f.calls.filter(call=>call.method==="POST").length,6);
    assert.equal(f.calls.some(call=>call.url.includes(":8789")),false,"background queues never print physical paper");
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test("a failed album prerequisite leaves an acknowledged RX1 print successful; concurrent attempts share its durable ID",async()=>{
  const f=await mount();
  try{
    const result=await f.page.evaluate(async()=>{
      const api=window.outbox,states=[];
      const unwatch=api.watchKioskPrint((token,state)=>states.push(state.status));
      const job={token:"same-guest",images:["data:image/png;base64,AQID"],frameName:"Pink",printSize:"strip"};
      await Promise.all([
        api.directKioskPrint(job,{archiveAfter:Promise.reject(new Error("album preparation failed"))}),
        api.directKioskPrint(job),
      ]);
      await api.runKioskPrints();unwatch();
      return {states,final:api.kioskPrintState(job.token),saved:await api.readSetting(`kiosk-direct-request:${job.token}`)};
    });
    const sends=f.calls.filter(call=>call.url.endsWith(":8789/print"));
    assert.equal(sends.length,2);assert.equal(new Set(sends.map(call=>call.key)).size,1);
    assert.equal(sends[0].key,result.saved.requestKey);
    assert.equal(result.final.status,"printed");assert.equal(result.states.includes("failed"),false);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
