import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canApplyKioskPhoto,
  canApplyKioskState,
  createSingleFlight,
  drainPendingPhotos,
  flushPendingPhotos,
  kioskPhotoPath,
  mergeKioskFinish,
} from "../src/kiosk/network-tasks.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const session = (token, photos = []) => ({
  accessToken: token,
  captureToken: `capture-${token}`,
  booking: { photos },
});

test("a delayed finish preserves later photo acknowledgements and attached originals while taking server quotas", () => {
  const current = { status: "checked_in", prints: 1, photos: [
    { id: "one", number: 1, sourcePreserved: true },
    { id: "two", number: 2, originalPending: true },
  ] };
  const finished = { status: "completed", prints: 3, captureEndsAt: "finished-at", photos: [
    { id: "one", number: 1, originalPending: true },
  ] };
  const merged = mergeKioskFinish(current, finished);
  assert.equal(merged.status, "completed");
  assert.equal(merged.prints, 3);
  assert.equal(merged.captureEndsAt, "finished-at");
  assert.deepEqual(merged.photos, current.photos);
  const newer = mergeKioskFinish(current, { ...finished, photos: [
    { id: "one", number: 1 }, { id: "two", number: 2, sourcePreserved: true },
  ] });
  assert.equal(newer.photos[1].originalPending, undefined, "a new finish response can attach an original too");
});

test("new captures start uploading while the previous camera photo is still saving", async () => {
  let rows = [{ id: "one" }], wake;
  const started = [], saved = [], requests = new Map();
  const first = deferred(), second = deferred(), third = deferred();
  const draining = drainPendingPhotos({
    isActive: () => true,
    readPending: async () => [...rows],
    subscribe: callback => { wake = callback; return () => { wake = null; }; },
    upload: row => {
      started.push(row.id);
      const request = deferred(); requests.set(row.id, request);
      ({ one: first, two: second, three: third })[row.id].resolve();
      return request.promise;
    },
    onSaved: row => { rows = rows.filter(item => item.id !== row.id); saved.push(row.id); },
  });
  await first.promise;
  rows.push({ id: "two" }, { id: "three" }); wake();
  await second.promise;
  assert.deepEqual(started, ["one", "two"]);
  assert.deepEqual(saved, [], "no deletion before acknowledgement");
  requests.get("two").resolve();
  await third.promise;
  assert.deepEqual(saved, ["two"]);
  requests.get("three").resolve(); requests.get("one").resolve();
  await draining;
  assert.deepEqual(rows, []);
  assert.equal(wake, null);
  assert.deepEqual(started, ["one", "two", "three"], "no duplicate scheduling");
});

