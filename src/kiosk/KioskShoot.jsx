import { useEffect, useRef, useState } from "react";
import {
  PiArrowClockwiseBold,
  PiCameraBold,
  PiCheckBold,
  PiHandTapBold,
  PiImagesDuotone,
  PiVideoCameraSlashDuotone,
  PiWebcamBold,
} from "react-icons/pi";
import { Button } from "../studio";
import { CameraPreview } from "./CameraPreview.jsx";
import { useKioskText } from "./use-kiosk-text.js";

// Ảnh trên máy (Blob) hoặc trên máy chủ (URL).
export function useObjectUrl(source) {
  const [url, setUrl] = useState(typeof source === "string" ? source : "");
  useEffect(() => {
    if (!(source instanceof Blob)) {
      setUrl(typeof source === "string" ? source : "");
      return;
    }
    const next = URL.createObjectURL(source);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [source]);
  return url;
}
function Thumb({ shot }) {
  const src = useObjectUrl(shot.preview);
  return src ? <img src={src} alt="" /> : <span className="shoot-thumb-empty" />;
}
const clock = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// Màn chụp: hình trực tiếp toàn màn hình (lật như gương, đã cắt mép thông số máy ảnh), không có
// chữ trên hình. Bên phải: thời gian còn lại, số tấm đã chụp, các ảnh vừa chụp xếp dọc và nút
// "Chụp xong". webcam: chế độ thử máy bằng webcam máy tính (khi không có máy ảnh) — { on, label,
// count (đếm ngược), onSnap, onToggle }.
export function KioskShoot({
  videoRef,
  zoom,
  ready,
  phase,
  preCount,
  sessionLeft,
  taken,
  quota,
  shots,
  flash,
  receiving,
  ending,
  onEnd,
  onReopenCamera,
  webcam = null,
}) {
  const t = useKioskText();
  const shooting = phase === "shoot" && !ending;
  const full = Boolean(quota) && taken >= quota;
  const testing = Boolean(webcam?.on && ready);
  const centerCount =
    phase === "ready"
      ? preCount
      : webcam?.count
        ? webcam.count
        : shooting && sessionLeft > 0 && sessionLeft <= 3
          ? sessionLeft : null;
  // Ảnh mới nhất ở đầu cột: có ảnh mới thì cuộn lên đầu để khách thấy ngay.
  const rail = useRef(null);
  useEffect(() => {
    rail.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [shots.length, receiving]);
  const progress = quota ? Math.min(100, (Math.min(taken, quota) / quota) * 100) : 0;
  return (
    <section className={`shoot-screen phase-${phase}${ready ? "" : " no-live"}`}>
      <div className="shoot-stage">
        <CameraPreview videoRef={videoRef} zoom={zoom} />
        {!ready && (
          <div className="shoot-no-camera" role="status">
            <span className="shoot-no-camera-icon" aria-hidden="true">
              <PiVideoCameraSlashDuotone />
            </span>
            <strong>Chưa có hình trực tiếp</strong>
            <p>Máy ảnh chưa gửi hình qua thẻ ghi hình HDMI. Ảnh gốc vẫn được nhận khi bấm dây chụp.</p>
            <div className="shoot-no-camera-actions">
              <Button className="small" onClick={onReopenCamera}>
                <PiArrowClockwiseBold aria-hidden="true" /> Mở lại camera
              </Button>
              {webcam && !webcam.on && (
                <Button className="outline small" onClick={() => webcam.onToggle(true)}>
                  <PiWebcamBold aria-hidden="true" /> Dùng webcam máy tính (thử máy)
                </Button>
              )}
            </div>
          </div>
        )}
        {webcam?.on && (
          <div className="shoot-webcam-badge" role="status">
            <PiWebcamBold aria-hidden="true" />
            <span>Thử máy bằng webcam{webcam.label ? ` · ${webcam.label}` : ""}</span>
            <button type="button" onClick={() => webcam.onToggle(false)}>Tắt</button>
          </div>
        )}
        {centerCount ? (
          <strong className="shoot-count" key={`${phase}-${webcam?.count ? "snap" : ""}${centerCount}`} role="timer" aria-live="assertive">
            {centerCount}
          </strong>
        ) : null}
        {shooting && !full && (testing ? (
          <button type="button" className="shoot-press shoot-snap" disabled={Boolean(webcam.count)} onClick={webcam.onSnap}>
            <PiCameraBold aria-hidden="true" />
            <strong>{webcam.count ? "Chuẩn bị…" : "Chạm để chụp"}</strong>
          </button>
        ) : (
          <div className="shoot-press" role="status">
            <PiHandTapBold aria-hidden="true" />
            <strong>{t("shoot.press")}</strong>
          </div>
        ))}
        {flash > 0 && <div className="camera-flash" key={flash} aria-hidden="true" />}
        {ending && (
          <div className="shoot-ending" role="status">
            <span className="spinner big" aria-hidden="true" />
          </div>
        )}
      </div>

      <aside className="shoot-rail" aria-label="Thời gian và ảnh đã chụp">
          {/* Còn dưới 1 phút: đồng hồ đỏ, nhấp nháy (như Selfbooth). */}
          <div className={`shoot-timer${phase === "shoot" && sessionLeft < 60 ? " is-urgent" : ""}`} role="timer">
            <span>THỜI GIAN CÒN LẠI</span>
            <strong>{phase === "ready" ? "—" : clock(sessionLeft)}</strong>
            <div className="shoot-progress">
              <small>
                Đã chụp <b>{Math.min(taken, quota || taken)}</b>/{quota || "∞"} tấm
              </small>
              {quota > 0 && (
                <i aria-hidden="true">
                  <b style={{ width: `${progress}%` }} />
                </i>
              )}
            </div>
          </div>
          <ol className="shoot-thumbs" ref={rail} aria-label="Ảnh vừa chụp, mới nhất ở trên">
            {receiving && (
              <li className="shoot-thumb-pending" role="status">
                <span className="spinner" aria-hidden="true" />
                Đang nhận ảnh…
              </li>
            )}
            {[...shots].reverse().map((shot, i) => (
              <li key={shot.key} className={i === 0 && !receiving ? "is-newest" : ""}>
                <Thumb shot={shot} />
                <b className="shoot-thumb-no">{shots.length - i}</b>
              </li>
            ))}
            {!shots.length && !receiving && (
              <li className="shoot-thumbs-empty">
                <PiImagesDuotone aria-hidden="true" />
                Ảnh vừa chụp sẽ hiện ở đây
              </li>
            )}
          </ol>
          {phase === "shoot" && !ending && (
            <div className="shoot-end-wrap">
              <button type="button" className="shoot-end" onClick={onEnd} disabled={!taken} aria-label="Chụp xong, chọn ảnh">
                <PiCheckBold aria-hidden="true" />
                <span>Chụp xong</span>
              </button>
              {!taken && <small>Chụp ít nhất 1 tấm</small>}
            </div>
          )}
      </aside>
    </section>
  );
}
