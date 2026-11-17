// Chỉnh chân dung theo vùng da, mắt, mũi, miệng và trang điểm.
// Vị trí khuôn mặt lấy từ MediaPipe Face Landmarker
// (478 điểm), tải khi khách mở trình làm đẹp.

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
export { BEAUTY_GROUPS, BEAUTY_PRESETS, needsFaces, normalizeAdjust } from './beauty-settings.js';

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

// Trả về danh sách khuôn mặt, mỗi mặt là mảng điểm {x, y} theo pixel.
export async function detectFaces(source) {
  const pending = loadFaceLandmarker();
  const model = await pending;
  try { return await detectFaceLandmarks(source, model); }
  catch (cause) {
    // Runtime failures can leave the WASM graph unusable. Retry must create a
    // fresh model instead of repeatedly reusing the same broken instance.
    if (landmarker === pending) { landmarker = undefined; try { model.close(); } catch {} }
    throw Object.assign(new Error('Bộ nhận diện vừa gặp lỗi. Bấm Nhận diện lại để thử lại.', { cause }), { code: 'FACE_DETECTION_UNAVAILABLE' });
  }
}
