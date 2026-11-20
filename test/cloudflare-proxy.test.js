import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../cloudflare/worker.js";

const origin = "https://nxc-photo.fixture.workers.dev";
const upstreamOrigin = "https://photo-be.fixture.onrender.com";
const environment = (assets = () => new Response("static asset")) => ({
  API_ORIGIN: upstreamOrigin,
  ASSETS: { fetch: assets },
});
const request = (path, options) => new Request(origin + path, options);

function intercept(t, handler) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const outgoing = new Request(input, init);
    calls.push({ input, init, request: outgoing });
    return handler(outgoing, calls.length);
  };
  t.after(() => { globalThis.fetch = previous; });
  return calls;
}

test("Cloudflare sends only /api and /api/* to Render and leaves SPA/assets to the asset binding", async (t) => {
  const assets = [];
  const env = environment((input) => {
    assets.push(input.url);
    return new Response("app or asset");
  });
  const calls = intercept(t, () => Response.json({ ok: true }));
  for (const path of ["/api", "/api/health", "/api/albums/token?photo=a%2Fb&size=original"]) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).request.url, upstreamOrigin + path);
  }
  for (const path of ["/", "/admin/bookings", "/album/token", "/assets/main.js", "/apiculture", "/api-other"]) {
    assert.equal(await (await worker.fetch(request(path), env)).text(), "app or asset");
  }
  assert.equal(calls.length, 3);
  assert.equal(assets.length, 6);
});

test("a missing build file answers a 404 nothing stores; other unknown paths open the app page", async () => {
  // As the asset binding answers with not_found_handling "none": a file or nothing.
  const files = { "/": "<!doctype html>app", "/assets/index-new.css": "body{}" };
  const asked = [];
  const env = environment((input) => {
    const path = new URL(input.url).pathname;
    asked.push(path);
    return path in files ? new Response(files[path]) : new Response("missing", { status: 404 });
  });
  // Opened while a new version is switched in: the old way, this got the app page with the
  // "immutable" 1-year cache of /assets/* and the admin stayed unstyled after every reload.
  for (const path of ["/assets/index-not-yet.css", "/fonts/missing.woff2"]) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match(response.headers.get("Content-Type"), /^text\/plain/);
  }
  assert.equal(await (await worker.fetch(request("/assets/index-new.css"), env)).text(), "body{}");
  for (const path of ["/kiosk", "/kiosk?device=x", "/admin/bookings", "/album/token", "/assetsy"]) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), "<!doctype html>app", path);
  }
  assert.deepEqual(asked.slice(-2), ["/assetsy", "/"]);
});

test("home, admin and album pages opened on *.workers.dev move to the shop's own domain; kiosk and API stay", async (t) => {
  const env = { ...environment(() => new Response("app or asset")), PUBLIC_ORIGIN: "https://mellowptb.com" };
  const calls = intercept(t, () => Response.json({ ok: true }));
  for (const [path, to] of [
    ["/", "https://mellowptb.com/"],
    ["/admin", "https://mellowptb.com/admin"],
    ["/admin/bookings?from=2026-11-01", "https://mellowptb.com/admin/bookings?from=2026-11-01"],
    ["/album/abc123", "https://mellowptb.com/album/abc123"],
  ]) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("Location"), to);
  }
  // Máy chụp giữ địa chỉ đang mở (ảnh chưa gửi, quyền camera / thư mục nằm ở đó); API không chuyển.
  for (const path of ["/kiosk?device=x", "/assets/main.js", "/administrator"])
    assert.equal(await (await worker.fetch(request(path), env)).text(), "app or asset");
  assert.equal((await worker.fetch(request("/api/health"), env)).status, 200);
  assert.equal(calls.length, 1);
  // Đã ở tên miền chính, hoặc chưa cấu hình: không chuyển.
  const own = new Request("https://mellowptb.com/admin");
  assert.equal(await (await worker.fetch(own, env)).text(), "app or asset");
  assert.equal(await (await worker.fetch(request("/admin"), environment())).text(), "static asset");
});

