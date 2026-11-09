import { prepareCameraImage } from "./kiosk/camera-image.js";

self.onmessage = async ({ data: { id, task, ...options } }) => {
  try {
    if (typeof OffscreenCanvas === "undefined" || !new OffscreenCanvas(1, 1).getContext("2d"))
      throw Object.assign(new Error("Offscreen canvas unavailable"), { code: "IMAGE_WORKER_UNAVAILABLE" });
    if (task === "camera") {
      const result = await prepareCameraImage(options.file, options.mirror);
      self.postMessage({ id, result });
    } else throw new Error("Unknown image task");
  } catch (error) {
    self.postMessage({ id, error: { message: error.message, code: error.code } });
  }
};
