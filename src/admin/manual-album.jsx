import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { PhotoThumb } from "../album/photo-thumb.jsx";
import { photoLayout } from "../frame-utils.js";
import { printSheets, renderPrintFrame } from "../kiosk/compose.js";
import { operatorPrint } from "./operator-print.js";
import "./manual-album.css";

// This recovery path prints locally. It never queues a second job on the room agent.
export function ManualAlbum({ booking, onClose, onPrinted }) {
  const toast = useToast();
  const { frames = [] } = useStudio();
  const available = useMemo(() => frames.filter(f => f.active !== false && (f.printSize || "full") === (booking.printSize || "full") && photoLayout(f).slots.length), [frames, booking.printSize]);
  const [frameId, setFrameId] = useState(available[0]?._id || "");
  const frame = available.find(f => f._id === frameId);
  const [photos, setPhotos] = useState([]);
  const [selected, setSelected] = useState([]);
  const [transforms, setTransforms] = useState([]);
  const [slot, setSlot] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copies, setCopies] = useState(1);
  const [archivePending, setArchivePending] = useState(false);
  const printing = useRef(false);
  const [sheet, setSheet] = useState("");
  const [rendering, setRendering] = useState(false);
  const urls = useRef([]);
  const slots = frame ? photoLayout(frame).slots : [];
  const complete = slots.length > 0 && slots.every((_, i) => selected[i]);
  const locked = busy || archivePending;
  useEffect(() => {
    if (!available.some((item) => item._id === frameId) && available.length) setFrameId(available[0]._id);
  }, [available, frameId]);
  useEffect(() => {
    let active = true;
    api(`/albums/${booking.accessToken}`).then(album => {
      if (active) setPhotos((album.photos || []).filter(p => p.kind === "original").map(p => ({ key: p.id, serverId: p.id, originalPending: p.originalPending, photo: p })));
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [booking.accessToken]);
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    let active = true;
    setSheet("");
    if (!frame || !complete) { setRendering(false); return; }
    setRendering(true);
    const timer = setTimeout(async () => {
      let canvas;
      try {
        canvas = await renderPrintFrame(frame, selected.slice(0, slots.length), booking.accessToken,
          `${window.location.origin}/album/${booking.accessToken}`, { transforms, scale: booking.printSize === "instax" ? 1 : 2, strict: true, sharp: booking.printSize !== "instax" });
        const result = await printSheets(canvas, frame, 1, booking.printSize || "full", booking.printSize === "instax" ? 1 : 2);
        if (active) { setSheet(result[0]); setError(""); }
      } catch (e) { if (active) setError(e.message); }
      finally { if (canvas) canvas.width = canvas.height = 0; if (active) setRendering(false); }
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [frame, selected, transforms, complete, booking.accessToken, booking.printSize, slots.length]);
  function addFiles(event) {
    const added = Array.from(event.target.files || []).filter(file => file.type.startsWith("image/")).map(file => {
      const preview = URL.createObjectURL(file);
      urls.current.push(preview);
      return { key: preview, image: file, preview, name: file.name };
    });
    setPhotos(current => [...current, ...added]);
    event.target.value = "";
  }
  function adjust(key, value) {
    setSheet("");
    setTransforms(current => { const next = [...current]; next[slot] = { ...next[slot], [key]: value }; return next; });
  }
  function chooseFrame(id) {
    setFrameId(id); setSelected([]); setTransforms([]); setSlot(0); setSheet("");
  }
  async function printLocal() {
    if (!sheet || printing.current || rendering) return;
    printing.current = true; setBusy(true); setError("");
    try {
      const result = await operatorPrint({ booking, images: [sheet], frameName: frame.name,
        printSize: booking.printSize || "full", copies });
      setArchivePending(false);
      toast.success(`Đã gửi ${copies} tờ tới hàng in RX1 và lưu file in.`);
      onPrinted?.(result);
    } catch (e) { setArchivePending(Boolean(e.printed)); setError(e.message); }
    finally { printing.current = false; setBusy(false); }
  }
  return <div className="modal-backdrop">
    <section className="modal manual-album" role="dialog" aria-modal="true" aria-label={`Ghép ảnh đơn ${booking.code}`}>
      <div className="modal-header"><div><h2>Ghép ảnh để in · #{booking.code}</h2><p>Chọn ô rồi chọn ảnh khách để đặt vào khung.</p></div><button className="icon-button" aria-label="Đóng" disabled={busy} onClick={onClose}>×</button></div>
      <ErrorBox error={error} />
      <div className="manual-album-grid"><div>
        <label>Khung ảnh<select value={frameId} disabled={locked} onChange={e => chooseFrame(e.target.value)}><option value="" disabled>Chọn khung</option>{available.map(f => <option key={f._id} value={f._id}>{f.themeName ? `${f.themeName} · ` : ""}{f.name}</option>)}</select></label>
        <details className="manual-album-frame-picker" open>
          <summary>Chọn khung bằng hình xem trước</summary>
          <div className="manual-album-frames" role="group" aria-label="Khung ảnh xem trước">
            {available.map(f => <button type="button" key={f._id} disabled={locked} aria-pressed={frameId === f._id} onClick={() => chooseFrame(f._id)}>
              <img src={f.thumb || f.image} alt={`Khung ${f.name}`} loading="lazy" />
              <span>{f.themeName && <small>{f.themeName}</small>}{f.name}</span>
            </button>)}
          </div>
        </details>
        {!available.length && <p>Chưa có khung phù hợp với khổ của đơn này.</p>}
        <div className="manual-album-slots">{slots.map((_, i) => <button key={i} disabled={locked} aria-pressed={slot === i} onClick={() => setSlot(i)}>Ô {i + 1}{selected[i] ? " ✓" : ""}</button>)}</div>
        {!!slots.length && <fieldset disabled={locked}><legend>Chỉnh ảnh ô {slot + 1}</legend>{[["zoom", "Phóng to", 1, 3, 1], ["x", "Dịch ngang", -1, 1, 0], ["y", "Dịch dọc", -1, 1, 0]].map(([key, label, min, max, fallback]) => <label key={key}>{label}<input type="range" min={min} max={max} step="0.01" value={transforms[slot]?.[key] ?? fallback} onChange={e => adjust(key, Number(e.target.value))} /></label>)}<button onClick={() => adjust("rotate", ((transforms[slot]?.rotate || 0) + 90) % 360)}>Xoay 90°</button></fieldset>}
        <label>Thêm ảnh từ máy quầy<input type="file" accept="image/*" multiple disabled={locked} onChange={addFiles} /></label>
        {loading && <p>Đang tải ảnh album…</p>}
        {!loading && !photos.length && <p>Album chưa có ảnh. Có thể thêm ảnh khách từ máy quầy.</p>}
        <div className="manual-album-photos">{photos.map((p, i) => <button key={p.key} disabled={!slots.length || locked || p.originalPending} title={p.originalPending ? "Ảnh gốc đang tải lên" : undefined} aria-label={`Đặt ảnh ${i + 1} vào ô ${slot + 1}`} onClick={() => {
          setSheet(""); setSelected(current => { const next = [...current]; next[slot] = p; return next; });
          setTransforms(current => { const next = [...current]; next[slot] = {}; return next; });
          setSlot(Math.min(slot + 1, slots.length - 1));
        }}>{p.photo ? <PhotoThumb photo={p.photo} token={booking.accessToken} alt={`Ảnh ${i + 1}`} /> : <img src={p.preview} alt={p.name} />}<span>{i + 1}</span></button>)}</div>
      </div><div className="manual-album-preview">{sheet ? <img src={sheet} alt="Tờ in đã ghép" /> : frame ? <>
        <img key={frame._id} src={frame.image} alt={`Xem trước khung ${frame.name}`} />
        <p className="manual-album-preview-caption" role="status">{rendering ? "Đang ghép ảnh chất lượng in…" : `${frame.name} · Chọn ảnh cho ${slots.length} ô để ghép và in.`}</p>
      </> : <p role="status">Chọn khung để xem trước.</p>}</div></div>
      {booking.printSize !== "instax" && <p className="soft-note">PC đang dùng cần cắm RX1 và chạy chương trình in. File được gửi trực tiếp qua bộ in RX1, dùng cùng thiết lập màu, DPI và cắt đôi như kiosk; sau đó lưu vào lịch sử đơn để in lại. Đây là in hỗ trợ, không trừ lượt hoặc cộng tiền.</p>}
      {booking.printSize !== "instax" && <><p className="soft-note">PNG 2400 × 3600 px (hoặc ngang), lấy từ ảnh gốc. Độ nét phụ thuộc nguồn ảnh và khung; bộ in chọn DPI cao nhất driver hỗ trợ.</p>
        <label>Số bộ in<select aria-label="Số bộ in" value={copies} disabled={locked} onChange={(event) => setCopies(Number(event.target.value))}>{Array.from({ length: 20 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select></label></>}
      <div className="order-print-actions"><Button className="outline" disabled={busy} onClick={onClose}>Quay lại</Button>{sheet && <a className="button outline" href={sheet} download={`NXC-${booking.code}-in.${booking.printSize === "instax" ? "jpg" : "png"}`}>Tải file in</a>}<Button disabled={!sheet || rendering || busy || booking.printSize === "instax"} onClick={printLocal}>{busy ? "Đang xử lý…" : archivePending ? "Lưu kết quả in" : "In qua RX1 & lưu file"}</Button></div>
      {booking.printSize === "instax" && <p>Khổ Instax: tải file và in bằng phần mềm dành cho máy Instax.</p>}
    </section>
  </div>;
}
