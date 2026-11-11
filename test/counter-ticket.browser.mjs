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
const packages = [
  {_id:'instax',name:'Polaroid',printSize:'instax',price:100000},
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

async function mount(branch = "") {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const requests = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON();
    requests.push({path,body});
    if (path.endsWith("/quote")) return route.fulfill({ json:{total:70000} });
    if (path.endsWith("/draft")) return route.fulfill({ status:201, json:{_id:"draft",branch:body.branch,
      status:"pending",paid:false,total:70000,packageName:"Gói photobooth",printSize:"strip",prints:1} });
    if (path.endsWith("/activate")) return route.fulfill({ json:{_id:"draft",code:"123456",branch:"HN",
      status:"confirmed",paid:true,total:70000,packageName:"Gói photobooth",printSize:"strip",prints:1} });
    throw new Error(`Unexpected API ${path}`);
  });
  const quoted = page.waitForResponse(response=>response.url().endsWith("/quote"));
  await page.goto(base + (branch ? `?branch=${encodeURIComponent(branch)}` : ""));
  await quoted;
  await page.getByRole("heading",{name:"Tạo mã chụp cho khách"}).waitFor();
  return {page,requests};
}

test("the counter defaults to HN photobooth even when a Polaroid-only branch and Instax package come first", async () => {
  const {page,requests} = await mount();
  try {
    assert.equal(await page.getByRole("combobox",{name:/^Chi nhánh/}).inputValue(),"HN");
    assert.deepEqual(await page.getByRole("combobox",{name:/^Chi nhánh/}).locator("option").allTextContents(),["Chọn chi nhánh","HN"]);
    assert.equal(await page.getByRole("combobox",{name:/^Gói chụp/}).inputValue(),"strip");
    await page.getByRole("button",{name:"Tạo phiếu chụp",exact:true}).click();
    await page.getByRole("heading",{name:"Chờ xác nhận đã thu"}).waitFor();
    assert.equal(requests.find(r=>r.path.endsWith("/draft")).body.branch,"HN");
    await page.getByText("Chi nhánh dùng mã:",{exact:false}).waitFor();
    await page.getByRole("checkbox").check();
    await page.getByRole("button",{name:"Xác nhận đã thu & hiện mã 6 số"}).click();
    await page.getByRole("heading",{name:"Mã chụp đã sẵn sàng"}).waitFor();
    assert.equal(await page.evaluate(()=>window.issued.branch),"HN");
    assert.ok((await page.getByText("Chi nhánh dùng mã:",{exact:false}).innerText()).includes("HN"));
  } finally { await page.close(); }
});

test("staff assigned only to a Polaroid branch cannot issue a photobooth code under another branch", async () => {
  const {page,requests} = await mount("Bắc Ninh");
  try {
    await page.getByText(/Chưa có phòng photobooth đang hoạt động trong chi nhánh của bạn/).waitFor();
    assert.equal(await page.getByRole("button",{name:"Tạo phiếu chụp",exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole("combobox",{name:/^Chi nhánh/}).inputValue(),"");
    assert.equal(requests.some(r=>r.path.endsWith("/draft")||r.path.endsWith("/activate")),false);
  } finally { await page.close(); }
});
