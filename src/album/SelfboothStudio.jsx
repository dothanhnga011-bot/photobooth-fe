// Phòng Selfbooth (Polaroid, khổ Instax): chụp xong, máy chụp chỉ hiện mã QR. Khách quét rồi trên điện thoại đi
// 4 bước như Selfbooth: Chọn ảnh (thả tim ảnh ưng ý — không giới hạn —, chạm ảnh để làm đẹp: mịn da, trắng da,
// thon mặt, má hồng, bộ lọc màu; beauty.js nhận diện khuôn mặt ngay trên máy) → Chọn khung → Thêm ảnh (ảnh nào
// vào ô nào, một ảnh vào được nhiều ô; kéo để dời, phóng to) → In: tấm Instax gửi tới máy in cạnh máy chụp
// (cùng đường in của máy chụp: /albums/:token/print-pack).
// Thời gian do máy chủ đặt từ lần mở đầu tiên (POST /albums/:token/edit-start, mặc định 250 giây — cùng cài đặt
// "Thời gian chọn ảnh"); hết giờ thì tự gửi in những gì đang chọn.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PiArrowLeftBold, PiArrowsOutCardinalBold, PiCheckBold, PiHeartBold, PiHeartFill, PiImagesDuotone, PiPlusBold,
  PiPrinterBold, PiPrinterDuotone, PiSelectionAllBold, PiSlidersHorizontalBold, PiStackDuotone, PiTimerBold,
} from "react-icons/pi";
import { api } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { ADJUST_LABELS, COLOR_FILTERS, DEFAULT_ADJUST, FILTER_CSS, isNeutral, warmFaceModel } from "../beauty.js";
import { composeFrameTile, composePreview, frameCandidates, printSheets, renderPrintFrame } from "../kiosk/compose.js";
import { photoAt } from "../kiosk/decor.js";
import { photoLayout } from "../frame-utils.js";
import { onNetworkRecovery } from "../network.js";
import { PhotoThumb } from "./photo-thumb.jsx";
import { printPackUpload } from "./print-upload.js";
import { AlbumViewer } from "./AlbumViewer.jsx";
import { createStudioMedia, needsFaces } from './studio-media.js';

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
// Các bước như Selfbooth, đúng thứ tự của tiệm: chọn ảnh → chọn khung → thêm ảnh vào khung → in. Thanh bước
// kiểu tab gạch chân như Selfbooth; bước đã qua hiện dấu ✓.
const STEPS = [
  ["photos", "Chọn ảnh", PiImagesDuotone],
  ["frame", "Chọn khung", PiStackDuotone],
  ["compose", "Thêm ảnh", PiSelectionAllBold],
  ["print", "In", PiPrinterDuotone],
];
const HEAD = {
  photos: "Thả tim ảnh bạn thích",
  frame: "Chọn khung",
  compose: "Thêm ảnh vào khung",
  print: "Xem lại & in",
};
// Ảnh trong ô: 100 % = phủ kín ô (như Selfbooth), phóng tới 300 %; x / y là phần của bề rộng / cao ô.
const NO_MOVE = { zoom: 1, x: 0, y: 0 };
const ZOOM = { min: 100, max: 300 };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Trạng thái lưu trên máy (tải lại trang vẫn giữ): ảnh đã thả tim, chỉnh của từng ảnh, khung, ảnh của từng ô,
// mã lệnh in.
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

