import { useEffect, useRef, useState } from "react";
import {
  PiCheckBold,
  PiImagesDuotone,
} from "react-icons/pi";
import { playCountdownBeep, playShutterSound } from "./kiosk-audio.js";

// Ảnh trên máy (Blob) hoặc trên máy chủ (URL).
export function useObjectUrl(source) {
  const [object, setObject] = useState(null);
  useEffect(() => {
    if (!(source instanceof Blob)) {
      setObject(null);
      return;
    }
    const next = URL.createObjectURL(source);
    setObject({ source, url: next });
    return () => URL.revokeObjectURL(next);
  }, [source]);
  // Never expose the previous guest's URL while the next effect is waiting.
  return typeof source === "string" ? source : object && object.source === source ? object.url : "";
}
function Thumb({ shot }) {
  const src = useObjectUrl(shot.preview);
  return src ? <img src={src} alt="" /> : <span className="shoot-thumb-empty" />;
}
// Màn hình đứng (kiosk màn dọc): ảnh vừa chụp hiện toàn màn shoot-stage.
function usePortrait() {
  const query = "(orientation: portrait)";
  const [portrait, setPortrait] = useState(() => globalThis.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = globalThis.matchMedia?.(query);
    if (!media) return;
    const change = () => setPortrait(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return portrait;
}
// Ảnh vừa chụp, hiện toàn màn shoot-stage (thay thế live view).
function LatestFull({ shot, number, receiving }) {
  const src = useObjectUrl(shot?.preview);
  return (
    <figure className="shoot-latest-full" aria-label="Ảnh vừa chụp">
      {src ? (
        <img key={src} src={src} alt={`Ảnh ${number} vừa chụp`} />
      ) : (
        <span className="shoot-latest-full-empty">
          <PiImagesDuotone aria-hidden="true" />
          Ảnh vừa chụp sẽ hiện ở đây
        </span>
      )}
      {src && <b className="shoot-latest-no">Ảnh {number}</b>}
      {receiving && (
        <span className="shoot-latest-pending" role="status">
          <span className="spinner" aria-hidden="true" /> Đang nhận ảnh…
        </span>
      )}
    </figure>
  );
}
const clock = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// Màn chụp: ảnh vừa chụp toàn màn hình (shoot-stage), không có live view. Bên dưới (shoot-rail):
// đồng hồ, dải ảnh thumbnail nhỏ, nút "Chụp xong". webcam: chế độ thử máy bằng webcam máy tính
// (khi không có máy ảnh) — { on, label, count (đếm ngược), onSnap, onToggle }.
// minShots: số ảnh layout cần — chưa đủ thì chưa bấm "Chụp xong" được.
export function KioskShoot({
  videoRef,
  zoom,
  ready,
  phase,
  preCount,
  showCountdown = true,
  sessionLeft,
  taken,
  quota,
  shots,
  flash,
  receiving,
  ending,
  onEnd,
  onReopenCamera,
  cameraIssue = null,
  cameraOpening = false,
  webcam = null,
  canvasPreview = false,
  mirror = false,
  rotation = 0,
  minShots = 1,
}) {
  const portrait = usePortrait();
  const enough = taken >= Math.max(1, minShots);
  // Không dùng live view — shoot-stage luôn hiện ảnh vừa chụp.
  const shooting = phase === "shoot" && !ending;
  const full = Boolean(quota) && taken >= quota;
  const testing = Boolean(webcam?.on);
  const centerCount =
    showCountdown && phase === "ready"
      ? preCount
      : webcam?.count
        ? webcam.count
        : showCountdown && shooting && sessionLeft > 0 && sessionLeft <= 3
          ? sessionLeft : null;
  // Thử máy bằng webcam (không có dây bấm): bấm phím Space / Enter để chụp.
  useEffect(() => {
    if (!testing || !shooting || full) return;
    const onKey = (event) => {
      if (!["Space", "Enter", "NumpadEnter"].includes(event.code) || event.repeat) return;
      if (/input|textarea|select|button/i.test(event.target?.tagName || "")) return;
      event.preventDefault();
      if (!webcam.count) webcam.onSnap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [testing, shooting, full, webcam]);
  // Ảnh mới nhất: có ảnh mới thì cuộn thumbnail về đầu để khách thấy ngay.
  const rail = useRef(null);
  useEffect(() => {
    rail.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, [shots.length, receiving]);
  const progress = quota ? Math.min(100, (Math.min(taken, quota) / quota) * 100) : 0;
  // Phát âm thanh đếm ngược "3, 2, 1"
  const lastCount = useRef(null);
  useEffect(() => {
    if (centerCount && centerCount !== lastCount.current) {
      lastCount.current = centerCount;
      playCountdownBeep(centerCount);
    } else if (!centerCount) {
      lastCount.current = null;
    }
  }, [centerCount]);

  // Nháy trắng và phát tiếng màn trập lúc chụp.
  const [flashing, setFlashing] = useState(0);
  const lastFlash = useRef(flash);
  useEffect(() => {
    if (!flash || flash === lastFlash.current) return;
    lastFlash.current = flash;
    setFlashing(flash);
    playShutterSound();
    const timer = setTimeout(() => setFlashing(0), 400);
    return () => clearTimeout(timer);
  }, [flash]);
  return (
    <section className={`shoot-screen phase-${phase}${portrait ? " is-portrait" : ""}`}>
      {/* Vùng chính: ảnh vừa chụp toàn màn, không có live view */}
      <div className="shoot-stage">
        <LatestFull shot={shots[shots.length - 1]} number={shots.length} receiving={receiving} />
        {centerCount ? (
          <strong className="shoot-count" key={`${phase}-${webcam?.count ? "snap" : ""}${centerCount}`} role="timer" aria-live="assertive">
            {centerCount}
          </strong>
        ) : null}
        {flashing > 0 && (
          <div className="camera-flash" key={flashing} aria-hidden="true" onAnimationEnd={() => setFlashing(0)} />
        )}
        {(ending || (!showCountdown && phase === "ready")) && (
          <div className="shoot-ending" role="status" aria-label={ending ? "Đang nhận ảnh" : "Đang mở lượt chụp"}>
            <span className="spinner big" aria-hidden="true" />
          </div>
        )}
      </div>

      {/* Rail phía dưới: đồng hồ, thumbnail nhỏ, nút Chụp xong */}
      <aside className="shoot-rail" aria-label="Thời gian và ảnh đã chụp">
          {/* Còn dưới 1 phút: đồng hồ đỏ, nhấp nháy. */}
          <div className={`shoot-timer${phase === "shoot" && sessionLeft < 60 ? " is-urgent" : ""}`} role="timer">
            <span>THỜI GIAN CÒN LẠI</span>
            <strong>{phase === "ready" ? "—" : clock(sessionLeft)}</strong>
            <div className="shoot-progress">
              <small>
                {!quota ? <>Đã chụp <b>{taken}</b> ảnh</>
                  : <>Đã chụp <b>{Math.min(taken, quota || taken)}</b>/{quota || "∞"} tấm</>}
              </small>
              {quota > 0 && (
                <i aria-hidden="true">
                  <b style={{ width: `${progress}%` }} />
                </i>
              )}
            </div>
          </div>
          <ol className="shoot-thumbs" ref={rail}
            aria-label="Ảnh vừa chụp, mới nhất ở trên">
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
              <button type="button" className="shoot-end" onClick={onEnd} disabled={!enough} aria-label="Chụp xong, chọn ảnh">
                <PiCheckBold aria-hidden="true" />
                <span>Chụp xong</span>
              </button>
              {!enough && <small>Chụp ít nhất {Math.max(1, minShots)} tấm</small>}
            </div>
          )}
      </aside>
    </section>
  );
}
