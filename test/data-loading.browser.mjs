// Real React hooks with delayed local API fixtures; no live sessions or photos.
// Development React intentionally exercises StrictMode's effect replay.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build } from "vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";

const fixture = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
  import { useLiveData } from '/src/use-live-data.js';
  import { useAdminSession } from '/src/admin/use-admin-session.js';
  import { StudioContext, ToastProvider } from '/src/studio.jsx';
  import { AlbumPage } from '/src/pages.jsx';
  import { PrintAlerts } from '/src/print-alerts.jsx';
  import { StorageMonitorProvider } from '/src/admin/storage-monitor.jsx';
  import { ServerStatus } from '/src/server-status.jsx';
  import { useKeepServerAwake } from '/src/use-connectivity.js';
  import { api } from '/src/api.js';
  window.api = api;
  const root = createRoot(document.getElementById('root'));
  let run = 0;
  function Live({ initialPath, interval, name = 'main', finished = false }) {
    const [path, setPath] = useState(initialPath);
    const reload = useLiveData(path,
      data => window.values.push({ name, data }),
      error => window.failures.push(error.message), interval, () => finished,
      { canRefresh: () => !window.mutating, version: () => window.revision });
    if (name === 'main') { window.reloadData = reload; window.setPath = setPath; }
    return React.createElement('div', null, path);
  }
  function Session() {
    const session = useAdminSession(() => {});
    window.session = session;
    return React.createElement('div', { id: 'session' },
      JSON.stringify({ user: session.user, checking: session.checking, error: session.error }));
  }
  function Awake({ enabled, interval, hours }) {
    useKeepServerAwake(enabled, interval, hours);
    return React.createElement('div', null, 'awake');
  }
  function SessionProvider() {
    const [error, setError] = useState('');
    window.setServerError = setError;
    return React.createElement(StudioContext.Provider, { value: { error } }, React.createElement(Session));
  }
  function AlbumRouter() {
    const navigate = useNavigate();
    window.goAlbum = token => navigate('/album/' + token);
    return React.createElement(Routes, null,
      React.createElement(Route, { path: '/album/:token', element: React.createElement(AlbumPage) }));
  }
  // The admin shell mounts one storage monitor and the print alerts side by side.
  function PrintHarness() {
    return React.createElement(StorageMonitorProvider, null,
      React.createElement(PrintAlerts));
  }
  window.mount = (mode, options = {}) => {
    window.values = []; window.failures = []; window.revision = 0; window.mutating = false;
    const content = mode === 'session' ? React.createElement(SessionProvider)
      : mode === 'album' ? React.createElement(MemoryRouter, { initialEntries: ['/album/A'] }, React.createElement(AlbumRouter))
      : mode === 'prints' ? React.createElement(PrintHarness)
      : mode === 'awake' ? React.createElement(Awake, options)
      : mode === 'status' ? React.createElement(React.Fragment, null,
        React.createElement(ServerStatus, { error: '', quiet: false }),
        React.createElement(Live, { initialPath: '/fixture/live', interval: options.interval || 200, finished: options.finished }))
      : React.createElement(React.Fragment, null,
        React.createElement(Live, { initialPath: options.path || '/fixture/live', interval: options.interval || 60000, finished: options.finished }),
        options.two && React.createElement(Live, { name: 'other', initialPath: options.path || '/fixture/live', interval: 60000 }));
    root.render(React.createElement(React.StrictMode, { key: ++run },
      React.createElement(ToastProvider, null, content)));
  };