test("Cloudflare rejects foreign and opaque browser origins before contacting Render, including safe reads", async (t) => {
  const calls = intercept(t, () => { throw Error("must not reach Render"); });
  for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
    for (const foreignOrigin of ["https://evil.example", "https://nxc-photo.fixture.workers.dev.evil.example", "null"]) {
      const response = await worker.fetch(request("/api/auth/login", {
        method,
        headers: { Origin: foreignOrigin },
      }), environment());
      assert.equal(response.status, 403, `${method} ${foreignOrigin}`);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(typeof (await response.json()).message, "string");
    }
  }
  assert.equal(calls.length, 0);
});

test("Cloudflare refuses cross-site writes with no Origin but keeps normal API clients and safe reads usable", async (t) => {
  const calls = intercept(t, () => Response.json({ ok: true }));
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const denied = await worker.fetch(request("/api/admin/bookings", {
      method, headers: { "Sec-Fetch-Site": "cross-site" },
    }), environment());
    assert.equal(denied.status, 403);
  }
  assert.equal(calls.length, 0);
  for (const options of [
    { method: "POST" },
    { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } },
    { method: "GET", headers: { "Sec-Fetch-Site": "cross-site" } },
  ]) {
    assert.equal((await worker.fetch(request("/api/health", options), environment())).status, 200);
  }
  assert.equal(calls.length, 3);
});

test("Cloudflare validates the browser origin before translating it to Render and discards spoofed proxy headers", async (t) => {
  const calls = intercept(t, () => Response.json({ ok: true }));
  const response = await worker.fetch(request("/api/auth/login", {
    method: "POST",
    headers: {
      Origin: origin,
      Host: "evil.example",
      Forwarded: "for=evil;host=evil.example;proto=http",
      "X-Forwarded-For": "1.2.3.4",
      "X-Forwarded-Host": "evil.example",
      "X-Forwarded-Proto": "http",
      "X-Forwarded-Scheme": "http",
      "X-Real-IP": "1.2.3.4",
      "Access-Control-Allow-Origin": "https://evil.example",
      "CF-Connecting-IP": "203.0.113.19",
      Cookie: "session=host-only-session",
      "Content-Type": "application/json",
    },
    body: '{"email":"fixture@example.test","password":"fixture"}',
  }), environment());
  assert.equal(response.status, 200);
  const sent = calls[0].request;
  assert.equal(sent.url, upstreamOrigin + "/api/auth/login");
  assert.equal(sent.headers.get("Origin"), upstreamOrigin);
  assert.equal(sent.headers.get("Cookie"), "session=host-only-session");
  assert.notEqual(sent.headers.get("Host"), "evil.example");
  assert.equal(sent.headers.get("Forwarded"), null);
  assert.equal(sent.headers.get("X-Forwarded-For"), "203.0.113.19");
  assert.equal(sent.headers.get("X-Forwarded-Host"), new URL(upstreamOrigin).host);
  assert.equal(sent.headers.get("X-Forwarded-Proto"), "https");
  assert.equal(sent.headers.get("X-Forwarded-Scheme"), null);
  assert.equal(sent.headers.get("X-Real-IP"), null);
  assert.equal(sent.headers.get("Access-Control-Allow-Origin"), null);
});

test("Cloudflare does not manufacture a trusted client IP from a browser X-Forwarded-For header", async (t) => {
  const calls = intercept(t, () => new Response(null, { status: 204 }));
  const response = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { Origin: origin, "X-Forwarded-For": "1.2.3.4" },
  }), environment());
  assert.equal(response.status, 204);
  assert.equal(calls[0].request.headers.get("X-Forwarded-For"), null);
});

