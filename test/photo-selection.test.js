import assert from "node:assert/strict";
import { test } from "node:test";
import { fillPhotoSlots, photoSlots, removePhotoSlot, selectedCount, togglePhotoSlot } from "../src/kiosk/photo-selection.js";

test("a chosen photo tapped again leaves an empty slot; the others never move", () => {
  let slots = [];
  for (const key of ["a", "b", "c", "d"]) slots = togglePhotoSlot(slots, 4, key);
  assert.deepEqual(slots, ["a", "b", "c", "d"]);
  slots = togglePhotoSlot(slots, 4, "b");
  assert.deepEqual(slots, ["a", null, "c", "d"]);
  assert.equal(selectedCount(slots), 3);
  // The next photo goes into the empty slot, not to the end.
  slots = togglePhotoSlot(slots, 4, "e");
  assert.deepEqual(slots, ["a", "e", "c", "d"]);
});

test("a full frame ignores a new photo; removing a slot on the frame keeps the order", () => {
  const full = ["a", "b", "c"];
  assert.deepEqual(togglePhotoSlot(full, 3, "z"), ["a", "b", "c"]);
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
