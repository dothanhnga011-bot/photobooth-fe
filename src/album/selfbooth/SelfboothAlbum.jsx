// Album phòng Selfbooth (in tờ 20 × 30 ở quầy, máy DNP DS820) — giao diện và các bước như album của web Selfbooth
// (14/11 chủ tiệm yêu cầu "làm theo Selfbooth"): 01 Ảnh (thư viện: thả tim, thêm ảnh từ điện thoại, xoá, tải,
// chọn nhiều; chạm ảnh để làm đẹp) → 02 Chủ đề (chọn một bộ khung) → 03 Ghép ảnh (mọi khung của bộ: chạm ô,
// chọn ảnh, kéo để dời, phóng to) → 04 Kết quả (mỗi khung là một tờ 20 × 30; chọn tờ muốn in trong số
// tờ của vé rồi gửi in lên Hàng chờ in của quầy — /albums/:token/print-pack; nhân viên in ra máy DS820).
// Không tính giờ (20/11 chủ tiệm, như web Selfbooth): khách chọn ảnh, chọn khung, ghép rồi xem bản hoàn thiện
// thong thả; chỉ khi khách bấm "Gửi in" thì lệnh in mới lên Hàng chờ in, nhân viên ở quầy bấm In.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PiArrowLeftBold, PiArrowRightBold, PiCheckBold,
  PiCheckSquareBold, PiDownloadSimpleBold, PiHeartBold, PiHeartDuotone, PiHeartFill, PiImagesDuotone,
  PiPrinterBold, PiPrinterDuotone, PiSelectionAllBold,
  PiSparkleFill, PiSquareBold, PiStackDuotone, PiTicketBold, PiTrashBold,
  PiUploadSimpleBold, PiXBold,
} from "react-icons/pi";
import { RefreshCw } from "lucide-react";
import { api, assetUrl, formatDateTime } from "../../api";
import { Button, ErrorBox, useStudio, useToast } from "../../studio";
import { DEFAULT_ADJUST, FILTER_CSS, isNeutral } from "../../beauty.js";
import { renderPrintFrame } from "../../kiosk/compose.js";

import {
  groupFramePacks, largePrint, loadFrameImage, photoLayout,
} from "../../frame-utils.js";
import { storageLink } from "../../media-delivery.js";
import { savePhoto } from "../../kiosk/direct-upload.js";
import { prepareCameraImageAsync } from "../../image-processing.js";
import { PhotoThumb, photoUrl } from "../photo-thumb.jsx";
import { printPackUpload } from "../print-upload.js";
import { mergeUploadedPhotos, uploadPhotos } from "../upload-photos.js";
import { downloadEach, fetchFiles, usesShareSheet } from "../save-to-phone.js";
import { createStudioMedia } from "../studio-media.js";
import { createCanvasCache } from '../../canvas-cache.js';

import { BeautyEditor } from './BeautyEditor.jsx';
import { FrameEditor, NO_MOVE } from './FrameEditor.jsx';
import { usePhotoSuggestions } from './use-photo-suggestions.js';
import { suggestionTarget } from './photo-suggestions.js';

const STEPS = [
  ["Ảnh", PiImagesDuotone],
  ["Chọn khung", PiStackDuotone],
  ["Ghép ảnh", PiSelectionAllBold],
  ["Bản in", PiPrinterDuotone],
];
const ACCEPTED = /^image\/(jpeg|png|webp)$/;
const MAX_UPLOAD_MB = 40;
const SHARE_BATCH_BYTES = 128 * 1024 * 1024;
const FIRST_GALLERY_PHOTOS = 4;
const pad = (n) => String(n).padStart(2, "0");
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
function useSmallEdits(media, adjustOf, edge = 720) {
  const cache = useMemo(() => createCanvasCache({ maxPixels: 8_000_000, maxEntries: 24 }), [media, edge]);
  useEffect(() => () => {
    for (const key of [...cache.keys()]) cache.delete(key);
  }, [cache]);
  return async (photo) => {
    const adjust = adjustOf(photo.id);
    const key = `${photo.id}:${JSON.stringify(adjust)}`;
    return cache.remember(key, async () => {
      const big = await media.edited(photo, adjust, 'preview');
      try {
        const scale = Math.min(1, edge / Math.max(big.width, big.height));
        const small = document.createElement("canvas");
        small.width = Math.max(1, Math.round(big.width * scale));
        small.height = Math.max(1, Math.round(big.height * scale));
        small.getContext("2d").drawImage(big, 0, 0, small.width, small.height);
        return small;
      } finally { big.width = big.height = 0; }
    });
  };
}

