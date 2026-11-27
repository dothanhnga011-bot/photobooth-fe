// Album Selfbooth — bước 01 Ảnh: thư viện ảnh (thả tim, thêm ảnh từ điện thoại, xoá, tải, chọn nhiều).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PiArrowRightBold, PiCheckBold, PiCheckSquareBold, PiDownloadSimpleBold, PiHeartBold, PiHeartFill, PiLockSimpleBold, PiPlusBold, PiSelectionAllBold, PiSparkleFill, PiSquareBold, PiTrashBold,
} from "react-icons/pi";
import { Button } from "../../studio";
import { FILTER_CSS, isNeutral } from "../../beauty.js";
import { PhotoThumb } from "../photo-thumb.jsx";
import { FIRST_GALLERY_PHOTOS, pad } from "./album-helpers.js";

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key = công thức làm đẹp (neutral suy ra từ đó); photo mới mỗi lần album hỏi lại
  },[photo.id,key,suspended]);
  return <>
    {!ready && <PhotoThumb photo={photo} token={token} alt={alt} loading={loading} decoding="async"
      fetchPriority={fetchPriority} onLoad={onSettled} onError={onSettled} style={{filter:FILTER_CSS[adjust.filter]||'none'}}/>}
    <canvas ref={canvas} className="sb-edited-thumb" role="img" aria-label={`${alt} đã chỉnh`} style={{display:ready?'block':'none'}}/>
  </>;
}

