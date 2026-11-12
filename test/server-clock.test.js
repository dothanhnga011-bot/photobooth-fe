import assert from "node:assert/strict";
import { test } from "node:test";
import { clockOffset, noteServerTime, serverNow, toLocalTime } from "../src/kiosk/server-clock.js";
import { watchCameraFolder } from "../src/kiosk/watch-camera-folder.js";

const reset = () => { const now = Date.now(); noteServerTime(now, now, now); };

test("the kiosk measures how far its clock is from the server and converts session times", () => {
  try {
    const sent = Date.now();
    // Máy chủ chạy trước máy chụp 3 phút; yêu cầu mất 200 ms (điểm giữa: sent + 100).
    noteServerTime(sent + 100 + 180000, sent, sent + 200);
    assert.equal(clockOffset(), 180000);
    assert.ok(Math.abs(serverNow() - Date.now() - 180000) < 50);
    assert.equal(toLocalTime(new Date(sent + 180000).toISOString()), sent);
    // Trả lời quá chậm (sai số lớn) hoặc thiếu serverTime (máy chủ cũ): giữ độ lệch đã đo.
    noteServerTime(sent, sent, sent + 10000);
    noteServerTime(undefined, sent, sent + 10);
    assert.equal(clockOffset(), 180000);
  } finally { reset(); }
});

test("a kiosk clock running 3 minutes fast still keeps the photos of the session's last minutes", async () => {
  const now = Date.now();
  // Máy chủ chậm hơn máy chụp 3 phút. Phiên (giờ máy chủ) còn 1 phút; ảnh vừa chụp (giờ máy này) là "bây giờ".
  noteServerTime(now - 180000, now, now);
  const file = { size: 100, lastModified: now };
  const folder = { name: "fixture", async *entries() { yield ["last.jpg", { kind: "file", getFile: async () => file }]; } };
  let imported, timeout;
  const done = new Promise((resolve) => { imported = resolve; });
  const stop = watchCameraFolder({ folder,
    booking: { captureStartedAt: new Date(now - 180000 - 500), captureEndsAt: new Date(now - 180000 + 60000) },
    onPhoto: async () => { imported(); return true; }, notifyOnce: () => {}, onScanSuccess: () => {}, onScan: () => {},
  });
  try {
    await Promise.race([done, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("the last photo was dropped")), 4000); })]);
  } finally { stop(); clearTimeout(timeout); reset(); }
});
