import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { saveOriginal, savePhoto, saveVideo, resetDirectUploads } from "../src/kiosk/direct-upload.js";
import { priority } from "../src/kiosk/uplink.js";
import { cleanJpegMetadata } from "../../photobooth-be/src/services/jpeg-metadata.js";

const sharp = createRequire(new URL("../../photobooth-be/package.json", import.meta.url))("sharp");
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
beforeEach(() => resetDirectUploads());

const camera = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#884455" } })
  .withMetadata({ orientation: 6, exif: { IFD0: { Make: "FUJIFILM", Artist: "private" } } }).jpeg().toBuffer();
const cleaned = cleanJpegMetadata(camera, 6);
const preview = new Blob([await sharp(camera).rotate().jpeg().toBuffer()], { type: "image/jpeg" });
const image = new Blob([camera], { type: "image/jpeg" });
const STORAGE = "https://test-media.account.r2.cloudflarestorage.com/media/x.jpg?X-Amz-Signature=1";
const options = { captureToken: "capture-token", clientKey: "camera-0123456789", mirrored: true, preview };

// A scripted network: each request is matched by kind and answered by the test.
function network(answers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const kind = String(url).includes(".r2.cloudflarestorage.com") ? "storage"
      : /\/(upload-url|original-url)$/.test(String(url)) ? "ticket" : "commit";
    const call = { kind, url: String(url), init };
    calls.push(call);
    return answers[kind](call);
  };
  return calls;
}
const json = (body, status = 200) => () => Response.json(body, { status });
const bytes = async (body) => Buffer.from(await body.arrayBuffer());
const until = async (check) => {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("expected upload did not start");
};

test("the camera original goes straight to storage and the server only gets the preview", async () => {
  const calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
    storage: () => new Response(null, { status: 200 }),
    commit: json({ photos: [{ id: "p1" }] }),
  });
  assert.deepEqual(await savePhoto("/kiosk/photo", image, options), { photos: [{ id: "p1" }] });
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "storage", "commit"]);
  assert.deepEqual(JSON.parse(calls[0].init.body),
    { clientKey: options.clientKey, size: cleaned.length, captureToken: "capture-token" });
  assert.match(calls[0].url, /\/api\/kiosk\/photo\/upload-url$/);
  const put = calls[1].init;
  assert.equal(put.method, "PUT");
  assert.equal(put.credentials, "omit");
  assert.equal(put.headers["Content-Type"], "image/jpeg");
  assert.deepEqual(await bytes(put.body), cleaned, "private metadata removed, pixels untouched");
  const commit = calls[2].init;
  assert.deepEqual(await bytes(commit.body), await bytes(preview), "only the preview reaches the server");
  assert.equal(commit.headers["X-Photo-Stored"], "stored-token");
  assert.equal(commit.headers["X-Photo-Key"], options.clientKey);
  assert.equal(commit.headers["X-Capture-Token"], "capture-token");
  assert.equal(commit.headers["X-Photo-Mirrored"], "1");
  assert.equal(commit.headers["X-Photo-Preview-Length"], undefined);
});

test("storage that refuses uploads sends photos through the server for a while", async () => {
  const calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
    storage: () => { throw new TypeError("Failed to fetch"); }, // e.g. CORS without PUT
    commit: json({ photos: [] }),
  });
  await savePhoto("/kiosk/photo", image, options);
  await savePhoto("/kiosk/photo", image, { ...options, clientKey: "camera-second-photo" });
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "storage", "commit", "commit"],
    "after one failure the next photo skips the storage attempt");
  for (const call of calls.filter((c) => c.kind === "commit")) {
    assert.equal(call.init.headers["X-Photo-Stored"], undefined);
    assert.equal(call.init.headers["X-Photo-Preview-Length"], String(preview.size));
    assert.deepEqual((await bytes(call.init.body)).subarray(0, camera.length), camera, "the usual full upload");
  }
});

