// Album phòng Selfbooth (phòng Polaroid, khổ Instax) — giao diện và các bước như album của web Selfbooth
// (14/11 chủ tiệm yêu cầu "làm theo Selfbooth"): 01 Ảnh (thư viện: thả tim, thêm ảnh từ điện thoại, xoá, tải,
// chọn nhiều; chạm ảnh để làm đẹp) → 02 Chủ đề (chọn một bộ khung) → 03 Ghép ảnh (mọi khung của bộ: chạm ô,
// chọn ảnh, kéo để dời, phóng to) → 04 Kết quả (mỗi khung là một tấm Instax Wide; chọn tấm muốn in trong số
// tấm của vé rồi gửi in tới máy Instax cạnh máy chụp — /albums/:token/print-pack).
// Thời gian do máy chủ đặt từ lần mở đầu (POST /albums/:token/edit-start, cài đặt "Thời gian chọn ảnh", mặc
// định 250 giây); hết giờ thì tự gửi in những gì đang chọn (chưa chọn bộ khung: bộ đầu tiên, ghép tự động).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PiArrowCounterClockwiseBold, PiArrowLeftBold, PiArrowRightBold, PiCheckBold, PiCheckCircleDuotone,
  PiCheckSquareBold, PiClockBold, PiDownloadSimpleBold, PiHeartBold, PiHeartDuotone, PiHeartFill, PiImagesDuotone,
  PiMagnifyingGlassBold, PiMinusBold, PiPlusBold, PiPrinterBold, PiPrinterDuotone, PiSelectionAllBold,
  PiShuffleBold, PiSparkleFill, PiSquareBold, PiStackDuotone, PiTicketBold, PiTimerBold, PiTrashBold,
  PiUploadSimpleBold, PiWarningCircleDuotone, PiXBold,
} from "react-icons/pi";
import { RefreshCw } from "lucide-react";
import { api, assetUrl, formatDateTime, getApiUrl } from "../../api";
import { Button, ErrorBox, useStudio, useToast } from "../../studio";
import { ADJUST_LABELS, COLOR_FILTERS, DEFAULT_ADJUST, FILTER_CSS, isNeutral, warmFaceModel } from "../../beauty.js";
import { renderPrintFrame } from "../../kiosk/compose.js";
import { photoAt } from "../../kiosk/decor.js";
import {
  composeLayout, groupFramePacks, instaxPrint, loadFrameImage, photoLayout, rotateSlotContext, slotRect,
} from "../../frame-utils.js";
import { onNetworkRecovery } from "../../network.js";
import { storageLink } from "../../media-delivery.js";
import { savePhoto } from "../../kiosk/direct-upload.js";
import { prepareCameraImageAsync } from "../../image-processing.js";
import { PhotoThumb, photoUrl } from "../photo-thumb.jsx";
import { printPackUpload } from "../print-upload.js";
import { mergeUploadedPhotos, uploadPhotos } from "../upload-photos.js";
import { downloadEach } from "../save-to-phone.js";
import { createStudioMedia, needsFaces } from "../studio-media.js";

