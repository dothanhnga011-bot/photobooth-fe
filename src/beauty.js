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
export { BEAUTY_PRESETS, needsFaces, normalizeAdjust } from './beauty-settings.js';

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
      // Điểm biểu cảm từng mặt (mắt nhắm, cười): dùng cho gợi ý ảnh đẹp ở album Selfbooth (scoreFaces).
      outputFaceBlendshapes: true,
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

// Gợi ý ảnh đẹp (album/selfbooth/photo-suggestions.js): mắt nhắm (eyeBlink) và cười (mouthSmile) của từng
// mặt, 0..1. Chạy một lần trên ảnh nhỏ của thư viện (không thử xoay như khi làm đẹp). Mặt quá nhỏ (người đi
// ngang phía sau, mặt in trên áo) không tính.
const MIN_FACE_WIDTH = 0.06;
export async function scoreFaces(source) {
  const model = await loadFaceLandmarker();
  const result = model.detect(source);
  return (result.faceBlendshapes || [])
    .map((shapes, index) => {
      const score = (name) => shapes.categories.find((c) => c.categoryName === name)?.score ?? 0;
      const xs = (result.faceLandmarks?.[index] || []).map((point) => point.x);
      return {
        blink: Math.max(score("eyeBlinkLeft"), score("eyeBlinkRight")),
        smile: (score("mouthSmileLeft") + score("mouthSmileRight")) / 2,
        width: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
      };
    })
    .filter((face) => face.width >= MIN_FACE_WIDTH);
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
