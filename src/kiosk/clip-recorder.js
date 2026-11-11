import { visibleRegion } from "./live-preview-layout.js";

// Video tua nhanh: trong lúc chụp, hình trực tiếp HDMI được quay liên tục thành từng đoạn ngắn
// (bắt đầu đoạn mới mỗi SEGMENT_MS, giữ đoạn liền trước). Mỗi lần có ảnh, đoạn quanh lúc chụp
// thành một clip — một tấm ảnh, một clip. Chụp xong, các clip được ghép, tua nhanh, lật gương
// thành một video gửi lên album.
const SEGMENT_MS = 8000;
const MIN_CLIP_MS = 4000;
// H.264 trước (máy tính mã hóa bằng phần cứng: nhẹ máy, nét hơn VP8 cùng bitrate), rồi VP9 / VP8.
const RECORD_TYPES = [
  "video/mp4;codecs=avc1.640028",
  "video/mp4;codecs=avc1",
  "video/webm;codecs=h264",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];
// Chế độ nhẹ (thử máy bằng webcam máy tính): quay các đoạn bằng VP8 mã hóa phần mềm thay cho H.264
// phần cứng — webcam laptop + quay H.264 liên tục đã làm sập tab Chrome (STATUS_BREAKPOINT).
const LIGHT_TYPES = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
// Video ghép gửi album: MP4 (H.264) trước — iPhone chỉ lưu được MP4 / MOV vào app Ảnh, Android
// cũng xem / lưu được. Trình duyệt không ghi được MP4 mới dùng WebM. Chế độ nhẹ (thử bằng webcam máy
// tính) ghép bằng VP8 (LIGHT_TYPES) như lúc quay: bộ mã hóa H.264 phần cứng của laptop vẫn làm sập tab
// Chrome (STATUS_BREAKPOINT) ngay sau "Chụp xong", lúc ghép video (11/11). Máy chụp thật vẫn ra MP4.
const OUTPUT_TYPES = [
  "video/mp4;codecs=avc1.640028",
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];
// Video gửi lên album tối đa 60 MB: chừa khoảng an toàn.
const MAX_VIDEO_BYTES = 48 * 1024 * 1024;

const pickType = (types) =>
  typeof MediaRecorder !== "undefined"
    ? types.find((type) => MediaRecorder.isTypeSupported(type)) || ""
    : "";

export function createClipRecorder() {
  let recorder = null, stream = null, startedAt = 0, previous = null, restart = null, light = false;
  let chunks = [];
  const clips = [];
  const stopCurrent = () =>
    new Promise((resolve) => {
      const current = recorder;
      if (!current || current.state === "inactive") return resolve(null);
      const parts = chunks;
      const began = startedAt;
      current.onstop = () =>
        resolve(parts.length ? { blob: new Blob(parts, { type: current.mimeType }), ms: Date.now() - began } : null);
      try {
        current.stop();
      } catch {
        resolve(null);
      }
    });
  const begin = () => {
    clearTimeout(restart);
    if (!stream?.active) return;
    try {
      chunks = [];
      const type = pickType(light ? LIGHT_TYPES : RECORD_TYPES);
      // Bản tạm chỉ giữ trên PC: thêm dư địa cho lần mã hóa đầu, trước khi ghép lại.
      // Không tăng bitrate file gửi album; webcam vẫn giữ chế độ nhẹ để tránh lỗi GPU.
      recorder = new MediaRecorder(stream, {
        ...(type && { mimeType: type }),
        videoBitsPerSecond: light ? 5_000_000 : 20_000_000,
      });
      const own = chunks;
      recorder.ondataavailable = (event) => event.data.size && own.push(event.data);
      recorder.start(1000);
      startedAt = Date.now();
      restart = setTimeout(async () => {
        previous = await stopCurrent();
        begin();
      }, SEGMENT_MS);
    } catch {
      recorder = null;
    }
  };
  return {
    // Bắt đầu quay từ luồng hình trực tiếp (không có hình HDMI thì bỏ qua video).
    // options.light: chế độ nhẹ cho webcam máy tính (quay các đoạn bằng VP8 phần mềm).
    start(liveStream, options = {}) {
      if (!liveStream || typeof MediaRecorder === "undefined" || recorder) return;
      stream = liveStream;
      light = Boolean(options.light);
      begin();
    },
    // Vừa có ảnh: chốt clip của tấm đó (đoạn đang quay, kèm đoạn trước nếu đoạn này quá ngắn).
    async cut() {
      if (!recorder) return;
      clearTimeout(restart);
      const current = await stopCurrent();
      const used = [current?.ms < MIN_CLIP_MS && previous, current].filter(Boolean);
      const parts = used.map((c) => c.blob);
      // Thời lượng clip: video ghép chọn bitrate vừa giới hạn tải lên.
      parts.ms = used.reduce((sum, c) => sum + (c.ms || 0), 0);
      if (parts.length) clips.push(parts);
      previous = null;
      begin();
    },
    async stop() {
      clearTimeout(restart);
      await stopCurrent();
      recorder = null;
      stream = null;
      return clips.slice();
    },
    count: () => clips.length,
  };
}