const STEPS = [
  ["Ảnh", PiImagesDuotone],
  ["Chủ đề", PiStackDuotone],
  ["Ghép ảnh", PiSelectionAllBold],
  ["Kết quả", PiPrinterDuotone],
];
const NO_MOVE = { zoom: 1, x: 0, y: 0, rotate: 0 };
const ZOOM = { min: 1, max: 3 };
const ACCEPTED = /^image\/(jpeg|png|webp)$/;
const MAX_UPLOAD_MB = 40;
const pad = (n) => String(n).padStart(2, "0");
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const clock = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;
const slotsOf = (frame) => photoLayout(frame).slots;
const capacityOf = (pack) => (pack?.frames || []).reduce((n, f) => n + slotsOf(f).length, 0);
// Ảnh của từng ô của mọi khung trong bộ: lấy lần lượt ảnh trong `pool`; repeat (tự động ghép) thì quay vòng.
function autoLayouts(frames, pool, { repeat = false } = {}) {
  let k = 0;
  return Object.fromEntries(frames.map((f) => [f._id, slotsOf(f).map(() => ({
    photo: (repeat && pool.length ? pool[k++ % pool.length] : pool[k++]) || null, ...NO_MOVE,
  }))]));
}
const isFilled = (frame, slots) => slots?.length === slotsOf(frame).length && slots.every((s) => s.photo);
const download = (url, name) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// Trạng thái lưu trên máy (tải lại trang vẫn giữ). save(changes | (v) => changes).
function useSaved(key, initial) {
  const [value, setValue] = useState(() => {
    try { return { ...initial, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* chế độ riêng tư: chỉ giữ trong trang */ }
  }, [key, value]);
  return [value, (changes) => setValue((v) => ({ ...v, ...(typeof changes === "function" ? changes(v) : changes) }))];
}

// Ảnh nhỏ đã làm đẹp (cạnh dài `edge` px) cho ô ghép / dải ảnh: ảnh xem trước cỡ lớn chỉ giữ trong lúc thu nhỏ.
function useSmallEdits(media, adjustOf, edge = 420) {
  const cache = useRef(new Map());
  useEffect(() => () => {
    for (const canvas of cache.current.values()) if (canvas instanceof HTMLCanvasElement) canvas.width = canvas.height = 0;
    cache.current.clear();
  }, [media]);
  return async (photo) => {
    const key = `${photo.id}:${JSON.stringify(adjustOf(photo.id))}`;
    if (!cache.current.has(key)) {
      const pending = media.edited(photo, adjustOf(photo.id), "preview").then((big) => {
        const scale = Math.min(1, edge / Math.max(big.width, big.height));
        const small = document.createElement("canvas");
        small.width = Math.max(1, Math.round(big.width * scale));
        small.height = Math.max(1, Math.round(big.height * scale));
        small.getContext("2d").drawImage(big, 0, 0, small.width, small.height);
        big.width = big.height = 0;
        cache.current.set(key, small);
        return small;
      }, (error) => { cache.current.delete(key); throw error; });
      cache.current.set(key, pending);
      if (cache.current.size > 48) {
        const [oldest, canvas] = cache.current.entries().next().value;
        if (canvas instanceof HTMLCanvasElement) canvas.width = canvas.height = 0;
        cache.current.delete(oldest);
      }
    }
    return cache.current.get(key);
  };
}

// ─── Làm đẹp một ảnh (mịn da, trắng da, thon mặt, má hồng, bộ lọc màu) ───────────────────────────────
function Editor({ token, media, photo, adjust, onChange, onClose, onFavorite, onDelete, disabled }) {
  const view = useRef(null);
  const [status, setStatus] = useState("loading");
  const [tab, setTab] = useState("smooth");
  const a = { ...DEFAULT_ADJUST, ...adjust };
  const turn = useRef(0);
  useEffect(() => { warmFaceModel(); }, []);
  useEffect(() => {
    const mine = ++turn.current;
    const run = async () => {
      if (needsFaces(a)) setStatus("faces");
      try {
        const canvas = await media.edited(photo, a, "preview", { isCurrent: () => mine === turn.current });
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
    const timer = setTimeout(run, 80);
    return () => { turn.current++; clearTimeout(timer); };
  }, [media, photo.id, JSON.stringify(a)]);
  return (
    <div className="sb-editor" role="dialog" aria-modal="true" aria-label={`Chỉnh ảnh ${pad(photo.number)}`}>
      <header>
        <button type="button" className="sb-icon" onClick={onClose} aria-label="Đóng"><PiArrowLeftBold aria-hidden="true" /></button>
        <h2>Ảnh #{pad(photo.number)}</h2>
        <button type="button" className="sb-icon sb-heart" aria-pressed={photo.favorite} disabled={disabled}
          aria-label={photo.favorite ? "Bỏ tim" : "Thả tim"} onClick={() => onFavorite(photo)}>
          {photo.favorite ? <PiHeartFill /> : <PiHeartBold />}
        </button>
        <button type="button" className="sb-icon" disabled={disabled} aria-label="Xoá ảnh" onClick={() => onDelete([photo.id])}>
          <PiTrashBold />
        </button>
      </header>
      <div className="sb-editor-view">
        <canvas ref={view} aria-label="Ảnh xem trước" />
        {status === "loading" && <p className="sb-editor-note" role="status">Đang mở ảnh…</p>}
        {status === "faces" && <p className="sb-editor-note" role="status">Đang nhận diện khuôn mặt…</p>}
        {status === "noface" && <p className="sb-editor-note">Không thấy khuôn mặt rõ — vẫn đổi được bộ lọc màu.</p>}
        {status === "nomodel" && <p className="sb-editor-note">Chưa tải được bộ làm đẹp — kiểm tra mạng rồi thử lại.</p>}
        {status === "error" && <p className="sb-editor-note">Không mở được ảnh — thử lại sau ít giây.</p>}
      </div>
      <div className="sb-editor-tabs" role="tablist" aria-label="Làm đẹp">
        {Object.entries(ADJUST_LABELS).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}{a[key] > 0 && <b>{a[key]}</b>}
          </button>
        ))}
      </div>
      <label className="sb-editor-slider">
        <span>{ADJUST_LABELS[tab]}</span>
        <input type="range" min={0} max={100} step={5} value={a[tab]} aria-label={ADJUST_LABELS[tab]} disabled={disabled}
          onChange={(e) => onChange({ ...a, [tab]: Number(e.target.value) })} />
      </label>
      <div className="sb-editor-filters" role="radiogroup" aria-label="Bộ lọc màu">
        {Object.entries(COLOR_FILTERS).map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={a.filter === key} disabled={disabled}
            onClick={() => onChange({ ...a, filter: key })}>
            <PhotoThumb photo={photo} token={token} alt="" style={{ filter: FILTER_CSS[key] || "none" }} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="sb-editor-foot">
        <Button className="outline" disabled={disabled || isNeutral(a)} onClick={() => onChange(DEFAULT_ADJUST)}>
          <PiArrowCounterClockwiseBold aria-hidden="true" /> Ảnh gốc
        </Button>
        <Button onClick={onClose}><PiCheckBold aria-hidden="true" /> Xong</Button>
      </div>
    </div>
  );
}

// ─── 01 Ảnh: thư viện ảnh ───────────────────────────────────────────────────────────────────────────────
function Gallery({ token, photos, favorites, adjustOf, busy, frozen, uploadProgress, selectedPack, downloadingId,
  onFavorite, onDelete, onDownload, onEdit, onUpload, onNext }) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const input = useRef(null);
  const allSelected = selecting && photos.length > 0 && selected.size === photos.length;
  const toggle = (id) => setSelected((old) => {
    const next = new Set(old);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const locked = busy || frozen;
  return (
    <>
      <div className="studio-head">
        <div>
          <div className="studio-title-row">
            <h2>Thư viện ảnh</h2>
            <span className="studio-photo-total">{photos.length} ảnh</span>
          </div>
          <p>
            {!photos.length
              ? "Thêm ảnh từ điện thoại để bắt đầu chọn và ghép khung."
              : "Chạm ảnh để chỉnh sửa. Thả tim những ảnh bạn yêu thích, không giới hạn số lượng."}
          </p>
          {selectedPack && photos.length > 0 && (
            <span className="gallery-selected-pack">Bộ đã chọn: <strong>{selectedPack.name}</strong></span>
          )}
        </div>
        <Button className="outline small" disabled={!photos.length}
          onClick={() => download(getApiUrl(`/api/albums/${token}/download`), "anh-goc.zip")}>
          <PiDownloadSimpleBold aria-hidden="true" /> Tải tất cả
        </Button>
      </div>
      <div className={`studio-grid ${selecting ? "is-selecting" : ""}`}>
        <button type="button" className="studio-upload-tile" aria-label="Thêm ảnh từ điện thoại" aria-busy={busy}
          disabled={locked} onClick={() => input.current?.click()}>
          {busy ? <PiUploadSimpleBold aria-hidden="true" /> : <PiPlusBold aria-hidden="true" />}
          <strong>{busy ? "Đang tải lên…" : "Thêm ảnh"}</strong>
          <span>{busy ? uploadProgress ? `Đã lưu ${uploadProgress.done}/${uploadProgress.total} ảnh` : "Vui lòng đợi" : "Từ điện thoại"}</span>
        </button>
        {photos.map((p, i) => {
          const adjust = adjustOf(p.id);
          const number = pad(p.number || i + 1);
          return (
            <figure key={p.id} className={`${p.favorite ? "is-fav" : ""} ${selected.has(p.id) ? "is-picked" : ""}`}>
              <button type="button" className="studio-photo" aria-label={selecting ? `Chọn ảnh ${number}` : `Xem & chỉnh ảnh ${number}`}
                onClick={() => (selecting ? toggle(p.id) : onEdit(p))}>
                <PhotoThumb photo={p} token={token} alt={`Ảnh ${number}`} loading={i < 4 ? "eager" : "lazy"}
                  decoding="async" style={{ filter: FILTER_CSS[adjust.filter] || "none" }} />
              </button>
              {!isNeutral(adjust) && <span className="photo-edited" title="Đã chỉnh sửa"><PiSparkleFill /></span>}
              <div className="tile-actions">
                {selecting ? (
                  <button type="button" className="tile-btn tile-check" role="checkbox" aria-checked={selected.has(p.id)}
                    aria-label={`Đánh dấu ảnh ${number}`} onClick={() => toggle(p.id)}>
                    {selected.has(p.id) ? <PiCheckSquareBold /> : <PiSquareBold />}
                  </button>
                ) : (
                  <>
                    <button type="button" className="tile-btn" disabled={Boolean(downloadingId)} aria-busy={downloadingId === p.id}
                      aria-label={`Tải ảnh ${number} về máy`} title="Tải ảnh về máy" onClick={() => onDownload(p)}>
                      <PiDownloadSimpleBold />
                    </button>
                    <button type="button" className="tile-btn tile-delete" disabled={locked} aria-label={`Xóa ảnh ${number}`}
                      title="Xóa ảnh" onClick={() => onDelete([p.id])}>
                      <PiTrashBold />
                    </button>
                  </>
                )}
                <button type="button" className="tile-btn tile-heart" disabled={frozen} aria-pressed={p.favorite}
                  aria-label={`${p.favorite ? "Bỏ tim" : "Thả tim"} ảnh ${number}`} onClick={() => onFavorite(p)}>
                  {p.favorite ? <PiHeartFill /> : <PiHeartBold />}
                </button>
              </div>
            </figure>
          );
        })}
      </div>
      <input ref={input} hidden type="file" aria-label="Chọn ảnh từ điện thoại" accept="image/jpeg,image/png,image/webp"
        multiple disabled={locked} onChange={(e) => { onUpload(Array.from(e.target.files || [])); e.target.value = ""; }} />
      <div className="studio-actions gallery-bar">
        <div className="gallery-tools">
          <button type="button" disabled={locked} onClick={() => input.current?.click()}>
            <PiUploadSimpleBold aria-hidden="true" /> {busy ? "Đang tải lên…" : "Thêm ảnh"}
          </button>
          <button type="button" className={selecting ? "on" : ""} disabled={!photos.length} onClick={() => {
            if (!selecting) return setSelecting(true);
            setSelected(allSelected ? new Set() : new Set(photos.map((p) => p.id)));
          }}>
            <PiSelectionAllBold aria-hidden="true" /> {!selecting ? "Chọn nhiều" : allSelected ? "Bỏ chọn" : "Chọn tất cả"}
          </button>
          {selecting && (
            <button type="button" aria-label="Thoát chế độ chọn" onClick={() => { setSelecting(false); setSelected(new Set()); }}>
              <PiXBold aria-hidden="true" />
            </button>
          )}
          {selecting && (
            <button type="button" className="danger" disabled={!selected.size || locked}
              onClick={async () => { if (await onDelete([...selected])) setSelected(new Set()); }}>
              <PiTrashBold aria-hidden="true" /> Xóa ({selected.size})
            </button>
          )}
        </div>
        <div className="gallery-cta">
          <span className="fav-count" aria-live="polite"><PiHeartFill aria-hidden="true" />{`Thích · ${favorites}`}</span>
          <Button disabled={!photos.length} onClick={onNext}>Chọn chủ đề <PiArrowRightBold aria-hidden="true" /></Button>
        </div>
      </div>
    </>
  );
}

// ─── 02 Chủ đề: chọn một bộ khung ───────────────────────────────────────────────────────────────────────
function ThemePicker({ packs, selected, favorites, frozen, onSelect, onBack, onNext }) {
  const pack = packs.find((p) => p.id === selected);
  const capacity = capacityOf(pack);
  const extra = pack ? Math.max(0, favorites - capacity) : 0;
  const missing = pack ? Math.max(0, capacity - favorites) : 0;
  return (
    <>
      <div className="studio-head theme-catalog-head">
        <div>
          <h2>Chọn bộ chủ đề</h2>
          <p>Chọn một bộ bạn thích. Các khung trong bộ sẽ được ghép cùng nhau, mỗi khung in một tấm Instax.</p>
        </div>
        <span className="theme-total">{packs.length} bộ khung</span>
      </div>
      <div className={`theme-status ${missing ? "is-short" : favorites ? "ok" : ""}`} role="status">
        {missing ? <PiWarningCircleDuotone aria-hidden="true" /> : favorites ? <PiCheckCircleDuotone aria-hidden="true" /> : <PiHeartFill aria-hidden="true" />}
        <div>
          <strong>{favorites ? `Bạn đã chọn ${favorites} ảnh yêu thích` : "Bạn chưa chọn ảnh yêu thích"}</strong>
          <span>
            {pack ? `Bộ “${pack.name}” có ${capacity} ô ảnh.` : "Chọn bộ khung để xem số ảnh cần ghép."}
            {extra > 0
              ? ` ${extra} ảnh còn lại vẫn được giữ trong thư viện và có thể dùng để đổi ảnh ở từng ô.`
              : missing > 0
                ? ` Còn thiếu ${missing} ảnh yêu thích. Bạn có thể chọn thêm hoặc tự động ghép ở bước tiếp theo.`
                : ""}
          </span>
        </div>
      </div>
      <div className="theme-catalog">
        {packs.map((p) => (
          <button key={p.id} type="button" className={p.id === selected ? "active" : ""} aria-pressed={p.id === selected}
            disabled={frozen} aria-label={`Chọn bộ ${p.name}, ${p.frames.length} khung, ${capacityOf(p)} ô ảnh`}
            onClick={() => onSelect(p.id)}>
            <span className="theme-big-preview" style={{ "--preview-columns": Math.min(3, p.frames.length) }}>
              {p.frames.map((f) => (
                <span className="theme-preview-frame" key={f._id}>
                  <img src={assetUrl(f.thumb || f.image)} alt={f.name} loading="lazy" decoding="async" />
                </span>
              ))}
            </span>
            <span className="theme-list-info">
              <span className="theme-card-title">
                <strong>{p.name}</strong>
                <span className={`theme-choice ${p.id === selected ? "checked" : ""}`} aria-hidden="true">
                  {p.id === selected && <PiCheckBold />}
                </span>
              </span>
              <span className="theme-card-meta">
                <span><PiStackDuotone aria-hidden="true" /> {p.frames.length} khung</span>
                <span><PiImagesDuotone aria-hidden="true" /> {capacityOf(p)} ô ảnh</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      {!packs.length && <div className="empty-state">Studio chưa có bộ khung Instax. Vui lòng liên hệ lễ tân.</div>}
      <div className="studio-actions theme-action-bar">
        <Button className="outline" onClick={onBack}><PiArrowLeftBold aria-hidden="true" /> Quay lại</Button>
        <span className="theme-action-summary">
          <strong>{pack ? pack.name : "Chọn 1 bộ khung"}</strong>
          <small>{pack ? `${capacity} ô ảnh · ${favorites} ảnh yêu thích${missing ? ` · Thiếu ${missing} ảnh` : ""}` : "Chạm bộ khung để chọn"}</small>
        </span>
        <Button disabled={!pack || !capacity || frozen} onClick={onNext}>Ghép ảnh <PiArrowRightBold aria-hidden="true" /></Button>
      </div>
    </>
  );
}

function ShortageDialog({ pack, required, favorites, totalPhotos, onMore, onAutomatic, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal favorite-shortage" role="dialog" aria-modal="true" aria-label="Chưa đủ ảnh yêu thích"
        onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-button modal-close" aria-label="Đóng" onClick={onClose}><PiXBold /></button>
        <span className="favorite-shortage-icon" aria-hidden="true"><PiHeartDuotone /></span>
        <h2>Chưa đủ ảnh yêu thích</h2>
        <p>Bộ “{pack.name}” có {required} ô ảnh. Bạn đã thích {favorites} ảnh.</p>
        <p className="favorite-shortage-count">Còn thiếu {required - favorites} ảnh yêu thích ({favorites}/{required}).</p>
        <p>
          {totalPhotos < required
            ? `Thư viện có ${totalPhotos} ảnh cho ${required} ô. Tự động ghép sẽ dùng lại một số ảnh để lấp đầy các ô.`
            : "Tự động ghép sẽ ưu tiên ảnh yêu thích và bổ sung từ ảnh còn lại trong thư viện."}
        </p>
        <div className="favorite-shortage-actions">
          <Button onClick={onAutomatic} disabled={!totalPhotos}>Tự động ghép</Button>
          <Button className="outline" onClick={onMore} autoFocus>Chọn thêm</Button>
        </div>
      </section>
    </div>
  );
}

// ─── 03 Ghép ảnh: một khung của bộ — chạm ô để chọn, chạm ảnh bên dưới để đặt, kéo để dời ──────────────
function FrameStage({ frame, slots, selected, small, photoOf, onSelect, onMove, disabled }) {
  const canvas = useRef(null);
  const [bg, setBg] = useState(null);
  const [images, setImages] = useState({});
  const [error, setError] = useState("");
  const drag = useRef(null);
  const layout = useMemo(() => photoLayout(frame), [frame]);
  useEffect(() => {
    let live = true;
    setBg(null);
    loadFrameImage(frame.image).then((image) => live && setBg(image), (e) => live && setError(e.message));
    return () => { live = false; };
  }, [frame.image]);
  const used = [...new Set(slots.map((s) => s.photo).filter(Boolean))];
  const usedKey = used.join();
  useEffect(() => {
    let live = true;
    Promise.all(used.map(async (id) => [id, await small(photoOf(id))]))
      .then((list) => live && setImages(Object.fromEntries(list)), (e) => live && setError(e.message));
    return () => { live = false; };
  }, [usedKey, small]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !bg) return;
    const scale = Math.min(1, 1100 / Math.max(bg.naturalWidth, bg.naturalHeight));
    c.width = Math.round(bg.naturalWidth * scale);
    c.height = Math.round(bg.naturalHeight * scale);
    composeLayout(c, bg, layout.slots, slots.map((s) => (s.photo && images[s.photo]) || null), slots,
      [], { frame: { ...layout, marks: [] }, overlay: true });
    const ctx = c.getContext("2d");
    layout.slots.forEach((slot, i) => {
      if (slots[i]?.photo && images[slots[i].photo]) return;
      const r = slotRect(slot, c.width, c.height);
      ctx.save();
      rotateSlotContext(ctx, r);
      ctx.fillStyle = "rgba(241, 183, 189, 0.22)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const size = Math.max(14, Math.min(r.w, r.h) * 0.22);
      ctx.fillStyle = "#4b332a";
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+", r.x + r.w / 2, r.y + r.h / 2 - size * 0.3);
      ctx.font = `500 ${Math.max(10, size * 0.36)}px system-ui, sans-serif`;
      ctx.fillText(`Ô ${i + 1}`, r.x + r.w / 2, r.y + r.h / 2 + size * 0.55);
      ctx.restore();
    });
    const slot = layout.slots[selected];
    if (slot) {
      const r = slotRect(slot, c.width, c.height);
      ctx.save();
      rotateSlotContext(ctx, r);
      ctx.lineWidth = Math.max(3, c.width / 220);
      ctx.strokeStyle = "#e0526b";
      ctx.strokeRect(r.x + ctx.lineWidth / 2, r.y + ctx.lineWidth / 2, r.w - ctx.lineWidth, r.h - ctx.lineWidth);
      ctx.restore();
    }
  }, [bg, images, JSON.stringify(slots), selected, layout]);
  const at = (event) => {
    const r = canvas.current.getBoundingClientRect();
    return photoAt(frame, (event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height,
      { width: bg?.naturalWidth || 1, height: bg?.naturalHeight || 1 });
  };
  function down(event) {
    if (disabled || !bg) return;
    const slot = at(event);
    if (slot < 0) return;
    onSelect(slot);
    if (!slots[slot]?.photo) return;
    drag.current = { id: event.pointerId, slot, x: event.clientX, y: event.clientY, start: { ...NO_MOVE, ...slots[slot] } };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function move(event) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const r = canvas.current.getBoundingClientRect(), s = layout.slots[d.slot];
    const angle = ((s.angle || 0) * Math.PI) / 180;
    const dx = event.clientX - d.x, dy = event.clientY - d.y;
    // Ô nghiêng: kéo theo hướng của ô.
    const lx = Math.cos(angle) * dx + Math.sin(angle) * dy, ly = -Math.sin(angle) * dx + Math.cos(angle) * dy;
    d.next = { ...d.start, x: clamp(d.start.x + lx / (s.w * r.width), -1, 1), y: clamp(d.start.y + ly / (s.h * r.height), -1, 1) };
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; onMove(d.slot, d.next); });
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.raf) { cancelAnimationFrame(d.raf); onMove(d.slot, d.next); }
  }
  return (
    <div className="frame-canvas" aria-busy={!bg}>
      <canvas ref={canvas} aria-label={`Khung ${frame.name}`} onPointerDown={down} onPointerMove={move}
        onPointerUp={up} onPointerCancel={up} />
      {!bg && !error && <p className="frame-hint" role="status">Đang tải khung…</p>}
      {error && <p className="frame-hint" role="alert">{error}</p>}
    </div>
  );
}

function CarouselThumb({ token, photo, active, count, onPick, disabled }) {
  return (
    <button type="button" className={active ? "active" : ""} disabled={disabled}
      aria-label={`Dùng ảnh ${pad(photo.number)} cho ô đang chọn`} onClick={onPick}>
      <PhotoThumb photo={photo} token={token} alt="" draggable={false} />
      {photo.favorite && <span className="carousel-heart"><PiHeartFill /></span>}
      {count > 0 && <span className="sheet-count">×{count}</span>}
    </button>
  );
}

function PackEditor({ token, pack, layouts, index, photos, small, photoOf, frozen, onIndex, onSlots, onReshuffle, onBack, onNext }) {
  const toast = useToast();
  const frame = pack.frames[Math.min(index, pack.frames.length - 1)];
  const slots = layouts[frame._id] || [];
  const [selected, setSelected] = useState(() => Math.max(0, slots.findIndex((s) => !s.photo)));
  useEffect(() => { setSelected(Math.max(0, (layouts[frame._id] || []).findIndex((s) => !s.photo))); }, [frame._id]);
  const current = { ...NO_MOVE, ...slots[selected] };
  const usage = (id) => Object.values(layouts).flat().filter((s) => s.photo === id).length;
  const update = (i, changes) => onSlots(frame._id, slots.map((s, k) => (k === i ? { ...s, ...changes } : s)));
  function assign(id) {
    if (frozen) return;
    update(selected, { photo: id, ...NO_MOVE });
    const next = slots.findIndex((s, k) => k > selected && !s.photo);
    if (next >= 0) setSelected(next);
  }
  function next() {
    const empty = pack.frames.findIndex((f) => !isFilled(f, layouts[f._id]));
    if (empty < 0) return onNext();
    onIndex(empty);
    toast.warning(`Khung “${pack.frames[empty].name}” còn ô chưa có ảnh.`);
  }
  return (
    <>
      <div className="studio-head">
        <div>
          <h2>Ghép ảnh vào khung</h2>
          <p>Chạm ô trên khung rồi chạm ảnh bên dưới để đặt vào. Một ảnh dùng được cho nhiều ô; kéo ảnh trong ô để dời.</p>
        </div>
      </div>
      {pack.frames.length > 1 && (
        <div className="frame-tabs" role="tablist" aria-label="Các khung trong bộ">
          {pack.frames.map((f, i) => (
            <button key={f._id} type="button" role="tab" aria-selected={i === index} aria-label={f.name}
              className={isFilled(f, layouts[f._id]) ? "" : "missing"} onClick={() => onIndex(i)}>
              <img src={assetUrl(f.thumb || f.image)} alt="" />
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="frame-editor">
        <div className="frame-main">
          <FrameStage frame={frame} slots={slots} selected={selected} small={small} photoOf={photoOf}
            onSelect={setSelected} onMove={(i, t) => update(i, t)} disabled={frozen} />
          <p className="frame-hint">Chạm ô để chọn · kéo để di chuyển · thanh trượt để phóng to</p>
          <div className="photo-carousel" aria-label="Ảnh để ghép">
            {photos.map((p) => (
              <CarouselThumb key={p.id} token={token} photo={p} active={p.id === current.photo} count={usage(p.id)}
                disabled={frozen} onPick={() => assign(p.id)} />
            ))}
          </div>
        </div>
        <div className="slot-tools" aria-label={`Ô ${selected + 1}`}>
          <div className="slot-tools-head">
            <strong>Ô {selected + 1}<small> / {slots.length}</small></strong>
            <div className="slot-tools-actions">
              {current.photo && slots.length > 1 && (
                <button type="button" className="text-link" disabled={frozen}
                  onClick={() => onSlots(frame._id, slots.map((s) => ({ ...s, photo: current.photo, ...NO_MOVE })))}>
                  Dùng cho tất cả ô
                </button>
              )}
              {current.photo && (
                <button type="button" className="text-link" disabled={frozen} onClick={() => update(selected, NO_MOVE)}>Đặt lại</button>
              )}
            </div>
          </div>
          <fieldset className="tool-rows" disabled={!current.photo || frozen}>
            <div className="tool-row">
              <button type="button" aria-label="Thu nhỏ" onClick={() => update(selected, { zoom: clamp(current.zoom - 0.1, ZOOM.min, ZOOM.max) })}>
                <PiMinusBold />
              </button>
              <PiMagnifyingGlassBold className="tool-icon" aria-hidden="true" />
              <input type="range" aria-label={`Phóng to ảnh ở ô ${selected + 1}`} min={ZOOM.min} max={ZOOM.max} step={0.01}
                value={current.zoom} onChange={(e) => update(selected, { zoom: Number(e.target.value) })} />
              <button type="button" aria-label="Phóng to" onClick={() => update(selected, { zoom: clamp(current.zoom + 0.1, ZOOM.min, ZOOM.max) })}>
                <PiPlusBold />
              </button>
            </div>
          </fieldset>
        </div>
      </div>
      <div className="studio-actions">
        <Button className="outline" onClick={onBack}><PiArrowLeftBold aria-hidden="true" /> Quay lại</Button>
        <Button className="outline" disabled={frozen} onClick={onReshuffle}><PiShuffleBold aria-hidden="true" /> Xếp lại</Button>
        <Button onClick={next}>Xem kết quả <PiArrowRightBold aria-hidden="true" /></Button>
      </div>
    </>
  );
}

// ─── 04 Kết quả: mỗi khung một tấm Instax Wide, chọn tấm muốn in ─────────────────────────────────────────
function Result({ booking, sheets, error, picked, remaining, quota, used, printing, onToggle, onPrint, onBack, onRetry }) {
  return (
    <>
      <div className="studio-head result-head">
        <div>
          <h2>Thành phẩm của bạn</h2>
          <p>{error ? "Chưa tạo được thành phẩm. Kiểm tra thông báo bên dưới." : sheets.length ? "Chọn tấm muốn in rồi bấm Gửi in." : "Đang tạo ảnh chất lượng cao…"}</p>
        </div>
      </div>
      <p className={`print-quota ${remaining ? "" : "empty"}`}>
        <PiPrinterDuotone aria-hidden="true" />
        <span>
          Vé #{booking.code} gồm <b>{quota} tấm Instax</b> · đã gửi {used} · còn <b>{remaining} tấm</b>
          {remaining > 0 && sheets.length > 1 && <small>Chạm vào tấm để chọn / bỏ chọn tấm muốn in.</small>}
          {!remaining && <small>Muốn in thêm? Mua thêm tấm tại quầy — lễ tân cộng vào vé, bạn chỉ cần bấm Gửi in lại.</small>}
        </span>
      </p>
      {error && (
        <div className="error-box" role="alert">
          {error} <button type="button" className="text-link" onClick={onRetry}>Thử lại</button>
        </div>
      )}
      {!sheets.length && !error && <p className="center muted" role="status">Đang ghép ảnh vào khung…</p>}
      <div className="sheet-strip">
        {sheets.map((s, i) => (
          <figure key={s.frameId} className={picked.has(i) ? "is-picked" : "is-skipped"}>
            <button type="button" aria-pressed={picked.has(i)} aria-label={`Tấm in ${i + 1}: ${s.name}`}
              disabled={printing || (!remaining && !picked.has(i))} onClick={() => onToggle(i)}>
              <img src={s.preview} alt={`Tấm in ${i + 1}`} />
              <span className="sheet-pick">{picked.has(i) ? <><PiCheckBold /> Sẽ in</> : "Chạm để in"}</span>
            </button>
            <figcaption>{s.name}</figcaption>
          </figure>
        ))}
      </div>
      <div className="studio-actions">
        <Button className="outline" disabled={printing} onClick={onBack}><PiArrowLeftBold aria-hidden="true" /> Quay lại</Button>
        <Button disabled={printing || !picked.size || !sheets.length} onClick={onPrint}>
          <PiPrinterBold aria-hidden="true" /> {printing ? "Đang gửi in…" : `Gửi in (${picked.size} tấm Instax)`}
        </Button>
      </div>
    </>
  );
}

export function SelfboothAlbum({ token, booking, setBooking, reload }) {
  const toast = useToast();
  const { frames: catalog = [], settings = {} } = useStudio();
  const media = useMemo(() => createStudioMedia(token), [token]);
  useEffect(() => () => media.clear(), [media]);
  const [saved, save] = useSaved(`selfbooth-album-v2-${token}`, {
    step: 0, hearts: [], adjusts: {}, packId: "", frameIndex: 0, layouts: {}, autoFill: false,
    requestKey: crypto.randomUUID(),
  });
  const originals = useMemo(() => booking.photos.filter((p) => p.kind === "original"), [booking.photos]);
  const ids = new Set(originals.map((p) => String(p.id)));
  const hearts = saved.hearts.filter((id) => ids.has(id));
  const photos = originals.map((p) => ({ ...p, id: String(p.id), favorite: hearts.includes(String(p.id)) }));
  const photoOf = (id) => photos.find((p) => p.id === id);
  const newestFirst = [...photos].reverse();
  const favorites = photos.filter((p) => p.favorite);
  const adjustOf = (id) => ({ ...DEFAULT_ADJUST, ...saved.adjusts[id] });
  const small = useSmallEdits(media, adjustOf);
  // Bộ khung: khung Instax đang bật gom theo chủ đề (chủ đề đang tắt thì ẩn), theo thứ tự chủ đề của tiệm.
  const packs = useMemo(() => {
    const hidden = new Set((settings.themes || []).filter((t) => t.active === false).map((t) => t.name));
    const frames = catalog.filter((f) => f.active !== false && f.printSize === "instax" && slotsOf(f).length &&
      !hidden.has(f.themeName?.trim()));
    return groupFramePacks(frames, (settings.themes || []).map((t) => t.name));
  }, [catalog, settings.themes]);
  const pack = packs.find((p) => p.id === saved.packId);
  const required = capacityOf(pack);
  const layoutsOf = (p, layouts) => p && p.frames.every((f) => layouts[f._id]?.length === slotsOf(f).length);
  const ready = Boolean(layoutsOf(pack, saved.layouts));
  const filled = ready && pack.frames.every((f) => isFilled(f, saved.layouts[f._id]));
  const quota = Math.max(1, Number(booking.prints) || 1);
  const used = Number(booking.printSheets) || 0;
  const remaining = Math.max(0, quota - used);
  const [editing, setEditing] = useState(null);
  const [shortage, setShortage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const mutating = useRef(false);
  const bookingRef = useRef(booking);
  bookingRef.current = booking;

  // Ảnh bị xoá / bộ khung bị gỡ: đưa lựa chọn về trạng thái hợp lệ.
  const idsKey = [...ids].join();
  useEffect(() => {
    if (saved.packId && catalog.length && !pack) return save({ packId: "", layouts: {}, step: Math.min(saved.step, 1) });
    const stale = Object.values(saved.layouts).some((slots) => slots.some((s) => s.photo && !ids.has(s.photo)));
    if (stale) save((v) => ({
      layouts: Object.fromEntries(Object.entries(v.layouts).map(([id, slots]) =>
        [id, slots.map((s) => (s.photo && !ids.has(s.photo) ? { ...s, photo: null } : s))])),
      step: Math.min(v.step, 2),
    }));
  }, [idsKey, saved.packId, packs.length]);
  useEffect(() => {
    if (saved.step >= 2 && !ready) save({ step: pack ? 1 : 0 });
    if (saved.step === 3 && !filled && ready) save({ step: 2 });
  }, [saved.step, ready, filled]);

  // ── Hạn chọn ảnh do máy chủ đặt (bù đồng hồ lệch của điện thoại) ──
  const alreadyPrinted = used >= quota;
  const [deadline, setDeadline] = useState(null);
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
        const r = await api(`/albums/${token}/edit-start`, { method: "POST" });
        if (!alive) return;
        const endsAt = new Date(r.editEndsAt).getTime();
        if (!Number.isFinite(endsAt)) throw new Error("Chưa nhận được thời gian chọn ảnh.");
        offset.current = Number(r.serverTime) - (sent + Date.now()) / 2 || 0;
        setDeadline(endsAt);
        setNow(Date.now());
      } catch {
        if (alive) retryTimer = setTimeout(start, 5000);
      } finally { running = false; }
    };
    start();
    const recover = onNetworkRecovery(start);
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => { alive = false; clearInterval(timer); clearTimeout(retryTimer); recover(); };
  }, [token, alreadyPrinted, Boolean(photos.length)]);
  const left = deadline ? Math.max(0, Math.ceil((deadline - (now + offset.current)) / 1000)) : null;
  const frozen = printing || left === 0 || Boolean(result);

  // ── Thư viện ──
  function toggleHeart(photo) {
    if (frozen) return;
    save((v) => ({ hearts: v.hearts.includes(photo.id) ? v.hearts.filter((h) => h !== photo.id) : [...v.hearts, photo.id] }));
  }
  async function removePhotos(list) {
    if (mutating.current || frozen || !list.length || !window.confirm(`Xóa ${list.length} ảnh khỏi thư viện?`)) return false;
    mutating.current = true;
    setBusy(true);
    try {
      setBooking(await api(`/albums/${token}/photos`, { method: "DELETE", body: { ids: list } }));
      setEditing(null);
      toast.success(`Đã xóa ${list.length} ảnh.`);
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  async function upload(selected) {
    if (mutating.current || frozen) return;
    const files = selected.filter((f) => ACCEPTED.test(f.type) && f.size <= MAX_UPLOAD_MB * 1024 * 1024);
    if (selected.length > files.length)
      toast.warning(`Bỏ qua ${selected.length - files.length} tệp: chỉ nhận ảnh JPG, PNG, WebP dưới ${MAX_UPLOAD_MB} MB.`);
    if (!files.length) return;
    mutating.current = true;
    setBusy(true);
    setUploadProgress({ done: 0, total: files.length });
    try {
      let confirmed = 0;
      const { done, error: failed } = await uploadPhotos(files, {
        upload: async (file) => {
          const clientKey = crypto.randomUUID();
          const preview = file.type === "image/jpeg" ? await prepareCameraImageAsync(file, false).catch(() => undefined) : undefined;
          return savePhoto(`/albums/${token}/photos`, file, { name: file.name, clientKey, preview });
        },
        onSaved: (response) => {
          const next = mergeUploadedPhotos(bookingRef.current, response);
          bookingRef.current = next;
          setBooking(next);
          setUploadProgress({ done: ++confirmed, total: files.length });
        },
      });
      if (failed) toast.error(done ? `Đã thêm ${done}/${files.length} ảnh. Chưa tải xong: ${failed.message}` : failed.message);
      else toast.success(`Đã thêm ${done} ảnh vào thư viện.`);
    } finally {
      mutating.current = false;
      setBusy(false);
      setUploadProgress(null);
    }
  }
  async function downloadOne(photo) {
    if (downloadingId) return;
    setDownloadingId(photo.id);
    const name = `anh-${pad(photo.number)}.jpg`;
    try {
      const adjust = adjustOf(photo.id);
      if (isNeutral(adjust))
        await downloadEach([{ url: `${photoUrl(token, photo.id)}?download=1`, link: storageLink(photo, "download"), name, type: "image/jpeg" }]);
      else {
        // Ảnh đã làm đẹp: lưu đúng bản đã chỉnh, cỡ in.
        const canvas = await media.edited(photo, adjust, "print");
        const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("máy không đủ bộ nhớ"))), "image/jpeg", 0.95));
        canvas.width = canvas.height = 0;
        const url = URL.createObjectURL(blob);
        download(url, name);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      toast.success("Đã lưu ảnh về máy.");
    } catch (e) {
      toast.error(`Không lưu được ảnh: ${e.message}`);
    } finally {
      setDownloadingId(null);
    }
  }

  // ── Chủ đề & ghép ảnh ──
  const go = (step) => { setError(""); save({ step }); window.scrollTo?.({ top: 0, behavior: "smooth" }); };
  function choosePack(id) {
    if (frozen) return;
    for (const frame of packs.find((p) => p.id === id)?.frames || []) loadFrameImage(frame.image).catch(() => {});
    if (id !== saved.packId) save({ packId: id, layouts: {}, frameIndex: 0, autoFill: false });
  }
  const pool = (autoFill) => autoFill ? [...favorites, ...photos.filter((p) => !p.favorite)].map((p) => p.id) : favorites.map((p) => p.id);
  function toCompose() {
    if (!pack || !required || !photos.length) return;
    if (favorites.length < required && !ready) {
      if (saved.step !== 1) go(1);
      return setShortage(true);
    }
    beginCompose(saved.autoFill);
  }
  function beginCompose(autoFill) {
    if (!pack || !photos.length) return;
    setShortage(false);
    save({ step: 2, autoFill, ...(!ready || (autoFill && !saved.autoFill) ? { layouts: autoLayouts(pack.frames, pool(autoFill), { repeat: autoFill }), frameIndex: 0 } : {}) });
  }
  function reshuffle() {
    save({ layouts: autoLayouts(pack.frames, pool(saved.autoFill), { repeat: saved.autoFill }) });
    toast.success("Đã xếp lại ảnh trong bộ khung.");
  }
  const carousel = useMemo(() => {
    const usedIds = new Set(Object.values(saved.layouts).flat().map((s) => s.photo));
    return saved.autoFill ? [...favorites, ...photos.filter((p) => !p.favorite)] : photos.filter((p) => p.favorite || usedIds.has(p.id));
  }, [idsKey, hearts.join(), saved.layouts, saved.autoFill]);

  // ── Kết quả: dựng tấm in Instax cho từng khung của bộ ──
  const [sheets, setSheets] = useState([]);
  const [sheetError, setSheetError] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [renderTurn, setRenderTurn] = useState(0);
  const sheetKey = JSON.stringify([saved.packId, saved.layouts, saved.adjusts]);
  async function renderSheets(p, layouts, isLive = () => true) {
    const out = [];
    for (const frame of p.frames) {
      const slots = layouts[frame._id] || [];
      // Cùng ảnh ở các ô liền nhau: giải mã ảnh gốc một lần.
      const shots = slots.map((s) => ({ key: s.photo, photo: photoOf(s.photo) }));
      if (shots.some((s) => !s.photo)) throw new Error(`Khung “${frame.name}” còn ô chưa có ảnh.`);
      if (shots.some((s) => s.photo.originalPending)) throw new Error("Ảnh gốc đang tải lên. Khi ảnh sẵn sàng, bạn gửi in được với đầy đủ chất lượng.");
      const canvas = await renderPrintFrame(frame, shots, token, `${location.origin}/album/${token}`, {
        scale: 1, sharp: true, overlay: true, transforms: slots,
        sourceFor: (shot) => media.edited(shot.photo, adjustOf(shot.photo.id), "print"),
      });
      try {
        if (!isLive()) return null;
        const instax = instaxPrint(canvas);
        const data = await new Promise((resolve) => resolve(instax.toDataURL("image/jpeg", 0.95)));
        const preview = canvas.toDataURL("image/jpeg", 0.85);
        instax.width = instax.height = 0;
        out.push({ frameId: frame._id, name: frame.name, data, preview });
      } finally { canvas.width = canvas.height = 0; }
    }
    return out;
  }
  useEffect(() => {
    if (saved.step !== 3 || !filled || result) return;
    let live = true;
    setSheets([]);
    setSheetError("");
    renderSheets(pack, saved.layouts, () => live).then((list) => {
      if (!live || !list) return;
      setSheets(list);
      setPicked(new Set(list.slice(0, remaining).map((_, i) => i)));
    }, (e) => live && setSheetError(e.message));
    return () => { live = false; };
  }, [saved.step, sheetKey, filled, renderTurn]);
  function togglePick(i) {
    if (printing) return;
    if (picked.has(i)) return setPicked((old) => new Set([...old].filter((k) => k !== i)));
    if (picked.size >= remaining)
      return toast.warning(remaining ? `Vé của bạn còn ${remaining} tấm in — bỏ chọn một tấm khác trước.` : "Vé đã dùng hết tấm in.");
    setPicked((old) => new Set(old).add(i));
  }

  // ── Gửi in (khách bấm, hoặc tự động khi hết giờ) ──
  // Lệnh in đã chuẩn bị được giữ tới khi máy chủ nhận: thử lại gửi đúng các tấm đó (cùng mã lệnh in), máy chủ
  // nhận ra lần gửi trước nếu nó đã tới.
  const printLock = useRef(false);
  const prepared = useRef(null);
  const [failed, setFailed] = useState(false);
  async function print({ auto = false } = {}) {
    if (printLock.current || result || !remaining) return;
    printLock.current = true;
    setPrinting(true);
    setError("");
    setFailed(false);
    try {
      const lookup = () => api(`/albums/${token}/print?requestKey=${saved.requestKey}`, { allowNull: true });
      if (await lookup()) { setResult({ sent: true, ...prepared.current?.done }); prepared.current = null; reload?.(); return; }
      if (!prepared.current) {
        let list = sheets, chosen = [...picked];
        if (auto || !list.length) {
          // Hết giờ: bộ đang chọn (chưa chọn thì bộ đầu tiên), ô còn trống lấp bằng ảnh yêu thích rồi ảnh còn lại.
          const p = pack || packs[0];
          if (!p) throw new Error("Tiệm chưa có bộ khung Instax — nhờ nhân viên in giúp bạn.");
          const layouts = layoutsOf(p, saved.layouts) && p.frames.every((f) => isFilled(f, saved.layouts[f._id]))
            ? saved.layouts : autoLayouts(p.frames, pool(true), { repeat: true });
          list = await renderSheets(p, layouts);
          chosen = picked.size && sheets.length ? [...picked] : list.slice(0, remaining).map((_, i) => i);
        }
        chosen = chosen.sort((a, b) => a - b).filter((i) => list[i]).slice(0, remaining);
        if (!chosen.length) throw new Error("Chọn ít nhất 1 tấm để in.");
        prepared.current = {
          options: printPackUpload({
            images: chosen.map((i) => list[i].data), frameName: (pack || packs[0])?.name || "Khung ảnh", requestKey: saved.requestKey,
          }),
          done: { count: chosen.length, previews: chosen.map((i) => list[i].preview) },
        };
      }
      await api(`/albums/${token}/print-pack`, prepared.current.options);
      setResult({ sent: true, ...prepared.current.done });
      prepared.current = null;
      reload?.();
      if (auto) toast.info("Hết thời gian chọn ảnh — đã gửi in những ảnh bạn đang chọn.");
    } catch (e) {
      // Mã 409 có thể là lệnh in trước đã tới (mất phản hồi): chỉ lệnh in đã lưu mới chứng minh điều đó.
      const previous = e.status === 409 && await api(`/albums/${token}/print?requestKey=${saved.requestKey}`, { allowNull: true }).catch(() => null);
      if (previous) { setResult({ sent: true, ...prepared.current?.done }); prepared.current = null; reload?.(); }
      else {
        if (e.status === 400) prepared.current = null;
        setError(e.message || "Chưa gửi in được — thử lại nhé.");
        setFailed(Boolean(prepared.current));
      }
    } finally {
      printLock.current = false;
      setPrinting(false);
    }
  }
  const autoTried = useRef(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => onNetworkRecovery(() => { autoTried.current = false; setRetry((n) => n + 1); }), []);
  const originalsReady = photos.length > 0 && photos.every((p) => !p.originalPending);
  const pendingOriginals = photos.filter((p) => p.originalPending).length;
  useEffect(() => {
    if (left === 0 && !result && remaining && originalsReady && packs.length && !autoTried.current) {
      autoTried.current = true;
      print({ auto: true });
    }
  }, [left, Boolean(result), originalsReady, packs.length, retry]);

  const step = result ? 3 : saved.step;
  const canOpen = (i) => i <= 1 || (i === 2 && ready) || (i === 3 && filled);
  const expires = formatDateTime(booking.mediaExpiresAt);
  const editPhoto = editing && photoOf(editing);
  return (
    <section className="sb-album">
      <div className="studio-meta">
        <div className="studio-meta-heading">
          <h1 className="studio-album-title">Ảnh <em>của bạn</em></h1>
          <Button className="outline small studio-album-refresh" disabled={busy} onClick={() => reload?.()}>
            <RefreshCw aria-hidden="true" /> Làm mới
          </Button>
        </div>
        <p className="studio-album-facts">
          <span><PiTicketBold aria-hidden="true" /> Vé <strong>#{booking.code}</strong></span>
          <span>Lưu miễn phí 3 ngày</span>
          {expires && <span>Ảnh sắp xóa gần nhất: <strong>{expires}</strong></span>}
        </p>
        <p className="studio-album-tip">Mỗi ảnh lưu 3 ngày kể từ lúc chụp. Tải về máy để giữ lâu hơn.</p>
        {!alreadyPrinted && !result && left !== null && (
          <p className={`sb-timer${left <= 30 ? " is-low" : ""}`} role="timer" aria-live={left <= 30 ? "polite" : "off"}>
            {left > 0 ? <PiTimerBold aria-hidden="true" /> : <PiClockBold aria-hidden="true" />}
            {left > 0 ? <>Còn <strong>{clock(left)}</strong> để chọn ảnh, ghép khung và gửi in</> : "Hết giờ — đang gửi in những ảnh bạn đã chọn…"}
          </p>
        )}
        {pendingOriginals > 0 && !result && (
          <p className="sb-timer" role="status">
            Đang nhận {pendingOriginals} ảnh gốc chất lượng cao từ máy chụp — tấm in dùng ảnh gốc nên chờ thêm chút nhé.
          </p>
        )}
      </div>
      <nav className="studio-steps" aria-label="Các bước">
        {STEPS.map(([label, Icon], i) => (
          <button key={label} type="button" className={i === step ? "active" : i < step ? "done" : ""}
            aria-current={i === step ? "step" : undefined} disabled={frozen || !canOpen(i)}
            onClick={() => (i === 2 && step < 2 ? toCompose() : go(i))}>
            <span>{i < step ? <PiCheckBold /> : <Icon />}</span>
            {label}
          </button>
        ))}
      </nav>
      <ErrorBox error={error} />
      {failed && !printing && !result && (
        <div className="print-retry" role="alert">
          <p>Chưa xác nhận được yêu cầu in. Bấm để kiểm tra lại — nếu máy in đã nhận thì không in thêm lần nữa.</p>
          <Button className="outline" onClick={() => print()}>Kiểm tra và thử lại</Button>
        </div>
      )}
      {result ? (
        <div className="print-confirmation">
          <span className="print-confirmation-check" aria-hidden="true"><PiCheckBold /></span>
          <h2>Đã gửi in!</h2>
          <p>Lấy ảnh ở máy Instax cạnh máy chụp — ảnh hiện màu dần sau ít phút.</p>
          {result.previews?.length > 0 && (
            <div className="sheet-strip is-done">
              {result.previews.map((src, i) => <img key={i} src={src} alt={`Tấm đã gửi in ${i + 1}`} />)}
            </div>
          )}
          <p className="print-confirmation-ticket">Vé #{booking.code} · đã gửi {Math.min(quota, used + (result.count || 0))}/{quota} tấm</p>
          {remaining - (result.count || 0) > 0 && (
            <Button className="outline" onClick={() => { setResult(null); save({ requestKey: crypto.randomUUID() }); }}>
              In thêm ({remaining - (result.count || 0)} tấm còn lại)
            </Button>
          )}
        </div>
      ) : step === 0 ? (
        <Gallery token={token} photos={newestFirst} favorites={favorites.length} adjustOf={adjustOf} busy={busy} frozen={frozen}
          uploadProgress={uploadProgress} selectedPack={pack} downloadingId={downloadingId} onFavorite={toggleHeart}
          onDelete={removePhotos} onDownload={downloadOne} onEdit={(p) => setEditing(p.id)} onUpload={upload}
          onNext={() => go(1)} />
      ) : step === 1 ? (
        <ThemePicker packs={packs} selected={saved.packId} favorites={favorites.length} frozen={frozen}
          onSelect={choosePack} onBack={() => go(0)} onNext={toCompose} />
      ) : step === 2 && ready ? (
        <PackEditor token={token} pack={pack} layouts={saved.layouts} index={saved.frameIndex} photos={carousel}
          small={small} photoOf={photoOf} frozen={frozen}
          onIndex={(frameIndex) => save({ frameIndex })}
          onSlots={(frameId, slots) => save((v) => ({ layouts: { ...v.layouts, [frameId]: slots } }))}
          onReshuffle={reshuffle} onBack={() => go(1)} onNext={() => go(3)} />
      ) : step === 3 && filled ? (
        <Result booking={booking} sheets={sheets} error={sheetError} picked={picked} remaining={remaining} quota={quota}
          used={used} printing={printing} onToggle={togglePick} onPrint={() => print()} onBack={() => go(2)}
          onRetry={() => setRenderTurn((n) => n + 1)} />
      ) : null}
      {shortage && pack && (
        <ShortageDialog pack={pack} required={required} favorites={favorites.length} totalPhotos={photos.length}
          onMore={() => { setShortage(false); go(0); }} onAutomatic={() => beginCompose(true)} onClose={() => setShortage(false)} />
      )}
      {editPhoto && (
        <Editor token={token} media={media} photo={editPhoto} adjust={saved.adjusts[editPhoto.id]} disabled={frozen}
          onChange={(adjust) => save((v) => ({ adjusts: { ...v.adjusts, [editPhoto.id]: adjust } }))}
          onFavorite={toggleHeart} onDelete={removePhotos} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
