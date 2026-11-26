import assert from "node:assert/strict";
import { test } from "node:test";
import { addPhotoSlot, fillPhotoSlots, photoSlots, removePhotoSlot, selectedCount } from "../src/kiosk/photo-selection.js";

test("a chosen photo tapped again fills the next empty slot too: one photo may repeat", () => {
  let slots = [];
  for (const key of ["a", "b", "a"]) slots = addPhotoSlot(slots, 4, key);
  assert.deepEqual(slots, ["a", "b", "a", null]);
  assert.equal(selectedCount(slots), 3);
  slots = addPhotoSlot(slots, 4, "a");
  assert.deepEqual(slots, ["a", "b", "a", "a"]);
});

test("emptying a slot on the frame leaves the others in place; the next photo goes into that slot", () => {
  let slots = removePhotoSlot(["a", "b", "c", "d"], 4, 1);
  assert.deepEqual(slots, ["a", null, "c", "d"]);
  assert.equal(selectedCount(slots), 3);
  slots = addPhotoSlot(slots, 4, "a");
  assert.deepEqual(slots, ["a", "a", "c", "d"]);
});

test("a full frame ignores a new photo; removing a slot on the frame keeps the order", () => {
  const full = ["a", "b", "c"];
  assert.deepEqual(addPhotoSlot(full, 3, "z"), ["a", "b", "c"]);
  assert.deepEqual(addPhotoSlot(full, 3, "a"), ["a", "b", "c"]);
  assert.deepEqual(removePhotoSlot(full, 3, 0), [null, "b", "c"]);
  assert.deepEqual(removePhotoSlot(full, 3, 7), ["a", "b", "c"]);
});

test("an older compacted or shorter list is read as slots of the current frame", () => {
  assert.deepEqual(photoSlots(["a"], 3), ["a", null, null]);
  assert.deepEqual(photoSlots(undefined, 2), [null, null]);
  assert.deepEqual(photoSlots(["a", "b", "c"], 2), ["a", "b"]);
});

test("when time runs out, empty slots are filled in place with photos not yet used", () => {
  assert.deepEqual(fillPhotoSlots([null, "b", null], 3, ["a", "b", "c", "d"]), ["a", "b", "c"]);
  // A photo that is no longer in the album leaves its slot to be refilled.
  assert.deepEqual(fillPhotoSlots(["gone", "b"], 2, ["a", "b"]), ["a", "b"]);
  // Fewer photos than slots: the first photo repeats rather than leaving a hole.
  assert.deepEqual(fillPhotoSlots([], 3, ["a", "b"]), ["a", "b", "a"]);
});
