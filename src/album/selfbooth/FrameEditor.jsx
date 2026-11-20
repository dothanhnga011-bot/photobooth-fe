// 03 Ghép ảnh của album phòng Selfbooth — chép theo FrameEditor của web Selfbooth (19/11 chủ tiệm: "chọn khung sau khi
// chụp giống Selfbooth"): thanh "← tên khung · 1/2 | 2/2 ô", chạm ô để chọn (ô trống: mở danh sách ảnh), kéo 1 ngón
// để dời, chụm 2 ngón / lăn chuột để phóng to, kéo ảnh từ dải ảnh thả vào ô, Đổi ảnh / Dùng cho tất cả ô / Đặt lại,
// thanh phóng to và thanh xoay ảnh trong ô. Khác Selfbooth: ảnh lấy từ bản đã làm đẹp cỡ nhỏ của album này (small),
// phóng to tối đa ×3 như máy in (clampZoom), và đang gửi in / đã gửi in (frozen) thì khoá thao tác.
import { useEffect, useRef, useState } from "react";
import {
  PiArrowCounterClockwiseBold, PiArrowLeftBold, PiArrowRightBold, PiHeartFill, PiMagnifyingGlassBold,
  PiMinusBold, PiPlusBold, PiShuffleBold, PiXBold,
} from "react-icons/pi";
import { Button, useToast } from "../../studio";
import { composeLayout, loadFrameImage, photoLayout, rotateSlotContext, slotRect } from "../../frame-utils.js";
import { photoAt } from "../../kiosk/decor.js";
import { PhotoThumb } from "../photo-thumb.jsx";

export const NO_MOVE = { zoom: 1, x: 0, y: 0, rotate: 0 };
const ZOOM = { min: 1, max: 3 };
const pad = (n) => String(n).padStart(2, "0");
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function SheetPhoto({ token, photo, count, active, onPick }) {
  return (
    <button type="button" className={active ? "active" : ""} aria-label={`Dùng ảnh ${pad(photo.number)}`} onClick={onPick}>
      <PhotoThumb photo={photo} token={token} alt="" />
      {count > 0 && <span className="sheet-count">×{count}</span>}
    </button>
  );
}

function CarouselThumb({ token, photo, active, count, disabled, onStart, onPick }) {
  return (
    <button type="button" className={active ? "active" : ""} disabled={disabled}
      aria-label={`Dùng ảnh ${pad(photo.number)} cho ô đang chọn`}
      onPointerDown={(e) => !disabled && onStart(e, e.currentTarget.querySelector("img")?.currentSrc || "")}
      onClick={(e) => e.detail === 0 && onPick()}>
      <PhotoThumb photo={photo} token={token} alt="" draggable={false} />
      {photo.favorite && <span className="carousel-heart"><PiHeartFill /></span>}
      {count > 0 && <span className="sheet-count">×{count}</span>}
    </button>
  );
}