test("a stalled browser PUT falls back once with the intact original and releases the next capture", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previous = globalThis.XMLHttpRequest;
  let uploading, aborts = 0;
  globalThis.XMLHttpRequest = class {
    constructor() { this.upload = {}; uploading = this; }
    open() {} setRequestHeader() {} send(body) { this.body = body; }
    abort() { aborts++; this.onabort?.(); }
  };
  try {
    const calls = network({
      ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
      commit: json({ photos: [] }),
    });
    const saving = savePhoto("/kiosk/photo", image, options);
    while (!uploading) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await bytes(uploading.body), cleaned);
    t.mock.timers.tick(30000);
    await saving;
    assert.equal(aborts, 1);
    assert.deepEqual(calls.map(call => call.kind), ["ticket", "commit"]);
    assert.deepEqual((await bytes(calls[1].init.body)).subarray(0, camera.length), camera);
    assert.equal(calls[1].init.headers["X-Photo-Stored"], undefined);
    await savePhoto("/kiosk/photo", image, { ...options, clientKey: "camera-after-stall" });
    assert.deepEqual(calls.map(call => call.kind), ["ticket", "commit", "commit"],
      "following captures use the existing fallback instead of waiting on storage again");
  } finally {
    if (previous === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = previous;
  }
});

test("an unusable stored upload, an older server and a half-written file all fall back", async () => {
  let calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
    storage: () => new Response(null, { status: 200 }),
    commit: (call) => call.init.headers["X-Photo-Stored"]
      ? Response.json({ message: "không dùng được" }, { status: 422 }) : Response.json({ photos: [] }),
  });
  await savePhoto("/kiosk/photo", image, options);
  assert.deepEqual(calls.map((c) => [c.kind, Boolean(c.init.headers?.["X-Photo-Stored"])]),
    [["ticket", false], ["storage", false], ["commit", true], ["commit", false]]);
  calls = network({ ticket: json({ message: "API không tồn tại." }, 404), commit: json({ photos: [] }) });
  await savePhoto("/albums/token/photos", image, { clientKey: "camera-older-server", preview });
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "commit"]);
  assert.match(calls[0].url, /\/api\/albums\/token\/photos\/upload-url$/);
  calls = network({ commit: json({ photos: [] }) });
  await savePhoto("/kiosk/photo", new Blob([camera.subarray(0, camera.length - 50)]), options);
  assert.deepEqual(calls.map((c) => c.kind), ["commit"], "the server judges an incomplete file as before");
});

test("a lost commit reply is retried without uploading 15 MB again; saved photos come back at once", async () => {
  let reachable = false;
  const calls = network({
    ticket: json({ upload: { url: STORAGE, stored: "stored-token" } }),
    storage: () => new Response(null, { status: 200 }),
    commit: () => { if (!reachable) throw new TypeError("Failed to fetch"); return Response.json({ photos: [1] }); },
  });
  await assert.rejects(savePhoto("/kiosk/photo", image, options));
  reachable = true;
  assert.deepEqual(await savePhoto("/kiosk/photo", image, options), { photos: [1] });
  const kinds = calls.map((c) => c.kind);
  assert.equal(kinds.filter((k) => k === "storage").length, 1, "uploaded once");
  assert.equal(kinds.filter((k) => k === "ticket").length, 1);
  assert.ok(calls.filter((c) => c.kind === "commit").every((c) => c.init.headers["X-Photo-Stored"] === "stored-token"));
  const already = { photos: [{ id: "p9", clientKey: "camera-already-saved" }] };
  const saved = network({ ticket: json({ saved: true, booking: already }) });
  assert.deepEqual(await savePhoto("/kiosk/photo", image, { ...options, clientKey: "camera-already-saved" }), already);
  assert.deepEqual(saved.map((c) => c.kind), ["ticket"]);
  // An answer that does not show this photo saved (or names another host) is never trusted.
  for (const ticket of [{ saved: true, booking: { photos: [] } }, { booking: already },
    { upload: { url: "https://example.com/upload", stored: "t" } }]) {
    const odd = network({ ticket: json(ticket), commit: json({ photos: [] }) });
    await savePhoto("/kiosk/photo", image, { ...options, clientKey: "camera-already-saved" });
    assert.deepEqual(odd.map((c) => c.kind), ["ticket", "commit"]);
    assert.equal(odd[1].init.headers["X-Photo-Stored"], undefined);
  }
});

// Video tua nhanh: thẳng lên kho R2, máy chủ chỉ gắn vào album; không được thì gửi qua máy chủ.
const video = new Blob([Buffer.alloc(4096, 3)], { type: "video/mp4" });
const VIDEO_STORAGE = "https://test-media.account.r2.cloudflarestorage.com/media/v.mp4?X-Amz-Signature=1";
const isServerVideo = (call) => /\/api\/kiosk\/video$/.test(call.url);

