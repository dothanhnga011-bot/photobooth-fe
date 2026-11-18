import { useEffect, useRef } from "react";
import { livePreviewLayout, visibleClip } from "./live-preview-layout.js";
import { previewRotation } from './preview-orientation.js';

// Lúc bấm chụp, máy ảnh đổi tín hiệu HDMI trong giây lát (hiện ảnh vừa chụp, đổi độ phân
// giải): chỉ nhận kích thước nguồn mới khi nó giữ nguyên quá khoảng này, để hình không nhảy.
const SETTLE_MS = 1500;

// canvas (chế độ máy yếu): vẽ từng khung hình lên <canvas> thay vì để trình duyệt tự hiện thẻ
// <video>. Trên mini PC GPU Intel đời cũ, lớp video của Chrome có lúc hiện trắng sau khi chụp dù
// khung hình vẫn đúng; vẽ bằng canvas đi đường khác nên vẫn thấy hình.
// fit: "cover" (mặc định, phủ kín khung xem) hoặc "contain" (thấy đủ khung hình — màn đứng chia đôi).
// mirror: lật như gương — cùng cài đặt với ảnh chụp và video, nên màn hình luôn giống ảnh nhận được.
export function CameraPreview({ videoRef, zoom = 0, canvas = false, fit = "cover", mirror = false, rotation = 0, label }) {
  const viewport = useRef(null);
  const screen = useRef(null);

  useEffect(() => {
    const camera = videoRef.current;
    const frame = viewport.current;
    let source = null, settle = null;
    const apply = () => {
      const layout = source && livePreviewLayout(
        source.width,
        source.height,
        frame.clientWidth,
        frame.clientHeight,
        zoom,
        fit,
        rotation,
        mirror,
      );
      const shown = [camera, screen.current].filter(Boolean);
      if (!layout) {
        for (const element of shown) element.style.visibility = "hidden";
        return;
      }
      for (const element of shown) {
        for (const [property, value] of Object.entries(layout))
          element.style[property] = `${value}px`;
        element.style.clipPath = visibleClip(zoom);
        // Rotate first, then mirror along the upright screen's horizontal axis.
        element.style.transform = [mirror && 'scaleX(-1)', previewRotation(rotation) && `rotate(${previewRotation(rotation)}deg)`].filter(Boolean).join(' ');
        element.style.visibility = "visible";
      }
    };
    const sourceChanged = () => {
      const next = { width: camera.videoWidth, height: camera.videoHeight };
      if (!next.width || !next.height) return;
      if (source && source.width === next.width && source.height === next.height) return;
      clearTimeout(settle);
      // Lần đầu có hình: hiện ngay. Đổi kích thước giữa chừng: đợi tín hiệu ổn định.
      if (!source) {
        source = next;
        apply();
        return;
      }
      settle = setTimeout(() => {
        if (camera.videoWidth === next.width && camera.videoHeight === next.height) {
          source = next;
          apply();
        }
      }, SETTLE_MS);
    };

    // Tính lại khi đổi thẻ ghi hình, độ phân giải hoặc kích thước màn hình.
    // Trình duyệt vẫn phát video trực tiếp, không vẽ lại từng khung lên canvas.
    const reset = () => {
      source = null;
      sourceChanged();
    };
    camera.addEventListener("loadedmetadata", reset);
    camera.addEventListener("resize", sourceChanged);
    const observer = new ResizeObserver(apply);
    observer.observe(frame);
    sourceChanged();
    return () => {
      clearTimeout(settle);
      observer.disconnect();
      camera.removeEventListener("loadedmetadata", reset);
      camera.removeEventListener("resize", sourceChanged);
    };
  }, [videoRef, zoom, canvas, fit, rotation, mirror]);

  // Chế độ máy yếu: chép khung hình mới nhất lên canvas, tối đa ~30 lần mỗi giây (nguồn HDMI 30 hình/giây).
  useEffect(() => {
    if (!canvas) return;
    const camera = videoRef.current;
    const target = screen.current;
    const ctx = target.getContext("2d", { alpha: false });
    let frame = 0, last = 0;
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 30 || camera.readyState < 2 || !camera.videoWidth) return;
      last = now;
      if (target.width !== camera.videoWidth) target.width = camera.videoWidth;
      if (target.height !== camera.videoHeight) target.height = camera.videoHeight;
      ctx.drawImage(camera, 0, 0, target.width, target.height);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [videoRef, canvas]);

  return (
    <div ref={viewport} className={`camera-preview-viewport${canvas ? " is-canvas" : ""}${mirror ? " is-mirrored" : ""}`}>
      <video ref={videoRef} autoPlay playsInline muted aria-label={label} />
      {canvas && <canvas ref={screen} aria-hidden="true" />}
    </div>
  );
}
