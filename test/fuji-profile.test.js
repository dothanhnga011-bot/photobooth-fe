import assert from "node:assert/strict";
import { test } from "node:test";
import { isRaw, RAW_ONLY_MESSAGE, PHOTO_FOLDER_EXAMPLE } from "../src/kiosk/folder.js";
import { cameraRank, liveUsable } from "../src/kiosk/camera.js";
import { cameraProfile } from "../src/kiosk/camera-profile.js";

test("Canon and Fujifilm RAW files are diagnosed while JPEG remains the capture format", () => {
  assert.equal(isRaw("IMG_0001.CR3"), true);
  assert.equal(isRaw("IMG_0001.cr2"), true);
  assert.equal(isRaw("IMG_0001.JPG"), false);
  assert.equal(isRaw("DSCF0001.RAF"), true);
  assert.match(PHOTO_FOLDER_EXAMPLE, /Fujifilm/);
  assert.match(RAW_ONLY_MESSAGE, /RAF/);
});

test("both rooms shoot with a Fujifilm X-T3 through X Acquire (the Selfbooth room since 14/11)", () => {
  const booth = cameraProfile("photobooth"), selfbooth = cameraProfile("polaroid");
  for (const profile of [booth, selfbooth]) {
    assert.equal(profile.folderKey, "camera-folder-fujifilm");
    assert.match(profile.label, /X-T3/);
    assert.match(profile.app, /X Acquire/);
    assert.match(profile.folder, /Fujifilm/);
    assert.match(profile.steps.join(" "), /X Acquire/);
    assert.ok(!profile.steps.join(" ").includes("EOS Utility"));
  }
  assert.match(selfbooth.note, /DS820/);
});
test("USB streaming cameras cannot replace an HDMI capture card", () => {
  assert.equal(liveUsable({ label: "EOS Webcam Utility" }), false);
  assert.equal(liveUsable({ label: "Canon EOS R100" }), false);
  assert.equal(liveUsable({ label: "FUJIFILM X-S10" }), false);
  assert.equal(liveUsable({ label: "FUJIFILM X-S20" }), false);
  assert.equal(liveUsable({ label: "FUJIFILM X-T3" }), false);
  assert.equal(liveUsable({ label: "Integrated Camera" }), false);
  assert.equal(liveUsable({ label: "USB Video" }), true);
  assert.equal(cameraRank({ label: "Elgato Cam Link HDMI" }), 0);
});
