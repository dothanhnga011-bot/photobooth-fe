import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PiFloppyDiskBold, PiPrinterBold } from "react-icons/pi";
import { ImagePlus, X } from "lucide-react";
import { api, getApiUrl } from "../api.js";
import { storageLink } from "../media-delivery.js";
import { ErrorBox, useStudio, useToast } from "../studio.jsx";
import { KioskFrames } from "../kiosk/KioskFrames.jsx";
import { KioskSelect, useShotBitmaps } from "../kiosk/KioskSelect.jsx";
import { frameCandidates, printPhotoRegions, printSheets, renderPrintFrame } from "../kiosk/compose.js";
import { frameCapacity } from "../frame-utils.js";
import { NO_DECOR, filterChoices, filterStepsFor, photoFilterId } from "../kiosk/decor.js";
import { addPhotoSlot, photoSlots, removePhotoSlot } from "../kiosk/photo-selection.js";
import { operatorPrint } from "./operator-print.js";
import "./counter-compose.css";

// Ghép ảnh để in ở quầy (Đơn hàng → In ảnh), 22/11: đúng hai màn của máy chụp PTB — chọn khung, rồi chạm
// ảnh để đặt vào ô trống (cùng ảnh có thể vào nhiều ô), chạm ô trên khung để bỏ, chỉnh / phóng
// ảnh, màu ảnh, thêm chữ, nhãn dán. Bấm nút cuối: ghép tờ in như máy chụp (ảnh gốc, 2400 × 3600 PNG) rồi
// in qua RX1 trên máy này và lưu vào đơn, hoặc chỉ lưu file (in sau bằng "In lại qua RX1"). Không trừ lượt in.
// Hiện trên toàn màn hình, ngoài khung trang quản trị, để giữ nguyên giao diện máy chụp.
export function CounterCompose({ booking, onClose, onSaved }) {
  const toast = useToast();
  const { frames: catalogFrames = [], settings = {}, stickers: shopStickers = [] } = useStudio();
  const token = booking.accessToken;
  const albumLink = `${window.location.origin}/album/${token}`;
  const [albumPhotos, setAlbumPhotos] = useState(null);
  const [added, setAdded] = useState([]);
  const [error, setError] = useState("");
  const [step, setStep] = useState("frame");
  const [frameIndex, setFrameIndex] = useState(0);
  const [selected, setSelected] = useState([]);
  const [decor, setDecor] = useState(NO_DECOR);
  const [copies, setCopies] = useState(1);
  const [mode, setMode] = useState("print");
  const [busy, setBusy] = useState(false);
  // RX1 đã in nhưng chưa lưu được vào đơn: chỉ thử lưu lại, không in thêm.
  const [unsaved, setUnsaved] = useState(null);
  const working = useRef(false);

  useEffect(() => {
    let active = true;
    api(`/albums/${token}`)
      .then((album) => { if (active) setAlbumPhotos((album.photos || []).filter((p) => p.kind === "original")); })
      .catch((cause) => { if (active) { setAlbumPhotos([]); setError(cause.message); } });
    return () => { active = false; };
  }, [token]);
  // Ảnh của khách như máy chụp thấy (ảnh xem nhanh, ảnh in lấy ảnh gốc trên máy chủ), thêm ảnh chép từ máy quầy.
  const shots = useMemo(() => [
    ...(albumPhotos || []).map((p) => ({
      key: String(p.id), serverId: p.id, mirrored: Boolean(p.mirrored), originalPending: p.originalPending,
      media: p,
      thumbnail: storageLink(p, "thumbnail"),
      preview: getApiUrl(`/api/albums/${token}/photos/${p.id}?size=preview`),
    })),
    ...added,
  ], [albumPhotos, added, token]);
  const frames = useMemo(() => frameCandidates(catalogFrames.filter((f) => f.active !== false), {
    count: Math.max(1, shots.length), printSize: booking.printSize, themeOrder: (settings.themes || []).map((t) => t.name),
  }), [catalogFrames, shots.length, booking.printSize, settings.themes]);
  const index = Math.min(frameIndex, Math.max(0, frames.length - 1));
  const frame = frames[index];
  const needOf = (f) => f ? frameCapacity(f) : 0;
  const need = needOf(frame);
  const { bitmaps, retryPreviews } = useShotBitmaps(shots, token, selected);
  const filters = useMemo(() => filterChoices(settings), [settings]);

  const changeFrame = (i) => {
    const keep = needOf(frames[i]);
    setFrameIndex(i);
    setSelected((list) => list.slice(0, keep));
  };
  const changeDecor = (changes) => setDecor((current) => ({ ...NO_DECOR, ...current, ...changes }));
  function addFiles(event) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));
    setAdded((list) => [...list, ...files.map((file) => ({ key: `file-${crypto.randomUUID()}`, image: file, preview: file, mirrored: false }))]);
    event.target.value = "";
  }

  async function submit(job) {
    try {
      await operatorPrint(job);
    } catch (cause) {
      if (cause.printed) setUnsaved(job);
      throw cause;
    }
    setUnsaved(null);
    toast.success(job.saveOnly
      ? "Đã lưu file in vào đơn. In bằng “In lại qua RX1” trên máy cắm RX1."
      : `Đã gửi ${job.copies} tờ tới hàng in RX1 và lưu file in vào đơn.`);
    onSaved?.();
  }
  async function run(task) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try { await task(); }
    catch (cause) { setError(cause.message); }
    finally { working.current = false; setBusy(false); }
  }
  const finish = () => run(async () => {
    const keys = photoSlots(selected, need);
    if (!frame || keys.some((key) => !key)) return;
    const chosen = keys.map((key) => shots.find((shot) => shot.key === key));
    const look = {
      filters: chosen.map((shot) => filterStepsFor(photoFilterId(decor, shot.key), settings)),
      stickers: decor.stickers || [],
      transforms: chosen.map((shot) => decor.transforms?.[shot.key]),
    };
    const canvas = await renderPrintFrame(frame, chosen, token, albumLink, { ...look, scale: 2, strict: true, sharp: true });
    let job;
    try {
      const [image] = await printSheets(canvas, frame, 1, booking.printSize, 2);
      job = {
        booking, images: [image], copies, saveOnly: mode === "save",
        frameName: frame.themeName?.trim() || frame.name || "Khung ảnh",
        // Khung nhỏ → máy cắt đôi, như máy chụp.
        printSize: frame.printSize === "strip" ? "strip" : "full",
        photos: printPhotoRegions(frame, canvas),
      };
    } finally {
      // Trả bộ nhớ tờ in 2400 × 3600 ngay (canvas cỡ 0), trước khi chờ gửi lệnh in.
      canvas.width = canvas.height = 0;
    }
    await submit(job);
  });

  const label = mode === "save"
    ? <><PiFloppyDiskBold aria-hidden="true" /> Lưu file in</>
    : <><PiPrinterBold aria-hidden="true" /> In {copies} bộ qua RX1</>;
  return createPortal(
    <div className="counter-compose" role="dialog" aria-modal="true" aria-label={`Ghép ảnh để in · #${booking.code}`}>
      <header className="counter-compose-bar">
        <button type="button" className="counter-compose-close" disabled={busy} onClick={onClose}>
          <X size={18} aria-hidden="true" /> Đóng
        </button>
        <strong>Ghép ảnh để in · #{booking.code}</strong>
        <label className="counter-compose-file">
          <ImagePlus size={17} aria-hidden="true" /> Thêm ảnh từ máy quầy
          <input type="file" accept="image/*" multiple disabled={busy} onChange={addFiles} />
        </label>
        <label>
          Số bộ in
          <select aria-label="Số bộ in" value={copies} disabled={busy} onChange={(event) => setCopies(Number(event.target.value))}>
            {Array.from({ length: 20 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Khi ghép xong
          <select aria-label="Khi ghép xong" value={mode} disabled={busy} onChange={(event) => setMode(event.target.value)}>
            <option value="print">In qua RX1 & lưu file</option>
            <option value="save">Chỉ lưu file in</option>
          </select>
        </label>
        {unsaved && <button type="button" className="counter-compose-retry" disabled={busy} onClick={() => run(() => submit(unsaved))}>
          Lưu kết quả in
        </button>}
      </header>
      <ErrorBox error={error} />
      {albumPhotos === null ? (
        <p className="counter-compose-note" role="status">Đang tải ảnh của đơn…</p>
      ) : !shots.length ? (
        <p className="counter-compose-note" role="status">Album chưa có ảnh. Thêm ảnh khách từ máy quầy ở thanh trên.</p>
      ) : !frames.length ? (
        <p className="counter-compose-note" role="status">Chưa có khung ảnh đang bật cho khổ của đơn này (Thiết lập → Khung ảnh).</p>
      ) : step === "frame" ? (
        <KioskFrames counter frames={frames} needs={frames.map(needOf)} index={index} busy={busy}
          onPick={changeFrame} onContinue={() => setStep("select")} />
      ) : (
        <KioskSelect
          counter
          shots={shots}
          bitmaps={bitmaps}
          retryPreviews={retryPreviews}
          count={need}
          selected={selected.slice(0, need)}
          onPick={(key) => setSelected((list) => addPhotoSlot(list, need, key))}
          onRemove={(slot) => setSelected((list) => removePhotoSlot(list, need, slot))}
          onClear={() => setSelected([])}
          frames={frames}
          index={index}
          onBack={() => setStep("frame")}
          onConfirm={finish}
          busy={busy}
          prints={copies}
          qrUrl={albumLink}
          filters={filters}
          decor={decor}
          onDecor={changeDecor}
          shopStickers={shopStickers}
          confirmLabel={label}
        />
      )}
    </div>,
    document.body,
  );
}
