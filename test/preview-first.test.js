// Preview first, original later: the kiosk sends only its 1600 px preview so the album shows the photo
// within seconds, then the 15 MB camera original goes straight to storage (or through the server).
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { resetDirectUploads, saveOriginal, savePreview } from "../src/kiosk/direct-upload.js";
import { cleanJpegMetadata } from "../../photobooth-be/src/services/jpeg-metadata.js";
import { priority, uplinkBusy, whenUplinkIdle } from "../src/kiosk/uplink.js";

const sharp = createRequire(new URL("../../photobooth-be/package.json", import.meta.url))("sharp");
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
beforeEach(() => resetDirectUploads());

const camera = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#884455" } })
  .withMetadata({ orientation: 6, exif: { IFD0: { Make: "FUJIFILM", Artist: "private" } } }).jpeg().toBuffer();
const cleaned = cleanJpegMetadata(camera, 6);
const preview = new Blob([await sharp(camera).rotate().jpeg().toBuffer()], { type: "image/jpeg" });
const row = { id: "camera-0123456789", token: "album-token", image: new Blob([camera], { type: "image/jpeg" }), preview, mirrored: true };
const STORAGE = "https://test-media.account.r2.cloudflarestorage.com/media/x.jpg?X-Amz-Signature=1";

function network(answers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url);
    const kind = text.includes(".r2.cloudflarestorage.com") ? "storage"
      : text.endsWith("/photos/original-url") ? "ticket"
      : text.endsWith("/photos/original") ? "attach" : "preview";
    const call = { kind, url: text, init };
    calls.push(call);
    return answers[kind](call);
  };
  return calls;
}
const json = (body, status = 200) => () => Response.json(body, { status });
const bytes = async (body) => Buffer.from(await body.arrayBuffer());
const header = (call, name) => new Headers(call.init.headers).get(name);

test("the preview alone goes first, marked so the server keeps a place for the original", async () => {
  const calls = network({ preview: json({ photos: [{ id: "p1", originalPending: true }] }) });
  const saved = await savePreview("/kiosk/photo", row, { captureToken: "capture-token" });
  assert.deepEqual(saved.photos[0], { id: "p1", originalPending: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(await bytes(calls[0].init.body), await bytes(preview), "only the ~0.3 MB preview, never the 15 MB file");
  assert.equal(header(calls[0], "X-Photo-Original"), "later");
  assert.equal(header(calls[0], "X-Photo-Key"), row.id);
  assert.equal(header(calls[0], "X-Photo-Mirrored"), "1");
  assert.equal(header(calls[0], "X-Capture-Token"), "capture-token");
});

test("the original then goes straight to storage, cleaned of private metadata, and is attached by its token", async () => {
  const calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
    storage: () => new Response(null, { status: 200 }),
    attach: json({ attached: true }),
  });
  assert.deepEqual(await saveOriginal(row.token, row), { attached: true });
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "storage", "attach"]);
  assert.match(calls[0].url, /\/api\/albums\/album-token\/photos\/original-url$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { clientKey: row.id, size: cleaned.length });
  assert.deepEqual(await bytes(calls[1].init.body), cleaned, "the camera bytes without private EXIF");
  assert.deepEqual(JSON.parse(calls[2].init.body), { clientKey: row.id, stored: "stored-token" });
});

test("without direct storage (or when storage refuses) the original goes through the server; a retry already saved stops", async () => {
  let calls = network({ ticket: json({ message: "Kho ảnh chưa hỗ trợ tải thẳng." }, 404), attach: json({ attached: true }) });
  await saveOriginal(row.token, row);
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "attach"]);
  assert.deepEqual(await bytes(calls[1].init.body), cleaned);
  assert.equal(header(calls[1], "X-Photo-Key"), row.id);
  calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
    storage: () => new Response(null, { status: 200 }),
    attach: (call) => typeof call.init.body === "string"
      ? Response.json({ message: "Ảnh gốc tải thẳng lên kho không khớp." }, { status: 422 })
      : Response.json({ attached: true }),
  });
  await saveOriginal(row.token, row);
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "storage", "attach", "attach"], "a refused stored file is sent again through the server");
  calls = network({ ticket: json({ saved: true }) });
  assert.deepEqual(await saveOriginal(row.token, row), { saved: true });
  assert.equal(calls.length, 1);
  network({ ticket: json({ message: "Ảnh không còn trong album." }, 410) });
  await assert.rejects(saveOriginal(row.token, row), (error) => error.status === 410);
});

test("a lost original commit reply never uploads the camera file to storage a second time", async () => {
  let commits = 0;
  const calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-original-token" } }),
    storage: () => new Response(null, { status: 200 }),
    attach: () => Response.json(++commits < 3 ? { message: "Reply lost" } : { attached: true }, { status: commits < 3 ? 503 : 200 }),
  });
  await assert.rejects(saveOriginal(row.token, row), (error) => error.status === 503);
  await saveOriginal(row.token, row);
  assert.equal(calls.filter((call) => call.kind === "storage").length, 1);
  assert.equal(calls.filter((call) => call.kind === "ticket").length, 1);
  assert.equal(calls.filter((call) => call.kind === "attach").length, 3);
});

test("originals wait while the guest's foreground uploads (preview, print, composite) are sending", async () => {
  let release;
  const sending = priority(() => new Promise((resolve) => { release = resolve; }));
  assert.equal(uplinkBusy(), true);
  let idle = false;
  const waiting = whenUplinkIdle().then(() => { idle = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(idle, false, "an original does not start while a print is sending");
  release();
  await sending;
  await waiting;
  assert.equal(idle, true);
  assert.equal(uplinkBusy(), false);
});