// ─── 01 Ảnh: thư viện ảnh ───────────────────────────────────────────────────────────────────────────────
function EditedThumb({ token, photo, adjust, small, suspended, alt, loading, fetchPriority, onSettled }) {
  const canvas=useRef(null),make=useRef(small);
  const settled=useRef(onSettled);
  make.current=small;
  settled.current=onSettled;
  const [ready,setReady]=useState(false);
  const neutral=isNeutral(adjust),key=JSON.stringify(adjust);
  useEffect(()=>{
    if(suspended)return;
    let alive=true;
    setReady(false);
    if(!neutral)make.current(photo).then(image=>{
      const c=canvas.current;
      if(!alive || !c || !image.width)return;
      c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);setReady(true);
      settled.current?.();
    }).catch(()=>{});
    return ()=>{alive=false};
  },[photo.id,key,suspended]);
  return <>
    {!ready && <PhotoThumb photo={photo} token={token} alt={alt} loading={loading} decoding="async"
      fetchPriority={fetchPriority} onLoad={onSettled} onError={onSettled} style={{filter:FILTER_CSS[adjust.filter]||'none'}}/>}
    <canvas ref={canvas} className="sb-edited-thumb" role="img" aria-label={`${alt} đã chỉnh`} style={{display:ready?'block':'none'}}/>
  </>;
}