test("the timelapse video goes straight to storage and the server only attaches it", async () => {
  const calls = network({
    ticket: json({ upload: { url: VIDEO_STORAGE, stored: "video-token" } }),
    storage: () => new Response(null, { status: 200 }),
    commit: json({ ok: true, size: video.size }, 201),
  });
  assert.deepEqual(await saveVideo(video, "capture-token"), { ok: true, size: video.size });
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "storage", "commit"]);
  assert.match(calls[0].url, /\/api\/kiosk\/video\/upload-url$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { captureToken: "capture-token", type: "video/mp4", size: video.size });
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.headers["Content-Type"], "video/mp4", "the signed upload expects the video type");
  assert.equal(calls[1].init.body, video);
  assert.match(calls[2].url, /\/api\/kiosk\/video\/commit$/);
  assert.deepEqual(JSON.parse(calls[2].init.body), { captureToken: "capture-token", stored: "video-token" });
});

test("a commit without an answer is retried later without uploading the video again", async () => {
  let commits = 0;
  const calls = network({
    ticket: json({ upload: { url: VIDEO_STORAGE, stored: "video-token" } }),
    storage: () => new Response(null, { status: 200 }),
    commit: () => (++commits === 1 ? Response.json({ message: "lỗi" }, { status: 400 }) : Response.json({ ok: true }, { status: 201 })),
  });
  await assert.rejects(saveVideo(video, "capture-token"));
  assert.deepEqual(await saveVideo(video, "capture-token"), { ok: true });
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "storage", "commit", "commit"]);
});

test("videos go through the server with MongoDB storage, a refused upload or an unusable stored file", async () => {
  // Kho MongoDB: không có URL tải thẳng (404).
  let calls = network({
    ticket: json({ message: "Kho ảnh chưa hỗ trợ tải thẳng." }, 404),
    storage: () => { throw new Error("not used"); },
    commit: json({ ok: true }, 201),
  });
  await saveVideo(video, "capture-token");
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "commit"]);
  assert.ok(isServerVideo(calls[1]));
  assert.equal(calls[1].init.headers["X-Capture-Token"], "capture-token");
  assert.equal(calls[1].init.headers["Content-Type"], "video/mp4");
  assert.equal(calls[1].init.body, video);
  // Tệp trên kho không dùng được (422): gửi lại qua máy chủ.
  calls = network({
    ticket: json({ upload: { url: VIDEO_STORAGE, stored: "video-token" } }),
    storage: () => new Response(null, { status: 200 }),
    commit: (call) => (isServerVideo(call) ? Response.json({ ok: true }, { status: 201 })
      : Response.json({ message: "Video chưa tải lên kho xong." }, { status: 422 })),
  });
  await saveVideo(new Blob([Buffer.alloc(10)], { type: "video/mp4" }), "capture-token");
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "storage", "commit", "commit"]);
  assert.ok(isServerVideo(calls[3]));
  // Kho từ chối tải lên (vd. CORS chưa cho trang này): qua máy chủ, và một lúc sau không thử kho nữa.
  calls = network({
    ticket: json({ upload: { url: VIDEO_STORAGE, stored: "video-token" } }),
    storage: () => { throw new TypeError("Failed to fetch"); },
    commit: json({ ok: true }, 201),
  });
  await saveVideo(new Blob([Buffer.alloc(20)], { type: "video/mp4" }), "capture-token");
  await saveVideo(new Blob([Buffer.alloc(30)], { type: "video/mp4" }), "capture-token");
  assert.deepEqual(calls.map((c) => c.kind), ["ticket", "storage", "commit", "commit"]);
  assert.ok(calls.slice(2).every(isServerVideo));
});

test("a photo storage failure does not force the next video through the server", async () => {
  const calls = network({
    ticket: (call) => Response.json({ upload: {
      url: call.url.includes("/video/") ? VIDEO_STORAGE : STORAGE, stored: "upload-token",
    } }),
    storage: (call) => call.init.body.type.startsWith("video/")
      ? new Response(null, { status: 200 }) : new Response(null, { status: 503 }),
    commit: json({ ok: true }),
  });
  await savePhoto("/kiosk/photo", image, options);
  const firstVideoCall = calls.length;
  await saveVideo(video, "capture-token");
  assert.deepEqual(calls.slice(firstVideoCall).map((call) => call.kind), ["ticket", "storage", "commit"]);
  assert.equal(calls[firstVideoCall + 1].init.body, video);
  assert.equal(calls.some(isServerVideo), false, "the full video never goes through the backend");
});