test("Cloudflare streams camera upload bytes without rewriting JPEG metadata, cookies or upload headers", async (t) => {
  const bytes = new Uint8Array([255, 216, 255, 226, 0, 16, 73, 67, 67, 95, 80, 82, 79, 70, 73, 76, 69, 0, 255, 217]);
  let controller;
  const input = new ReadableStream({ start(value) { controller = value; controller.enqueue(bytes.subarray(0, 10)); } });
  const calls = intercept(t, async (sent) => {
    const reader = sent.body.getReader();
    assert.deepEqual((await reader.read()).value, bytes.subarray(0, 10));
    controller.enqueue(bytes.subarray(10));
    controller.close();
    assert.deepEqual((await reader.read()).value, bytes.subarray(10));
    assert.equal((await reader.read()).done, true);
    return Response.json({ saved: true }, { status: 201 });
  });
  const custom = {
    "X-Photo-Key": "capture-fixture-17",
    "X-Capture-Token": "signed-fixture-session",
    "X-Photo-Stored": "signed-original-object",
    "X-Photo-Mirrored": "true",
    "X-Photo-Preview-Length": "65432",
    "X-Photo-Name": "DSCF0148.JPG",
  };
  const response = await worker.fetch(request("/api/kiosk/photo?mode=raw", {
    method: "POST", body: input, duplex: "half",
    headers: { ...custom, Origin: origin, Cookie: "session=fixture", "Content-Type": "image/jpeg" },
  }), environment());
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { saved: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.method, "POST");
  assert.equal(calls[0].request.url, upstreamOrigin + "/api/kiosk/photo?mode=raw");
  for (const [name, value] of Object.entries(custom)) assert.equal(calls[0].request.headers.get(name), value);
  assert.equal(calls[0].request.headers.get("Content-Type"), "image/jpeg");
  assert.equal(calls[0].request.headers.get("Cookie"), "session=fixture");
});

test("Cloudflare preserves original/print bytes, ranges, disposition and private cookies with no edge cache", async (t) => {
  const bytes = new Uint8Array([255, 216, 0, 255, 1, 128, 3, 254, 255, 217]);
  const cookies = [
    "session=fixture; Path=/; Expires=Thu, 22 Oct 2026 08:00:00 GMT; HttpOnly; Secure; SameSite=None",
    "other=fixture; Path=/; HttpOnly; Secure",
  ];
  const calls = intercept(t, () => {
    const headers = new Headers({
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.length),
      "Content-Range": "bytes 0-9/20000",
      "Accept-Ranges": "bytes",
      "Content-Disposition": 'attachment; filename="DSCF0148.JPG"',
      "Cache-Control": "private, max-age=60",
      "Access-Control-Allow-Origin": upstreamOrigin,
      "Access-Control-Allow-Credentials": "true",
    });
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
    return new Response(bytes, { status: 206, headers });
  });
  const response = await worker.fetch(request("/api/albums/token/photos/id?size=original&download=1", {
    headers: { Range: "bytes=0-9", Cookie: "session=fixture" },
  }), environment());
  assert.equal(response.status, 206);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(response.headers.get("Content-Length"), String(bytes.length));
  assert.equal(response.headers.get("Content-Range"), "bytes 0-9/20000");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="DSCF0148.JPG"');
  assert.deepEqual(response.headers.getSetCookie(), cookies);
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=60", "the backend's own rule");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal(calls[0].request.headers.get("Range"), "bytes=0-9");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "manual");
});

test("Cloudflare keeps the backend's caching rules and stores nothing that has none", async (t) => {
  const rules = {
    "/api/albums/token": "private, no-cache",
    "/api/frames/id/image?v=abc": "public, max-age=31536000, immutable",
    "/api/albums/token/photos/id?size=thumbnail&direct=1": "private, max-age=245",
    "/api/admin/print-jobs/stream": "no-cache, no-transform",
  };
  intercept(t, (outgoing) => {
    const url = new URL(outgoing.url);
    const rule = rules[url.pathname + url.search];
    return new Response("{}", { headers: rule ? { "Cache-Control": rule, ETag: 'W/"1"' } : {} });
  });
  for (const [path, rule] of Object.entries(rules)) {
    const response = await worker.fetch(request(path), environment());
    assert.equal(response.headers.get("Cache-Control"), rule, path);
  }
  const response = await worker.fetch(request("/api/auth/me", { headers: { Cookie: "session=fixture" } }), environment());
  assert.equal(response.headers.get("Cache-Control"), "no-store", "no rule: not stored");
});