// Kích thước video ra: khung 16:9 đúng bằng độ phân giải phần hình còn thấy sau khi cắt mép thông số
// (vd. HDMI 1920 × 1080 cắt mép → 1536 × 864), tối đa maxHeight. Không phóng to: phóng to không thêm
// chi tiết mà làm nhoè, và cùng bitrate thì ảnh nhỏ hơn được nhiều bit mỗi điểm ảnh hơn.
export function timelapseSize(sourceWidth, sourceHeight, region, maxHeight = 1080) {
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  const sw = sourceWidth * region.w, sh = sourceHeight * region.h;
  const height = even(sw > 0 && sh > 0 ? Math.min(maxHeight, sh, (sw * 9) / 16) : maxHeight);
  return [even((height * 16) / 9), height];
}

// Crop on actual source pixels. Fractional HDMI margins (e.g. y = 86.4) and
// a tiny resize after rounding H.264 dimensions used to soften native-size frames.
// Only genuinely larger sources (4K, or the webcam cap) need resampling.
export function timelapseCrop(sourceWidth, sourceHeight, region, width, height) {
  const sw = sourceWidth * region.w, sh = sourceHeight * region.h;
  if (!(sw > 0 && sh > 0 && width > 0 && height > 0)) return null;
  const [nativeWidth, nativeHeight] = timelapseSize(sourceWidth, sourceHeight, region, Infinity);
  const native = width === nativeWidth && height === nativeHeight;
  const cropWidth = Math.min(sourceWidth, native ? width : Math.round(Math.min(sw, sh * width / height)));
  const cropHeight = Math.min(sourceHeight, native ? height : Math.round(Math.min(sh, sw * height / width)));
  return {
    x: Math.max(0, Math.min(sourceWidth - cropWidth, Math.round(sourceWidth * region.x + (sw - cropWidth) / 2))),
    y: Math.max(0, Math.min(sourceHeight - cropHeight, Math.round(sourceHeight * region.y + (sh - cropHeight) / 2))),
    width: cropWidth,
    height: cropHeight,
    resize: cropWidth !== width || cropHeight !== height,
  };
}

// Bitrate video ghép: theo số điểm ảnh (0,35 bit / điểm ảnh / khung, 30 khung/giây — đủ cho H.264 phần
// cứng giữ chi tiết cả khi tua nhanh nhiều chuyển động): 1920 × 1080 → 16 Mbps (trần), 1536 × 864 →
// ~14 Mbps, 1034 × 582 → ~6 Mbps. Cao hơn mức này không nét thêm mà tệp nặng hơn, tải lên album lâu
// hơn. Không vượt mức để cả video dưới giới hạn tải lên.
export function timelapseBitrate(width, height, seconds, light = false) {
  const floor = light ? 2_000_000 : 4_000_000, ceiling = light ? 8_000_000 : 16_000_000;
  const byPixels = width * height * 30 * 0.35;
  const bySize = (MAX_VIDEO_BYTES * 8) / Math.max(1, seconds);
  return Math.round(Math.max(floor, Math.min(ceiling, byPixels, bySize)));
}

