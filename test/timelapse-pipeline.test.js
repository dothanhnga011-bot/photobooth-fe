import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { buildTimelapse, createClipRecorder, timelapseBitrate } from "../src/kiosk/clip-recorder.js";

const originals = Object.fromEntries(["document", "MediaRecorder"].map((key) => [key, globalThis[key]]));
const createObjectURL = URL.createObjectURL, revokeObjectURL = URL.revokeObjectURL;
let videos, events, canvas, settings, stoppedTracks, failedClip;

beforeEach(() => {
  videos = []; events = []; settings = {}; stoppedTracks = 0; failedClip = -1;
  URL.createObjectURL = () => `blob:clip-${videos.length}`;
  URL.revokeObjectURL = (url) => events.push(["revoke", url]);
  globalThis.document = {
    createElement(kind) {
      if (kind === "canvas") {
        canvas = {
          getContext: () => ({
            fillRect() {}, save() {}, restore() {}, translate() {}, scale() {},
            drawImage: (video, ...args) => events.push(["draw", video.index, ...args]),
          }),
          captureStream: (fps) => {
            settings = { width: canvas.width, height: canvas.height, fps };
            return { getTracks: () => [{ stop: () => stoppedTracks++ }] };
          },
        };
        return canvas;
      }
      const video = {
        index: videos.length, videoWidth: 1920, videoHeight: 1080, readyState: 0,
        set src(url) {
          this.url = url;
          queueMicrotask(() => {
            if (this.index === failedClip) this.onerror?.();
            else { this.readyState = 2; this.onloadeddata?.(); }
          });
        },
        async play() {
          events.push(["play", this.index]);
          events.push(["preloaded", this.index, videos[this.index + 1]?.readyState]);
          events.push(["decoders", videos.filter((item) => !item.disposed).length]);
          setImmediate(() => this.onended?.());
        },
        pause() {}, load() {},
        removeAttribute() { this.disposed = true; },
        requestVideoFrameCallback() { return 42; },
        cancelVideoFrameCallback(id) { events.push(["cancel", this.index, id]); },
      };
      videos.push(video);
      return video;
    },
  };
  globalThis.MediaRecorder = class {
    static isTypeSupported(type) { return type.startsWith("video/mp4"); }
    constructor(stream, options) { this.mimeType = options.mimeType; settings.options = options; }
    start() {} pause() {} resume() {}
    stop() {
      this.ondataavailable({ data: new Blob([new Uint8Array(1500)]) });
      this.onstop();
    }
  };
});

afterEach(() => {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

const clips = () => {
  const first = [new Blob(["one"]), new Blob(["two"])]; first.ms = 12000;
  const second = [new Blob(["three"])]; second.ms = 8000;
  return [first, second];
};

test("timelapse loads each clip once and overlaps decoding without reducing output quality", async () => {
  const result = await buildTimelapse(clips());
  assert.equal(result.type, "video/mp4;codecs=avc1.640028");
  assert.equal(result.size, 1500);
  assert.equal(videos.length, 3, "first clip is reused for its dimensions and playback");
  assert.deepEqual(events.filter(([type]) => type === "play").map(([, index]) => index), [0, 1, 2]);
  // Assertions stay outside play(), whose rejection the resilient builder intentionally catches.
  assert.deepEqual(events.filter(([type]) => type === "preloaded").slice(0, 2),
    [["preloaded", 0, 2], ["preloaded", 1, 2]]);
  assert.ok(events.filter(([type]) => type === "decoders").every(([, count]) => count <= 2));
  assert.deepEqual([settings.width, settings.height, settings.fps], [1536, 864, 30]);
  assert.equal(settings.options.videoBitsPerSecond, timelapseBitrate(1536, 864, 5));
  assert.deepEqual(events.find(([type]) => type === "draw").slice(2), [192, 86, 1536, 864, 0, 0, 1536, 864]);
  assert.ok(videos.every((video) => video.playbackRate === 4 && video.disposed));
  assert.equal(events.filter(([type]) => type === "revoke").length, 3);
  assert.equal(events.filter(([type]) => type === "cancel").length, 3);
  assert.equal(stoppedTracks, 1);
});

test("HDMI records a cleaner local intermediate while the webcam keeps its low-load encoder", async () => {
  for (const light of [false, true]) {
    const recording = createClipRecorder();
    recording.start({ active: true }, { light });
    assert.equal(settings.options.videoBitsPerSecond, light ? 5_000_000 : 20_000_000);
    await recording.stop();
  }
});

test("a corrupt preloaded clip is skipped and every decoder is released", async () => {
  failedClip = 1;
  // Unlike playback, a failed preload never rejects an unobserved promise while another clip runs.
  const result = await buildTimelapse(clips());
  assert.equal(result.size, 1500);
  assert.deepEqual(events.filter(([type]) => type === "play").map(([, index]) => index), [0, 2]);
  assert.ok(videos.every((video) => video.disposed));
  assert.equal(events.filter(([type]) => type === "revoke").length, 3);
  assert.equal(stoppedTracks, 1);
});

test("webcam test mode builds the timelapse with software VP8 (laptop H.264 crashed Chrome); the booth keeps MP4", async () => {
  const supported = globalThis.MediaRecorder.isTypeSupported;
  globalThis.MediaRecorder.isTypeSupported = (type) => /^video\/(mp4|webm)/.test(type);
  try {
    const webcam = await buildTimelapse(clips(), { light: true });
    assert.equal(settings.options.mimeType, "video/webm;codecs=vp8");
    assert.equal(webcam.size, 1500);
    await buildTimelapse(clips());
    assert.equal(settings.options.mimeType, "video/mp4;codecs=avc1.640028");
  } finally {
    globalThis.MediaRecorder.isTypeSupported = supported;
  }
});
