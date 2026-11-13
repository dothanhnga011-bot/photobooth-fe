// Chỉnh sửa chân dung (tương tự Beautify của Xingtu): làm mịn da, trắng da,
// má hồng và thon gọn mặt V-line. Vị trí khuôn mặt lấy từ MediaPipe Face Landmarker
// (478 điểm), chỉ tải khi khách dùng chỉnh da hoặc khuôn mặt.

import wasmLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import noSimdLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url";
import noSimdBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url";
import modelUrl from "./assets/models/face_landmarker.task?url";
import { detectFaceLandmarks } from "./face-detection.js";
export {
  DEFAULT_ADJUST, COLOR_FILTERS, FILTER_CSS, ADJUST_LABELS,
  isNeutral, applyBeauty,
} from "./beauty-render.js";

let landmarker;
export function loadFaceLandmarker() {
  landmarker ??= (async () => {
    const { FilesetResolver, FaceLandmarker } =
      await import("@mediapipe/tasks-vision");
    const simd = await FilesetResolver.isSimdSupported();
    const files = {
      wasmLoaderPath: simd ? wasmLoaderUrl : noSimdLoaderUrl,
      wasmBinaryPath: simd ? wasmBinaryUrl : noSimdBinaryUrl,
    };
    return FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: modelUrl, delegate: "CPU" },
      runningMode: "IMAGE",
      numFaces: 6,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
    });
  })().catch((e) => {
    landmarker = undefined;
    throw Object.assign(
      new Error(
        "Không tải được bộ nhận diện khuôn mặt. Bấm thử lại khi kết nối ổn định.",
        { cause: e },
      ),
      { code: "FACE_DETECTION_UNAVAILABLE" },
    );
  });
  return landmarker;
}

// The face model is ~7 MB to download (the 11.7 MB wasm compresses to ~3.2 MB, the 3.8 MB model
// does not compress). Fetched only when a guest first moved a skin/face slider, they waited
// seconds before seeing anything. The editor warms the HTTP cache in the background once the
// photo is on screen, so that first slider move only compiles. Skipped when the device asks to
// save data or is on 2G; nothing is compiled or run here.
let warming;
export function warmFaceModel() {
  if (warming || landmarker) return warming;
  const connection = globalThis.navigator?.connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "")) return undefined;
  const fill = async (url) => {
    const response = await fetch(url, { priority: "low" });
    const reader = response.body?.getReader();
    if (!reader) return response.arrayBuffer();
    while (!(await reader.read()).done); // read to the end so the cache keeps it; keep nothing
  };
  warming = (async () => {
    const { FilesetResolver } = await import("@mediapipe/tasks-vision");
    const simd = await FilesetResolver.isSimdSupported();
    await Promise.all([simd ? wasmLoaderUrl : noSimdLoaderUrl, simd ? wasmBinaryUrl : noSimdBinaryUrl, modelUrl]
      .map(fill));
  })().catch(() => { warming = undefined; });
  return warming;
}

// Trả về danh sách khuôn mặt, mỗi mặt là mảng điểm {x, y} theo pixel.
export async function detectFaces(source) {
  const model = await loadFaceLandmarker();
  return detectFaceLandmarks(source, model);
}