test("an unchanged album poll gets an empty 304 even when Render answers the subrequest in full", async (t) => {
  const body = JSON.stringify({ photos: Array.from({ length: 60 }, (_, i) => ({ id: String(i) })) });
  intercept(t, () => new Response(body, { status: 200, headers: {
    "Content-Type": "application/json; charset=utf-8", "Content-Length": String(body.length),
    "Cache-Control": "private, no-cache", ETag: 'W/"1c9-abc"', "Set-Cookie": "session=s; Path=/; HttpOnly; Secure",
  } }));
  for (const tag of ['W/"1c9-abc"', '"1c9-abc"', '"older", W/"1c9-abc"', "*"]) {
    const response = await worker.fetch(request("/api/albums/token", { headers: { "If-None-Match": tag } }), environment());
    assert.equal(response.status, 304, tag);
    assert.equal(response.body, null);
    assert.equal(response.headers.get("ETag"), 'W/"1c9-abc"');
    assert.equal(response.headers.get("Cache-Control"), "private, no-cache");
    assert.equal(response.headers.get("Content-Length"), null);
  }
  for (const headers of [{ "If-None-Match": 'W/"other"' }, {}]) {
    const response = await worker.fetch(request("/api/albums/token", { headers }), environment());
    assert.equal(response.status, 200);
    assert.equal(await response.text(), body, "changed or first load: the full album");
  }
  // Writes are never turned into 304s.
  const write = await worker.fetch(request("/api/albums/token/photos", {
    method: "POST", headers: { Origin: origin, "If-None-Match": "*", "Content-Type": "application/json" }, body: "{}",
  }), environment());
  assert.equal(write.status, 200);
});

test("the cron keeps Render awake from 06:00 to 01:00 Vietnam time and stays quiet at night", async (t) => {
  const calls = intercept(t, () => new Response('{"ok":true}'));
  const run = async (utc, env = environment()) => {
    const pending = [];
    await worker.scheduled({ scheduledTime: Date.parse(utc) }, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  };
  // Vietnam = UTC+7: 06:00 → 23:00Z (day before), 00:50 → 17:50Z, 01:00 → 18:00Z, 05:50 → 22:50Z.
  for (const utc of ["2026-10-18T23:00:00Z", "2026-10-19T05:00:00Z", "2026-10-19T16:30:00Z", "2026-10-19T17:50:00Z"])
    await run(utc);
  assert.equal(calls.length, 4, "pings while the shop and its albums are in use");
  assert.ok(calls.every((c) => c.request.url === upstreamOrigin + "/api/health" && c.request.method === "GET"));
  for (const utc of ["2026-10-19T18:00:00Z", "2026-10-19T20:30:00Z", "2026-10-19T22:50:00Z"])
    await run(utc);
  assert.equal(calls.length, 4, "no pings 01:00–06:00, so the free hours last the month");
  await run("2026-10-19T05:00:00Z", { API_ORIGIN: "http://insecure.example" });
  await run("2026-10-19T05:00:00Z", { API_ORIGIN: "not a url" });
  assert.equal(calls.length, 4, "never pings a misconfigured or insecure origin");
});

test("Cloudflare keeps HEAD and 304 responses bodyless with the upstream validators", async (t) => {
  const calls = intercept(t, () => new Response(null, { status: 304, headers: { ETag: '"fixture"' } }));
  const response = await worker.fetch(request("/api/albums/token", {
    method: "HEAD", headers: { "If-None-Match": '"fixture"' },
  }), environment());
  assert.equal(response.status, 304);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("ETag"), '"fixture"');
  assert.equal(calls[0].request.body, null);
  assert.equal(calls[0].request.headers.get("If-None-Match"), '"fixture"');
});

