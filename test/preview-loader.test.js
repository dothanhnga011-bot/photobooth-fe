import assert from "node:assert/strict";
import { test } from "node:test";
import { createPreviewLoader } from "../src/kiosk/preview-loader.js";

const settle = () => new Promise(resolve => setImmediate(resolve));
const shots = (count) => Array.from({ length: count }, (_, index) => ({ key: String(index) }));
function fixture() {
  const pending = [], frames = new Map(), snapshots = [];
  let active = 0, peak = 0, frameId = 0;
  const loader = createPreviewLoader({
    load: (shot, token, signal) => {
      active++; peak = Math.max(peak, active);
      return new Promise((resolve, reject) => pending.push({
        key: shot.key, token, signal,
        resolve: image => { active--; resolve(image); },
        reject: () => { active--; reject(new Error("temporary decode error")); },
      }));
    },
    onChange: (map, token) => snapshots.push({ token, map }),
    schedule: callback => { frames.set(++frameId, callback); return frameId; },
    cancel: id => frames.delete(id),
  });
  const image = () => ({ width: 1600, height: 1067, closed: 0, close() { this.closed++; } });
  return { loader, pending, frames, snapshots, image, peak: () => peak,
    paint: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); } };
}

test("twelve previews decode at most three at a time and publish one batch per paint", async () => {
  const f = fixture();
  f.loader.setShots(shots(12), "guest");
  await settle();
  assert.equal(f.pending.length, 3);
  let completed = 0;
  while (completed < 12) {
    const group = f.pending.splice(0);
    for (const task of group) task.resolve(f.image());
    completed += group.length;
    await settle();
    assert.equal(f.frames.size, 1);
    f.paint();
    assert.equal(f.snapshots.at(-1).map.size, completed);
  }
  assert.equal(f.peak(), 3);
  assert.deepEqual(f.snapshots.map(row => row.map.size), [0, 3, 6, 9, 12]);
  f.loader.setShots(shots(12), "guest");
  await settle();
  assert.equal(f.pending.length, 0, "session refreshes reuse decoded previews");
  f.loader.close();
  for (const image of f.snapshots.at(-1).map.values()) assert.equal(image.closed, 1);
});

test("a new guest aborts old loads, drops the old queue and closes results that arrive late", async () => {
  const f = fixture();
  f.loader.setShots(shots(12), "old");
  await settle();
  const old = f.pending.splice(0), oldImages = old.map(() => f.image());
  f.loader.setShots(shots(2), "new");
  assert.ok(old.every(task => task.signal.aborted));
  assert.equal(f.pending.length, 0, "do not exceed the decode limit while old work settles");
  old.forEach((task, index) => task.resolve(oldImages[index]));
  await settle();
  assert.ok(oldImages.every(image => image.closed === 1));
  assert.deepEqual(f.pending.map(task => task.token), ["new", "new"]);
  f.pending.splice(0).forEach(task => task.resolve(f.image()));
  await settle(); f.paint();
  assert.equal(f.snapshots.at(-1).token, "new");
  assert.equal(f.snapshots.at(-1).map.size, 2);
  assert.equal(f.snapshots.some(row => row.token === "old" && row.map.size), false);
  f.loader.close();
});

test("leaving selection cancels pending paints and closes decoded and still-running images", async () => {
  const f = fixture();
  f.loader.setShots(shots(4), "guest");
  await settle();
  const first = f.image();
  f.pending.shift().resolve(first);
  await settle();
  assert.equal(f.frames.size, 1);
  f.loader.setShots([], "guest");
  assert.equal(first.closed, 1);
  assert.equal(f.frames.size, 0);
  const remaining = f.pending.splice(0).map(task => { const image = f.image(); task.resolve(image); return image; });
  await settle(); f.paint();
  assert.ok(remaining.every(image => image.closed === 1));
  assert.equal(f.snapshots.at(-1).map.size, 0);
  f.loader.close();
});

test("a failed preview can retry without decoding its successful siblings again", async () => {
  const f = fixture();
  f.loader.setShots(shots(2), "guest");
  await settle();
  f.pending.shift().reject();
  f.pending.shift().resolve(f.image());
  await settle(); f.paint();
  f.loader.setShots(shots(2), "guest");
  await settle();
  assert.deepEqual(f.pending.map(task => task.key), ["0"]);
  f.pending.shift().resolve(f.image());
  await settle(); f.paint();
  assert.equal(f.snapshots.at(-1).map.size, 2);
  f.loader.close();
});
