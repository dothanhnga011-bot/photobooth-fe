import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { cleanCameraJpeg, cleanJpegParts, exifOrientation } from "../src/kiosk/jpeg-clean.js";
import { cleanJpegMetadata } from "../../photobooth-be/src/services/jpeg-metadata.js";

// The booth's cleaner must give exactly the bytes the server's would: the stored original is the
// same whichever way a photo travelled. Sample JPEGs come from the server's own image library.
const sharp = createRequire(new URL("../../photobooth-be/package.json", import.meta.url))("sharp");
const base = () => sharp({ create: { width: 320, height: 200, channels: 3,
  noise: { type: "gaussian", mean: 120, sigma: 30 } } });
const samples = async () => {
  const plain = await base().jpeg().toBuffer();
  const rotated = await base().withMetadata({ orientation: 6, exif: { IFD0: { Make: "FUJIFILM", Artist: "private" } } })
    .jpeg({ quality: 92 }).toBuffer();
  const profiled = await base().withIccProfile("p3").withMetadata({ orientation: 3 }).jpeg({ progressive: true }).toBuffer();
  const mirrored = await base().withMetadata({ orientation: 2 }).jpeg({ restartInterval: 4 }).toBuffer();
  const comment = Buffer.concat([plain.subarray(0, 2), Buffer.from([0xff, 0xfe, 0x00, 0x07, 0x68, 0x65, 0x6c, 0x6c, 0x6f]),
    plain.subarray(2)]);
  const trailing = Buffer.concat([rotated, Buffer.from("MPF secondary image bytes")]);
  return { plain, rotated, profiled, mirrored, comment, trailing };
};

test("the booth cleans camera JPEGs exactly like the server", async () => {
  for (const [name, jpeg] of Object.entries(await samples())) {
    const orientation = (await sharp(jpeg).metadata()).orientation;
    assert.equal(exifOrientation(new Uint8Array(jpeg)), orientation, `${name}: orientation`);
    const server = cleanJpegMetadata(jpeg, orientation);
    const booth = Buffer.from(await (await cleanCameraJpeg(new Blob([jpeg]))).arrayBuffer());
    assert.deepEqual(booth, Buffer.from(server), `${name}: same bytes as the server`);
    assert.equal(booth.equals(jpeg), server === jpeg, `${name}: changed only when the server changes it`);
  }
});

test("a file still being written or not a JPEG is refused like on the server", async () => {
  const { rotated } = await samples();
  for (const bytes of [rotated.subarray(0, rotated.length - 2), rotated.subarray(0, 600), Buffer.from("not a jpeg")]) {
    assert.throws(() => cleanJpegMetadata(bytes, 6));
    assert.throws(() => cleanJpegParts(new Uint8Array(bytes), 6));
  }
});

test("an already clean JPEG reuses its original Blob and normalizes an unknown MIME type", async () => {
  const { plain } = await samples();
  const original = new Blob([plain], { type: "image/jpeg" });
  assert.equal(await cleanCameraJpeg(original), original, "no replacement image allocation");
  const untyped = await cleanCameraJpeg(new Blob([plain]));
  assert.equal(untyped.type, "image/jpeg");
  assert.deepEqual(Buffer.from(await untyped.arrayBuffer()), plain);
});

test("metadata removal reuses source Blob slices while preserving pixels and orientation", async () => {
  const { rotated } = await samples();
  const image = new Blob([rotated], { type: "image/jpeg" });
  const slices = [], slice = image.slice.bind(image);
  image.slice = (start, end) => {
    slices.push([start, end]);
    return slice(start, end);
  };
  const result = await cleanCameraJpeg(image);
  const cleaned = Buffer.from(await result.arrayBuffer());
  assert.deepEqual(cleaned, cleanJpegMetadata(rotated, 6));
  assert.ok(slices.length > 0, "retained camera bytes come from the immutable source Blob");
  assert.equal(slices.reduce((size, [start, end]) => size + end - start, 0), cleaned.length - 36,
    "only the 36-byte replacement EXIF is newly allocated");
  assert.equal((await sharp(cleaned).metadata()).orientation, 6);
});