export function Gallery({ token, photos, favorites, adjustOf, small, suspended, busy, frozen, uploadProgress, selectedPack, downloadingId, saveProgress, readyToSave, mobileSave, saveAvailable, saveHint, onSaveAll,
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
    ? `Lưu ${batch.files.length} ảnh${batch.total > batch.files.length ? batchSuffix : ""}`
    : batch ? "Tiếp tục lưu ảnh" : "Lưu tất cả ảnh";
  return (
    <>
      <div className="studio-head studio-gallery-head">
        <div>
          <div className="studio-title-row">
            <h2>Thư viện ảnh</h2>
            <span className="studio-photo-total">{photos.length} ảnh</span>
          </div>
          {photos.length > 0 && <p>Chạm ảnh để chỉnh, thả tim để ghép.</p>}
        </div>
      </div>
      <div className="gallery-tools" role="group" aria-label="Công cụ thư viện">
        {selecting ? (
          <button type="button" onClick={() => setSelected(allSelected ? new Set() : new Set(photos.map(p => p.id)))}>
            <PiSelectionAllBold aria-hidden="true" /> {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
          </button>
        ) : <>
          {photos.length > 0 && <button type="button" className={batch ? "is-save-ready" : undefined}
            disabled={!saveAvailable || busy || Boolean(downloadingId) || pending > 0} onClick={onSaveAll} aria-busy={downloadingId === "all"}
            aria-describedby="sb-gallery-save-hint">
            <PiDownloadSimpleBold aria-hidden="true" /> {saveProgress || saveLabel}
          </button>}
          {photos.length > 0 && <button type="button" disabled={locked} onClick={() => {
            setView("all"); setSelecting(true);
          }}><PiSelectionAllBold aria-hidden="true" /> Chọn nhiều</button>}
          {(favorites > 0 || showFavorites) && <button type="button" aria-pressed={showFavorites}
            onClick={() => setView(showFavorites ? "all" : "favorites")}>
            <PiHeartBold aria-hidden="true" /> Ảnh đã thích
          </button>}
          {photos.length > 0 && <small id="sb-gallery-save-hint" role="status" className={downloadingId === "all" ? "visually-hidden" : undefined}>
            {downloadingId === "all" ? saveProgress
              : pending ? `Đang nhận ${pending} ảnh gốc từ máy chụp.`
              : batch?.files.length && batch.remaining.length ? `${saveHint} Còn ${batch.remaining.length} ảnh sau lượt này.`
              : saveHint}
          </small>}
        </>}
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
      {!shown.length && <div className="empty-state">
        <strong>{showFavorites ? "Bạn chưa thả tim ảnh nào." : "Thư viện chưa có ảnh"}</strong>
        <p>{showFavorites ? "Về thư viện rồi chạm vào hình trái tim bên dưới ảnh bạn thích."
          : "Ảnh từ máy chụp sẽ tự xuất hiện tại đây. Bạn cũng có thể chạm Thêm ảnh để lấy ảnh từ điện thoại."}</p>
        {showFavorites && <Button className="outline" onClick={() => setView("all")}>Xem tất cả ảnh</Button>}
      </div>}
      <div className={`studio-grid ${selecting ? "is-selecting" : ""}`}>
        {/* Ô đầu tiên, ngay cạnh các ảnh vừa chụp: thêm ảnh từ điện thoại (chỉ điện thoại này thấy). */}
        {!selecting && !showFavorites && !showSuggested && (
          <div className="studio-add-tile">
            <button type="button" disabled={locked} aria-busy={Boolean(uploadProgress)} aria-describedby="sb-add-note"
              onClick={() => input.current?.click()}>
              <span className="studio-add-icon" aria-hidden="true"><PiPlusBold /></span>
              <strong>Thêm ảnh</strong>
              <small id="sb-add-note" role="status">
                {uploadProgress ? `Đang thêm ${uploadProgress.done}/${uploadProgress.total}…` : "Từ điện thoại · chỉ bạn thấy"}
              </small>
            </button>
          </div>
        )}
        {shown.map((p, i) => {
          const adjust = adjustOf(p.id);
          const number = pad(p.number || i + 1);
          return (
            <figure key={p.id} className={`${p.favorite ? "is-fav" : ""} ${selected.has(p.id) ? "is-picked" : ""} ${suggested.has(p.id) ? "is-suggested" : ""}`}>
              <button type="button" className="studio-photo" aria-label={selecting ? `Chọn ảnh ${number}` : `Xem & chỉnh ảnh ${number}`}
                aria-pressed={selecting ? selected.has(p.id) : undefined}
                onClick={() => (selecting ? toggle(p.id) : onEdit(p))}>
                <EditedThumb photo={p} token={token} adjust={adjust} small={small} suspended={suspended} alt={`Ảnh ${number}`}
                  loading={i < FIRST_GALLERY_PHOTOS ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : undefined}
                  onSettled={i < FIRST_GALLERY_PHOTOS && !firstPhotosReady.current ? () => {
                    settledThumbnails.current.add(p.id);
                    checkFirstPhotos();
                  } : undefined} />
                {!selecting && <span className="photo-edit-label" aria-hidden="true"><PiSparkleFill /> Chỉnh ảnh</span>}
              </button>
              {!isNeutral(adjust) && <span className="photo-edited" title="Đã chỉnh sửa"><PiSparkleFill /></span>}
              {suggested.has(p.id) && <span className="photo-suggested" title="Gợi ý ảnh đẹp: cười tươi, rõ nét, không nhắm mắt">Gợi ý ảnh đẹp</span>}
              {p.mine && <span className="photo-mine" title="Ảnh bạn thêm từ điện thoại: người khác quét mã không thấy">
                <PiLockSimpleBold aria-hidden="true" /> Chỉ bạn thấy</span>}
              <div className="tile-actions">
                {selecting ? (
                  <button type="button" className="tile-btn tile-check" role="checkbox" aria-checked={selected.has(p.id)}
                    aria-label={`Đánh dấu ảnh ${number}`} onClick={() => toggle(p.id)}>
                    {selected.has(p.id) ? <PiCheckSquareBold /> : <PiSquareBold />}
                  </button>
                ) : (
                  <>
                    <button type="button" className={`tile-btn${readyToSave?.scope === p.id ? " is-save-ready" : ""}`}
                      disabled={!saveAvailable || busy || Boolean(downloadingId) || p.originalPending} aria-busy={downloadingId === p.id}
                      aria-label={readyToSave?.scope === p.id ? `Lưu ảnh ${number} đã sẵn sàng` : mobileSave ? `Lưu ảnh ${number} vào thư viện` : `Tải ảnh ${number} về máy`}
                      title={mobileSave ? "Lưu vào thư viện ảnh" : "Tải ảnh về máy"} onClick={() => onDownload(p)}>
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
