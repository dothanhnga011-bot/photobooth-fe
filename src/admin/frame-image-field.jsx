import { useEffect, useRef, useState } from "react";
import { RotateCcw, RotateCw, ScanSearch, Trash2, Undo2, Upload } from "lucide-react";
import { loadFrameImage } from "../frame-utils.js";
import { detectFrameSlots, prepareFrame, rotateFrame } from "../frame-import.js";
import { FrameRegionEditor } from "./frame-region-editor.jsx";
import { useToast } from "../studio";

// Tờ in 20 × 30 cm ở 300 dpi: cạnh dài 3600 px (khung nguyên tờ 2400 × 3600, khung dải 1200 × 3600).
export const PRINT_LONG_EDGE = 3600;

// Kích thước thật của ảnh khung, để báo khi ảnh nhỏ hơn khổ in (in ra sẽ phải phóng to).
function useImageSize(image) {
  const [size, setSize] = useState(null);
  useEffect(() => {
    let live = true;
    setSize(null);
    if (image) loadFrameImage(image).then(
      (im) => live && setSize({ width: im.naturalWidth, height: im.naturalHeight }),
      () => {},
    );
    return () => { live = false; };
  }, [image]);
  return size;
}

export function FrameImageField({ value, onChange, onBusyChange = () => {} }) {
  const toast = useToast();
  const size = useImageSize(value.image);
  // Dưới 95 % cạnh dài của khổ in: hoạ tiết, chữ của khung bị phóng to khi in nên kém nét.
  const lowResolution = size && Math.max(size.width, size.height) < PRINT_LONG_EDGE * 0.95;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [history, setHistory] = useState([]);
  const input = useRef(null), mounted = useRef(false), working = useRef(false);
  // Import can finish after the user edits the name/theme. Publish through the
  // latest callback so those newer fields are not replaced by an old form snapshot.
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const changeFrame = next => {
    if (next.image === value.image && JSON.stringify(next.slots) === JSON.stringify(value.slots || [])) return;
    setHistory(previous => [...previous.slice(-19), { image: value.image, slots: value.slots || [] }]);
    setError(""); latestChange.current(next);
  };
  const changeSlots = slots => changeFrame({ image: value.image, slots });
  async function work(task) {
    if (working.current) return;
    working.current = true; setBusy(true); onBusyChange(true); setError("");
    try { await task(); }
    catch (err) {
      if (mounted.current) { setError(err.message); toast.error(err.message); }
    } finally {
      working.current = false;
      if (mounted.current) { setBusy(false); onBusyChange(false); }
    }
  }
  async function load(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.warning("Vui lòng chọn ảnh khung dạng PNG, JPG hoặc WebP."); return;
    }
    const previous = value.image && value.slots?.length ? value : null;
    await work(async () => {
      const frame = await prepareFrame(file);
      if (!mounted.current) return;
      // Thay bằng ảnh cùng tỉ lệ (vd. bản nét hơn của cùng thiết kế): giữ các ô đã chỉnh tay (ô
      // nghiêng, thứ tự…) — toạ độ ô tính theo tỉ lệ khung nên vẫn đúng. Vẫn hoàn tác được.
      if (previous) {
        const [before, after] = await Promise.all([loadFrameImage(previous.image), loadFrameImage(frame.image)]);
        const sameShape = Math.abs((before.naturalWidth / before.naturalHeight) /
          (after.naturalWidth / after.naturalHeight) - 1) < 0.01;
        if (!mounted.current) return;
        if (sameShape) {
          changeFrame({ image: frame.image, slots: previous.slots });
          toast.success(`Đã thay ảnh khung, giữ nguyên ${previous.slots.length} ô ảnh. Khung mới khác bố cục thì bấm Tự nhận diện.`);
          return;
        }
      }
      setHistory([]); latestChange.current(frame);
      if (!frame.slots.length) toast.info("Chưa tự tìm được ô ảnh. Bấm Vẽ vùng ảnh để đánh dấu các ô.");
      else toast.success(`Đã nhận diện ${frame.slots.length} ô ảnh. Kiểm tra và chỉnh vùng đỏ nếu cần.`);
    });
  }
  return <div className="frame-image-field" aria-busy={busy}>
    <input ref={input} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp"
      aria-label="Chọn file ảnh khung" disabled={busy} onChange={event => {
        load(event.target.files?.[0]); event.target.value = "";
      }} />
    {!value.image ? <button type="button" disabled={busy}
      className={`frame-drop${over ? " over" : ""}`} onClick={() => input.current.click()}
      onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={event => { event.preventDefault(); setOver(false); load(event.dataTransfer.files?.[0]); }}>
      <span className="frame-drop-empty"><Upload size={26} />
        <strong>{busy ? "Đang phân tích khung…" : "Chọn hoặc kéo thả ảnh khung"}</strong>
        <small>PNG / WebP giữ nền trong suốt · JPG có ô trắng</small>
      </span>
    </button> : <>
      <div className="frame-region-actions">
        <button type="button" disabled={busy} onClick={() => work(async () => {
          const slots = detectFrameSlots(await loadFrameImage(value.image));
          if (!mounted.current) return;
          changeSlots(slots);
          if (!slots.length) toast.info("Chưa tự tìm được ô ảnh. Bạn có thể vẽ vùng ảnh thủ công.");
        })}><ScanSearch size={15} /> Tự nhận diện</button>
        <button type="button" disabled={busy} onClick={() => input.current.click()}><Upload size={15} /> Thay ảnh</button>
        {[false, true].map(clockwise => <button type="button" key={String(clockwise)} disabled={busy}
          aria-label={`Xoay cả khung ${clockwise ? "phải" : "trái"} 90°`} onClick={() => work(async () => {
            const next = await rotateFrame(value.image, value.slots || [], clockwise);
            if (mounted.current) changeFrame(next);
          })}>{clockwise ? <RotateCw size={15} /> : <RotateCcw size={15} />} 90°</button>)}
        <button type="button" disabled={busy || !history.length} onClick={() => {
          onChange(history.at(-1));
          setHistory(history.slice(0, -1)); setError("");
        }}><Undo2 size={15} /> Hoàn tác</button>
      </div>
      <FrameRegionEditor key={value.image} image={value.image} slots={value.slots || []}
        disabled={busy} onChange={changeSlots} />
      <div className="frame-drop-meta">
        <span aria-live="polite"><strong>{value.slots?.length || 0} ô ảnh</strong> · ghép theo thứ tự đánh số</span>
        <button type="button" disabled={busy} className="text-link" onClick={() => {
          setError(""); setHistory([]); onChange({ image: "", slots: [] });
        }}><Trash2 size={14} /> Bỏ ảnh</button>
      </div>
      {lowResolution && <p className="frame-resolution-warning" role="note">
        Ảnh khung chỉ <b>{size.width} × {size.height} px</b>, nhỏ hơn khổ in 20 × 30 cm (cạnh dài{" "}
        {PRINT_LONG_EDGE} px): khi in, hoạ tiết và chữ của khung bị phóng to {(
          PRINT_LONG_EDGE / Math.max(size.width, size.height)).toFixed(1).replace(".", ",")} lần nên
        kém nét. Nên xuất lại từ file thiết kế đúng <b>2400 × 3600 px</b> (khung dải 1200 × 3600) rồi
        bấm <b>Thay ảnh</b> — các ô ảnh đã chỉnh được giữ nguyên.
      </p>}
    </>}
    {busy && <small role="status">Đang đọc ảnh khung…</small>}
    {error && <small className="error-text" role="alert">{error}</small>}
  </div>;
}
