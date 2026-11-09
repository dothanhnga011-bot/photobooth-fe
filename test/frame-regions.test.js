import assert from "node:assert/strict";
import { test } from "node:test";
import { drawMarks, frameCapacity, frameOutputSize, photoLayout, printDate } from "../src/frame-utils.js";

const region = (x, y, extra = {}) => ({ x, y, w: 0.4, h: 0.2, ...extra });

test("legacy frames without region numbers keep one photo per slot", () => {
  const frame = { slots: [region(0, 0), region(0.5, 0), region(0, 0.5)] };
  const layout = photoLayout(frame);
  assert.equal(layout.slots.length, 3);
  assert.deepEqual(layout.copies, []);
  assert.deepEqual(layout.marks, []);
  assert.equal(frameCapacity(frame), 3);
});

test("a small frame copied to the second strip prints each photo twice", () => {
  // Dải trái: ảnh 1, 2, 3; dải phải là bản sao cùng số (sao chép vùng ảnh 1 → vẫn là ảnh 1).
  const left = [1, 2, 3].map((n) => region(0.05, 0.05 + (n - 1) * 0.3, { kind: "photo", photo: n }));
  const right = left.map((r) => ({ ...r, x: 0.55 }));
  const frame = { printSize: "strip", sheet: true, slots: [...left, ...right] };
  const layout = photoLayout(frame);
  assert.equal(frameCapacity(frame), 3);
  assert.deepEqual(layout.slots, left);
  assert.deepEqual(layout.copies.map((c) => [c.of, c.slot.x]), [[0, 0.55], [1, 0.55], [2, 0.55]]);
  assert.equal(photoLayout(layout), layout, "đã tính rồi thì giữ nguyên");
});

test("photo numbers order the leaders and QR / date regions become marks", () => {
  const frame = {
    slots: [
      region(0, 0.5, { kind: "photo", photo: 2 }),
      { x: 0.1, y: 0.9, w: 0.1, h: 0.06, kind: "qr" },
      region(0, 0, { kind: "photo", photo: 1 }),
      { x: 0.3, y: 0.9, w: 0.3, h: 0.04, kind: "date" },
      region(0.5, 0, { kind: "photo", photo: 1 }),
    ],
  };
  const layout = photoLayout(frame);
  assert.deepEqual(layout.slots.map((s) => s.y), [0, 0.5]);
  assert.deepEqual(layout.copies.map((c) => c.of), [0]);
  assert.deepEqual(layout.marks.map((m) => m.kind), ["qr", "date"]);
  assert.equal(frameCapacity(frame), 2);
});

test("full-sheet small frames print at full sheet size, legacy strips stay strips", () => {
  const sheet = frameOutputSize({ printSize: "strip", sheet: true }, { naturalWidth: 1200, naturalHeight: 1800 });
  const full = frameOutputSize({ printSize: "full" }, { naturalWidth: 1200, naturalHeight: 1800 });
  // Khung dải cũ: ảnh khung chỉ là một dải (rộng bằng nửa tờ).
  const strip = frameOutputSize({ printSize: "strip" }, { naturalWidth: 600, naturalHeight: 1800 });
  assert.deepEqual(sheet, full);
  assert.equal(strip.height, sheet.height);
  assert.ok(Math.abs(strip.width * 2 - sheet.width) <= 1, `${strip.width} × 2 ≈ ${sheet.width}`);
});

test("print date uses Vietnam time and dots", () => {
  assert.equal(printDate(new Date("2026-10-22T18:30:00Z")), "23.10.2026");
});

test("marks draw a white QR square and the date in the frame colour", () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]),
    set: (target, key, value) => { target[key] = value; calls.push(["set", key, value]); return true; },
  });
  ctx.measureText = (text) => ({ width: text.length * 10 });
  const qr = { qr: true };
  drawMarks(ctx, {
    dateColor: "#ff0000",
    marks: [{ x: 0, y: 0, w: 0.2, h: 0.1, kind: "qr" }, { x: 0.5, y: 0.9, w: 0.4, h: 0.05, kind: "date" }],
  }, qr, 1000, 1500);
  assert.ok(calls.some(([k, ...a]) => k === "drawImage" && a[0] === qr), "QR được vẽ");
  assert.ok(calls.some(([k, key, value]) => k === "set" && key === "fillStyle" && value === "#ff0000"), "màu chữ ngày in");
  assert.ok(calls.some(([k, text]) => k === "fillText" && /^\d\d\.\d\d\.\d{4}$/.test(text)), "ngày dạng dd.MM.yyyy");
});
