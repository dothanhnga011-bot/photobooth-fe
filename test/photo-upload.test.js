import assert from "node:assert/strict";
import { test } from "node:test";
import { api } from "../src/api.js";
import { photoUpload } from "../src/photo-upload.js";

test("phone files and kiosk JPEG blobs reach fetch byte for byte, without base64", async () => {
  const oldFetch = globalThis.fetch;
  const bytes = Uint8Array.from({ length: 4096 }, (_, i) => i % 251);
  const image = new Blob([bytes], { type: "image/jpeg" });
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, ...options };
    return Response.json({ photos: [{ id: "saved" }] });
  };
  try {
    await api("/albums/fixture/photos", photoUpload(image, {
      clientKey: "fixture-photo-01", name: "Ảnh số 1.jpg", captureToken: "fixture-capture",
      mirrored: true,
    }));
    assert.equal(sent.body, image);
    assert.deepEqual(new Uint8Array(await sent.body.arrayBuffer()), bytes);
    assert.equal(sent.headers["Content-Type"], "image/jpeg");
    assert.equal(decodeURIComponent(sent.headers["X-Photo-Name"]), "Ảnh số 1.jpg");
    assert.equal(sent.headers["X-Photo-Key"], "fixture-photo-01");
    assert.equal(sent.headers["X-Capture-Token"], "fixture-capture");
    assert.equal(sent.headers["X-Photo-Mirrored"], "1");
  } finally { globalThis.fetch = oldFetch; }
});

test("old offline data URLs keep their JSON transport and idempotency key", async () => {
  const oldFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => { sent = options; return Response.json({ photos: [] }); };
  try {
    await api("/albums/fixture/photos", photoUpload("data:image/jpeg;base64,/9j/2Q==", { clientKey: "old-offline-key" }));
    assert.equal(sent.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(sent.body), { image: "data:image/jpeg;base64,/9j/2Q==", clientKey: "old-offline-key" });
    assert.equal(sent.headers["X-Photo-Mirrored"], undefined);
  } finally { globalThis.fetch = oldFetch; }
});

test("a booth sends its own preview after the camera bytes in the same request", async () => {
  const oldFetch = globalThis.fetch;
  const camera = new Blob([Uint8Array.from({ length: 5000 }, (_, i) => i % 199)], { type: "image/jpeg" });
  const preview = new Blob([Uint8Array.from({ length: 700 }, (_, i) => (i * 7) % 256)], { type: "image/jpeg" });
  const sent = [];
  globalThis.fetch = async (url, options) => { sent.push(options); return Response.json({ photos: [] }); };
  try {
    await api("/kiosk/photo", photoUpload(camera, { clientKey: "booth-01", captureToken: "t", mirrored: false, preview }));
    const body = new Uint8Array(await sent[0].body.arrayBuffer());
    assert.equal(sent[0].headers["Content-Type"], "image/jpeg");
    assert.equal(sent[0].headers["X-Photo-Preview-Length"], "700");
    assert.deepEqual(body.subarray(0, 5000), new Uint8Array(await camera.arrayBuffer()), "camera bytes first, untouched");
    assert.deepEqual(body.subarray(5000), new Uint8Array(await preview.arrayBuffer()), "then the preview");
    // Phone files and old offline rows without a preview are sent exactly as before.
    await api("/albums/fixture/photos", photoUpload(camera, { clientKey: "phone-01" }));
    assert.equal(sent[1].body, camera);
    assert.equal(sent[1].headers["X-Photo-Preview-Length"], undefined);
    await api("/albums/fixture/photos", photoUpload(camera, { clientKey: "empty-preview", preview: new Blob([]) }));
    assert.equal(sent[2].body, camera, "an empty preview is not sent");
  } finally { globalThis.fetch = oldFetch; }
});

test("print sheets go as raw bytes in order, with their sizes, key and theme in headers", async () => {
  const { printPackUpload, dataUrlBytes } = await import("../src/album/print-upload.js");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 250, 251]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 0xff, 0xd9]);
  const images = [`data:image/png;base64,${png.toString("base64")}`, `data:image/jpeg;base64,${jpg.toString("base64")}`];
  assert.deepEqual(Buffer.from(dataUrlBytes(images[0])), png);
  const request = printPackUpload({ images, frameName: "Hồng & mơ", requestKey: "8b7f5a9e-1c2d-4e3f-9a0b-1c2d3e4f5a6b" });
  assert.equal(request.method, "POST");
  assert.equal(request.retry, undefined, "never resent behind the guest's back");
  assert.equal(request.body.type, "application/octet-stream");
  assert.deepEqual(Buffer.from(await request.body.arrayBuffer()), Buffer.concat([png, jpg]));
  assert.deepEqual(request.headers, {
    "X-Print-Key": "8b7f5a9e-1c2d-4e3f-9a0b-1c2d3e4f5a6b",
    "X-Print-Frame": encodeURIComponent("Hồng & mơ"),
    "X-Print-Sheets": `${png.length},${jpg.length}`,
  });
  // About a quarter smaller than the same sheets as base64 JSON.
  assert.ok(request.body.size < JSON.stringify({ images }).length * 0.8);
  // Khổ của khung được in (máy DNP cắt đôi "strip", nguyên tờ "full") đi kèm khi có.
  const strip = printPackUpload({ images, frameName: "x", requestKey: "8b7f5a9e-1c2d-4e3f-9a0b-1c2d3e4f5a6b", printSize: "strip" });
  assert.equal(strip.headers["X-Print-Size"], "strip");
});