// Khung ghép sẵn ảnh của các ô (đã làm đẹp, phóng / dời) để xem / chọn. keep: đang kéo / phóng ảnh — giữ ảnh
// cũ tới khi ảnh mới ghép xong (không nháy "Đang ghép…").
function FramePreview({ frame, images, className = "", label, tile = false, transforms = [], keep = false }) {
  const [src, setSrc] = useState("");
  const moves = JSON.stringify(transforms);
  useEffect(() => {
    const controller = new AbortController();
    if (!keep) setSrc('');
    if (!images.length) return;
    const render = tile ? composeFrameTile(frame, images, { signal: controller.signal, placeholders: false, transforms })
      : composePreview(frame, images, 720, '', { signal: controller.signal, transforms });
    render.then((canvas) => {
      if (!controller.signal.aborted) setSrc(canvas.toDataURL("image/jpeg", 0.88));
      canvas.width = canvas.height = 0;
    }).catch(() => {});
    return () => controller.abort();
  }, [frame, images, tile, moves]);
  return src ? <img className={className} src={src} alt={label} draggable={false} />
    : <span className={`${className} is-loading`} role="status">Đang ghép…</span>;
}

// Bước "Thêm ảnh": khung lớn, ô đang chọn có viền. Chạm một ô để chọn, kéo trong ô để dời ảnh (gộp theo
// khung hình của màn hình: mỗi khung hình ghép lại một lần).
function ComposeStage({ frame, images, transforms, active, onActive, onMove, disabled }) {
  const box = useRef(null);
  const drag = useRef(null);
  const slots = useMemo(() => photoLayout(frame).slots, [frame]);
  useEffect(() => () => cancelAnimationFrame(drag.current?.raf), []);
  function down(event) {
    if (disabled || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const slot = photoAt(frame, (event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height);
    if (slot < 0) return;
    onActive(slot);
    drag.current = { id: event.pointerId, slot, x: event.clientX, y: event.clientY, start: { ...NO_MOVE, ...transforms[slot] } };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function move(event) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const r = box.current.getBoundingClientRect(), s = slots[d.slot];
    d.next = {
      ...d.start,
      x: clamp(d.start.x + (event.clientX - d.x) / (s.w * r.width), -1, 1),
      y: clamp(d.start.y + (event.clientY - d.y) / (s.h * r.height), -1, 1),
    };
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; onMove(d.slot, d.next); });
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.raf) { cancelAnimationFrame(d.raf); onMove(d.slot, d.next); }
  }
  const s = slots[active];
  return (
    <div className="studio-compose-stage" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <FramePreview frame={frame} images={images} transforms={transforms} keep className="studio-print-preview" label="Khung đang ghép" />
      {s && <span className="studio-slot-ring" aria-hidden="true"
        style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }} />}
    </div>
  );
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
  const [saved, save] = useSaved(`selfbooth-v1-${token}`, {
    hearts: [], adjusts: {}, frameId: "", slots: [], transforms: [], requestKey: crypto.randomUUID(),
  });
  const [step, setStep] = useState("photos");
  const [shotRatio, setShotRatio] = useState("");
  const [editing, setEditing] = useState(null);
  const [active, setActive] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [result, setResult] = useState(alreadyPrinted ? { sent: true } : null);
  const [error, setError] = useState("");
  const photoOf = (id) => photos.find((p) => String(p.id) === id);
  // Thả tim không giới hạn (như Selfbooth).
  const hearts = saved.hearts.filter((id) => photoOf(id));
  const frame = frames.find((f) => f._id === saved.frameId) || frames[0];
  const slotCount = frame ? photoLayout(frame).slots.length || need : need;
  // Ảnh của từng ô: khách đặt ở bước Thêm ảnh; ô chưa đặt lấy lần lượt các ảnh đã thả tim chưa nằm ở ô nào
  // (thả tim ít hơn số ô thì lặp lại). Hết giờ mà chưa thả tim ảnh nào: các ảnh đầu tiên.
  const pool = hearts.length ? hearts : photos.map((p) => String(p.id));
  const slotIds = [];
  for (let i = 0; i < slotCount; i++) {
    const placed = saved.slots?.[i];
    if (photoOf(placed)) { slotIds.push(placed); continue; }
    const later = (saved.slots || []).slice(i + 1);
    slotIds.push(pool.find((id) => !slotIds.includes(id) && !later.includes(id)) ?? pool[i % Math.max(1, pool.length)]);
  }
  const printPhotos = slotIds.map(photoOf).filter(Boolean);
  const transforms = Array.from({ length: slotCount }, (_, i) => ({ ...NO_MOVE, ...saved.transforms?.[i] }));
  const originalsReady = printPhotos.length > 0 && printPhotos.every(photo => !photo.originalPending);
  const pendingOriginals = photos.filter(photo => photo.originalPending).length;
  const printLock = useRef(false);
  const preparedPrint = useRef(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => { if (active >= slotCount) setActive(0); }, [active, slotCount]);

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

  // Ảnh của các ô (đã làm đẹp, cỡ xem trước) cho khung xem trước; ảnh nằm ở nhiều ô chỉ làm một lần.
  const [images, setImages] = useState([]);
  const adjustKey = JSON.stringify(slotIds.map((id) => saved.adjusts[id] || null));
  useEffect(() => {
    let alive = true;
    const made = new Map();
    const drop = () => made.forEach((image) => { image.width = image.height = 0; });
    (async () => {
      for (const id of slotIds) {
        const p = photoOf(id);
        if (!p || made.has(id)) continue;
        made.set(id, await media.edited(p, saved.adjusts[p.id], 'preview', { isCurrent: () => alive }));
        if (!alive) return drop();
      }
      setImages(slotIds.map((id) => made.get(id)).filter(Boolean));
    })().catch(drop);
    return () => { alive = false; };
  }, [media, slotIds.join(), adjustKey]);

  const autoTried = useRef(false);
  useEffect(() => onNetworkRecovery(() => { autoTried.current = false; setRetry(n => n + 1); }), []);
  const locked = printing || Boolean(preparedPrint.current);
  const frozen = locked || left === 0;

  function toggleHeart(photo) {
    if (frozen) return;
    const id = String(photo.id);
    save({ hearts: hearts.includes(id) ? hearts.filter((h) => h !== id) : [...hearts, id] });
  }
  function chooseFrame(f) {
    if (frozen || f._id === frame?._id) return;
    // Ô của khung mới khác chỗ: ảnh về giữa ô.
    save({ frameId: f._id, transforms: [] });
    setActive(0);
  }
  // Đặt ảnh vào ô đang chọn (ảnh mới về giữa ô) rồi chuyển sang ô kế tiếp.
  function place(photo) {
    if (frozen) return;
    const slots = [...slotIds], moves = [...transforms];
    slots[active] = String(photo.id);
    moves[active] = NO_MOVE;
    save({ slots, transforms: moves });
    if (active < slotCount - 1) setActive(active + 1);
  }
  function moveSlot(slot, t) {
    if (frozen) return;
    const moves = [...transforms];
    moves[slot] = t;
    save({ slots: slotIds, transforms: moves });
  }

  async function print({ auto = false } = {}) {
    if (printLock.current || result) return;
    if (!frame) return setError("Tiệm chưa có khung Instax cho layout này — nhờ nhân viên in giúp bạn.");
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
          scale: 1, sharp: true, transforms,
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

  // Bước mở được: khung cần ít nhất một ảnh đã thả tim; thêm ảnh / in cần có khung.
  const canOpen = (key) => key === "photos" || (hearts.length > 0 && (key === "frame" || Boolean(frame)));
  const at = STEPS.findIndex(([key]) => key === step);
  const next = STEPS[at + 1]?.[0];
  const back = STEPS[at - 1]?.[0];
  const editingPhoto = photoOf(editing);
  // Ảnh để đặt vào ô: ảnh đã thả tim và ảnh đang nằm trong ô (như Selfbooth).
  const strip = [...new Set([...hearts, ...slotIds.filter(Boolean)])].map(photoOf).filter(Boolean);
  const t = transforms[active] || NO_MOVE;
  const lead = {
    photos: `Đã thả tim ${hearts.length} ảnh · chạm ảnh để làm đẹp · khung in ${slotCount} ảnh`,
    frame: "Chạm một khung để chọn — khung ghép sẵn ảnh bạn thả tim",
    compose: slotCount > 1
      ? "Chạm ô trên khung rồi chạm ảnh bên dưới để đặt vào · kéo ảnh trong ô để dời"
      : "Chạm ảnh bên dưới để đặt vào khung · kéo ảnh trong ô để dời",
    print: "Kiểm tra lần cuối rồi bấm In ảnh",
  }[step];
  return (
    <section className="selfbooth-studio">
      <header className="studio-head">
        <div>
          <h2>{HEAD[step]}</h2>
          <p>{lead}</p>
        </div>
        {left !== null && (
          <span className={`studio-timer${left <= 30 ? " is-urgent" : ""}`} role="timer" aria-label={`Còn ${clock(left)}`}>
            <PiTimerBold aria-hidden="true" /> {clock(left)}
          </span>
        )}
      </header>
      <nav className="selfbooth-steps" aria-label="Các bước">
        <ol>
          {STEPS.map(([key, label, Icon], i) => (
            <li key={key}>
              <button type="button" className={step === key ? "is-active" : i < at ? "is-done" : ""}
                aria-current={step === key ? "step" : undefined} disabled={frozen || !canOpen(key)} onClick={() => setStep(key)}>
                {i < at ? <PiCheckBold aria-hidden="true" /> : <Icon aria-hidden="true" />} <span>{label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <ErrorBox error={error} />
      {deadlineError && <p className="studio-status is-warn" role="status">{deadlineError} — đang tự kết nối lại.</p>}
      {!frames.length && <p className="studio-status is-warn" role="status">Chưa có khung cho layout này. Nhờ nhân viên kiểm tra khung Instax trước khi in.</p>}
      {!photos.length && <p className="studio-status" role="status">Đang nhận ảnh từ máy chụp. Ảnh sẽ tự xuất hiện tại đây.</p>}
      {pendingOriginals > 0 && <p className="studio-status" role="status">Đang nhận {pendingOriginals} ảnh gốc chất lượng cao. Bạn vẫn chọn ảnh và làm đẹp được; bản in sẽ đợi ảnh gốc.</p>}
      {step === "photos" && (
        // Ô ảnh theo đúng tỉ lệ ảnh máy chụp (máy phòng này chụp dọc): ảnh to, không trống hai bên.
        <ul className="studio-photos" aria-label="Ảnh vừa chụp" style={shotRatio ? { "--shot-ratio": shotRatio } : undefined}>
          {[...photos].reverse().map((photo) => {
            const hearted = hearts.includes(String(photo.id));
            const tuned = !isNeutral({ ...DEFAULT_ADJUST, ...saved.adjusts[photo.id] });
            return (
              <li key={photo.id} className={hearted ? "is-hearted" : ""}>
                <button type="button" className="studio-photo" disabled={frozen} onClick={() => setEditing(String(photo.id))} aria-label={`Làm đẹp ảnh ${photo.number}`}>
                  <PhotoThumb photo={photo} token={token} alt="" loading="lazy" decoding="async"
                    onLoad={(e) => !shotRatio && e.currentTarget.naturalWidth && setShotRatio(`${e.currentTarget.naturalWidth} / ${e.currentTarget.naturalHeight}`)} />
                  {tuned && <span className="studio-tuned"><PiSlidersHorizontalBold aria-hidden="true" /> Đã làm đẹp</span>}
                </button>
                <button type="button" className="studio-heart" disabled={frozen} aria-pressed={hearted} onClick={() => toggleHeart(photo)}
                  aria-label={hearted ? `Bỏ tim ảnh ${photo.number}` : `Thả tim ảnh ${photo.number}`}>
                  {hearted ? <PiHeartFill aria-hidden="true" /> : <PiHeartBold aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {step === "frame" && (
        <div className="studio-frames" role="radiogroup" aria-label="Khung">
          {frames.map((f) => (
            <button key={f._id} type="button" role="radio" disabled={frozen} aria-checked={frame?._id === f._id} onClick={() => chooseFrame(f)}>
              <FramePreview frame={f} images={images} label={f.name} tile />
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      )}
      {step === "compose" && frame && (
        <div className="studio-compose">
          {hearts.length < slotCount && (
            <p className="studio-status">
              Bạn thả tim {hearts.length} ảnh cho khung {slotCount} ô — ảnh được lặp cho đủ ô. Thả tim thêm hoặc chạm ảnh để đổi.
            </p>
          )}
          <ComposeStage frame={frame} images={images} transforms={transforms} active={active} disabled={frozen}
            onActive={setActive} onMove={moveSlot} />
          {slotCount > 1 && (
            <div className="studio-slots" role="radiogroup" aria-label="Ô trên khung">
              {slotIds.map((id, i) => (
                <button key={i} type="button" role="radio" aria-checked={active === i} disabled={frozen} onClick={() => setActive(i)}>
                  {photoOf(id) && <PhotoThumb photo={photoOf(id)} token={token} alt="" />}
                  <span>Ô {i + 1}</span>
                </button>
              ))}
            </div>
          )}
          <div className="studio-strip-head">
            <strong>{slotCount > 1 ? `Ảnh cho ô ${active + 1}` : "Ảnh cho khung"}</strong>
            <button type="button" className="studio-link" disabled={frozen} onClick={() => setStep("photos")}>
              <PiPlusBold aria-hidden="true" /> Thả tim thêm ảnh
            </button>
          </div>
          <ul className="studio-strip" aria-label="Ảnh đã thả tim">
            {strip.map((photo) => {
              const id = String(photo.id);
              const used = slotIds.flatMap((s, i) => (s === id ? [i + 1] : []));
              return (
                <li key={id}>
                  <button type="button" disabled={frozen} aria-pressed={slotIds[active] === id} onClick={() => place(photo)}
                    aria-label={`Đặt ảnh ${photo.number} vào ô ${active + 1}`}>
                    <PhotoThumb photo={photo} token={token} alt="" loading="lazy" decoding="async" />
                    {used.length > 0 && <b>{slotCount > 1 ? `Ô ${used.join(", ")}` : <PiCheckBold aria-label="Đang dùng" />}</b>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="studio-adjust">
            <label>
              <span><PiArrowsOutCardinalBold aria-hidden="true" /> Phóng to ô {active + 1} · {Math.round(t.zoom * 100)}%</span>
              <input type="range" min={ZOOM.min} max={ZOOM.max} step={5} value={Math.round(t.zoom * 100)} disabled={frozen}
                aria-label={`Phóng to ảnh ở ô ${active + 1}`}
                onChange={(e) => moveSlot(active, { ...t, zoom: Number(e.target.value) / 100 })} />
            </label>
            <button type="button" className="studio-link" disabled={frozen || (t.zoom === 1 && !t.x && !t.y)}
              onClick={() => moveSlot(active, NO_MOVE)}>Căn giữa</button>
          </div>
        </div>
      )}
      {step === "print" && frame && (
        <div className="studio-print">
          <FramePreview frame={frame} images={images} transforms={transforms} className="studio-print-preview" label="Ảnh in xem trước" />
        </div>
      )}
      <footer className="studio-foot">
        {back && (
          <Button className="outline" disabled={locked} onClick={() => setStep(back)}>
            <PiArrowLeftBold aria-hidden="true" /> Quay lại
          </Button>
        )}
        {next && !(left === 0 && error) && (
          <Button disabled={frozen || !photos.length || !canOpen(next)} onClick={() => setStep(next)}>
            {next === "print" ? "Xem lại" : "Tiếp tục"} <PiCheckBold aria-hidden="true" />
          </Button>
        )}
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