test("a failed camera upload stops the next row and awaits its in-flight sibling", async () => {
  const first = deferred(), second = deferred(), began = deferred();
  const rows = [{ id: "one" }, { id: "two" }, { id: "three" }];
  const saved = [], started = [];
  let settled = false;
  const draining = drainPendingPhotos({
    isActive: () => true, readPending: async () => rows,
    upload: row => { started.push(row.id); if (started.length === 2) began.resolve(); return row.id === "one" ? first.promise : second.promise; },
    onSaved: row => saved.push(row.id),
  });
  draining.then(() => { settled = true; }, () => { settled = true; });
  await began.promise;
  first.reject(new Error("offline"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  second.resolve();
  await assert.rejects(draining, /offline/);
  assert.deepEqual(started, ["one", "two"]);
  assert.deepEqual(saved, ["two"]);
});

test("a session change keeps acknowledgements but does not send the next guest's backlog", async () => {
  const requests = [deferred(), deferred()], began = deferred();
  let active = true, count = 0;
  const saved = [];
  const draining = drainPendingPhotos({
    isActive: () => active,
    readPending: async () => [{ id: "one" }, { id: "two" }, { id: "three" }],
    upload: () => { const request = requests[count++]; if (count === 2) began.resolve(); return request.promise; },
    onSaved: row => saved.push(row.id),
  });
  await began.promise;
  active = false;
  requests.forEach(request => request.resolve());
  await draining;
  assert.equal(count, 2);
  assert.deepEqual(saved.sort(), ["one", "two"]);
});

test("timer and online ticks share one slow photo POST without queuing duplicates", async () => {
  const gate = createSingleFlight();
  const saving = deferred(), began = deferred();
  let uploads = 0, removed = 0;
  const flush = () => gate.run(() => flushPendingPhotos({
    isIdle: () => true,
    readPending: async () => [{ id: "camera-fixed-key" }],
    upload: async () => { uploads++; began.resolve(); await saving.promise; },
    removePending: async () => { removed++; },
    onSaved: () => {},
  }));
  const first = flush();
  await began.promise;
  const overlap = Array.from({ length: 7 }, flush);
  assert.ok(overlap.every((promise) => promise === first));
  assert.equal(uploads, 1);
  saving.resolve();
  await Promise.all([first, ...overlap]);
  assert.equal(uploads, 1);
  assert.equal(removed, 1);
});

test("replacing an idle effect finishes its POST then yields backlog to active capture", async () => {
  const gate = createSingleFlight(), saving = deferred(), began = deferred();
  let idle = true;
  const uploads = [], removed = [];
  const old = gate.run(() => flushPendingPhotos({
    isIdle: () => idle,
    readPending: async () => [{ id: "old-1" }, { id: "old-2" }],
    upload: async (row) => { uploads.push(row.id); began.resolve(); await saving.promise; },
    removePending: async (id) => { removed.push(id); },
    onSaved: () => {},
  }));
  await began.promise;
  idle = false; // Effect cleanup/new guest; the running POST is not aborted.
  const missedTick = gate.run(async () => { uploads.push("active"); });
  assert.equal(missedTick, old);
  saving.resolve();
  await old;
  assert.deepEqual(uploads, ["old-1"]);
  assert.deepEqual(removed, ["old-1"]);
  await gate.run(async () => { uploads.push("active"); });
  assert.deepEqual(uploads, ["old-1", "active"]);
});

test("failed photo remains in outbox and the same key is available for retry", async () => {
  const gate = createSingleFlight();
  const row = { id: "stable-retry-key" }, keys = [], removed = [];
  let failure = true;
  const flush = () => gate.run(() => flushPendingPhotos({
    isIdle: () => true,
    readPending: async () => [row],
    upload: async (item) => { keys.push(item.id); if (failure) throw Error("offline"); },
    removePending: async (id) => removed.push(id),
    onSaved: () => {},
  }));
  await flush();
  assert.deepEqual(removed, []);
  failure = false;
  await flush();
  assert.deepEqual(keys, [row.id, row.id]);
  assert.deepEqual(removed, [row.id]);
});

test("an idle storage read failure settles shared callers and can retry safely", async () => {
  const gate = createSingleFlight();
  const reading = deferred(), began = deferred();
  const running = gate.run(() => flushPendingPhotos({
    isIdle: () => true,
    readPending: async () => { began.resolve(); return reading.promise; },
    upload: async () => assert.fail("no photos were read"),
    removePending: async () => assert.fail("nothing was uploaded"),
    onSaved: () => {},
  }));
  await began.promise;
  const activeSync = gate.run(async () => assert.fail("overlapping sync queued"));
  reading.reject(Error("IndexedDB temporarily unavailable"));
  await Promise.all([running, activeSync]);
  let retried = false;
  await gate.run(async () => { retried = true; });
  assert.equal(retried, true);
});

test("state poll is single flight while photo requests can complete independently", async () => {
  const states = createSingleFlight(), photos = createSingleFlight();
  const pending = deferred(), began = deferred();
  let polls = 0, saved = false;
  const poll = () => states.run(async () => {
    polls++; began.resolve(); await pending.promise;
  });
  const first = poll();
  await began.promise;
  assert.equal(poll(), first);
  await photos.run(async () => { saved = true; });
  assert.equal(saved, true);
  assert.equal(polls, 1);
  pending.resolve();
  await first;
});

test("a stale state snapshot cannot discard a photo confirmed after the poll began", async () => {
  const started = session("guest", [{ id: "one" }]);
  let current = started;
  const response = deferred();
  const poll = response.promise.then((booking) => {
    if (canApplyKioskState(started, current, { active: true, finishing: false }))
      current = { ...current, booking };
  });
  current = { ...started, booking: { photos: [{ id: "one" }, { id: "two" }] } };
  response.resolve({ photos: [{ id: "one" }] });
  await poll;
  assert.deepEqual(current.booking.photos.map((photo) => photo.id), ["one", "two"]);
});

test("disposed, finishing and replaced sessions ignore old state responses", () => {
  const started = session("guest-one");
  assert.equal(canApplyKioskState(started, started, { active: true, finishing: false }), true);
  assert.equal(canApplyKioskState(started, started, { active: false, finishing: false }), false);
  assert.equal(canApplyKioskState(started, started, { active: true, finishing: true }), false);
  assert.equal(canApplyKioskState(started, session("guest-two"), { active: true, finishing: false }), false);
  assert.equal(canApplyKioskState(started, null, { active: true, finishing: false }), false);
});

test("a delayed photo response cannot undo confirmed finish; next row uploads into album", async () => {
  const active = session("guest", [{ id: "one" }]);
  active.booking.status = "checked_in";
  active.booking.captureEndsAt = new Date(Date.now() + 60000);
  let current = active;
  const response = deferred(), removed = [];
  assert.equal(kioskPhotoPath(current), "/kiosk/photo");
  const saving = response.promise.then((booking) => {
    if (canApplyKioskPhoto(active, current, booking)) current = { ...current, booking };
    removed.push("two");
  });
  // Backend finish holds the capture lock, so this confirmed snapshot includes
  // the saved photo even when the earlier upload response reaches us later.
  current = { ...active, booking: {
    ...active.booking, status: "completed",
    photos: [{ id: "one" }, { id: "two" }, { id: "phone-added-after-finish" }],
  } };
  response.resolve({ ...active.booking, photos: [{ id: "one" }, { id: "two" }] });
  await saving;
  assert.equal(current.booking.status, "completed");
  assert.equal(current.booking.photos.length, 3);
  assert.deepEqual(removed, ["two"]);
  assert.equal(kioskPhotoPath(current), "/albums/guest/photos");
  assert.equal(kioskPhotoPath(active, active.booking.captureEndsAt.getTime()), null);
});