function Gallery({ token, photos, favorites, adjustOf, small, suspended, busy, frozen, uploadProgress, selectedPack, downloadingId, saveProgress, readyToSave, shareSheet, onSaveAll,
  suggestions = [], capacity = 0, suggestProgress = null, onFirstPhotosReady, onHeartMany, onFavorite, onDelete, onDownload, onEdit, onUpload, onNext }) {
  const [selecting, setSelecting] = useState(false);
  const [view, setView] = useState("all");
  const suggested = useMemo(() => new Set(suggestions), [suggestions]);
  const showSuggested = view === "suggested" && suggested.size > 0;
  const showFavorites = view === "favorites";
  const shown = showSuggested ? photos.filter((p) => suggested.has(p.id))
    : showFavorites ? photos.filter((p) => p.favorite) : photos;
  const firstPhotos = shown.slice(0, FIRST_GALLERY_PHOTOS);
  const settledThumbnails = useRef(new Set());
  const firstPhotosReady = useRef(false);
  function checkFirstPhotos() {
    if (firstPhotosReady.current || !firstPhotos.length ||
        !firstPhotos.every(p => settledThumbnails.current.has(p.id))) return;
    firstPhotosReady.current = true;
    onFirstPhotosReady();
  }
  // A photo may have been removed while the first row was loading.
  useEffect(checkFirstPhotos);
  // Đã chọn bộ khung: chỉ thả tim cho đủ số ô còn thiếu (ảnh đẹp nhất trước); chưa chọn bộ: cả loạt gợi ý.
  const hearted = new Set(photos.filter((p) => p.favorite).map((p) => p.id));
  const needed = capacity ? Math.max(0, capacity - favorites) : Infinity;
  const unhearted = suggestions.filter((id) => !hearted.has(id)).slice(0, needed);
  const [selected, setSelected] = useState(() => new Set());
  const input = useRef(null);
  const allSelected = selecting && photos.length > 0 && photos.every(p => selected.has(p.id));
  const toggle = (id) => setSelected((old) => {
    const next = new Set(old);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const locked = busy || frozen || Boolean(downloadingId);
  const batch = readyToSave?.scope === "all" ? readyToSave : null;
  const pending = photos.filter(p => p.originalPending).length;
  const batchSuffix = batch?.remaining.length ? " của lượt này" : " còn lại";
  const saveLabel = batch?.files.length
    ? `${batch.download ? "Tải" : "Lưu"} ${batch.files.length} ảnh${batch.total > batch.files.length ? batchSuffix : ""}`
    : batch ? "Tiếp tục lưu ảnh" : "Lưu tất cả ảnh";
  return (
    <>
      <div className="studio-head studio-gallery-head">
        <div>
          <div className="studio-title-row">
            <h2>Thư viện ảnh</h2>
            <span className="studio-photo-total">{photos.length} ảnh</span>
          </div>
          {photos.length > 0 && <p>Chạm để chỉnh ảnh · Thả tim để ghép</p>}
        </div>
        {photos.length > 0 && <div className="gallery-save">
          <Button disabled={!photos.length || busy || Boolean(downloadingId) || pending > 0} onClick={onSaveAll}
            aria-busy={downloadingId === "all"}>
            <PiDownloadSimpleBold aria-hidden="true" /> {saveProgress || saveLabel}
          </Button>
          {photos.length > 0 && <small role="status" className={downloadingId === "all" ? "visually-hidden" : undefined}>
            {downloadingId === "all" ? saveProgress
              : pending ? `Đang nhận ${pending} ảnh gốc từ máy chụp.`
              : batch?.download ? "Ảnh JPG sẽ vào Tệp → Tải về."
              : batch?.files.length && batch.remaining.length ? `Còn ${batch.remaining.length} ảnh sau lượt này.`
              : shareSheet ? "Chọn “Lưu hình ảnh” khi bảng lưu mở." : ""}
          </small>}
        </div>}
      </div>
      <div className="gallery-tools" role="group" aria-label="Công cụ thư viện">
        {selecting ? (
          <button type="button" onClick={() => setSelected(allSelected ? new Set() : new Set(photos.map(p => p.id)))}>
            <PiSelectionAllBold aria-hidden="true" /> {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
          </button>
        ) : <>
          {(favorites > 0 || showFavorites) && <button type="button" aria-pressed={showFavorites}
            onClick={() => setView(showFavorites ? "all" : "favorites")}>
            <PiHeartBold aria-hidden="true" /> Ảnh đã thích
          </button>}
          <button type="button" disabled={locked} onClick={() => input.current?.click()}>
            <PiUploadSimpleBold aria-hidden="true" /> Thêm ảnh
          </button>
          {photos.length > 0 && <button type="button" disabled={locked} onClick={() => {
            setView("all"); setSelecting(true);
          }}><PiSelectionAllBold aria-hidden="true" /> Chọn nhiều</button>}
        </>}
        {uploadProgress && <small role="status">Đang thêm ảnh {uploadProgress.done}/{uploadProgress.total}</small>}
      </div>
      {!selecting && !showFavorites && suggestProgress && (
        <div className="suggest-bar is-working" role="status">
          <PiSparkleFill aria-hidden="true" />
          <span>Đang tìm ảnh đẹp… {suggestProgress.done}/{suggestProgress.total}</span>
          <span className="suggest-progress" aria-hidden="true">
            <span style={{ width: `${Math.round((100 * suggestProgress.done) / suggestProgress.total)}%` }} />
          </span>
        </div>
      )}
      {!selecting && !showFavorites && !suggestProgress && suggested.size > 0 && (
        <div className="suggest-bar">
          <PiSparkleFill aria-hidden="true" />
          <span>
            <strong>Gợi ý ảnh đẹp</strong>: {suggested.size} ảnh
            {selectedPack && capacity ? <> · {capacity} ô trong bộ “{selectedPack.name}”</> : null}
          </span>
          <div className="suggest-actions">
            <button type="button" aria-pressed={showSuggested} onClick={() => setView(showSuggested ? "all" : "suggested")}>
              {showSuggested ? "Xem tất cả ảnh" : "Xem ảnh đẹp"}
            </button>
            {unhearted.length > 0 && (
              <button type="button" className="is-primary" disabled={frozen} onClick={() => onHeartMany(unhearted)}>
                <PiHeartFill aria-hidden="true" /> Thả tim {unhearted.length} ảnh đẹp
              </button>
            )}
          </div>
        </div>
      )}
      {!shown.length && <p className="empty-state">
        {showFavorites ? "Bạn chưa thả tim ảnh nào." : "Chưa có ảnh trong thư viện."}
      </p>}
      <div className={`studio-grid ${selecting ? "is-selecting" : ""}`}>
        {shown.map((p, i) => {
          const adjust = adjustOf(p.id);
          const number = pad(p.number || i + 1);
          return (
            <figure key={p.id} className={`${p.favorite ? "is-fav" : ""} ${selected.has(p.id) ? "is-picked" : ""} ${suggested.has(p.id) ? "is-suggested" : ""}`}>
              <button type="button" className="studio-photo" aria-label={selecting ? `Chọn ảnh ${number}` : `Xem & chỉnh ảnh ${number}`}
                onClick={() => (selecting ? toggle(p.id) : onEdit(p))}>
                <EditedThumb photo={p} token={token} adjust={adjust} small={small} suspended={suspended} alt={`Ảnh ${number}`}
                  loading={i < FIRST_GALLERY_PHOTOS ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : undefined}
                  onSettled={i < FIRST_GALLERY_PHOTOS && !firstPhotosReady.current ? () => {
                    settledThumbnails.current.add(p.id);
                    checkFirstPhotos();
                  } : undefined} />
              </button>
              {!isNeutral(adjust) && <span className="photo-edited" title="Đã chỉnh sửa"><PiSparkleFill /></span>}
              {suggested.has(p.id) && <span className="photo-suggested" title="Gợi ý ảnh đẹp: cười tươi, rõ nét, không nhắm mắt">Gợi ý ảnh đẹp</span>}
              <div className="tile-actions">
                {selecting ? (
                  <button type="button" className="tile-btn tile-check" role="checkbox" aria-checked={selected.has(p.id)}
                    aria-label={`Đánh dấu ảnh ${number}`} onClick={() => toggle(p.id)}>
                    {selected.has(p.id) ? <PiCheckSquareBold /> : <PiSquareBold />}
                  </button>
                ) : (
                  <>
                    <button type="button" className={`tile-btn${readyToSave?.scope === p.id ? " is-save-ready" : ""}`}
                      disabled={busy || Boolean(downloadingId) || p.originalPending} aria-busy={downloadingId === p.id}
                      aria-label={readyToSave?.scope === p.id ? `Lưu ảnh ${number} đã sẵn sàng` : `Tải ảnh ${number} về máy`}
                      title="Tải ảnh về máy" onClick={() => onDownload(p)}>
                      {readyToSave?.scope === p.id ? <PiCheckBold /> : <PiDownloadSimpleBold />}
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
        multiple disabled={locked} onChange={(e) => {
          if (e.target.files.length) { setView("all"); onUpload(Array.from(e.target.files)); }
          e.target.value = "";
        }} />
      <div className="studio-actions gallery-bar">
        {selecting ? <>
          <Button className="outline" disabled={busy} aria-label="Thoát chế độ chọn"
            onClick={() => { setSelecting(false); setSelected(new Set()); }}>Hủy chọn</Button>
          <Button className="outline gallery-delete" disabled={!selected.size || locked}
            onClick={async () => { if (await onDelete([...selected])) { setSelected(new Set()); setSelecting(false); } }}>
            <PiTrashBold aria-hidden="true" /> Xóa ({selected.size})
          </Button>
        </> : <>
          <span className="fav-count" aria-live="polite"><PiHeartFill aria-hidden="true" />{`Thích · ${favorites}`}</span>
          <Button disabled={!photos.length || busy} onClick={onNext}>Chọn khung in <PiArrowRightBold aria-hidden="true" /></Button>
        </>}
      </div>
    </>
  );
}

// ─── 02 Chủ đề: chọn một bộ khung ───────────────────────────────────────────────────────────────────────
function ThemePicker({ packs, selected, favorites, frozen, unit, onSelect, onBack, onNext }) {
  const pack = packs.find((p) => p.id === selected);
  const capacity = capacityOf(pack);
  const missing = pack ? Math.max(0, capacity - favorites) : 0;
  return (
    <>
      <div className="studio-head theme-catalog-head">
        <div>
          <h2>Chọn bộ khung</h2>
          <p>{packs.length > 1 ? "Chạm bộ bạn thích để chọn. " : ""}Mỗi khung in trên một {unit} cm.</p>
        </div>
        <span className="theme-total">{packs.length} bộ khung</span>
      </div>
      <div className={`theme-catalog${packs.length === 1 ? " is-single" : ""}`}>
        {packs.map((p) => (
          <button key={p.id} type="button" className={p.id === selected ? "active" : ""} aria-pressed={p.id === selected}
            disabled={frozen} aria-label={`Chọn bộ ${p.name}, ${p.frames.length} khung, ${capacityOf(p)} ô ảnh`}
            onClick={() => onSelect(p.id)}>
            <span className="theme-big-preview" aria-hidden="true" style={{
              "--preview-columns": Math.min(3, p.frames.length),
              "--preview-rows": Math.ceil(p.frames.length / 3),
            }}>
              {p.frames.map((f, index) => (
                <span className="theme-preview-frame" key={f._id}>
                  <img src={assetUrl(f.thumb || f.image)} alt="" loading={p === packs[0] && index === 0 ? "eager" : "lazy"} decoding="async" />
                </span>
              ))}
            </span>
            <span className="theme-list-info">
              <span className="theme-card-title">
                <strong>{p.name}</strong>
                {p.id === selected && <span className="theme-choice"><PiCheckBold aria-hidden="true" /> Đã chọn</span>}
              </span>
              <span className="theme-card-meta">
                <span><PiStackDuotone aria-hidden="true" /> {p.frames.length} khung</span>
                <span><PiImagesDuotone aria-hidden="true" /> {capacityOf(p)} ô ảnh</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      {!packs.length && <div className="empty-state">Studio chưa có bộ khung in {unit}. Vui lòng liên hệ lễ tân.</div>}
      <div className="studio-actions theme-action-bar">
        <Button className="outline" onClick={onBack}><PiArrowLeftBold aria-hidden="true" /> Quay lại</Button>
        {pack && <span className="theme-action-summary" role="status">
          <PiHeartFill aria-hidden="true" />
          {missing ? `Còn thiếu ${missing} ảnh yêu thích, có thể ghép tự động.` : "Đủ ảnh yêu thích để ghép."}
        </span>}
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

// ─── 03 Ghép ảnh: cả bộ — mọi khung đã có ảnh, chuyển tab để chỉnh (như PackEditor của web Selfbooth) ─────────
function PackEditor({ token, pack, layouts, index, photos, small, photoOf, adjustOf, frozen, onIndex, onSlots, onReshuffle, onBack, onNext }) {
  const toast = useToast();
  const at = Math.min(index, pack.frames.length - 1);
  const frame = pack.frames[at];
  function next() {
    const empty = pack.frames.findIndex((f) => !isFilled(f, layouts[f._id]));
    if (empty < 0) return onNext();
    onIndex(empty);
    toast.warning(`Khung “${pack.frames[empty].name}” còn ô chưa có ảnh.`);
  }
  return (
    <>
      {pack.frames.length > 1 && (
        <div className="frame-tabs" role="tablist" aria-label="Các khung trong bộ">
          {pack.frames.map((f, i) => (
            <button key={f._id} type="button" role="tab" aria-selected={i === at} aria-label={f.name}
              className={isFilled(f, layouts[f._id]) ? "" : "missing"} onClick={() => onIndex(i)}>
              <img src={assetUrl(f.thumb || f.image)} alt="" />
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      )}
      <FrameEditor key={frame._id} token={token} frame={frame}
        title={pack.frames.length > 1 ? `${frame.name} · ${at + 1}/${pack.frames.length}` : frame.name}
        slots={layouts[frame._id] || []} photos={photos} small={small} photoOf={photoOf} adjustOf={adjustOf} frozen={frozen}
        onSlots={(slots) => onSlots(frame._id, slots)} onReshuffle={onReshuffle} onBack={onBack} onNext={next} />
    </>
  );
}

// ─── 04 Kết quả: mỗi khung một tờ 20 × 30, chọn tờ muốn in ─────────────────────
function Result({ booking, sheets, error, picked, remaining, quota, used, printing, unit, word, onToggle, onPrint, onBack, onRetry }) {
  return (
    <>
      <div className="studio-head result-head">
        <div>
          <h2>Thành phẩm của bạn</h2>
          <p>{error ? "Thử lại để tạo ảnh in." : sheets.length ? `Chạm vào ${word} bạn muốn in, rồi bấm Gửi in.` : "Đang tạo ảnh chất lượng cao…"}</p>
        </div>
      </div>
      <p className={`print-quota ${remaining ? "" : "empty"}`}>
        <PiPrinterDuotone aria-hidden="true" />
        <span>
          <b>{remaining ? `Còn ${remaining}/${quota} ${unit} cm` : "Đã dùng hết lượt in"}</b>
          <small>Vé #{booking.code} · Đã gửi {used} {word}{!remaining && " · Mua thêm lượt tại quầy"}</small>
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
              <span className="sheet-pick">{picked.has(i) ? <><PiCheckBold aria-hidden="true" /> Đã chọn</> : remaining ? "Chọn để in" : "Xem trước"}</span>
            </button>
            <figcaption>{s.name}</figcaption>
          </figure>
        ))}
      </div>
      <div className="studio-actions">
        <Button className="outline" disabled={printing} onClick={onBack}><PiArrowLeftBold aria-hidden="true" /> Sửa khung</Button>
        <Button disabled={printing || !picked.size || !sheets.length} onClick={onPrint}>
          <PiPrinterBold aria-hidden="true" /> {printing ? "Đang gửi in…" : `Gửi in (${picked.size} ${word})`}
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
  // Phòng Selfbooth in tờ 20 × 30 máy DS820: album chỉ dùng khung khổ này.
  const size = "large";
  const unit = "tờ 20 × 30", word = "tờ";
  // Bộ khung: khung đúng khổ đang bật gom theo chủ đề (chủ đề đang tắt thì ẩn), theo thứ tự chủ đề của tiệm.
  const packs = useMemo(() => {
    const hidden = new Set((settings.themes || []).filter((t) => t.active === false).map((t) => t.name));
    const frames = catalog.filter((f) => f.active !== false && f.printSize === size && slotsOf(f).length &&
      !hidden.has(f.themeName?.trim()));
    return groupFramePacks(frames, (settings.themes || []).map((t) => t.name));
  }, [catalog, settings.themes, size]);
  const pack = packs.find((p) => p.id === saved.packId);
  const required = capacityOf(pack);
  const layoutsOf = (p, layouts) => p && p.frames.every((f) => layouts[f._id]?.length === slotsOf(f).length);
  const ready = Boolean(layoutsOf(pack, saved.layouts));
  const filled = ready && pack.frames.every((f) => isFilled(f, saved.layouts[f._id]));
  const quota = Math.max(1, Number(booking.prints) || 1);
  const used = Number(booking.printSheets) || 0;
  const [result, setResult] = useState(null);
  const submitted = result ? Math.max(used, result.usedBefore + (result.count || 0)) : used;
  const remaining = Math.max(0, quota - submitted);
  const [editing, setEditing] = useState(null);
  const [firstPhotosReady, setFirstPhotosReady] = useState(false);
  const [shortage, setShortage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [saveProgress, setSaveProgress] = useState("");
  const [readyToSave, setReadyToSave] = useState(null);
  const [shareSheet] = useState(usesShareSheet);
  const savingPhotos = useRef(false);
  const [printing, setPrinting] = useState(false);
  const step = saved.step;
  const showReceipt = Boolean(result && step === 3);
  const suggestLimit = suggestionTarget({ total: photos.length, packCapacity: required, packCapacities: packs.map(capacityOf) });
  const { progress: suggestProgress, suggested: suggestedIds } = usePhotoSuggestions(token, photos, {
    limit: suggestLimit,
    paused: !firstPhotosReady || step !== 0 || Boolean(editing || busy || downloadingId),
  });
  const suggested = useMemo(() => new Set(suggestedIds), [suggestedIds]);
  const [error, setError] = useState("");
  const mutating = useRef(false);
  const bookingRef = useRef(booking);
  bookingRef.current = booking;

  // Ảnh bị xoá / bộ khung bị gỡ: đưa lựa chọn về trạng thái hợp lệ.
  const idsKey = [...ids].join();
  useEffect(() => setReadyToSave(null), [idsKey, token]);
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

  const frozen = printing || showReceipt;

  // ── Thư viện ──
  function toggleHeart(photo) {
    if (frozen) return;
    save((v) => ({ hearts: v.hearts.includes(photo.id) ? v.hearts.filter((h) => h !== photo.id) : [...v.hearts, photo.id] }));
  }
  function heartMany(list) {
    if (frozen || !list.length) return;
    save((v) => ({ hearts: [...v.hearts, ...list.filter((id) => !v.hearts.includes(id))] }));
    toast.success(`Đã thả tim ${list.length} ảnh đẹp được gợi ý.`);
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
          return savePhoto(`/albums/${token}/photos`, file, { name: file.name, clientKey, preview, onlyNewPhoto: true });
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
  const photoEntry = photo => ({
    url: `${photoUrl(token, photo.id)}?download=1`,
    link: storageLink(photo, "download"),
    name: `anh-${pad(photo.number)}.jpg`,
    type: "image/jpeg",
  });

  async function savePhotos(scope, work) {
    if (savingPhotos.current) return;
    savingPhotos.current = true;
    setDownloadingId(scope);
    try {
      await work();
    } catch (e) {
      if (e.name !== "AbortError") toast.error(`Không lưu được ảnh: ${e.message}`);
    } finally {
      savingPhotos.current = false;
      setDownloadingId(null);
      setSaveProgress("");
    }
  }
  async function prepareShare(scope, entries, total = entries.length, cache = new Map()) {
    const completed = total - entries.length;
    const progress = done => setSaveProgress(`Đang chuẩn bị ${completed + done}/${total} ảnh…`);
    progress(0);
    const prepared = await fetchFiles(entries, cache, progress, { maxBytes: SHARE_BATCH_BYTES });
    // A few requests can finish together after crossing the byte limit. Keep
    // their JPEGs for the next batch and release the shared files from the cache.
    let count = 0, bytes = 0;
    for (const file of prepared) {
      if (count && bytes + file.size > SHARE_BATCH_BYTES) break;
      bytes += file.size;
      count++;
    }
    let files = prepared.slice(0, count);
    while (files.length > 1 && !navigator.canShare({ files })) files = files.slice(0, -1);
    for (const entry of entries.slice(0, files.length)) cache.delete(entry.url);
    return { scope, files, total, cache, remaining: entries.slice(files.length), download: !navigator.canShare({ files }) };
  }
  async function downloadFiles(files) {
    const entries = files.map(file => ({ url: URL.createObjectURL(file), name: file.name }));
    try { await downloadEach(entries); }
    finally { setTimeout(() => entries.forEach(entry => URL.revokeObjectURL(entry.url)), 30_000); }
  }
  async function shareBatch(batch, fromPreparation = false) {
    setReadyToSave(batch);
    const { scope, files, remaining, total, cache, download } = batch;
    // Safari lets a quick fetch use the tap that started it. After a slow fetch,
    // keep the prepared bytes and let the same button open the system sheet.
    if (fromPreparation && (download || navigator.userActivation?.isActive === false)) return;
    if (download) await downloadFiles(files);
    else {
      try { await navigator.share({ files }); }
      catch (e) {
        if (e.name === "AbortError" || (fromPreparation && e.name === "NotAllowedError")) return;
        setReadyToSave({ ...batch, download: true });
        toast.info("Có thể tải các ảnh này vào thư mục Tải về.");
        return;
      }
    }
    setReadyToSave(remaining.length ? { scope, files: [], remaining, total, cache } : null);
    if (remaining.length) setReadyToSave(await prepareShare(scope, remaining, total, cache));
  }
  function resumeSave(batch) {
    return savePhotos(batch.scope, async () => {
      if (batch.files.length) await shareBatch(batch);
      else await shareBatch(await prepareShare(batch.scope, batch.remaining, batch.total, batch.cache), true);
    });
  }
  function downloadAll() {
    if (!photos.length || photos.some(photo => photo.originalPending)) return;
    if (readyToSave?.scope === "all") return resumeSave(readyToSave);
    return savePhotos("all", async () => {
      const entries = photos.map(photoEntry);
      setReadyToSave(null);
      if (shareSheet) await shareBatch(await prepareShare("all", entries), true);
      else await downloadEach(entries);
    });
  }
  function downloadOne(photo, { inEditor = false } = {}) {
    if (photo.originalPending) return;
    const adjust = adjustOf(photo.id);
    const scope = inEditor ? `edit:${photo.id}:${JSON.stringify(adjust)}` : photo.id;
    if (readyToSave?.scope === scope) return resumeSave(readyToSave);
    return savePhotos(scope, async () => {
      setReadyToSave(null);
      const entry = photoEntry(photo);
      if (isNeutral(adjust)) {
        if (shareSheet) await shareBatch(await prepareShare(scope, [entry]), true);
        else await downloadEach([entry]);
      } else {
        // Render the guest JPEG from camera pixels, at up to 20MP, independently
        // of both the interactive preview and the 3000px print source.
        const canvas = await media.edited(photo, adjust, "download");
        let blob;
        try { blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("máy không đủ bộ nhớ"))), "image/jpeg", 0.95)); }
        finally { canvas.width = canvas.height = 0; }
        const file = new File([blob], entry.name, { type: entry.type });
        if (shareSheet) await shareBatch({ scope, files: [file], remaining: [], total: 1, download: !navigator.canShare({ files: [file] }) }, true);
        else await downloadFiles([file]);
      }
    });
  }

  // ── Chủ đề & ghép ảnh ──
  const go = (step) => {
    setError("");
    save(step === 1 && !pack && packs.length === 1 ? { step, packId: packs[0].id } : { step });
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };
  function choosePack(id) {
    if (frozen) return;
    for (const frame of packs.find((p) => p.id === id)?.frames || []) loadFrameImage(frame.image).catch(() => {});
    if (id !== saved.packId) save({ packId: id, layouts: {}, frameIndex: 0, autoFill: false });
  }
  // Ghép tự động: ảnh yêu thích trước, rồi ảnh gợi ý, rồi các ảnh còn lại.
  const pool = (autoFill) => autoFill
    ? [...favorites, ...photos.filter((p) => !p.favorite && suggested.has(p.id)), ...photos.filter((p) => !p.favorite && !suggested.has(p.id))].map((p) => p.id)
    : favorites.map((p) => p.id);
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

  // ── Kết quả: dựng tờ in 20 × 30 cho từng khung của bộ ──
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
        // Tờ 20 × 30: đúng 2400 × 3600 (hoặc ngang) như máy chủ đòi; JPEG 0,95 giữ chi tiết mà vẫn gửi nhanh qua 4G.
        const sheet = largePrint(canvas);
        const data = await new Promise((resolve) => resolve(sheet.toDataURL("image/jpeg", 0.95)));
        const preview = canvas.toDataURL("image/jpeg", 0.85);
        if (sheet !== canvas) sheet.width = sheet.height = 0;
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
  }, [saved.step, sheetKey, filled, renderTurn, result]);
  function togglePick(i) {
    if (printing) return;
    if (picked.has(i)) return setPicked((old) => new Set([...old].filter((k) => k !== i)));
    if (picked.size >= remaining)
      return toast.warning(remaining ? `Vé của bạn còn ${remaining} ${word} in — bỏ chọn một ${word} khác trước.` : `Vé đã dùng hết ${word} in.`);
    setPicked((old) => new Set(old).add(i));
  }

  // ── Gửi in (chỉ khi khách bấm) ──
  // Lệnh in đã chuẩn bị được giữ tới khi máy chủ nhận: thử lại gửi đúng các tấm đó (cùng mã lệnh in), máy chủ
  // nhận ra lần gửi trước nếu nó đã tới.
  const printLock = useRef(false);
  const prepared = useRef(null);
  const [failed, setFailed] = useState(false);
  function confirmPrint() {
    setResult({ usedBefore: used, ...prepared.current?.done });
    save({ step: 3 });
    prepared.current = null;
    reload?.();
  }
  async function print() {
    if (printLock.current || result || !remaining) return;
    printLock.current = true;
    setPrinting(true);
    setError("");
    setFailed(false);
    try {
      const lookup = () => api(`/albums/${token}/print?requestKey=${saved.requestKey}`, { allowNull: true });
      if (await lookup()) { confirmPrint(); return; }
      if (!prepared.current) {
        const chosen = [...picked].sort((a, b) => a - b).filter((i) => sheets[i]).slice(0, remaining);
        if (!chosen.length) throw new Error(`Chọn ít nhất 1 ${word} để in.`);
        prepared.current = {
          options: printPackUpload({
            images: chosen.map((i) => sheets[i].data), frameName: pack?.name || "Khung ảnh", requestKey: saved.requestKey,
          }),
          done: { count: chosen.length, previews: chosen.map((i) => sheets[i].preview) },
        };
      }
      await api(`/albums/${token}/print-pack`, prepared.current.options);
      confirmPrint();
    } catch (e) {
      // Mã 409 có thể là lệnh in trước đã tới (mất phản hồi): chỉ lệnh in đã lưu mới chứng minh điều đó.
      const previous = e.status === 409 && await api(`/albums/${token}/print?requestKey=${saved.requestKey}`, { allowNull: true }).catch(() => null);
      if (previous) confirmPrint();
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
  const pendingOriginals = photos.filter((p) => p.originalPending).length;

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
          <span>{expires ? <>Ảnh đầu tiên hết hạn lúc <strong>{expires}</strong></> : "Ảnh được lưu 3 ngày"}</span>
        </p>
        {pendingOriginals > 0 && step !== 0 && !showReceipt && (
          <p className="sb-timer" role="status">
            Đang nhận {pendingOriginals} ảnh gốc để in.
          </p>
        )}
      </div>
      <nav className="studio-steps" aria-label="Các bước">
        {STEPS.map(([label, Icon], i) => (
          <button key={label} type="button" className={i === step ? "active" : i < step ? "done" : ""}
            aria-current={i === step ? "step" : undefined} disabled={frozen || !canOpen(i)}
            onClick={() => (i === 2 && step < 2 ? toCompose() : go(i))}>
            <span aria-hidden="true">{i < step ? <PiCheckBold /> : <Icon />}</span>
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
      {showReceipt ? (
        <div className="print-confirmation">
          <span className="print-confirmation-check" aria-hidden="true"><PiCheckBold /></span>
          <h2>Đã gửi in!</h2>
          <p>Đọc mã <strong>#{booking.code}</strong> tại quầy để nhận ảnh.</p>
          <div className="print-confirmation-actions">
            <Button onClick={() => { setSheets([]); setPicked(new Set()); go(0); }}>
              <PiImagesDuotone aria-hidden="true" /> Về thư viện ảnh
            </Button>
            {remaining > 0 && (
              <Button className="outline" onClick={() => {
                setSheets([]);
                setPicked(new Set());
                setResult(null);
                save({ requestKey: crypto.randomUUID() });
              }}>In thêm ({remaining} {word} còn lại)</Button>
            )}
          </div>
          {result.previews?.length > 0 && (
            <div className="sheet-strip is-done">
              {result.previews.map((src, i) => <img key={i} src={src} alt={`Tấm đã gửi in ${i + 1}`} />)}
            </div>
          )}
          <p className="print-confirmation-ticket">Đã gửi {Math.min(quota, submitted)}/{quota} {word}</p>
        </div>
      ) : step === 0 ? (
        <Gallery token={token} photos={newestFirst} favorites={favorites.length} adjustOf={adjustOf} small={small} suspended={Boolean(editing)} busy={busy} frozen={frozen}
          uploadProgress={uploadProgress} selectedPack={pack} downloadingId={downloadingId} onFavorite={toggleHeart}
          saveProgress={downloadingId === "all" ? (saveProgress || "Đang tải ảnh…") : ""}
          readyToSave={readyToSave} shareSheet={shareSheet} onSaveAll={downloadAll}
          onFirstPhotosReady={() => setFirstPhotosReady(true)}
          suggestions={suggestedIds} capacity={pack ? required : 0} suggestProgress={suggestProgress} onHeartMany={heartMany}
          onDelete={removePhotos} onDownload={downloadOne} onEdit={(p) => setEditing(p.id)} onUpload={upload}
          onNext={() => go(1)} />
      ) : step === 1 ? (
        <ThemePicker packs={packs} selected={saved.packId} favorites={favorites.length} frozen={frozen} unit={unit}
          onSelect={choosePack} onBack={() => go(0)} onNext={toCompose} />
      ) : step === 2 && ready ? (
        <PackEditor token={token} pack={pack} layouts={saved.layouts} index={saved.frameIndex} photos={carousel}
          small={small} photoOf={photoOf} adjustOf={adjustOf} frozen={frozen}
          onIndex={(frameIndex) => save({ frameIndex })}
          onSlots={(frameId, slots) => save((v) => ({ layouts: { ...v.layouts, [frameId]: slots } }))}
          onReshuffle={reshuffle} onBack={() => go(1)} onNext={() => go(3)} />
      ) : step === 3 && filled ? (
        <Result booking={booking} sheets={sheets} error={sheetError} picked={picked} remaining={remaining} quota={quota}
          used={used} printing={printing} unit={unit} word={word} onToggle={togglePick} onPrint={() => print()} onBack={() => go(2)}
          onRetry={() => setRenderTurn((n) => n + 1)} />
      ) : null}
      {shortage && pack && (
        <ShortageDialog pack={pack} required={required} favorites={favorites.length} totalPhotos={photos.length}
          onMore={() => { setShortage(false); go(0); }} onAutomatic={() => beginCompose(true)} onClose={() => setShortage(false)} />
      )}
      {editPhoto && (
        <BeautyEditor token={token} media={media} photo={editPhoto} photos={newestFirst} adjust={saved.adjusts[editPhoto.id]} disabled={frozen}
          onChange={(adjust) => save((v) => ({ adjusts: { ...v.adjusts, [editPhoto.id]: adjust } }))}
          onNavigate={setEditing} onDownload={photo => downloadOne(photo, { inEditor: true })} downloading={Boolean(downloadingId)}
          downloadLabel={readyToSave?.scope === `edit:${editPhoto.id}:${JSON.stringify(adjustOf(editPhoto.id))}`
            ? readyToSave.download ? "Tải JPG" : "Lưu vào Ảnh" : undefined}
          onApplyAll={(adjust) => {
            if (frozen) return;
            save((v) => ({ adjusts: { ...v.adjusts, ...Object.fromEntries(photos.map(p => [p.id, { ...adjust }])) } }));
            toast.success(`Đã áp dụng chỉnh sửa cho ${photos.length} ảnh.`);
          }}
          onFavorite={toggleHeart} onDelete={removePhotos} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
