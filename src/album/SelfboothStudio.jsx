// Phòng Selfbooth (Polaroid, khổ Instax): chụp xong, máy chụp chỉ hiện mã QR. Khách quét rồi trên điện thoại:
// thả tim ảnh ưng ý (đủ số ô của layout), làm đẹp từng ảnh — mịn da, trắng da, thon mặt, má hồng, bộ lọc màu
// (beauty.js, như Selfbooth, nhận diện khuôn mặt ngay trên máy) —, chọn khung, xem trước rồi bấm In: tấm Instax
// gửi tới máy in cạnh máy chụp (cùng đường in của máy chụp: /albums/:token/print-pack).
// Thời gian do máy chủ đặt từ lần mở đầu tiên (POST /albums/:token/edit-start, mặc định 250 giây — cùng cài đặt
// "Thời gian chọn ảnh"); hết giờ thì tự gửi in những gì đang chọn.
import { useEffect, useMemo, useRef, useState } from "react";
import { PiArrowLeftBold, PiCheckBold, PiHeartFill, PiHeartBold, PiPrinterBold, PiSlidersHorizontalBold, PiTimerBold } from "react-icons/pi";
import { api } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { ADJUST_LABELS, COLOR_FILTERS, DEFAULT_ADJUST, FILTER_CSS, applyBeauty, detectFaces, isNeutral, warmFaceModel } from "../beauty.js";
import { composePreview, frameCandidates, printSheets, renderPrintFrame } from "../kiosk/compose.js";
import { fetchMediaBlob, storageLink } from "../media-delivery.js";
import { PhotoThumb, photoUrl } from "./photo-thumb.jsx";
import { printPackUpload } from "./print-upload.js";
import { AlbumViewer } from "./AlbumViewer.jsx";