test("a video storage failure does not disable direct uploads of camera originals", async () => {
  const calls = network({
    ticket: (call) => Response.json({ upload: {
      url: call.url.includes("/video/") ? VIDEO_STORAGE : STORAGE, stored: "upload-token",
    } }),
    storage: (call) => new Response(null, { status: call.init.body.type.startsWith("video/") ? 503 : 200 }),
    commit: json({ ok: true }),
  });
  await saveVideo(video, "capture-token");
  const firstPhotoCall = calls.length;
  await saveOriginal("album-token", { id: options.clientKey, image });
  assert.deepEqual(calls.slice(firstPhotoCall).map((call) => call.kind), ["ticket", "storage", "commit"]);
  assert.deepEqual(await bytes(calls[firstPhotoCall + 1].init.body), cleaned);
});

test("photos and video share two upload slots, yield to previews and give a ready video its FIFO turn", async () => {
  const acknowledgements = new Map(), started = [];
  let releaseForeground, releaseAll = false, active = 0, highest = 0;
  const foreground = priority(() => new Promise((resolve) => { releaseForeground = resolve; }));
  const calls = network({
    ticket: (call) => {
      const body = JSON.parse(call.init.body), id = body.clientKey || "video";
      return Response.json({ upload: { url: `${STORAGE}&id=${id}`, stored: `stored-${id}` } });
    },
    storage: async (call) => {
      const id = new URL(call.url).searchParams.get("id");
      started.push(id);
      active++; highest = Math.max(highest, active);
      try {
        if (!releaseAll) await new Promise((resolve) => { acknowledgements.set(id, resolve); });
        return new Response(null, { status: 200 });
      } finally { active--; }
    },
    commit: json({ ok: true }),
  });
  const jobs = [
    saveOriginal("album", { id: "first", image }),
    saveOriginal("album", { id: "second", image }),
  ];
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 0, "foreground previews go before all large uploads");
    releaseForeground(); await foreground;
    await until(() => started.length === 2);
    assert.deepEqual([...started].sort(), ["first", "second"]);
    jobs.push(saveVideo(video, "capture-token"));
    await until(() => calls.some((call) => call.kind === "ticket" && call.url.includes("/video/")));
    await new Promise((resolve) => setImmediate(resolve));
    jobs.push(saveOriginal("album", { id: "third", image }));
    acknowledgements.get("first")();
    await until(() => started.length === 3);
    assert.equal(started[2], "video");
    acknowledgements.get("second")();
    await until(() => started.length === 4);
    assert.equal(started[3], "third");
    assert.equal(highest, 2);
  } finally {
    releaseAll = true;
    releaseForeground();
    for (const release of acknowledgements.values()) release();
    await foreground;
    await Promise.allSettled(jobs);
  }
});

test("a video can upload while two originals wait for their small commit replies", async () => {
  const acknowledgements = [];
  let videoStarted = false, photosFinished = 0;
  network({
    ticket: (call) => Response.json({ upload: {
      url: call.url.includes("/video/") ? VIDEO_STORAGE : STORAGE, stored: "upload-token",
    } }),
    storage: (call) => {
      if (call.init.body.type.startsWith("video/")) videoStarted = true;
      return new Response(null, { status: 200 });
    },
    commit: (call) => call.url.includes("/video/") ? Response.json({ ok: true })
      : new Promise((resolve) => { acknowledgements.push(() => resolve(Response.json({ attached: true }))); }),
  });
  const jobs = ["first", "second"].map((id) => saveOriginal("album", { id, image }).then(() => { photosFinished++; }));
  try {
    await until(() => acknowledgements.length === 2);
    jobs.push(saveVideo(video, "capture-token"));
    await until(() => videoStarted);
    assert.equal(photosFinished, 0, "large-transfer slots are free before either original commit returns");
  } finally {
    for (const acknowledge of acknowledgements) acknowledge();
    await Promise.allSettled(jobs);
  }
});
