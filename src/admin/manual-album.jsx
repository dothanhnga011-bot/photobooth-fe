import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Button, ErrorBox, useStudio } from "../studio";
import { PhotoThumb } from "../album/photo-thumb.jsx";
import { photoLayout } from "../frame-utils.js";
import { printSheets, renderPrintFrame } from "../kiosk/compose.js";
import "./manual-album.css";

// This recovery path prints locally. It never queues a second job on the room agent.
export function ManualAlbum({ booking, onClose }) {
  const { frames = [] } = useStudio();
  const available = useMemo(() => frames.filter(f => (f.printSize || "full") === (booking.printSize || "full") && photoLayout(f).slots.length), [frames, booking.printSize]);
  const [frameId, setFrameId] = useState(available[0]?._id || "");
  const frame = available.find(f => f._id === frameId);
  const [photos, setPhotos] = useState([]);
  const [selected, setSelected] = useState([]);
  const [transforms, setTransforms] = useState([]);
  const [slot, setSlot] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState("");
  const [rendering, setRendering] = useState(false);
  const urls = useRef([]);
  const slots = frame ? photoLayout(frame).slots : [];
  const complete = slots.length > 0 && slots.every((_, i) => selected[i]);
  useEffect(() => {
    let active = true;
    api(`/albums/${booking.accessToken}`).then(album => {
      if (active) setPhotos((album.photos || []).filter(p => p.kind === "original").map(p => ({ key: p.id, serverId: p.id, photo: p })));
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
          `${window.location.origin}/album/${booking.accessToken}`, { transforms });
        const result = await printSheets(canvas, frame, 1, booking.printSize || "full");
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
    setTransforms(current => { const next = [...current]; next[slot] = { ...next[slot], [key]: value }; return next; });
  }
  async function printLocal() {
    if (!sheet || busy) return;
    const popup = window.open("", "_blank", "width=850,height=700");
    if (!popup) { setError("Trình duyệt chặn cửa sổ in. Hãy cho phép cửa sổ bật lên rồi thử lại."); return; }
    setBusy(true);
    try {
      const image = popup.document.createElement("img");
      image.src = sheet;
      await image.decode();
      const landscape = image.naturalWidth > image.naturalHeight;
      const style = popup.document.createElement("style");
      style.textContent = `@page { size: ${landscape ? "6in 4in" : "4in 6in"}; margin: 0; } html,body { margin:0; padding:0; } img { display:block; width:100%; height:auto; }`;
      popup.document.head.append(style);
      popup.document.title = `In ảnh #${booking.code}`;
      popup.document.body.append(image);
      popup.focus();
      popup.print();
    } catch (e) { popup.close(); setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop">
    <section className="modal manual-album" role="dialog" aria-modal="true" aria-label={`Ghép ảnh đơn ${booking.code}`}>
      <div className="modal-header"><div><h2>Mở album & ghép ảnh · #{booking.code}</h2><p>Chọn ô rồi chọn ảnh khách để đặt vào khung.</p></div><button className="icon-button" aria-label="Đóng" onClick={onClose}>×</button></div>
      <ErrorBox error={error} />
      <div className="manual-album-grid"><div>
        <label>Khung ảnh<select value={frameId} onChange={e => { setFrameId(e.target.value); setSelected([]); setTransforms([]); setSlot(0); setSheet(""); }}><option value="" disabled>Chọn khung</option>{available.map(f => <option key={f._id} value={f._id}>{f.themeName ? `${f.themeName} · ` : ""}{f.name}</option>)}</select></label>
        {!available.length && <p>Chưa có khung phù hợp với khổ của đơn này.</p>}
        <div className="manual-album-slots">{slots.map((_, i) => <button key={i} aria-pressed={slot === i} onClick={() => setSlot(i)}>Ô {i + 1}{selected[i] ? " ✓" : ""}</button>)}</div>
        {!!slots.length && <fieldset><legend>Chỉnh ảnh ô {slot + 1}</legend>{[["zoom", "Phóng to", 1, 3, 1], ["x", "Dịch ngang", -1, 1, 0], ["y", "Dịch dọc", -1, 1, 0]].map(([key, label, min, max, fallback]) => <label key={key}>{label}<input type="range" min={min} max={max} step="0.01" value={transforms[slot]?.[key] ?? fallback} onChange={e => adjust(key, Number(e.target.value))} /></label>)}<button onClick={() => adjust("rotate", ((transforms[slot]?.rotate || 0) + 90) % 360)}>Xoay 90°</button></fieldset>}
        <label>Thêm ảnh từ máy quầy<input type="file" accept="image/*" multiple onChange={addFiles} /></label>
        {loading && <p>Đang tải ảnh album…</p>}
        {!loading && !photos.length && <p>Album chưa có ảnh. Có thể thêm ảnh khách từ máy quầy.</p>}
        <div className="manual-album-photos">{photos.map((p, i) => <button key={p.key} disabled={!slots.length} aria-label={`Đặt ảnh ${i + 1} vào ô ${slot + 1}`} onClick={() => {
          setSheet(""); setSelected(current => { const next = [...current]; next[slot] = p; return next; });
          setTransforms(current => { const next = [...current]; next[slot] = {}; return next; });
          setSlot(Math.min(slot + 1, slots.length - 1));
        }}>{p.photo ? <PhotoThumb photo={p.photo} token={booking.accessToken} alt={`Ảnh ${i + 1}`} /> : <img src={p.preview} alt={p.name} />}<span>{i + 1}</span></button>)}</div>
      </div><div className="manual-album-preview">{sheet ? <img src={sheet} alt="Tờ in đã ghép" /> : <p role="status">{rendering ? "Đang ghép ảnh chất lượng in…" : "Chọn đủ ảnh cho các ô để xem tờ in."}</p>}</div></div>
      <p className="soft-note">Cắm máy quầy vào RX1 và cài driver. Trong hộp in, chọn đúng máy, giấy 4 × 6 inch, lề 0, tắt đầu/chân trang. Khung nhỏ cần bật “2inch cut” trong driver. Chọn số bản trong hộp in; lệnh này không gửi đến máy phòng chụp và không tự trừ lượt in.</p>
      <div className="order-print-actions"><Button className="outline" onClick={onClose}>Đóng</Button>{sheet && <a className="button outline" href={sheet} download={`NXC-${booking.code}-in.${booking.printSize === "instax" ? "jpg" : "png"}`}>Tải file in</a>}<Button disabled={!sheet || rendering || busy || booking.printSize === "instax"} onClick={printLocal}>{busy ? "Đang mở…" : "In bằng máy quầy"}</Button></div>
      {booking.printSize === "instax" && <p>Khổ Instax: tải file và in bằng phần mềm dành cho máy Instax.</p>}
    </section>
  </div>;
}
