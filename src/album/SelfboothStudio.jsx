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
import { ADJUST_LABELS, COLOR_FILTERS, DEFAULT_ADJUST, FILTER_CSS, isNeutral, warmFaceModel } from "../beauty.js";
import { composeFrameTile, composePreview, frameCandidates, printSheets, renderPrintFrame } from "../kiosk/compose.js";
import { onNetworkRecovery } from "../network.js";
import { PhotoThumb } from "./photo-thumb.jsx";
import { printPackUpload } from "./print-upload.js";
import { AlbumViewer } from "./AlbumViewer.jsx";
import { createStudioMedia, needsFaces } from './studio-media.js';

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

function Editor({ token, media, photo, adjust, onChange, onClose }) {
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
      if (needsFaces(a)) setStatus("faces");
      try {
        const canvas = await media.edited(photo, a, 'preview', { isCurrent: () => mine === turn.current });
        if (mine !== turn.current || !view.current) { canvas.width = canvas.height = 0; return; }
        view.current.width = canvas.width;
        view.current.height = canvas.height;
        view.current.getContext("2d").drawImage(canvas, 0, 0);
        canvas.width = canvas.height = 0;
        const faces = needsFaces(a) ? await media.facesOf(photo) : null;
        if (mine === turn.current) setStatus(faces && !faces.length ? "noface" : "ready");
      } catch (error) {
        if (mine === turn.current) setStatus(error.code === "FACE_DETECTION_UNAVAILABLE" ? "nomodel" : "error");
      }
    };
    const frame = setTimeout(run, 80);
    return () => { turn.current++; clearTimeout(frame); };
  }, [media, photo.id, JSON.stringify(a)]);
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
function FramePreview({ frame, images, className = "", label, tile = false }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setSrc('');
    if (!images.length) return;
    const render = tile ? composeFrameTile(frame, images, { signal: controller.signal, placeholders: false })
      : composePreview(frame, images, 720, '', { signal: controller.signal });
    render.then((canvas) => {
      if (!controller.signal.aborted) setSrc(canvas.toDataURL("image/jpeg", 0.88));
      canvas.width = canvas.height = 0;
    }).catch(() => {});
    return () => controller.abort();
  }, [frame, images, tile]);
  return src ? <img className={className} src={src} alt={label} /> : <span className={`${className} is-loading`} role="status">Đang ghép…</span>;
}

