import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { build } from "vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

let server, browser, base;
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {StudioContext,ToastProvider} from '/src/studio.jsx'; import {CounterTicket} from '/src/counter-ticket.jsx';
const rooms = [
  {_id:'polaroid',name:'Polaroid',branch:'Bắc Ninh',kind:'polaroid',active:true},
  {_id:'booth',name:'PTB',branch:'HN',kind:'photobooth',active:true},
  {_id:'off',name:'Old booth',branch:'Closed',kind:'photobooth',active:false}];
if(new URLSearchParams(location.search).has('multi'))rooms.push({_id:'booth-2',name:'PTB 2',branch:'HCM',kind:'photobooth',active:true});
// Gói Polaroid tính theo phút như Selfbooth (giá, số phút, số tấm Instax) đứng trước.
const packages = [
  {_id:'polaroid-big',name:'Chụp đôi',printSize:'instax',price:150000,duration:12,prints:2},
  {_id:'instax',name:'Chụp đơn',printSize:'instax',price:90000,duration:7,prints:1},
  {_id:'strip',name:'Gói photobooth',printSize:'strip',price:70000,prints:1,shots:4}];
createRoot(document.getElementById('root')).render(React.createElement(StudioContext.Provider,
  {value:{rooms,packages,settings:{}}},React.createElement(ToastProvider,null,React.createElement(CounterTicket,
  {assignedBranch:new URLSearchParams(location.search).get('branch')||'',onClose:()=>{},onCreated:ticket=>window.issued=ticket}))));`;

before(async () => {
  const bundle = await build({ configFile: false, logLevel: "error", esbuild: { jsx: "automatic" },
    define: { "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, rollupOptions: { input: "virtual:counter.jsx" } },
    plugins: [{ name: "counter-fixture", resolveId: id => id === "virtual:counter.jsx" ? "\0counter.jsx" : null,
      load: id => id === "\0counter.jsx" ? fixture : null }],
  });
  const assets = new Map(bundle.output.map(a => [`/${a.fileName}`, a.code || a.source]));
  const entry = bundle.output.find(a => a.isEntry).fileName;
  server = createServer((req,res) => {
    const path = new URL(req.url,"http://fixture").pathname;
    if (assets.has(path)) { res.writeHead(200,{"Content-Type":"text/javascript"}); return res.end(assets.get(path)); }
    res.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});
    res.end(`<div id="root"></div><script type="module" src="/${entry}"></script>`);
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless:true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function mount(branch = "", multi = false) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const requests = [];
  let draft;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON();
    requests.push({path,body});
    if (path.endsWith("/quote")) return route.fulfill({ json:{total:70000} });
    if (path.endsWith("/draft")) {
      const polaroid = body.room === 'polaroid';
      draft = {_id:'draft',room:body.room,roomName:polaroid?'Polaroid':body.room==='booth-2'?'PTB 2':'PTB',
        branch:polaroid?'Bắc Ninh':body.room==='booth-2'?'HCM':'HN',status:'pending',paid:false,total:70000,
        packageName:polaroid?'Polaroid đôi':'Gói photobooth',printSize:polaroid?'instax':'strip',prints:1};
      return route.fulfill({status:201,json:draft});
    }
    if (path.endsWith("/activate")) return route.fulfill({json:{...draft,code:'123456',status:'confirmed',paid:true}});
    throw new Error(`Unexpected API ${path}`);
  });
  const quoted = page.waitForResponse(response=>response.url().endsWith("/quote"));
  const query = new URLSearchParams();
  if(branch)query.set('branch',branch);
  if(multi)query.set('multi','1');
  await page.goto(base + '?' + query);
  await quoted;
  await page.getByRole("heading",{name:"Tạo mã chụp cho khách"}).waitFor();
  return {page,requests};
}

test("the counter defaults to HN photobooth even when a Polaroid-only branch and Instax package come first", async () => {
  const {page,requests} = await mount();
  try {
    assert.equal(await page.getByRole("combobox",{name:/^Chi nhánh/}).count(),0);
    await page.getByText('Máy / phòng chụp: PTB',{exact:true}).waitFor();
    assert.equal(await page.getByRole("combobox",{name:/^Gói chụp/}).inputValue(),"strip");
    await page.getByRole("button",{name:"Tạo phiếu chụp",exact:true}).click();
    await page.getByRole("heading",{name:"Chờ xác nhận đã thu"}).waitFor();
    const sent = requests.find(r=>r.path.endsWith('/draft')).body;
    assert.equal(sent.room,'booth');
    assert.equal('branch' in sent,false,'the server derives the branch from the room');
    assert.equal(await page.getByText('Chi nhánh dùng mã:',{exact:false}).count(),0);
    await page.getByRole("checkbox").check();
    await page.getByRole("button",{name:"Xác nhận đã thu & hiện mã 6 số"}).click();
    await page.getByRole("heading",{name:"Mã chụp đã sẵn sàng"}).waitFor();
    assert.equal(await page.evaluate(()=>window.issued.branch),"HN");
    await page.getByText('PTB',{exact:true}).waitFor();
  } finally { await page.close(); }
});

test("staff assigned only to a Polaroid branch cannot issue a photobooth code under another branch", async () => {
  const {page,requests} = await mount("Bắc Ninh");
  try {
    // Chi nhánh chỉ có phòng Polaroid: mặc định gói Polaroid; đổi sang gói photobooth thì bị chặn.
    assert.equal(await page.getByRole("combobox",{name:/^Gói chụp/}).inputValue(),"polaroid-big");
    await page.getByText('Máy / phòng chụp: Polaroid',{exact:true}).waitFor();
    await page.getByRole("combobox",{name:/^Gói chụp/}).selectOption("strip");
    await page.getByText(/Chưa có phòng photobooth đang hoạt động phù hợp với gói này/).waitFor();
    assert.equal(await page.getByRole("button",{name:"Tạo phiếu chụp",exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole("combobox",{name:/^Chi nhánh/}).count(),0);
    assert.equal(requests.some(r=>r.path.endsWith("/draft")||r.path.endsWith("/activate")),false);
  } finally { await page.close(); }
});

test("the counter sells timed Polaroid packages as codes for the Polaroid room (Selfbooth model)", async () => {
  const {page,requests} = await mount();
  try {
    const pack = page.getByRole("combobox",{name:/^Gói chụp/});
    // Hai nhóm gói; mọi gói Polaroid đang bán đều hiện, kèm số phút.
    assert.deepEqual(await pack.locator("optgroup").evaluateAll(groups => groups.map(g => g.label)),
      ["Photobooth","Polaroid (nhập mã ở phòng Polaroid)"]);
    const layouts = await pack.locator("optgroup").nth(1).locator("option").allTextContents();
    assert.equal(layouts.length, 2);
    assert.match(layouts[0], /^Chụp đôi · 12 phút — 150\.000/);
    assert.match(layouts[1], /^Chụp đơn · 7 phút — 90\.000/);
    const requoted = page.waitForResponse(response=>response.url().endsWith("/quote"));
    await pack.selectOption("polaroid-big");
    await requoted;
    // Đổi gói tự chọn phòng Polaroid, không cần chọn chi nhánh.
    await page.getByText('Máy / phòng chụp: Polaroid',{exact:true}).waitFor();
    await page.getByText("Phòng Polaroid (Selfbooth) · 12 phút chụp, bấm dây không giới hạn · in 2 tấm Instax · khách chọn ảnh & bộ khung trên điện thoại").waitFor();
    await page.getByRole("button",{name:"Tạo phiếu chụp",exact:true}).click();
    await page.getByRole("heading",{name:"Chờ xác nhận đã thu"}).waitFor();
    const draft = requests.find(r=>r.path.endsWith("/draft")).body;
    assert.equal(draft.package,"polaroid-big");
    assert.equal(draft.room,'polaroid');
    assert.equal('branch' in draft,false);
  } finally { await page.close(); }
});

test('multiple matching machines are chosen by name; inactive machines and branch inputs stay out of the form',async()=>{
  const {page,requests}=await mount('',true);
  try{
    const room=page.getByRole('combobox',{name:'Máy / phòng chụp'});
    assert.deepEqual(await room.locator('option').allTextContents(),['PTB','PTB 2']);
    await room.selectOption('booth-2');
    await page.getByRole('button',{name:'Tạo phiếu chụp',exact:true}).click();
    await page.getByRole('heading',{name:'Chờ xác nhận đã thu'}).waitFor();
    const sent=requests.find(r=>r.path.endsWith('/draft')).body;
    assert.equal(sent.room,'booth-2');
    assert.equal('branch' in sent,false);
    await page.getByText('Máy / phòng chụp: PTB 2.',{exact:true}).waitFor();
  }finally{await page.close();}
});
