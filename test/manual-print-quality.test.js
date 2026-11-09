import test from "node:test";
import assert from "node:assert/strict";
import { packPrintSheets } from "../src/frame-utils.js";

globalThis.indexedDB ??= { open: () => ({}) };
const { printSource } = await import("../src/kiosk/compose.js");

test("high-resolution sheets retain their pixels, orientation and both strip positions", () => {
  const previous = globalThis.document;
  const calls = [];
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, {
    get: (_, name) => (...args) => calls.push([name, ...args]),
  }) }) };
  try {
    const [portrait, landscape] = packPrintSheets([
      { canvas: { width: 2400, height: 3600 }, printSize: "full" },
      { canvas: { width: 3600, height: 2400 }, printSize: "full" },
    ], 2);
    assert.deepEqual([portrait.canvas.width, portrait.canvas.height], [2400, 3600]);
    assert.deepEqual([landscape.canvas.width, landscape.canvas.height], [3600, 2400]);
    calls.length = 0;
    const [strip] = packPrintSheets([{ canvas: { width: 1200, height: 3600 }, printSize: "strip" }], 2);
    assert.equal(strip.frames, 2);
    assert.deepEqual([strip.canvas.width, strip.canvas.height], [2400, 3600]);
    assert.deepEqual(calls.filter(c => c[0] === "translate"), [["translate", 600, 1800], ["translate", 1800, 1800]]);
    assert.equal(calls.filter(c => c[0] === "drawImage").length, 2);
    const [legacy] = packPrintSheets([{ canvas: { width: 1200, height: 1800 }, printSize: "full" }]);
    assert.deepEqual([legacy.canvas.width, legacy.canvas.height], [1200, 1800]);
  } finally { globalThis.document = previous; }
});

test("strict printing rejects pending originals and preview-only photos before downloading previews", async () => {
  await assert.rejects(printSource({ originalPending: true, serverId: "pending" }, "token", { strict: true }), /Ảnh gốc đang tải lên/);
  await assert.rejects(printSource({ preview: "thumbnail.jpg" }, "token", { strict: true }), /Thiếu ảnh gốc/);
});