const needsFaces = (a) => ["smooth", "whiten", "slim", "blush"].some((k) => Number(a?.[k]) > 0);
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Trạng thái lưu trên máy (tải lại trang vẫn giữ): ảnh đã thả tim, chỉnh của từng ảnh, khung, mã lệnh in.
function useSaved(key, initial) {
  const [value, setValue] = useState(() => {
    try { return { ...initial, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* chế độ riêng tư: chỉ giữ trong trang */ }
  }, [key, value]);
  return [value, (changes) => setValue((v) => ({ ...v, ...changes }))];
}

// Ảnh của album theo cỡ ("preview" 1600 px để chỉnh, "print" 3000 px để in), dùng chung giữa các bước.
const bitmaps = new Map();
const faceCache = new Map();
function sourceOf(token, photo, size) {
  const key = `${photo.id}|${size}`;
  if (!bitmaps.has(key))
    bitmaps.set(key, fetchMediaBlob(photoUrl(token, photo.id, size), { link: storageLink(photo, size) || undefined })
      .then((blob) => createImageBitmap(blob))
      .catch((error) => { bitmaps.delete(key); throw error; }));
  return bitmaps.get(key);
}
// Khuôn mặt nhận diện trên ảnh 1600 px (một lần mỗi ảnh); không thấy mặt / không tải được mô hình: [].
function facesOf(token, photo) {
  if (!faceCache.has(photo.id))
    faceCache.set(photo.id, sourceOf(token, photo, "preview").then((image) => detectFaces(image))
      .catch((error) => { faceCache.delete(photo.id); throw error; }));
  return faceCache.get(photo.id);
}
const scaled = (faces, k) => faces.map((face) => face.map((p) => ({ ...p, x: p.x * k, y: p.y * k })));
// Ảnh đã làm đẹp ở cỡ cần dùng (canvas). Mặt nhận diện trên ảnh xem trước, đổi tỉ lệ cho ảnh in.
async function edited(token, photo, adjust, size = "preview") {
  const image = await sourceOf(token, photo, size);
  if (isNeutral({ ...DEFAULT_ADJUST, ...adjust })) return applyBeauty(image, [], DEFAULT_ADJUST);
  let faces = [];
  if (needsFaces(adjust)) {
    const preview = await sourceOf(token, photo, "preview");
    faces = scaled(await facesOf(token, photo).catch(() => []), image.width / preview.width);
  }
  return applyBeauty(image, faces, adjust);
}

function Editor({ token, photo, adjust, onChange, onClose }) {
  const view = useRef(null);
  const [status, setStatus] = useState("loading");
  const [tab, setTab] = useState("smooth");
  const a = { ...DEFAULT_ADJUST, ...adjust };
  const turn = useRef(0);
  useEffect(() => { warmFaceModel(); }, []);
  // Vẽ lại ảnh xem trước mỗi lần đổi mức chỉnh (lần mới nhất thắng).
  useEffect(() => {
    const mine = ++turn.current;
    const run = async () => {
      if (needsFaces(a) && !faceCache.has(photo.id)) setStatus("faces");
      try {
        const canvas = await edited(token, photo, a);
        if (mine !== turn.current || !view.current) return;
        view.current.width = canvas.width;
        view.current.height = canvas.height;
        view.current.getContext("2d").drawImage(canvas, 0, 0);
        canvas.width = canvas.height = 0;
        const faces = needsFaces(a) ? await facesOf(token, photo).catch(() => []) : null;
        if (mine === turn.current) setStatus(faces && !faces.length ? "noface" : "ready");
      } catch (error) {
        if (mine === turn.current) setStatus(error.code === "FACE_DETECTION_UNAVAILABLE" ? "nomodel" : "error");
      }
    };
    const frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [photo.id, JSON.stringify(a)]);
  return (
    <div className="studio-editor" role="dialog" aria-modal="true" aria-label={`Làm đẹp ảnh ${photo.number}`}>
      <header>
        <button type="button" onClick={onClose} aria-label="Đóng"><PiArrowLeftBold aria-hidden="true" /></button>
        <strong>Làm đẹp ảnh #{String(photo.number).padStart(2, "0")}</strong>
        <button type="button" onClick={() => onChange(DEFAULT_ADJUST)} disabled={isNeutral(a)}>Ảnh gốc</button>
      </header>
      <div className="studio-editor-view">
        <canvas ref={view} aria-label="Ảnh xem trước" />
        {status === "loading" && <p className="studio-editor-note" role="status">Đang mở ảnh…</p>}
        {status === "faces" && <p className="studio-editor-note" role="status">Đang nhận diện khuôn mặt…</p>}
        {status === "noface" && <p className="studio-editor-note">Không thấy khuôn mặt rõ — vẫn đổi được bộ lọc màu.</p>}
        {status === "nomodel" && <p className="studio-editor-note">Chưa tải được bộ làm đẹp — kiểm tra mạng rồi thử lại.</p>}
        {status === "error" && <p className="studio-editor-note">Không mở được ảnh — thử lại sau ít giây.</p>}
      </div>
      <div className="studio-editor-tabs" role="tablist" aria-label="Làm đẹp">
        {Object.entries(ADJUST_LABELS).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}{a[key] > 0 && <b>{a[key]}</b>}
          </button>
        ))}
      </div>
      <label className="studio-editor-slider">
        <span>{ADJUST_LABELS[tab]}</span>
        <input type="range" min={0} max={100} step={5} value={a[tab]} aria-label={ADJUST_LABELS[tab]}
          onChange={(e) => onChange({ ...a, [tab]: Number(e.target.value) })} />
      </label>
      <div className="studio-editor-filters" role="radiogroup" aria-label="Bộ lọc màu">
        {Object.entries(COLOR_FILTERS).map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={a.filter === key} onClick={() => onChange({ ...a, filter: key })}>
            <PhotoThumb photo={photo} token={token} alt="" style={{ filter: FILTER_CSS[key] || "none" }} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <Button onClick={onClose}><PiCheckBold aria-hidden="true" /> Xong</Button>
    </div>
  );
}

// Khung ghép sẵn ảnh đã chọn (đã làm đẹp) để xem / chọn.
function FramePreview({ frame, images, className = "", label }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    if (!images.length) return;
    composePreview(frame, images, 720).then((canvas) => {
      if (alive) setSrc(canvas.toDataURL("image/jpeg", 0.88));
      canvas.width = canvas.height = 0;
    }).catch(() => {});
    return () => { alive = false; };
  }, [frame._id, images]);
  return src ? <img className={className} src={src} alt={label} /> : <span className={`${className} is-loading`} role="status">Đang ghép…</span>;
}