`;

let server, browser, base;
before(async () => {
  const bundle = await build({
    configFile: false,
    logLevel: "error",
    esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:data-loading" } },
    plugins: [{
      name: "data-loading-fixture",
      resolveId: (id) => id === "virtual:data-loading" ? "\0data-loading-fixture" : null,
      load: (id) => id === "\0data-loading-fixture" ? fixture : null,
    }],
  });
  const assets = new Map(bundle.output.map((entry) => ["/" + entry.fileName, entry.code || entry.source]));
  const entry = bundle.output.find((file) => file.isEntry).fileName;
  server = createServer((req, res) => {
    if (assets.has(req.url)) {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(assets.get(req.url));
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end('<div id="root"></div><script type="module" src="/' + entry + '"></script>');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function setup(handler, { clock = false } = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  if (clock) await page.clock.install();
  page.setDefaultTimeout(5000);
  const requests = [], errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.EventSource = class {
      constructor() { window.stream = this; }
      addEventListener(name, handler) { this[name] = handler; }
      close() {}
    };
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const item = { route, path: new URL(request.url()).pathname, method: request.method(), url: request.url() };
    requests.push(item);
    if (handler) await handler(item);
  });
  await page.goto(base);
  await page.waitForFunction(() => typeof window.mount === "function").catch((error) => {
    throw new Error(`Fixture did not start: ${errors.join('; ') || error.message}`);
  });
  return { context, page, requests, errors };
}
const respond = (item, body, status = 200) => item.route.fulfill({ status, json: body }).catch(() => {});
const until = async (predicate) => {
  const end = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "fixture did not reach expected request");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("StrictMode and two mounted readers issue one initial GET", async () => {
  const f = await setup();
  try {
    await f.page.evaluate(() => window.mount('live', { two: true }));
    await until(() => f.requests.length === 1);
    await respond(f.requests[0], { version: 1 });
    await f.page.waitForFunction(() => window.values.length === 2);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(await f.page.evaluate(() => window.values.map(value => value.data.version)), [1, 1]);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("refresh bursts wait for the active GET and publish one fresh trailing response", async () => {
  const f = await setup();
  try {
    await f.page.evaluate(() => window.mount('live'));
    await until(() => f.requests.length === 1);
    await respond(f.requests[0], { version: 1 });
    await f.page.waitForFunction(() => window.values.length === 1);
    await f.page.evaluate(() => { window.pendingRefresh = window.reloadData(); });
    await until(() => f.requests.length === 2);
    await f.page.evaluate(() => { window.trailingRefresh = Promise.all(Array.from({ length: 8 }, () => window.reloadData())); });
    assert.equal(f.requests.length, 2);
    await respond(f.requests[1], { version: 2 });
    await until(() => f.requests.length === 3);
    assert.equal(await f.page.evaluate(() => window.values.length), 1, "superseded result is not shown");
    await respond(f.requests[2], { version: 3 });
    await f.page.evaluate(() => window.trailingRefresh);
    assert.deepEqual(await f.page.evaluate(() => window.values.map(value => value.data.version)), [1, 3]);
    assert.equal(f.requests.length, 3);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("changed filters and mutation revisions reject stale responses", async () => {
  const f = await setup();
  try {
    await f.page.evaluate(() => window.mount('live', { path: '/fixture/old' }));
    await until(() => f.requests.length === 1);
    await f.page.evaluate(() => window.setPath('/fixture/new'));
    await until(() => f.requests.length === 2);
    await respond(f.requests[0], { id: 'old' });
    await f.page.evaluate(() => { window.revision++; });
    await respond(f.requests[1], { id: 'before-mutation' });
    await f.page.evaluate(() => { window.latest = window.reloadData(); });
    await until(() => f.requests.length === 3);
    await respond(f.requests[2], { id: 'current' });
    await f.page.evaluate(() => window.latest);
    assert.deepEqual(await f.page.evaluate(() => window.values.map(value => value.data.id)), ['current']);
    assert.deepEqual(await f.page.evaluate(() => window.failures), []);
  } finally { await f.context.close(); }
});

test("hidden tabs pause polling and an online event resumes an idle visible reader", async () => {
  const f = await setup((item) => respond(item, { ok: true }));
  try {
    await f.page.evaluate(() => {
      window.fixtureHidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.fixtureHidden });
      window.mount('live', { interval: 40 });
    });
    await f.page.waitForFunction(() => window.values.length === 1);
    await f.page.waitForTimeout(140);
    assert.equal(f.requests.length, 1);
    await f.page.evaluate(() => { window.fixtureHidden = false; window.dispatchEvent(new Event('online')); });
    await f.page.waitForFunction(() => window.values.length >= 2);
    assert.ok(f.requests.length >= 2);
  } finally { await f.context.close(); }
});

test("session startup shares its check and an old retry cannot overwrite a completed login", async () => {
  let failures = 0;
  const f = await setup(async (item) => {
    if (item.path === '/api/auth/me' && failures < 2) {
      failures++;
      await respond(item, { message: 'Fixture unavailable' }, 503);
    } else if (item.path === '/api/auth/login') {
      await respond(item, { _id: 'new', name: 'New user', email: 'new@fixture.local', role: 'admin' });
    }
  });
  try {
    await f.page.evaluate(() => window.mount('session'));
    await f.page.waitForFunction(() => !window.session.checking && window.session.error);
    assert.equal(f.requests.length, 2);
    await f.page.evaluate(() => window.setServerError('offline'));
    await f.page.waitForTimeout(20);
    await f.page.evaluate(() => window.setServerError(''));
    await until(() => f.requests.length === 3);
    await f.page.evaluate(() => window.session.setCredentials({ email: 'new@fixture.local', password: 'fixture-password' }));
    await f.page.waitForFunction(() => window.session.credentials.email === 'new@fixture.local');
    await f.page.evaluate(() => window.session.login({ preventDefault() {} }));
    await f.page.waitForFunction(() => window.session.user?._id === 'new');
    await respond(f.requests[2], { _id: 'old', name: 'Old user' });
    assert.equal(await f.page.evaluate(() => window.session.user._id), 'new');
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("one transient gateway error recovers without publishing an error to the screen", async () => {
  let calls = 0;
  const f = await setup(item => ++calls === 1
    ? respond(item, { message: 'Temporary gateway failure' }, 502)
    : respond(item, { ready: true }));
  try {
    await f.page.evaluate(() => window.mount('live', { two: true }));
    await f.page.waitForFunction(() => window.values.length === 2);
    assert.equal(calls, 2, 'both readers share the initial request and its retry');
    assert.deepEqual(await f.page.evaluate(() => window.failures), []);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("wake and network-change bursts refresh a stopped catalog once", async () => {
  const f = await setup(item => respond(item, { ready: true }));
  try {
    await f.page.evaluate(() => window.mount('live', { finished: true, interval: 40 }));
    await f.page.waitForFunction(() => window.values.length === 1);
    await f.page.waitForTimeout(140);
    assert.equal(f.requests.length, 1, 'a finished reader does not poll');
    await f.page.evaluate(() => {
      for (const name of ['online', 'focus', 'pageshow', 'online', 'focus'])
        window.dispatchEvent(new Event(name));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await f.page.waitForFunction(() => window.values.length === 2);
    await f.page.waitForTimeout(140);
    assert.equal(f.requests.length, 2, 'one real request confirms recovery');
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("failed login-session check recovers on wake even when the catalog was already healthy", async () => {
  let calls = 0;
  const f = await setup(item => ++calls <= 2
    ? respond(item, { message: 'Unavailable' }, 503)
    : respond(item, { _id: 'restored', name: 'Fixture user' }));
  try {
    await f.page.evaluate(() => window.mount('session'));
    await f.page.waitForFunction(() => !window.session.checking && window.session.error);
    assert.equal(calls, 2);
    await f.page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
    });
    await f.page.waitForFunction(() => window.session.user?._id === 'restored');
    assert.equal(calls, 3);
    assert.equal(await f.page.evaluate(() => window.session.error), '');
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("session recovery also runs after a server restart without an online event", async () => {
  let calls = 0;
  const f = await setup(item => ++calls <= 2
    ? respond(item, { message: 'Restarting' }, 503)
    : respond(item, { _id: 'reconnected', name: 'Fixture user' }));
  try {
    await f.page.evaluate(() => window.mount('session'));
    await f.page.waitForFunction(() => !window.session.checking && window.session.error);
    await f.page.waitForFunction(() => window.session.user?._id === 'reconnected', null, { timeout: 6000 });
    assert.equal(calls, 3);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("switching album tokens removes the previous ticket while the next album loads", async () => {
  const f = await setup();
  try {
    await f.page.evaluate(() => window.mount('album'));
    await until(() => f.requests.length === 1);
    await respond(f.requests[0], { code: '111111', status: 'checked_in', photos: [], packageName: 'Fixture A' });
    await f.page.getByText('111111', { exact: true }).waitFor();
    await f.page.evaluate(() => window.goAlbum('B'));
    await until(() => f.requests.length === 2);
    assert.equal(await f.page.getByText('111111', { exact: true }).count(), 0);
    await f.page.getByText('Đang mở album…', { exact: true }).waitFor();
    await respond(f.requests[1], { code: '222222', status: 'checked_in', photos: [], packageName: 'Fixture B' });
    await f.page.getByText('222222', { exact: true }).waitFor();
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("the album checks every 5 seconds while photos are still arriving, then calms down to once a minute", async () => {
  let photos = [];
  const album = () => ({ code: '333333', status: 'completed', photos, packageName: 'Fixture C' });
  const f = await setup((item) => respond(item, item.path.endsWith('/print') ? null : album()), { clock: true });
  const polls = () => f.requests.filter((r) => r.path === '/api/albums/A').length;
  const advance = async (ms) => {
    for (let t = 0; t < ms; t += 1000) {
      await f.page.clock.runFor(1000);
      await f.page.waitForTimeout(5);
    }
  };
  try {
    await f.page.evaluate(() => window.mount('album'));
    await until(() => polls() === 1);
    // Ảnh còn đang lên (khách vừa bấm Chụp xong): 5 giây/lần.
    await advance(30_000);
    assert.ok(polls() >= 6 && polls() <= 8, `polls in the first 30 s: ${polls()}`);
    // Một ảnh mới tới lúc 2 phút: album còn đang đổi, tiếp tục 5 giây/lần thêm 3 phút.
    await advance(90_000);
    photos = [{ id: 'p1', number: 1, kind: 'original', links: {} }];
    await advance(150_000);
    const busy = polls();
    await advance(20_000);
    assert.ok(polls() - busy >= 3, 'still every 5 s: the album changed less than 3 minutes ago');
    // Đứng yên 3 phút: 60 giây/lần.
    await advance(60_000);
    const calm = polls();
    await advance(55_000);
    assert.ok(polls() - calm <= 1, `at most one check in 55 s once settled, got ${polls() - calm}`);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("pending originals keep two-second updates even after three minutes without a change", async () => {
  const album = { code: '333333', status: 'completed', photos: [{ id: 'waiting', kind: 'original', originalPending: true }] };
  const f = await setup((item) => respond(item, item.path.endsWith('/print') ? null : album), { clock: true });
  const polls = () => f.requests.filter((r) => r.path === '/api/albums/A').length;
  try {
    await f.page.evaluate(() => window.mount('album'));
    await until(() => polls() >= 1);
    for (let elapsed = 0; elapsed < 190_000; elapsed += 1000) {
      await f.page.clock.runFor(1000); await f.page.waitForTimeout(5);
    }
    const before = polls();
    for (let elapsed = 0; elapsed < 10_000; elapsed += 1000) {
      await f.page.clock.runFor(1000); await f.page.waitForTimeout(5);
    }
    assert.ok(polls() - before >= 4, 'a long camera upload cannot silently switch to one-minute polling');
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("a slow album connection stays a calm wait without inventing a cold-start cause or ETA", async () => {
  const f = await setup((item) => item.route.abort("failed"));
  try {
    await f.page.evaluate(() => window.mount('album'));
    await f.page.getByText(/Kết nối đang chậm. Album sẽ tự cập nhật khi có ảnh/).waitFor({ timeout: 8000 });
    assert.equal(await f.page.getByText('Đang mở album…', { exact: true }).count(), 1);
    assert.equal(await f.page.locator('.error, [role="alert"]').count(), 0, "no error box while waiting");
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("an unknown album says so once, in the page, without a repeating toast", async () => {
  const f = await setup();
  try {
    await f.page.evaluate(() => window.mount('album'));
    await until(() => f.requests.length === 1);
    await respond(f.requests[0], { message: 'Không tìm thấy album.' }, 404);
    await f.page.getByText('Không tìm thấy album.', { exact: true }).first().waitFor();
    await f.page.waitForTimeout(300);
    assert.equal(await f.page.getByText('Không tìm thấy album.', { exact: true }).count(), 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("a lost connection shows one notice, panels stay quiet, and a health probe restores everything", async () => {
  let down = false;
  const f = await setup((item) => down
    ? item.route.abort("internetdisconnected").catch(() => {})
    : respond(item, { ok: true }));
  try {
    // Like the catalog: loaded once, nothing keeps polling it.
    await f.page.evaluate(() => window.mount('status', { finished: true }));
    await f.page.waitForFunction(() => window.values.length >= 1);
    down = true;
    // A one-off action fails (e.g. saving a form); no panel is polling afterwards.
    await f.page.evaluate(() => window.api('/fixture/action', { retry: 0 }).catch(() => {}));
    const notice = f.page.locator('.toast-warning', { hasText: 'Chưa kết nối được máy chủ' });
    await notice.waitFor();
    await f.page.waitForTimeout(1500);
    assert.equal(await notice.count(), 1, 'one notice for the whole page, not one per failed poll');
    assert.equal(await f.page.locator('.toast-error').count(), 0);
    const loaded = await f.page.evaluate(() => window.values.length);
    down = false;
    // No reader is told to retry: the page's own health probe notices the server is back.
    await f.page.locator('.toast-success', { hasText: 'Đã kết nối lại máy chủ.' }).waitFor({ timeout: 8000 });
    assert.ok(f.requests.some((item) => item.path === '/api/health'));
    await f.page.waitForFunction((n) => window.values.length > n, loaded);
    assert.equal(await notice.count(), 0, 'the notice is dismissed after reconnecting');
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("brief window switches do not reload every panel, a long absence does", async () => {
  const f = await setup((item) => respond(item, { ok: true }));
  try {
    await f.page.evaluate(() => {
      window.fixtureHidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.fixtureHidden });
      window.mount('live', { finished: true });
    });
    await f.page.waitForFunction(() => window.values.length === 1);
    await f.page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      window.fixtureHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      window.fixtureHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await f.page.waitForTimeout(300);
    assert.equal(f.requests.length, 1, 'alt-tab or a quick tab switch is not a reason to reload');
    await f.page.evaluate(() => { window.fixtureHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await f.page.waitForTimeout(1100);
    await f.page.evaluate(() => { window.fixtureHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await f.page.waitForFunction(() => window.values.length === 2);
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("a print stream closed by a server restart reconnects and refreshes figures it may have missed", async () => {
  const f = await setup(async (item) => {
    if (item.path === '/api/admin/storage') return respond(item, { ttlHours: 24 });
  });
  try {
    await f.page.evaluate(() => {
      window.sources = [];
      window.EventSource = class {
        constructor(url) { this.url = url; this.readyState = 0; this.handlers = {}; window.sources.push(this); }
        addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); }
        emit(name, event = {}) { for (const handler of this.handlers[name] || []) handler(event); }
        close() { this.readyState = 2; this.closed = true; }
      };
      window.mount('prints');
    });
    await f.page.waitForFunction(() => window.sources.length > 0);
    // StrictMode opens and closes a first stream; count from the live one.
    const opened = await f.page.evaluate(() => window.sources.length);
    await f.page.evaluate(() => { const s = window.sources.at(-1); s.readyState = 1; s.emit('open'); });
    // The storage monitor listens for "nxc:print": it is how a reconnect makes the page look again.
    const storageReads = () => f.requests.filter((item) => item.path === '/api/admin/storage').length;
    await until(() => storageReads() >= 1);
    const before = storageReads();
    // The proxy answered 502: the browser closes the stream for good.
    await f.page.evaluate(() => { const s = window.sources.at(-1); s.readyState = 2; s.emit('error'); });
    await f.page.waitForFunction((n) => window.sources.length === n + 1, opened, { timeout: 4000 });
    assert.equal(await f.page.evaluate((n) => window.sources[n - 1].closed, opened), true);
    await f.page.evaluate(() => { const s = window.sources.at(-1); s.readyState = 1; s.emit('open'); });
    await until(() => storageReads() > before);
    // A temporary drop the browser retries by itself does not open a second stream.
    await f.page.evaluate(() => { const s = window.sources.at(-1); s.readyState = 0; s.emit('error'); });
    await f.page.waitForTimeout(2500);
    assert.equal(await f.page.evaluate(() => window.sources.length), opened + 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test("kiosk and admin pages ping /api/health on a timer, only inside shop hours, and stop when unmounted", async () => {
  const f = await setup((item) => respond(item, { ok: true }));
  try {
    const health = () => f.requests.filter((item) => item.path === '/api/health').length;
    await f.page.evaluate(() => window.mount('awake', { enabled: true, interval: 60, hours: { from: 0, to: 24 } }));
    await f.page.waitForFunction(() => document.body.textContent.includes('awake'));
    await until(() => health() >= 3);
    await f.page.evaluate(() => window.mount('awake', { enabled: false, interval: 60, hours: { from: 0, to: 24 } }));
    await f.page.waitForTimeout(150);
    const stopped = health();
    await f.page.waitForTimeout(300);
    assert.equal(health(), stopped, 'a page that is not the kiosk or admin never pings');
    await f.page.evaluate(() => window.mount('awake', { enabled: true, interval: 60, hours: { from: 3, to: 3 } }));
    await f.page.waitForTimeout(300);
    assert.equal(health(), stopped, 'outside shop hours nothing is sent');
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});