export function FrameEditor({ token, frame, title, slots, photos, small, photoOf, adjustOf, frozen, onSlots, onReshuffle, onBack, onNext }) {
  const toast = useToast();
  const canvas = useRef(null);
  const layout = photoLayout(frame);
  const [bg, setBg] = useState(null);
  const [bgError, setBgError] = useState("");
  const [images, setImages] = useState({});
  const [imageState, setImageState] = useState({ kind: "pending" });
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(() => Math.max(0, slots.findIndex((s) => !s.photo)));
  const [picking, setPicking] = useState(null); // ô đang chọn ảnh (mở danh sách ảnh)
  const [everySlot, setEverySlot] = useState(false);
  const [ghost, setGhost] = useState(null);
  const missing = useRef(null);
  const gesture = useRef({ pointers: new Map() });
  const drag = useRef(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const filledCount = slots.filter((s) => s.photo).length;
  const used = [...new Set(slots.map((s) => s.photo).filter(Boolean))];
  const imageKey = used.map((id) => `${id}:${JSON.stringify(adjustOf(id))}`).join();

  useEffect(() => {
    let live = true;
    setBg(null);
    setBgError("");
    loadFrameImage(frame.image).then((image) => live && setBg(image), (e) => live && setBgError(e.message));
    return () => { live = false; };
  }, [frame.image, retry]);
  useEffect(() => {
    let live = true;
    setImageState({ kind: "pending" });
    Promise.all(used.map(async (id) => [id, await small(photoOf(id))])).then(
      (list) => { if (live) { setImages(Object.fromEntries(list)); setImageState({ kind: "ready" }); } },
      (e) => live && setImageState({ kind: "error", error: e.message }),
    );
    return () => { live = false; };
  }, [imageKey, retry]);

  const error = bgError || imageState.error || "";
  const canNext = Boolean(bg) && imageState.kind === "ready";
  const message = error || (!bg ? "Đang tải khung…" : imageState.kind === "pending" ? "Đang xử lý ảnh trong khung…" : "");

  useEffect(() => {
    const draw = () => {
      const c = canvas.current;
      if (!c) return;
      if (!bg) { c.width = 1; c.height = 1; return; }
      const scale = Math.min(1, 1100 / Math.max(bg.naturalWidth, bg.naturalHeight));
      const width = Math.round(bg.naturalWidth * scale), height = Math.round(bg.naturalHeight * scale);
      if (c.width !== width) c.width = width;
      if (c.height !== height) c.height = height;
      composeLayout(c, bg, layout.slots, slots.map((s) => (s.photo && images[s.photo]) || null), slots,
        [], { frame: { ...layout, marks: [] }, overlay: true });
      const ctx = c.getContext("2d");
      // Ô trống: nền hồng nhạt + dấu "+" để khách biết chạm vào chọn ảnh.
      layout.slots.forEach((slot, i) => {
        if (slots[i]?.photo && images[slots[i].photo]) return;
        const r = slotRect(slot, c.width, c.height);
        ctx.save();
        rotateSlotContext(ctx, r);
        ctx.fillStyle = "rgba(241, 183, 189, 0.18)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        const size = Math.max(18, Math.min(r.w, r.h) * 0.22);
        ctx.fillStyle = "#4b332a";
        ctx.font = `600 ${size}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("+", r.x + r.w / 2, r.y + r.h / 2 - size * 0.3);
        ctx.font = `500 ${Math.max(11, size * 0.32)}px system-ui, sans-serif`;
        ctx.fillText(`Ô ${i + 1}`, r.x + r.w / 2, r.y + r.h / 2 + size * 0.55);
        ctx.restore();
      });
      const slot = layout.slots[selected];
      if (!slot) return;
      const r = slotRect(slot, c.width, c.height);
      ctx.save();
      rotateSlotContext(ctx, r);
      ctx.lineWidth = Math.max(3, c.width / 220);
      ctx.strokeStyle = getComputedStyle(c).getPropertyValue("--wine").trim() || "#4b332a";
      ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2]);
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      ctx.restore();
    };
    // Nhiều lần kéo / phóng to trong một khung hình chỉ vẽ lại một lần.
    const request = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(request);
  }, [bg, images, slots, selected, frame]);

  const update = (i, changes) => !frozen && onSlots(slotsRef.current.map((s, j) => (j === i ? { ...s, ...changes } : s)));
  const assign = (i, photo) => update(i, { photo, ...NO_MOVE });
  const current = { ...NO_MOVE, ...(slots[selected] || slots[0]) };
  const point = (x, y) => {
    const r = canvas.current.getBoundingClientRect();
    return { x: (x - r.left) / r.width, y: (y - r.top) / r.height };
  };
  const hit = (p) => photoAt(frame, p.x, p.y, { width: bg?.naturalWidth || 1, height: bg?.naturalHeight || 1 });

  // Chạm ô: ô trống → mở danh sách ảnh; ô có ảnh → chọn để kéo (1 ngón) / phóng to (2 ngón).
  function onDown(e) {
    if (frozen || !bg) return;
    const g = gesture.current;
    canvas.current.setPointerCapture?.(e.pointerId);
    g.pointers.set(e.pointerId, point(e.clientX, e.clientY));
    if (g.pointers.size === 1) {
      const at = hit(point(e.clientX, e.clientY));
      if (at >= 0) setSelected(at);
      g.slot = at >= 0 ? at : selected;
      g.tap = { x: e.clientX, y: e.clientY, hit: at };
    } else g.tap = null;
    g.start = { ...NO_MOVE, ...slotsRef.current[g.slot] };
    g.origin = [...g.pointers.values()];
  }
  function onMove(e) {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, point(e.clientX, e.clientY));
    if (!slotsRef.current[g.slot]?.photo) return;
    const now = [...g.pointers.values()];
    const s = layout.slots[g.slot];
    if (now.length === 1 && g.origin.length === 1) {
      // Ô nghiêng: kéo theo hướng của ô (đổi về hệ toạ độ của ô).
      const r = canvas.current.getBoundingClientRect(), angle = ((s.angle || 0) * Math.PI) / 180;
      const dx = (now[0].x - g.origin[0].x) * r.width, dy = (now[0].y - g.origin[0].y) * r.height;
      const lx = Math.cos(angle) * dx + Math.sin(angle) * dy, ly = -Math.sin(angle) * dx + Math.cos(angle) * dy;
      update(g.slot, { x: clamp(g.start.x + lx / (s.w * r.width), -1, 1), y: clamp(g.start.y + ly / (s.h * r.height), -1, 1) });
    } else if (now.length === 2 && g.origin.length === 2) {
      const d = (a) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
      update(g.slot, { zoom: clamp((g.start.zoom * d(now)) / d(g.origin), ZOOM.min, ZOOM.max) });
    }
  }
  function onUp(e) {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    const tap = g.tap;
    if (tap && !g.pointers.size && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8
      && tap.hit >= 0 && !slotsRef.current[tap.hit]?.photo)
      setPicking(tap.hit);
    g.tap = null;
    g.start = { ...NO_MOVE, ...slotsRef.current[g.slot] };
    g.origin = [...g.pointers.values()];
  }

  // Dải ảnh: chạm = đưa vào ô đang chọn; kéo lên thả vào ô bất kỳ.
  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.active && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) d.active = true;
      if (d.active && d.src) setGhost({ src: d.src, x: e.clientX, y: e.clientY });
    };
    const up = (e) => {
      const d = drag.current;
      drag.current = null;
      setGhost(null);
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) assign(selected, d.id);
        return;
      }
      if (document.elementFromPoint(e.clientX, e.clientY) !== canvas.current) return;
      const at = hit(point(e.clientX, e.clientY));
      if (at >= 0) { setSelected(at); assign(at, d.id); }
    };
    const cancel = () => { drag.current = null; setGhost(null); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  });

  function pick(photoId) {
    const slot = picking;
    setPicking(null);
    if (frozen) return;
    if (everySlot) {
      onSlots(slotsRef.current.map((s) => ({ ...s, photo: photoId, ...NO_MOVE })));
      setEverySlot(false);
      toast.success(`Đã dùng ảnh này cho cả ${slots.length} ô.`);
      return;
    }
    assign(slot, photoId);
    // Tự chuyển sang ô trống kế tiếp cho nhanh.
    const next = slotsRef.current.findIndex((s, i) => i !== slot && !s.photo);
    setSelected(next >= 0 ? next : slot);
  }
  function fillAll() {
    if (frozen) return;
    onSlots(slotsRef.current.map((s) => ({ ...s, photo: current.photo, ...NO_MOVE })));
    toast.success(`Đã dùng ảnh này cho cả ${slots.length} ô.`);
  }
  function next() {
    if (!canNext) return;
    const empty = slots.findIndex((s) => !s.photo);
    if (empty >= 0) {
      setSelected(empty);
      missing.current = toast.warning(`Còn ${slots.length - filledCount} ô chưa có ảnh — chạm vào ô trống để chọn ảnh.`);
      return;
    }
    onNext();
  }
  const usage = (id) => slots.filter((s) => s.photo === id).length;
  // Đã điền đủ các ô: ẩn cảnh báo "còn ô trống".
  useEffect(() => {
    if (filledCount === slots.length && missing.current) {
      toast.dismiss(missing.current);
      missing.current = null;
    }
  }, [filledCount]);

  return (
    <>
      <header className="frame-nav">
        <button type="button" className="icon-button" aria-label="Quay lại" onClick={onBack}><PiArrowLeftBold /></button>
        <strong>{title}</strong>
        <span>{filledCount}/{slots.length} ô</span>
      </header>
      <div className="frame-workspace">
        <div className="frame-preview-panel">
          <div className="frame-canvas" aria-busy={!bg}>
            <canvas ref={canvas} aria-label={`Khung ${frame.name}`} onPointerDown={onDown} onPointerMove={onMove}
              onPointerUp={onUp} onPointerCancel={onUp}
              onWheel={(e) => current.photo && update(selected, {
                zoom: clamp(current.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), ZOOM.min, ZOOM.max),
              })} />
          </div>
          {message && <p className="frame-hint" role={error ? "alert" : "status"}>{message}</p>}
          {error && (
            <Button className="outline" onClick={() => setRetry((n) => n + 1)}>
              <PiArrowCounterClockwiseBold aria-hidden="true" /> Thử lại
            </Button>
          )}
          <p className="frame-hint">Chạm ô để chọn · kéo để di chuyển · chụm 2 ngón để phóng to</p>
          <div className="photo-carousel" aria-label="Ảnh yêu thích">
            {photos.map((p) => (
              <CarouselThumb key={p.id} token={token} photo={p} active={p.id === current.photo} count={usage(p.id)}
                disabled={frozen}
                onStart={(e, src) => { drag.current = { id: p.id, src, x: e.clientX, y: e.clientY, active: false }; }}
                onPick={() => assign(selected, p.id)} />
            ))}
          </div>
        </div>
        <div className="slot-tools" aria-label={`Ô ${selected + 1}`}>
          <div className="slot-tools-head">
            <strong>Ô {selected + 1}</strong>
            <div className="slot-tools-actions">
              <button type="button" className="text-link" disabled={frozen} onClick={() => setPicking(selected)}>
                {current.photo ? "Đổi ảnh" : "Chọn ảnh"}
              </button>
              {current.photo && slots.length > 1 && (
                <button type="button" className="text-link" disabled={frozen} onClick={fillAll}>Dùng cho tất cả ô</button>
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
              <input type="range" aria-label="Phóng to ảnh" min={ZOOM.min} max={ZOOM.max} step="0.01" value={current.zoom}
                onChange={(e) => update(selected, { zoom: Number(e.target.value) })} />
              <button type="button" aria-label="Phóng to" onClick={() => update(selected, { zoom: clamp(current.zoom + 0.1, ZOOM.min, ZOOM.max) })}>
                <PiPlusBold />
              </button>
            </div>
            <div className="tool-row">
              <button type="button" aria-label="Xoay về 0°" onClick={() => update(selected, { rotate: 0 })}>
                <PiArrowCounterClockwiseBold />
              </button>
              <input type="range" aria-label="Góc xoay" min="-180" max="180" step="1" value={current.rotate || 0}
                onChange={(e) => update(selected, { rotate: Number(e.target.value) })} />
              <b>{current.rotate || 0}°</b>
            </div>
          </fieldset>
        </div>
      </div>
      <div className="studio-actions">
        <Button className="outline" disabled={frozen} onClick={onReshuffle}><PiShuffleBold aria-hidden="true" /> Xếp lại</Button>
        <Button disabled={!canNext} onClick={next}>Xem kết quả <PiArrowRightBold aria-hidden="true" /></Button>
      </div>
      {ghost && <img className="drag-ghost" src={ghost.src} alt="" style={{ left: ghost.x, top: ghost.y }} />}
      {picking !== null && (
        <div className="modal-backdrop" onClick={() => setPicking(null)}>
          <section className="modal photo-sheet" role="dialog" aria-modal="true" aria-label={`Chọn ảnh cho ô ${picking + 1}`}
            onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Chọn ảnh cho ô {picking + 1}</h3>
              <button type="button" className="icon-button" aria-label="Đóng" onClick={() => setPicking(null)}><PiXBold /></button>
            </div>
            <p className="muted">Một ảnh có thể dùng cho nhiều ô.</p>
            {slots.length > 1 && (
              <label className="checkbox sheet-every">
                <input type="checkbox" checked={everySlot} onChange={(e) => setEverySlot(e.target.checked)} />
                Dùng ảnh chọn cho tất cả {slots.length} ô
              </label>
            )}
            <div className="photo-sheet-grid">
              {photos.map((p) => (
                <SheetPhoto key={p.id} token={token} photo={p} count={usage(p.id)} active={slots[picking]?.photo === p.id}
                  onPick={() => pick(p.id)} />
              ))}
            </div>
            {!photos.length && <p className="center muted">Chưa có ảnh yêu thích.</p>}
          </section>
        </div>
      )}
    </>
  );
}
