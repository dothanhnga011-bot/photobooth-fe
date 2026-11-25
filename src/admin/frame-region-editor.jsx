import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, MousePointer2, RotateCcw, RotateCw, SquareDashed, Trash2 } from "lucide-react";
import { fitRegion, moveRegion, regionFromPoints, resizeRegion, rotateRegion, turnRegion } from "../frame-regions.js";

// Side handles move one side only, in the slot's own (possibly rotated) directions.
const SIDES = { n: "trên", e: "phải", s: "dưới", w: "trái" };
const MIN_REGION_SIZE = .001;

const rectangleStyle = region => ({ left: `${region.x * 100}%`, top: `${region.y * 100}%`,
  width: `${region.w * 100}%`, height: `${region.h * 100}%`,
  transform: region.angle ? `rotate(${region.angle}deg)` : undefined });

function RegionNumber({ label, value, disabled, onCommit, min, max, step = 1 }) {
  const formatted = String(Math.round(value * 10) / 10);
  const [text, setText] = useState(formatted);
  useEffect(() => setText(formatted), [formatted]);
  return <label className="frame-region-number"><span>{label}</span>
    <input type="number" inputMode="decimal" value={text} min={min} max={max} step={step} disabled={disabled}
      onChange={event => setText(event.target.value)} onBlur={() => {
        if (text.trim() && Number.isFinite(Number(text))) onCommit(Number(text));
        else setText(formatted);
      }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
  </label>;
}

export function FrameRegionEditor({ image, slots, disabled, onChange }) {
  const [drawing, setDrawing] = useState(!slots.length);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(100);
  const stage = useRef(null), picture = useRef(null), operation = useRef(null);
  const shown = draft || slots;
  const index = selected !== null && selected < slots.length ? selected : null;
  const point = event => {
    const rect = stage.current.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };
  const begin = (event, kind, regionIndex, corner) => {
    if (disabled || !picture.current?.naturalWidth || !picture.current?.naturalHeight ||
        operation.current || event.button !== 0 || (kind === "draw" && slots.length >= 40)) return;
    event.preventDefault(); event.stopPropagation();
    operation.current = { kind, index: regionIndex, corner, start: point(event), slots, pointerId: event.pointerId,
      size: { width: picture.current.naturalWidth, height: picture.current.naturalHeight } };
    setSelected(kind === "draw" ? slots.length : regionIndex);
    stage.current.setPointerCapture(event.pointerId);
  };
  const nextDraft = event => {
    const op = operation.current, end = point(event);
    if (op.kind === "draw") return [...op.slots, regionFromPoints(op.start, end)];
    const dx = end.x - op.start.x, dy = end.y - op.start.y;
    return op.slots.map((region, i) => {
      if (i !== op.index) return region;
      if (op.kind === "move") return moveRegion(region, dx, dy, op.size);
      if (op.kind === "resize") return resizeRegion(region, op.corner, dx, dy, MIN_REGION_SIZE, op.size);
      const cx = region.x + region.w / 2, cy = region.y + region.h / 2;
      const bearing = p => Math.atan2((p.y - cy) * op.size.height, (p.x - cx) * op.size.width);
      const angle = (region.angle || 0) + (bearing(end) - bearing(op.start)) * 180 / Math.PI;
      return rotateRegion(region, event.shiftKey ? Math.round(angle / 15) * 15 : angle, op.size);
    });
  };
  const finish = (event, cancel = false) => {
    const op = operation.current;
    if (!op || op.pointerId !== event.pointerId) return;
    if (!cancel) {
      const next = nextDraft(event), region = next.at(-1), rect = stage.current.getBoundingClientRect();
      if (op.kind !== "draw" || (region.w * rect.width >= 3 && region.h * rect.height >= 3)) {
        onChange(next);
        if (op.kind === "draw") setDrawing(false);
      } else setSelected(null);
    }
    operation.current = null; setDraft(null);
    if (stage.current.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
  };
  const keyboard = (event, i, corner) => {
    if (disabled || !picture.current?.naturalWidth || !picture.current?.naturalHeight) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!corner && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault(); onChange(slots.filter((_, n) => n !== i)); setSelected(null); return;
    }
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const dx = direction[0] * step / picture.current.naturalWidth;
    const dy = direction[1] * step / picture.current.naturalHeight;
    onChange(slots.map((s, n) => n !== i ? s : corner
      ? resizeRegion(s, corner, dx, dy, MIN_REGION_SIZE, dimensions) : moveRegion(s, dx, dy, dimensions)));
  };
  const reorder = direction => {
    const next = [...slots], target = index + direction;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next); setSelected(target);
  };
  const changeSelected = make => onChange(slots.map((region, i) => i === index ? make(region) : region));
  const rotation = angle => changeSelected(region => rotateRegion(region, angle, dimensions));
  const quarterTurn = direction => changeSelected(region => turnRegion(region, direction, dimensions));
  const current = index === null ? null : shown[index];
  return <div className="frame-region-editor">
    <div className="frame-region-modes" role="group" aria-label="Đánh dấu vùng ảnh">
      <button type="button" disabled={disabled} aria-pressed={!drawing} onClick={() => setDrawing(false)}>
        <MousePointer2 size={15} /> Chọn / chỉnh ô
      </button>
      <button type="button" disabled={disabled || slots.length >= 40} aria-pressed={drawing}
        onClick={() => { setDrawing(true); setSelected(null); }}>
        <SquareDashed size={15} /> Vẽ vùng ảnh
      </button>
    </div>
    <p className="frame-region-hint" role="status">{drawing
      ? "Kéo từ góc này sang góc kia để thêm một ô ảnh."
      : "Chọn ô để kéo vị trí; kéo góc hoặc cạnh để chỉnh kích thước, nút tròn để xoay."}</p>
    <label className="frame-region-zoom">Phóng to khung
      <input type="range" aria-label="Phóng to khung" min="100" max="400" step="10" value={zoom}
        onChange={event => setZoom(Number(event.target.value))} /> <output>{zoom}%</output>
    </label>
    <div className="frame-region-viewport"><div className="frame-region-preview"
      style={{ width: `min(${zoom}%, ${340 * zoom / 100}px)` }}>
      <div ref={stage} className={`frame-region-stage${drawing ? " is-drawing" : ""}`} aria-label="Vùng đánh dấu trên khung"
        onPointerDown={event => drawing ? begin(event, "draw") : setSelected(null)}
        onPointerMove={event => {
          if (operation.current?.pointerId === event.pointerId) setDraft(nextDraft(event));
        }}
        onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
        onLostPointerCapture={event => finish(event, true)}
        onKeyDown={event => {
          if (event.key === "Escape" && operation.current) finish({ pointerId: operation.current.pointerId }, true);
        }}>
        <img ref={picture} src={image} alt="Khung ảnh để đánh dấu vị trí" draggable={false}
          onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
        {shown.map((region, i) => <div key={i} data-region-index={i}
          className={`frame-region-box${selected === i ? " is-selected" : ""}${drawing && i === slots.length ? " is-draft" : ""}`}
          style={rectangleStyle(region)}>
          <button type="button" className="frame-region-hit" aria-label={`Ô ảnh ${i + 1}`}
            disabled={disabled} aria-pressed={selected === i}
            onClick={() => { if (!drawing) setSelected(i); }} onFocus={() => { if (!drawing) setSelected(i); }}
            onPointerDown={event => { if (!drawing) begin(event, "move", i); }}
            onKeyDown={event => keyboard(event, i)}>
            <span style={region.angle ? { transform: `rotate(${-region.angle}deg)` } : undefined}>{i + 1}</span></button>
          {!drawing && selected === i && ["nw", "ne", "sw", "se"].map(corner =>
            <button type="button" key={corner} className={`frame-region-handle ${corner}`}
              aria-label={`Chỉnh góc ${corner} ô ${i + 1}`} disabled={disabled}
              onPointerDown={event => begin(event, "resize", i, corner)} onKeyDown={event => keyboard(event, i, corner)} />)}
          {!drawing && selected === i && Object.entries(SIDES).map(([side, name]) =>
            <button type="button" key={side} className={`frame-region-handle frame-region-side ${side}`}
              aria-label={`Kéo cạnh ${name} ô ${i + 1}`} disabled={disabled}
              onPointerDown={event => begin(event, "resize", i, side)} onKeyDown={event => keyboard(event, i, side)} />)}
          {!drawing && selected === i && <button type="button" className="frame-region-rotate-handle"
            aria-label={`Kéo để xoay ô ${i + 1}`} disabled={disabled}
            onPointerDown={event => begin(event, "rotate", i)}><RotateCw size={14} /></button>}
        </div>)}
      </div>
    </div></div>
    {index !== null && <div className="frame-region-selection">
      <strong>Ô {index + 1}</strong>
      <button type="button" disabled={disabled || index === 0} onClick={() => reorder(-1)}
        aria-label={`Đưa ô ${index + 1} lên trước`}><ArrowUp size={15} /> Trước</button>
      <button type="button" disabled={disabled || index === slots.length - 1} onClick={() => reorder(1)}
        aria-label={`Đưa ô ${index + 1} ra sau`}><ArrowDown size={15} /> Sau</button>
      <button type="button" disabled={disabled || slots.length >= 40} onClick={() => {
        onChange([...slots, moveRegion(slots[index], .02, .02, dimensions)]); setSelected(slots.length);
      }}><Copy size={15} /> Nhân đôi ô</button>
      <button type="button" disabled={disabled} aria-label={`Xóa ô ${index + 1}`} onClick={() => {
        onChange(slots.filter((_, i) => i !== index)); setSelected(null);
      }}><Trash2 size={15} /> Xóa ô</button>
    </div>}
    {current && <section className="frame-region-inspector" aria-label={`Thông số ô ${index + 1}`}>
      <div className="frame-region-numbers">{[
        ["x", "Trái (px)", dimensions.width], ["y", "Trên (px)", dimensions.height],
        ["w", "Rộng (px)", dimensions.width], ["h", "Cao (px)", dimensions.height],
      ].map(([key, label, edge]) => <RegionNumber key={key} label={label} value={current[key] * edge}
        min={key === "w" || key === "h" ? 1 : undefined} disabled={disabled}
        onCommit={value => changeSelected(region => fitRegion({ ...region, [key]: value / edge }, dimensions))} />)}
      </div>
      <div className="frame-region-angle">
        <button type="button" disabled={disabled} aria-label="Xoay ảnh trong ô trái 90°"
          onClick={() => quarterTurn(-1)}><RotateCcw size={17} /></button>
        <input type="range" aria-label="Xoay vùng ảnh" min="-180" max="180" step="0.1"
          value={current.angle || 0} disabled={disabled} onChange={event => rotation(Number(event.target.value))} />
        <button type="button" disabled={disabled} aria-label="Xoay ảnh trong ô phải 90°"
          onClick={() => quarterTurn(1)}><RotateCw size={17} /></button>
      </div>
      <RegionNumber label="Góc xoay ô (°)" value={current.angle || 0} min={-180} max={180} step={.1}
        disabled={disabled} onCommit={rotation} />
      <div className="frame-region-align">
        <button type="button" disabled={disabled} onClick={() => changeSelected(region =>
          fitRegion({ ...region, x: (1 - region.w) / 2 }, dimensions))}>Căn giữa ngang</button>
        <button type="button" disabled={disabled} onClick={() => changeSelected(region =>
          fitRegion({ ...region, y: (1 - region.h) / 2 }, dimensions))}>Căn giữa dọc</button>
        <button type="button" disabled={disabled} onClick={() => rotation(0)}>Đặt góc 0°</button>
      </div>
    </section>}
    <p className="frame-region-caption">Vùng đỏ chỉ đánh dấu chỗ ghép ảnh, không xuất hiện trên ảnh in.</p>
  </div>;
}