export function SelfboothStudio({ token, booking, reload }) {
  const toast = useToast();
  const { frames: catalog = [] } = useStudio();
  const photos = useMemo(() => booking.photos.filter((p) => p.kind === "original"), [booking.photos]);
  const need = Math.max(1, Number(booking.selectCount) || 1);
  const frames = useMemo(() => frameCandidates(catalog.filter((f) => f.active !== false), { count: need, printSize: "instax" })
    .filter((f) => (f.printSize || "full") === "instax"), [catalog, need]);
  const alreadyPrinted = (Number(booking.printSheets) || 0) >= (Number(booking.prints) || 1);
  const [saved, save] = useSaved(`selfbooth-v1-${token}`, { hearts: [], adjusts: {}, frameId: "", requestKey: crypto.randomUUID() });
  const [step, setStep] = useState("photos");
  const [editing, setEditing] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [result, setResult] = useState(alreadyPrinted ? { sent: true } : null);
  const [error, setError] = useState("");
  const hearts = saved.hearts.filter((id) => photos.some((p) => String(p.id) === id)).slice(0, need);
  const frame = frames.find((f) => f._id === saved.frameId) || frames[0];

  // Hạn chọn ảnh do máy chủ đặt (bù đồng hồ lệch của điện thoại).
  const [deadline, setDeadline] = useState(null);
  const offset = useRef(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (alreadyPrinted) return;
    const sent = Date.now();
    api(`/albums/${token}/edit-start`, { method: "POST" }).then((r) => {
      offset.current = Number(r.serverTime) - (sent + Date.now()) / 2 || 0;
      setDeadline(new Date(r.editEndsAt).getTime());
      setNow(Date.now());
    }).catch(() => {});
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [token, alreadyPrinted]);
  const left = deadline ? Math.max(0, Math.ceil((deadline - (now + offset.current)) / 1000)) : null;

  // Ảnh đã thả tim (đã làm đẹp, cỡ xem trước) cho khung xem trước.
  const [images, setImages] = useState([]);
  const adjustKey = JSON.stringify(hearts.map((id) => saved.adjusts[id] || null));
  useEffect(() => {
    let alive = true;
    const chosen = hearts.map((id) => photos.find((p) => String(p.id) === id)).filter(Boolean);
    Promise.all(chosen.map((p) => edited(token, p, saved.adjusts[p.id]).then((c) => createImageBitmap(c))))
      .then((list) => alive && setImages(list)).catch(() => {});
    return () => { alive = false; };
  }, [hearts.join(), adjustKey]);

  function toggleHeart(photo) {
    const id = String(photo.id);
    if (hearts.includes(id)) return save({ hearts: hearts.filter((h) => h !== id) });
    if (hearts.length >= need) return toast.warning(`Layout này in ${need} ảnh — bỏ tim một ảnh trước nhé.`);
    save({ hearts: [...hearts, id] });
  }

  async function print({ auto = false } = {}) {
    if (printing || result) return;
    if (!frame) return setError("Tiệm chưa có khung Instax cho layout này — nhờ nhân viên in giúp bạn.");
    // Hết giờ mà chưa đủ tim: thêm các ảnh đầu cho đủ.
    const ids = [...hearts];
    for (const p of photos) if (ids.length < need && !ids.includes(String(p.id))) ids.push(String(p.id));
    const chosen = ids.map((id) => photos.find((p) => String(p.id) === id)).filter(Boolean);
    if (!chosen.length) return;
    setPrinting(true);
    setError("");
    try {
      const shots = [];
      for (const photo of chosen) {
        const canvas = await edited(token, photo, saved.adjusts[photo.id], "print");
        const image = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
        canvas.width = canvas.height = 0;
        shots.push({ key: String(photo.id), image, mirrored: false });
      }
      const sheet = await renderPrintFrame(frame, shots, token, `${location.origin}/album/${token}`, { scale: 1 });
      const composite = sheet.toDataURL("image/jpeg", 0.9);
      const [instax] = await printSheets(sheet, frame, 1, "instax");
      sheet.width = sheet.height = 0;
      await api(`/albums/${token}/print-pack`, printPackUpload({
        images: [instax], frameName: frame.themeName?.trim() || frame.name || "Khung ảnh", requestKey: saved.requestKey,
      }));
      setResult({ sent: true, composite });
      reload?.();
      if (auto) toast.info("Hết thời gian chọn ảnh — đã gửi in những ảnh bạn đang chọn.");
    } catch (e) {
      // Lượt này đã in (gửi lại từ máy khác / lần trước mất kết nối): coi như đã gửi.
      if (e.status === 409 && /tờ|in/.test(e.message)) setResult({ sent: true });
      else setError(e.message || "Chưa gửi in được — thử lại nhé.");
    } finally {
      setPrinting(false);
    }
  }
  const autoTried = useRef(false);
  useEffect(() => {
    if (left === 0 && !result && !autoTried.current) {
      autoTried.current = true;
      print({ auto: true });
    }
  }, [left]);

  if (result)
    return (
      <section className="selfbooth-studio is-done">
        <div className="studio-result">
          <h2>Đã gửi in!</h2>
          <p>Lấy ảnh ở máy Instax cạnh máy chụp — ảnh hiện màu dần sau ít phút.</p>
          {result.composite && (
            <>
              <img src={result.composite} alt="Ảnh đã ghép khung" />
              <a className="button" href={result.composite} download={`Mellow-${booking.code}.jpg`}>Tải ảnh ghép</a>
            </>
          )}
        </div>
        <AlbumViewer token={token} booking={booking} />
      </section>
    );

  const editingPhoto = photos.find((p) => String(p.id) === editing);
  return (
    <section className="selfbooth-studio">
      <header className="studio-head">
        <div>
          <h2>{step === "photos" ? "Thả tim ảnh để in" : step === "frame" ? "Chọn khung" : "Xem lại & in"}</h2>
          <p>{step === "photos"
            ? `Chọn ${need} ảnh · đã chọn ${hearts.length}/${need} · chạm ảnh để làm đẹp`
            : step === "frame" ? "Chạm một khung để chọn" : "Ảnh in ra đúng như bên dưới"}</p>
        </div>
        {left !== null && (
          <span className={`studio-timer${left <= 30 ? " is-urgent" : ""}`} role="timer" aria-label={`Còn ${clock(left)}`}>
            <PiTimerBold aria-hidden="true" /> {clock(left)}
          </span>
        )}
      </header>
      <ErrorBox error={error} />
      {step === "photos" && (
        <ul className="studio-photos" aria-label="Ảnh vừa chụp">
          {[...photos].reverse().map((photo) => {
            const order = hearts.indexOf(String(photo.id)) + 1;
            const tuned = !isNeutral({ ...DEFAULT_ADJUST, ...saved.adjusts[photo.id] });
            return (
              <li key={photo.id} className={order ? "is-hearted" : ""}>
                <button type="button" className="studio-photo" onClick={() => setEditing(String(photo.id))} aria-label={`Làm đẹp ảnh ${photo.number}`}>
                  <PhotoThumb photo={photo} token={token} alt="" loading="lazy" decoding="async" />
                  {tuned && <span className="studio-tuned"><PiSlidersHorizontalBold aria-hidden="true" /> Đã làm đẹp</span>}
                </button>
                <button type="button" className="studio-heart" aria-pressed={Boolean(order)} onClick={() => toggleHeart(photo)}
                  aria-label={order ? `Bỏ tim ảnh ${photo.number}` : `Thả tim ảnh ${photo.number}`}>
                  {order ? <PiHeartFill aria-hidden="true" /> : <PiHeartBold aria-hidden="true" />}
                  {order > 0 && need > 1 && <b>{order}</b>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {step === "frame" && (
        <div className="studio-frames" role="radiogroup" aria-label="Khung">
          {frames.map((f) => (
            <button key={f._id} type="button" role="radio" aria-checked={frame?._id === f._id} onClick={() => save({ frameId: f._id })}>
              <FramePreview frame={f} images={images} label={f.name} />
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      )}
      {step === "print" && frame && (
        <div className="studio-print">
          <FramePreview frame={frame} images={images} className="studio-print-preview" label="Ảnh in xem trước" />
        </div>
      )}
      <footer className="studio-foot">
        {step !== "photos" && (
          <Button className="outline" onClick={() => setStep(step === "print" && frames.length > 1 ? "frame" : "photos")}>
            <PiArrowLeftBold aria-hidden="true" /> Quay lại
          </Button>
        )}
        {step === "photos" && (
          <Button disabled={hearts.length < need} onClick={() => setStep(frames.length > 1 ? "frame" : "print")}>
            Tiếp tục <PiCheckBold aria-hidden="true" />
          </Button>
        )}
        {step === "frame" && <Button onClick={() => setStep("print")}>Xem lại <PiCheckBold aria-hidden="true" /></Button>}
        {step === "print" && (
          <Button disabled={printing} onClick={() => print()}>
            <PiPrinterBold aria-hidden="true" /> {printing ? "Đang gửi in…" : "In ảnh"}
          </Button>
        )}
      </footer>
      {editingPhoto && (
        <Editor token={token} photo={editingPhoto} adjust={saved.adjusts[editingPhoto.id]}
          onChange={(a) => save({ adjusts: { ...saved.adjusts, [editingPhoto.id]: a } })}
          onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
