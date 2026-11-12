import { prepareCameraImage } from "./kiosk/camera-image.js";
import { resampleImage } from "./kiosk/lanczos.js";

self.onmessage = async ({ data: { id, task, ...options } }) => {
  try {
    if (typeof OffscreenCanvas === "undefined" || !new OffscreenCanvas(1, 1).getContext("2d"))
      throw Object.assign(new Error("Offscreen canvas unavailable"), { code: "IMAGE_WORKER_UNAVAILABLE" });
    if (task === "camera") {
      const result = await prepareCameraImage(options.file, options.mirror);
      self.postMessage({ id, result });
    } else if (task === "resample") {
      // Tờ in DNP: Lanczos3 một lần từ ảnh gốc vào đúng ô (lanczos.js), trả điểm ảnh RGBA.
      const { bitmap, out, src } = options;
      try {
        const result = resampleImage(bitmap, out, src, (w, h) => new OffscreenCanvas(w, h));
        self.postMessage({ id, result }, [result.data.buffer]);
      } finally {
        bitmap.close();
      }
    } else throw new Error("Unknown image task");
  } catch (error) {
    self.postMessage({ id, error: { message: error.message, code: error.code } });
  }
};