// Prepare a playable first frame once; reuse the same decoder for dimensions and playback.
function prepareClip(blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  let settle, timer;
  const ready = new Promise((resolve) => {
    settle = (loaded) => {
      clearTimeout(timer);
      video.onloadeddata = video.onerror = null;
      resolve(loaded);
    };
    video.onloadeddata = () => settle(true);
    video.onerror = () => settle(false);
    timer = setTimeout(() => settle(video.readyState >= 2), 4000);
  });
  video.src = url;
  return {
    video, ready,
    dispose() {
      settle(false);
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

// Ghép các clip thành một video tua nhanh (mặc định ×4), 16:9 đúng độ phân giải nguồn (tối đa Full HD),
// lật gương như màn hình xem trước và cắt bỏ mép có thông số máy ảnh. Chạy trong lúc khách chọn ảnh:
// mất khoảng ¼ thời lượng các clip. Bitrate theo độ phân giải (timelapseBitrate), dưới giới hạn tải lên.
export async function buildTimelapse(clips, { zoom = 0, speed = 4, mirror = true, light = false } = {}) {
  const segments = clips.flat();
  if (!segments.length || typeof MediaRecorder === "undefined") return null;
  const region = visibleRegion(zoom);
  let current = prepareClip(segments[0]);
  await current.ready;
  // Chế độ nhẹ (webcam máy tính): tối đa 720p, tới 8 Mbps.
  const [width, height] = timelapseSize(current.video.videoWidth, current.video.videoHeight, region, light ? 720 : 1080);
  const seconds = Math.max(1, clips.reduce((sum, clip) => sum + (clip.ms || SEGMENT_MS), 0) / 1000 / speed);
  const bitrate = timelapseBitrate(width, height, seconds, light);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  const type = pickType(light ? LIGHT_TYPES : OUTPUT_TYPES);
  const output = canvas.captureStream(30);
  const recorder = new MediaRecorder(output, { ...(type && { mimeType: type }), videoBitsPerSecond: bitrate });
  const chunks = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const finished = new Promise((resolve) => (recorder.onstop = resolve));
  recorder.start(1000);
  recorder.pause();
  const draw = (video) => {
    const crop = timelapseCrop(video.videoWidth, video.videoHeight, region, width, height);
    if (!crop) return;
    ctx.imageSmoothingEnabled = crop.resize;
    ctx.save();
    if (mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
    ctx.restore();
  };
  for (let index = 0; index < segments.length; index++) {
    // Decode only one clip ahead while the current one plays. This removes the
    // serial load/decode wait between clips without holding every decoder open.
    // The first decoded clip also supplies dimensions, so it is not loaded twice.
    const next = index + 1 < segments.length ? prepareClip(segments[index + 1]) : null;
    const { video } = current;
    try {
      if (!(await current.ready)) continue;
      video.playbackRate = speed;
      draw(video);
      await video.play();
      recorder.resume();
      await new Promise((resolve) => {
        let stopped = false, frameId, timer;
        const done = () => {
          if (stopped) return;
          stopped = true;
          clearTimeout(timer);
          video.onended = video.onerror = null;
          if (frameId !== undefined) {
            if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameId);
            else cancelAnimationFrame(frameId);
          }
          resolve();
        };
        video.onended = video.onerror = done;
        // Clip lỗi / không phát hết: không để video bị treo.
        timer = setTimeout(done, 20000);
        const frame = () => {
          if (stopped) return;
          draw(video);
          if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback(frame);
          else frameId = requestAnimationFrame(frame);
        };
        frame();
      });
      recorder.pause();
    } catch {
      /* bỏ qua clip lỗi */
    } finally {
      current.dispose();
      current = next;
    }
  }
  recorder.stop();
  await finished;
  output.getTracks().forEach((t) => t.stop());
  canvas.width = canvas.height = 0;
  if (!chunks.length) return null;
  const blob = new Blob(chunks, { type: recorder.mimeType || type || "video/webm" });
  return blob.size > 1000 && blob.size <= 60 * 1024 * 1024 ? blob : null;
}