export function SelfboothStudio({ token, booking, reload }) {
  const toast = useToast();
  const { frames: catalog = [] } = useStudio();
  const media = useMemo(() => createStudioMedia(token), [token]);
  useEffect(() => () => media.clear(), [media]);
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
  const minimum = Math.min(need, photos.length);
  const printIds = [...hearts];
  for (const photo of photos) if (printIds.length < need && !printIds.includes(String(photo.id))) printIds.push(String(photo.id));
  const printPhotos = printIds.map(id => photos.find(photo => String(photo.id) === id)).filter(Boolean);
  const originalsReady = printPhotos.length > 0 && printPhotos.every(photo => !photo.originalPending);
  const pendingOriginals = photos.filter(photo => photo.originalPending).length;
  const printLock = useRef(false);
  const preparedPrint = useRef(null);
  const [retry, setRetry] = useState(0);

  // Hạn chọn ảnh do máy chủ đặt (bù đồng hồ lệch của điện thoại).
  const [deadline, setDeadline] = useState(null);
  const [deadlineError, setDeadlineError] = useState('');
  const offset = useRef(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (alreadyPrinted || !photos.length) return;
    let alive = true, running = false, retryTimer;
    const start = async () => {
      if (running || !alive) return;
      running = true;
      clearTimeout(retryTimer);
      const sent = Date.now();
      try {
        const r = await api(`/albums/${token}/edit-start`, { method: 'POST' });
        if (!alive) return;
        const endsAt = new Date(r.editEndsAt).getTime();
        if (!Number.isFinite(endsAt)) throw new Error('Chưa nhận được thời gian chọn ảnh. Đang kết nối lại…');
        offset.current = Number(r.serverTime) - (sent + Date.now()) / 2 || 0;
        setDeadline(endsAt);
        setDeadlineError('');
        setNow(Date.now());
      } catch (e) {
        if (alive) { setDeadlineError(e.message); retryTimer = setTimeout(start, 5000); }
      } finally { running = false; }
    };
    start();
    const recover = onNetworkRecovery(start);
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => { alive = false; clearInterval(timer); clearTimeout(retryTimer); recover(); };
  }, [token, alreadyPrinted, Boolean(photos.length)]);
  const left = deadline ? Math.max(0, Math.ceil((deadline - (now + offset.current)) / 1000)) : null;

  // Ảnh đã thả tim (đã làm đẹp, cỡ xem trước) cho khung xem trước.
  const [images, setImages] = useState([]);
  const adjustKey = JSON.stringify(hearts.map((id) => saved.adjusts[id] || null));
  useEffect(() => {
    let alive = true;
    const chosen = hearts.map((id) => photos.find((p) => String(p.id) === id)).filter(Boolean);
    const list = [];
    (async () => {
      for (const p of chosen) {
        const canvas = await media.edited(p, saved.adjusts[p.id], 'preview', { isCurrent: () => alive });
        list.push(canvas);
        if (!alive) { list.forEach(image => { image.width = image.height = 0; }); return; }
      }
      setImages(list);
    })().catch(() => list.forEach(image => { image.width = image.height = 0; }));
    return () => { alive = false; };
  }, [media, hearts.join(), adjustKey]);

  const autoTried = useRef(false);
  useEffect(() => onNetworkRecovery(() => { autoTried.current = false; setRetry(n => n + 1); }), []);
  const locked = printing || Boolean(preparedPrint.current);

  function toggleHeart(photo) {
    if (locked || left === 0) return;
    const id = String(photo.id);
    if (hearts.includes(id)) return save({ hearts: hearts.filter((h) => h !== id) });
    if (hearts.length >= need) return toast.warning(`Layout này in ${need} ảnh — bỏ tim một ảnh trước nhé.`);
    save({ hearts: [...hearts, id] });
  }

  async function print({ auto = false } = {}) {
    if (printLock.current || result) return;
    if (!frame) return setError("Tiệm chưa có khung Instax cho layout này — nhờ nhân viên in giúp bạn.");
    // Hết giờ mà chưa đủ tim: thêm các ảnh đầu cho đủ.
    const chosen = printPhotos;
    if (!chosen.length) return;
    if (!deadline) return setError('Đang đồng bộ thời gian chọn ảnh. Vui lòng đợi kết nối lại.');
    if (chosen.some(photo => photo.originalPending))
      return setError('Ảnh gốc đang tải lên. Khi ảnh sẵn sàng, bạn có thể gửi in với đầy đủ chất lượng.');
    printLock.current = true;
    setEditing(null);
    setPrinting(true);
    setError("");
    try {
      const lookup = () => api(`/albums/${token}/print?requestKey=${saved.requestKey}`, { allowNull: true });
      if (await lookup()) { setResult({ sent: true }); reload?.(); return; }
      if (!preparedPrint.current) {
        const shots = chosen.map(photo => ({ key: String(photo.id), photo }));
        const sheet = await renderPrintFrame(frame, shots, token, `${location.origin}/album/${token}`, {
          scale: 1, sharp: true,
          sourceFor: shot => media.edited(shot.photo, saved.adjusts[shot.photo.id], 'print'),
        });
        try {
          const composite = sheet.toDataURL('image/jpeg', 0.95);
          const [instax] = await printSheets(sheet, frame, 1, 'instax');
          preparedPrint.current = { composite, options: printPackUpload({
            images: [instax], frameName: frame.themeName?.trim() || frame.name || 'Khung ảnh', requestKey: saved.requestKey,
          }) };
        } finally { sheet.width = sheet.height = 0; }
      }
      await api(`/albums/${token}/print-pack`, preparedPrint.current.options);
      setResult({ sent: true, composite: preparedPrint.current.composite });
      preparedPrint.current = null;
      reload?.();
      if (auto) toast.info("Hết thời gian chọn ảnh — đã gửi in những ảnh bạn đang chọn.");
    } catch (e) {
      // A conflict can also mean changed content or a job still being saved.
      // Only a real saved print job proves the earlier request succeeded.
      const previous = e.status === 409 && await api(`/albums/${token}/print?requestKey=${saved.requestKey}`, { allowNull: true }).catch(() => null);
      if (previous) { setResult({ sent: true, composite: preparedPrint.current?.composite }); preparedPrint.current = null; reload?.(); }
      else {
        if (e.status === 400) preparedPrint.current = null;
        setError(e.message || 'Chưa gửi in được — thử lại nhé.');
      }
    } finally {
      printLock.current = false;
      setPrinting(false);
    }
  }
  const autoReady = frame && originalsReady;
  useEffect(() => {
    if (left === 0 && !result && autoReady && !autoTried.current) {
      autoTried.current = true;
      print({ auto: true });
    }
  }, [left, Boolean(autoReady), frame?._id, retry]);

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
            : step === "frame" ? "Chạm một khung để chọn" : "Xem lại ảnh trước khi gửi in"}</p>
        </div>
        {left !== null && (
          <span className={`studio-timer${left <= 30 ? " is-urgent" : ""}`} role="timer" aria-label={`Còn ${clock(left)}`}>
            <PiTimerBold aria-hidden="true" /> {clock(left)}
          </span>
        )}
      </header>
      <ErrorBox error={error} />
      {deadlineError && <p className="studio-status is-warn" role="status">{deadlineError} — đang tự kết nối lại.</p>}
      {!frames.length && <p className="studio-status is-warn" role="status">Chưa có khung cho layout này. Nhờ nhân viên kiểm tra khung Instax trước khi in.</p>}
      {!photos.length && <p className="studio-status" role="status">Đang nhận ảnh từ máy chụp. Ảnh sẽ tự xuất hiện tại đây.</p>}
      {pendingOriginals > 0 && <p className="studio-status" role="status">Đang nhận {pendingOriginals} ảnh gốc chất lượng cao. Bạn vẫn chọn ảnh và làm đẹp được; bản in sẽ đợi ảnh gốc.</p>}
      {photos.length > 0 && photos.length < need && <p className="studio-status">Album hiện có {photos.length} ảnh. Ảnh bạn chọn sẽ được lặp để đủ {need} ô của khung.</p>}
      {step === "photos" && (
        <ul className="studio-photos" aria-label="Ảnh vừa chụp">
          {[...photos].reverse().map((photo) => {
            const order = hearts.indexOf(String(photo.id)) + 1;
            const tuned = !isNeutral({ ...DEFAULT_ADJUST, ...saved.adjusts[photo.id] });
            return (
              <li key={photo.id} className={order ? "is-hearted" : ""}>
                <button type="button" className="studio-photo" disabled={locked || left === 0} onClick={() => setEditing(String(photo.id))} aria-label={`Làm đẹp ảnh ${photo.number}`}>
                  <PhotoThumb photo={photo} token={token} alt="" loading="lazy" decoding="async" />
                  {tuned && <span className="studio-tuned"><PiSlidersHorizontalBold aria-hidden="true" /> Đã làm đẹp</span>}
                </button>
                <button type="button" className="studio-heart" disabled={locked || left === 0} aria-pressed={Boolean(order)} onClick={() => toggleHeart(photo)}
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
            <button key={f._id} type="button" role="radio" disabled={locked || left === 0} aria-checked={frame?._id === f._id} onClick={() => save({ frameId: f._id })}>
              <FramePreview frame={f} images={images} label={f.name} tile />
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
          <Button className="outline" disabled={locked} onClick={() => setStep(step === "print" && frames.length > 1 ? "frame" : "photos")}>
            <PiArrowLeftBold aria-hidden="true" /> Quay lại
          </Button>
        )}
        {step === "photos" && !(left === 0 && error) && (
          <Button disabled={locked || left === 0 || !photos.length || hearts.length < minimum} onClick={() => setStep(frames.length > 1 ? "frame" : "print")}>
            Tiếp tục <PiCheckBold aria-hidden="true" />
          </Button>
        )}
        {step === "frame" && !(left === 0 && error) && <Button disabled={locked || left === 0} onClick={() => setStep("print")}>Xem lại <PiCheckBold aria-hidden="true" /></Button>}
        {(step === "print" || (left === 0 && error)) && (
          <Button disabled={printing || !frame || !deadline || !originalsReady} onClick={() => print()}>
            <PiPrinterBold aria-hidden="true" /> {printing ? "Đang chuẩn bị và gửi in…" : preparedPrint.current ? "Kiểm tra và thử lại" : "In ảnh"}
          </Button>
        )}
      </footer>
      {editingPhoto && (
        <Editor token={token} media={media} photo={editingPhoto} adjust={saved.adjusts[editingPhoto.id]}
          onChange={(a) => save({ adjusts: { ...saved.adjusts, [editingPhoto.id]: a } })}
          onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