test("Cloudflare remaps only Render redirects and leaves signed R2 URLs exactly intact", async (t) => {
  const remote = "https://account.r2.cloudflarestorage.com/media/file.jpg?X-Amz-Signature=a%2Bb%2Fc&download=1";
  const locations = [
    [upstreamOrigin + "/api/auth/me?from=login#state", origin + "/api/auth/me?from=login#state"],
    ["/api/albums/fixture?size=preview", origin + "/api/albums/fixture?size=preview"],
    [remote, remote],
    ["https://photo-be.fixture.onrender.com.evil.example/api/auth/me", "https://photo-be.fixture.onrender.com.evil.example/api/auth/me"],
  ];
  let location;
  const calls = intercept(t, () => new Response(null, { status: 302, headers: { Location: location } }));
  for (const [from, expected] of locations) {
    location = from;
    const response = await worker.fetch(request("/api/albums/token/photos/id?direct=1"), environment());
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), expected);
    assert.equal(calls.at(-1).init.redirect, "manual", "never follow signed redirects with the session cookie");
  }
  assert.equal(calls.length, locations.length);
});

test("Cloudflare returns the print SSE stream immediately and delivers events before the stream closes", async (t) => {
  const encoder = new TextEncoder();
  let controller;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  intercept(t, () => new Response(stream, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
  } }));
  let timeout;
  t.after(() => { clearTimeout(timeout); try { controller.close(); } catch {} });
  const response = await Promise.race([
    worker.fetch(request("/api/admin/print-jobs/stream", { headers: { Cookie: "session=fixture" } }), environment()),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(Error("proxy buffered an open SSE stream")), 500); }),
  ]);
  clearTimeout(timeout);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  assert.equal(response.headers.get("X-Accel-Buffering"), "no");
  const reader = response.body.getReader();
  const first = 'event: print\ndata: {"code":"fixture-1"}\n\n';
  controller.enqueue(encoder.encode(first));
  assert.equal(new TextDecoder().decode((await reader.read()).value), first);
  const second = ": heartbeat\n\n";
  controller.enqueue(encoder.encode(second));
  assert.equal(new TextDecoder().decode((await reader.read()).value), second);
  controller.close();
  assert.equal((await reader.read()).done, true);
});

test("Cloudflare never retries writes after a lost upstream response and reports a small no-store JSON error", async (t) => {
  const calls = intercept(t, () => { throw new TypeError("connection lost after the payment was saved"); });
  const response = await worker.fetch(request("/api/admin/bookings/fixture/paid", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: '{"paid":true}',
  }), environment());
  assert.equal(calls.length, 1, "a payment, capture or print must never be replayed by the edge proxy");
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Type"), /application\/json/);
  const body = await response.json();
  assert.equal(typeof body.message, "string");
  assert.ok(!body.message.includes("payment was saved"), "internal fetch errors do not leak");
});

test("Cloudflare passes backend error status and body through without an SPA fallback or retry", async (t) => {
  const error = { message: "Backend fixture unavailable", retryAfter: 30 };
  let assetsCalled = false;
  const calls = intercept(t, () => Response.json(error, { status: 503, headers: { "Retry-After": "30" } }));
  const response = await worker.fetch(request("/api/albums/token"), environment(() => {
    assetsCalled = true;
    return new Response("SPA");
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), error);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(calls.length, 1);
  assert.equal(assetsCalled, false);
});

test("Cloudflare refuses missing, malformed, credentialed or insecure API configuration", async (t) => {
  const calls = intercept(t, () => { throw Error("insecure origin must not be called"); });
  for (const target of [undefined, "", "not-a-url", "http://insecure.example", "ftp://localhost", "https://user:password@example.com"]) {
    const response = await worker.fetch(request("/api/auth/me", { headers: { Cookie: "session=fixture" } }), {
      ...environment(), API_ORIGIN: target,
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(typeof (await response.json()).message, "string");
  }
  assert.equal(calls.length, 0);
});
