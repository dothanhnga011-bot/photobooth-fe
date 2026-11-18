import { useEffect, useRef, useState } from 'react';
import { PiArrowCounterClockwiseBold, PiCaretLeftBold, PiCaretRightBold, PiCheckBold, PiDownloadSimpleBold, PiEyeBold, PiHeartBold, PiHeartFill, PiMagnifyingGlassPlusBold, PiTrashBold, PiXBold } from 'react-icons/pi';
import { Button } from '../../studio.jsx';
import { ADJUST_LABELS, BEAUTY_PRESETS, DEFAULT_ADJUST, isNeutral, normalizeAdjust } from '../../beauty-settings.js';
import { COLOR_FILTERS, FILTER_CSS } from '../../beauty-render.js';
import { PhotoThumb } from '../photo-thumb.jsx';

// Selfbooth's photo + scroll panel, in Mellow's existing espresso/ivory tokens.
// Serif 24px heading, 12–14px controls, 44px targets; footer stays on screen.
export function BeautyEditor({ token, media, photo, photos = [photo], adjust, onChange, onClose,
  onFavorite, onDelete, onNavigate, onApplyAll, onDownload, downloading = false, disabled }) {
  const dialog = useRef(null), view = useRef(null), original = useRef(null), edited = useRef(null), turn = useRef(0);
  const originalId = useRef('');
  const publish = useRef(onChange), requested = useRef('');
  publish.current = onChange;
  const [faceState, setFaceState] = useState({ status: 'loading', faces: [] });
  const [attempt, setAttempt] = useState(0), [revision, setRevision] = useState(0);
  const [compare, setCompare] = useState(false), [zoom, setZoom] = useState(false), [dragging, setDragging] = useState(false);
  const [rendering, setRendering] = useState(false), [renderError, setRenderError] = useState('');
  const [paintedKey, setPaintedKey] = useState('');
  const [drafts, setDrafts] = useState({});
  const a = normalizeAdjust(drafts[photo.id] || adjust), adjustKey = JSON.stringify(a), edge = dragging ? 640 : 1600;
  const renderKey = `${photo.id}:${adjustKey}:${attempt}:${edge}`;
  requested.current = renderKey;
  const hasOriginal = Boolean(original.current) && originalId.current === photo.id;
  const updating = rendering || (!isNeutral(a) && paintedKey !== renderKey);
  const faceReady = faceState.status === 'ready' && faceState.faces.length > 0;
  const canCommit = !disabled && !updating && !renderError && hasOriginal;
  const index = photos.findIndex(p => p.id === photo.id);
  const move = delta => {
    if (onNavigate && photos.length > 1) onNavigate(photos[(index + delta + photos.length) % photos.length].id);
  };
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog.current?.querySelector('button')?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus?.(); };
  }, []);
  useEffect(() => {
    let alive = true;
    original.current = null; originalId.current = '';
    if (edited.current) edited.current.width = edited.current.height = 0;
    edited.current = null;
    if (view.current) view.current.width = view.current.height = 0;
    setCompare(false); setZoom(false); setDragging(false);
    setFaceState({ status: 'loading', faces: [] });
    media.preview(photo).then(canvas => {
      if (alive) { original.current = canvas; originalId.current = photo.id; setRevision(n => n + 1); }
    }).catch(error => { if (alive) setRenderError(error.message); });
    media.facesOf(photo, { retry: attempt > 0 }).then(faces => {
      if (alive) setFaceState({ status: 'ready', faces });
    }).catch(error => { if (alive) setFaceState({ status: 'error', faces: [], message: error.message }); });
    return () => { alive = false; };
  }, [media, photo.id, attempt]);
  useEffect(() => {
    const current = ++turn.current;
    const isCurrent = () => current === turn.current && requested.current === renderKey;
    setRenderError('');
    if (isNeutral(a)) {
      if (edited.current) edited.current.width = edited.current.height = 0;
      edited.current = null; setRendering(false); setPaintedKey(renderKey); setRevision(n => n + 1);
      publish.current(a); return;
    }
    setRendering(true);
    const timer = setTimeout(async () => {
      try {
        const canvas = await media.edited(photo, a, 'preview', { edge, isCurrent });
        if (!isCurrent()) { canvas.width = canvas.height = 0; return; }
        if (edited.current) edited.current.width = edited.current.height = 0;
        edited.current = canvas; setPaintedKey(renderKey); setRevision(n => n + 1);
        // Keep the timer-driven print path up to date, but never persist a
        // recipe which has failed rendering or belongs to another photo.
        publish.current(a);
      } catch (error) {
        if (isCurrent() && error.name !== 'AbortError') setRenderError(error.message);
      } finally { if (isCurrent()) setRendering(false); }
    }, 60);
    return () => { turn.current++; clearTimeout(timer); };
  }, [media, photo.id, adjustKey, attempt, edge]);
  useEffect(() => () => { turn.current++; if (edited.current) edited.current.width = edited.current.height = 0; }, []);
  useEffect(() => {
    const source = compare || !edited.current ? original.current : edited.current, canvas = view.current;
    if (!source?.width || !canvas) return;
    canvas.width = source.width; canvas.height = source.height;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    if (zoom) {
      const face = faceState.faces[0], scale = source.width / (original.current?.width || source.width);
      const cx = face ? face[168].x * scale : source.width / 2;
      const cy = face ? (face[168].y + face[152].y) / 2 * scale : source.height / 2;
      const w = source.width / 2, h = source.height / 2;
      ctx.drawImage(source, Math.max(0, Math.min(source.width - w, cx - w / 2)), Math.max(0, Math.min(source.height - h, cy - h / 2)), w, h, 0, 0, canvas.width, canvas.height);
    } else ctx.drawImage(source, 0, 0);
  }, [revision, compare, zoom, faceState]);

  function keydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (!event.target.closest('input,textarea,select,button') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
    }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(el => el.tabIndex >= 0 && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  const holdCompare = {
    onPointerDown: event => { event.currentTarget.setPointerCapture(event.pointerId); setCompare(true); },
    onPointerUp: () => setCompare(false), onPointerCancel: () => setCompare(false),
    onLostPointerCapture: () => setCompare(false), onBlur: () => setCompare(false),
    onKeyDown: event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); setCompare(true); } },
    onKeyUp: () => setCompare(false), onContextMenu: event => event.preventDefault(),
  };
  function edit(value) { setCompare(false); setDrafts(v => ({ ...v, [photo.id]: value })); }
  function change(key, value) { edit({ ...a, [key]: value }); }
  const notice = faceState.status === 'loading' ? 'Đang chuẩn bị bộ làm đẹp…' : faceState.status === 'error'
    ? 'Chưa mở được bộ nhận diện. Màu ảnh vẫn dùng được.' : !faceState.faces.length
      ? 'Chưa nhận diện được khuôn mặt rõ. Bạn vẫn đổi màu ảnh được.'
      : `Đã nhận diện ${faceState.faces.length} khuôn mặt · chỉnh trên ảnh này`;
  return <div className="sb-beauty-backdrop">
    <section ref={dialog} className="sb-editor sb-beauty-editor" role="dialog" aria-modal="true" aria-label={`Chỉnh ảnh ${String(photo.number).padStart(2, '0')}`} onKeyDown={keydown}>
      <header className="sb-beauty-head">
        <button type="button" className="sb-icon" onClick={onClose} aria-label="Đóng"><PiXBold /></button>
        <div><h2>Xem & chỉnh ảnh</h2><span className="sb-beauty-number">Ảnh {String(photo.number).padStart(2, '0')}{photos.length > 1 ? ` · ${index + 1}/${photos.length}` : ''}</span></div>
        <button type="button" className="sb-beauty-reset" disabled={disabled || isNeutral(a)} onClick={() => edit({ ...DEFAULT_ADJUST })}><PiArrowCounterClockwiseBold /> Khôi phục</button>
      </header>
      <div className="sb-beauty-workspace">
        <div className="sb-beauty-preview-panel">
          <div className="sb-editor-view sb-beauty-view">
            <canvas ref={view} aria-label={compare ? 'Ảnh gốc để so sánh' : 'Ảnh xem trước'} />
            <div className="sb-beauty-photo-actions">
              <button type="button" className="sb-icon" disabled={disabled} aria-label="Xoá ảnh" onClick={() => onDelete([photo.id])}><PiTrashBold /></button>
              <button type="button" className="sb-icon sb-heart" aria-pressed={photo.favorite} disabled={disabled} aria-label={photo.favorite ? 'Bỏ tim' : 'Thả tim'} onClick={() => onFavorite(photo)}>{photo.favorite ? <PiHeartFill /> : <PiHeartBold />}</button>
            </div>
            {photos.length > 1 && onNavigate && <>
              <button type="button" className="sb-beauty-prev" aria-label="Ảnh trước" onClick={() => move(-1)}><PiCaretLeftBold /></button>
              <button type="button" className="sb-beauty-next" aria-label="Ảnh tiếp" onClick={() => move(1)}><PiCaretRightBold /></button>
            </>}
            <button type="button" className="sb-beauty-zoom" aria-pressed={zoom} aria-label="Phóng to ảnh" onClick={() => setZoom(v => !v)}><PiMagnifyingGlassPlusBold />{zoom ? '2×' : '1×'}</button>
            {(!hasOriginal || updating) && <p className="sb-editor-note" role="status">{!hasOriginal ? 'Đang mở ảnh…' : compare ? 'Ảnh gốc · đang chuẩn bị bản chỉnh' : 'Đang cập nhật ảnh…'}</p>}
            {compare && !updating && <span className="sb-beauty-original-tag">Ảnh gốc · chưa chỉnh</span>}
          </div>
          <div className="sb-beauty-below">
            <button type="button" aria-pressed={compare} disabled={isNeutral(a)} {...holdCompare}><PiEyeBold /> Giữ để so sánh</button>
            {onDownload && <button type="button" disabled={!canCommit || downloading || photo.originalPending} aria-busy={downloading} onClick={() => onDownload(photo)}><PiDownloadSimpleBold />{downloading ? 'Đang lưu…' : 'Tải ảnh về'}</button>}
          </div>
        </div>
        <section className="sb-beauty-panel" aria-label="Công cụ làm đẹp">
          <div className={`sb-beauty-status${!faceReady && faceState.status !== 'loading' ? ' is-warn' : ''}`} role="status">
            <span>{notice}</span>{faceState.status !== 'loading' && !faceReady && <button type="button" onClick={() => setAttempt(n => n + 1)}>Nhận diện lại</button>}
          </div>
          {renderError && <p className="sb-beauty-error" role="alert">Chưa áp dụng được: {renderError} <button type="button" onClick={() => setAttempt(n => n + 1)}>Thử lại</button></p>}
          <h3>Gợi ý nhanh</h3>
          <div className="sb-beauty-presets" role="group" aria-label="Chọn nhanh mức làm đẹp">
            {BEAUTY_PRESETS.map(p => <button key={p.id} type="button" disabled={disabled || !faceReady} aria-pressed={Object.keys(ADJUST_LABELS).every(key => a[key] === (p.values[key] || 0))} onClick={() => edit({ ...DEFAULT_ADJUST, ...p.values, filter: a.filter })}>{p.label}</button>)}
          </div>
          <fieldset className="sb-beauty-adjustments"><legend>Làm đẹp</legend>
            <div className="sb-beauty-sliders">
              {Object.entries(ADJUST_LABELS).map(([key, label]) => <label className="sb-beauty-slider" key={key}>
                <span>{label}<output>{a[key]}</output></span>
                <input type="range" min="0" max="100" step="1" value={a[key]} disabled={disabled || !faceReady} aria-label={label} style={{ '--level': `${a[key]}%` }}
                  onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
                  onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)} onBlur={() => setDragging(false)}
                  onChange={event => change(key, Number(event.target.value))} />
              </label>)}
            </div>
          </fieldset>
          <h3>Màu ảnh</h3>
          <div className="sb-editor-filters" role="radiogroup" aria-label="Bộ lọc màu">
            {Object.entries(COLOR_FILTERS).map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={a.filter === key} disabled={disabled} onClick={() => change('filter', key)}>
              <PhotoThumb key={photo.id} photo={photo} token={token} alt="" style={{ filter: FILTER_CSS[key] || 'none' }} /><span>{label}</span>
            </button>)}
          </div>
          <p className="sb-beauty-hint">0 giữ nguyên · ảnh gốc luôn được giữ riêng.</p>
        </section>
      </div>
      <footer className="sb-editor-foot sb-beauty-foot">
        {onApplyAll && <Button className="outline" disabled={!canCommit} onClick={() => { setDrafts(Object.fromEntries(photos.map(p => [p.id, { ...a }]))); onApplyAll(a); }}>Áp dụng cho tất cả ảnh</Button>}
        <Button disabled={!canCommit} onClick={onClose}><PiCheckBold /> Xong</Button>
      </footer>
    </section>
  </div>;
}
