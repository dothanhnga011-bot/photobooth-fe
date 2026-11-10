import assert from "node:assert/strict";
import { test } from "node:test";
import { flushOriginalPhotos } from "../src/kiosk/network-tasks.js";

const startedAt = 1_800_000_000_000;
const original = (id, token = "guest") => ({
  id, token, stage: "original", originalAt: startedAt,
  image: new Blob([`camera original ${id}`], { type: "image/jpeg" }),
});
function outbox(initial, overrides = {}) {
  let rows = initial;
  const sent = [], removed = [];
  const options = {
    isActive: () => true,
    now: () => startedAt,
    readPending: async () => rows,
    upload: async (row) => { sent.push(row.id); },
    removePending: async (id) => { removed.push(id); rows = rows.filter((row) => row.id !== id); },
    savePending: async (row) => { rows = rows.map((saved) => saved.id === row.id ? row : saved); },
    ...overrides,
  };
  return { options, sent, removed, rows: () => rows };
}

test("a rejected original cannot block later photos or another guest, and failed camera bytes stay saved", async () => {
  const bad = original("rejected", "old-guest");
  const queue = outbox([bad, original("next"), original("other", "new-guest"), { id: "preview", stage: "preview" }]);
  queue.options.upload = async (row) => {
    queue.sent.push(row.id);
    if (row.id === bad.id) throw Object.assign(new Error("Invalid image"), { status: 400 });
  };
  assert.equal(await flushOriginalPhotos(queue.options), true);
  assert.deepEqual(queue.sent, ["rejected", "next", "other"]);
  assert.deepEqual(queue.removed, ["next", "other"]);
  assert.deepEqual(queue.rows().map((row) => row.id), ["rejected", "preview"]);
  const kept = queue.rows()[0];
  assert.equal(kept.image, bad.image);
  assert.equal(kept.token, bad.token);
  assert.equal(kept.originalAt, startedAt);
  assert.equal(kept.originalRetryAt, startedAt + 20000);
  assert.equal(kept.originalFailures, 1);
  await flushOriginalPhotos(queue.options);
  assert.deepEqual(queue.sent, ["rejected", "next", "other"], "a second wake does not immediately retry the bad file");
});

test("a missing album keeps its original age, retries later and expires instead of blocking forever", async () => {
  let clock = startedAt;
  const queue = outbox([original("missing"), original("valid")], { now: () => clock });
  queue.options.upload = async (row) => {
    queue.sent.push(row.id);
    if (row.id === "missing") throw Object.assign(new Error("Not found"), { status: 404 });
  };
  await flushOriginalPhotos(queue.options);
  assert.equal(queue.rows()[0].originalAt, startedAt);
  assert.deepEqual(queue.sent, ["missing", "valid"]);
  clock += 20000;
  await flushOriginalPhotos(queue.options);
  assert.equal(queue.rows()[0].originalAt, startedAt);
  assert.equal(queue.rows()[0].originalRetryAt, clock + 40000);
  clock = startedAt + 86400001;
  await flushOriginalPhotos(queue.options);
  assert.equal(queue.rows().length, 0);
  assert.deepEqual(queue.removed, ["valid", "missing"]);
});

test("a connection outage retains all bytes; the next wake can send other ready originals", async () => {
  const queue = outbox([original("offline"), original("ready")]);
  queue.options.upload = async (row) => {
    queue.sent.push(row.id);
    throw Object.assign(new Error("Connection lost"), { code: "NETWORK" });
  };
  assert.equal(await flushOriginalPhotos(queue.options), true);
  assert.deepEqual(queue.sent, ["offline"]);
  assert.deepEqual(queue.removed, []);
  queue.options.upload = async (row) => { queue.sent.push(row.id); };
  await flushOriginalPhotos(queue.options);
  assert.deepEqual(queue.sent, ["offline", "ready"]);
  assert.equal(queue.rows()[0].id, "offline");
});

test("original upload yields to foreground work and deletes only after a running request acknowledges", async () => {
  let active = true, acknowledge;
  const queue = outbox([original("first"), original("second")], { isActive: () => active });
  queue.options.beforeNext = async () => { active = false; };
  await flushOriginalPhotos(queue.options);
  assert.deepEqual(queue.sent, []);
  active = true;
  queue.options.beforeNext = async () => {};
  queue.options.upload = (row) => { queue.sent.push(row.id); return new Promise((resolve) => { acknowledge = resolve; }); };
  const work = flushOriginalPhotos(queue.options);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(queue.sent, ["first"]);
  assert.deepEqual(queue.removed, []);
  active = false;
  acknowledge();
  await work;
  assert.deepEqual(queue.removed, ["first"]);
  assert.equal(queue.rows()[0].id, "second");
});

test("gone photos are removed while server errors retain the original even after a day and respect Retry-After", async () => {
  const clock = startedAt + 86400001;
  const queue = outbox([original("gone"), original("server-busy")], { now: () => clock });
  queue.options.upload = async (row) => {
    throw Object.assign(new Error("Unavailable"), { status: row.id === "gone" ? 410 : 503, retryAfterMs: 90000 });
  };
  await flushOriginalPhotos(queue.options);
  assert.deepEqual(queue.removed, ["gone"]);
  assert.equal(queue.rows()[0].id, "server-busy");
  assert.equal(queue.rows()[0].originalRetryAt, clock + 90000);
});
