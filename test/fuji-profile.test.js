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

test("each room gets its camera application, instructions and an isolated folder permission", () => {
  const fuji = cameraProfile("photobooth"), canon = cameraProfile("polaroid");
  assert.equal(fuji.folderKey, "camera-folder-fujifilm");
  assert.notEqual(canon.folderKey, fuji.folderKey);
  assert.match(canon.label, /R100/);
  assert.match(canon.app, /EOS Utility/);
  assert.match(canon.folder, /Canon/);
  assert.match(canon.steps.join(" "), /RS-60E3/);
  assert.match(canon.steps.join(" "), /Remote shooting/);
  assert.ok(!canon.steps.join(" ").includes("X Acquire"));
  assert.match(fuji.steps.join(" "), /X Acquire/);
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
