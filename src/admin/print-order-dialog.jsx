import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Image as ImageIcon, Printer, RefreshCw, X } from "lucide-react";
import { api, assetUrl, formatDateTime } from "../api.js";
import { fetchMediaBlob } from "../media-delivery.js";
import { Button, ErrorBox, useToast } from "../studio.jsx";
import { checkDirectPrinter } from "../kiosk/direct-print.js";
import { CounterCompose } from "./counter-compose.jsx";
import { compositeSheet } from "./counter-sheet.js";
import { operatorPrint } from "./operator-print.js";
import { isSelfboothSize, selfboothUnit } from "../print-sizes.js";
import { printLargeSheets } from "./print-sheet.js";
import "./print-order-dialog.css";

const SIZES = { full: "10 × 15 cm", strip: "2 dải 5 × 15 cm / tờ", large: "20 × 30 cm (DS820)" };
const STATES = { idle: "Chưa gửi máy in", queued: "Đang chờ máy in", sending: "Đang gửi máy in", sent: "Đã gửi tới hàng in", failed: "Lỗi hoặc mất xác nhận in" };
const sheetUrl = (job, sheet, thumbnail = false) => assetUrl(`${job.image}?sheet=${sheet}${thumbnail ? "&size=thumbnail" : ""}`);

export function PrintOrderDialog({ booking, onClose, onExtra, onPrinted }) {
  const toast = useToast();
  const [details, setDetails] = useState(booking);
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState(0);
  const [copies, setCopies] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [archivePending, setArchivePending] = useState(false);
  const [manual, setManual] = useState(false);
  const [failedImage, setFailedImage] = useState("");
  const inFlight = useRef(false);
  const imageCache = useRef(null);
  // Tờ in làm từ ảnh ghép (đơn chưa có file in): giữ lại tới khi lưu xong để "Lưu kết quả in" không in thêm.
  const compositeCache = useRef(null);
  const job = jobs.find((item) => item._id === selected) || jobs[0];
  const count = job?.sheetCount || 1;
  const printSize = job?.printSize || details.printSize || "full";
  // Phòng Selfbooth (tờ 20 × 30): in ở quầy bằng cửa sổ in ra máy DNP DS820, không qua RX1.
  const selfbooth = isSelfboothSize(printSize);
  const maximum = selfbooth ? 20 : Math.min(20, Math.floor(20 / count));
  const locked = busy || archivePending;
  const canOperate = !details.mediaDeleted && ["checked_in", "completed"].includes(details.status);
  const canSell = !details.mediaDeleted && details.paid && ["confirmed", "checked_in", "completed"].includes(details.status);
  // Vé PTB: ghép lại ở quầy bằng màn chọn ảnh của máy chụp. Vé Selfbooth: khách ghép và gửi in trên điện thoại.
  const canCompose = canOperate && Boolean(details.accessToken) && !isSelfboothSize(details.printSize);
  const composite = canCompose && details.composite?.url ? details.composite : null;
  const preview = job?.image ? sheetUrl(job, Math.min(page, count - 1), true) : "";

  // Read the chosen order, rather than trusting the potentially old list-row snapshot.
  useEffect(() => {
    if (manual || busy) return;
    let active = true;
    let reading = false;
    let timer;
    const controller = new AbortController();
    async function read() {
      if (!active || reading) return;
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(read, 10000); return; }
      reading = true;
      try {
        const result = await api(`/admin/bookings/${booking._id}/prints`, { signal: controller.signal });
        if (!active) return;
        setDetails((current) => ({ ...current, ...result.booking }));
        setJobs(result.jobs);
        setSelected((current) => result.jobs.some((item) => item._id === current) ? current : result.jobs[0]?._id || "");
        setLoadError("");
      } catch (cause) {
        if (active) setLoadError(cause.message);
      } finally {
        reading = false;
        if (active) { setLoading(false); timer = setTimeout(read, 10000); }
      }
    }
    const visible = () => { if (!document.hidden) read(); };
    document.addEventListener("visibilitychange", visible);
    read();
    return () => { active = false; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [booking._id, refresh, manual, busy]);
  useEffect(() => { setPage(0); }, [job?._id]);
  useEffect(() => { if (!locked && maximum > 0) setCopies((value) => Math.min(value, maximum)); }, [maximum, locked]);

  function choose(id) {
    setSelected(id); setPage(0); setCopies(1); setError(""); imageCache.current = null;
  }
  async function reprint() {
    if (!job || inFlight.current || !canOperate || copies > maximum) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (selfbooth) {
        printLargeSheets({ imageUrls: Array.from({ length: count }, (_, index) => sheetUrl(job, index)), code: details.code, copies });
        toast.info(`Đang mở bản in vé #${details.code}. Chọn máy in DNP DS820, giấy 8 × 12 inch (20 × 30 cm).`);
      } else {
        if (!archivePending) await checkDirectPrinter();
        if (imageCache.current?.id !== job._id) {
          const images = [];
          for (let index = 0; index < count; index++) images.push(await fetchMediaBlob(sheetUrl(job, index)));
          imageCache.current = { id: job._id, images };
        }
        await operatorPrint({ booking: details, images: imageCache.current.images,
          sourceJob: job, printSize, frameName: job.frameName, copies });
        toast.success(`Đã gửi ${count * copies} tờ tới hàng in RX1.`);
      }
      setArchivePending(false); imageCache.current = null;
      onPrinted?.();
    } catch (cause) {
      setArchivePending(Boolean(cause.printed)); setError(cause.message);
    } finally { inFlight.current = false; setBusy(false); }
  }

  // Đơn chưa có file in: làm tờ in từ ảnh ghép khung trong album, in qua RX1 (hoặc chỉ lưu) và lưu vào đơn.
  async function printComposite(saveOnly) {
    if (!composite || inFlight.current || copies > maximum) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      compositeCache.current ??= await compositeSheet(assetUrl(composite.url), details.printSize);
      const sheet = compositeCache.current;
      await operatorPrint({ booking: details, images: [sheet.image], frameName: composite.frameName || "Ảnh ghép khung",
        printSize: sheet.printSize, copies, saveOnly });
      toast.success(saveOnly ? "Đã lưu file in từ ảnh ghép vào đơn." : `Đã gửi ${copies} tờ tới hàng in RX1 và lưu file in vào đơn.`);
      setArchivePending(false); compositeCache.current = null;
      setRefresh((value) => value + 1);
      onPrinted?.();
    } catch (cause) {
      setArchivePending(Boolean(cause.printed)); setError(cause.message);
    } finally { inFlight.current = false; setBusy(false); }
  }

  if (manual) return <CounterCompose booking={details} onClose={() => setManual(false)} onSaved={() => {
    setManual(false); setSelected(""); setPage(0); setRefresh((value) => value + 1); onPrinted?.();
  }} />;
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}>
    <section className="modal order-print-dialog" role="dialog" aria-modal="true" aria-label={`In ảnh đơn ${booking.code}`}
      aria-busy={busy || loading} onClick={(event) => event.stopPropagation()}>
      <div className="modal-header">
        <div><h2>In ảnh · #{booking.code}</h2><p>Xem file đã lưu, in lại hoặc ghép ảnh để in.</p></div>
        <button className="icon-button" aria-label="Đóng" disabled={busy} onClick={onClose}><X /></button>
      </div>
      <ErrorBox error={error || loadError} />
      <div className="order-print-summary">
        <span>{details.roomName || "Chưa chọn máy"} · {SIZES[details.printSize] || SIZES.full}</span>
        <span>Đã dùng <b>{details.printSheets || 0}/{details.prints ?? 1}</b> {"tờ"}</span>
      </div>
      {loading ? <p className="order-print-loading" role="status">Đang kiểm tra file in mới nhất…</p> : job ? <>
        <label className="order-print-source">File in đã lưu
          <select value={job._id} disabled={locked} onChange={(event) => choose(event.target.value)}>
            {jobs.map((item) => <option key={item._id} value={item._id}>{item.frameName || "Khung đã ghép"} · {formatDateTime(item.createdAt)} · {item.sheetCount || 1} tờ</option>)}
          </select>
        </label>
        <div className="order-print-body">
          <div className="order-print-preview">
            {preview && failedImage !== preview ? <img src={preview} alt={`Tờ ${page + 1} của đơn ${booking.code}`} onError={() => setFailedImage(preview)} />
              : <p role="status"><ImageIcon /> Không tải được ảnh xem trước. Hãy làm mới hoặc tải file đầy đủ.</p>}
            {count > 1 && <div className="order-print-pages">
              <button className="icon-button" aria-label="Tờ trước" disabled={page === 0 || busy} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={18} /></button>
              <span>Tờ {page + 1}/{count}</span>
              <button className="icon-button" aria-label="Tờ sau" disabled={page >= count - 1 || busy} onClick={() => setPage((value) => value + 1)}><ChevronRight size={18} /></button>
            </div>}
            <a href={sheetUrl(job, page)} target="_blank" rel="noreferrer">Xem bản đầy đủ <ExternalLink size={14} /></a>
          </div>
          <div className="order-print-settings">
            <dl>
              <div><dt>Khung</dt><dd>{job.frameName || "Khung đã ghép"}</dd></div>
              <div><dt>Khổ file</dt><dd>{SIZES[printSize]}</dd></div>
              <div><dt>Trạng thái</dt><dd>{job.status === "printed" ? "Đã xác nhận in" : STATES[job.spoolStatus] || "Chưa gửi máy in"}</dd></div>
              {job.width && <div><dt>Độ phân giải</dt><dd>{job.width} × {job.height} px</dd></div>}
              {job.expiresAt && <div><dt>Lưu đến</dt><dd>{formatDateTime(job.expiresAt)}</dd></div>}
            </dl>
            {job.spoolStatus === "failed" && job.spoolMessage && <p className="soft-note">{job.spoolMessage}</p>}
            <label>Số bộ in lại<select value={copies} disabled={locked || !maximum} onChange={(event) => setCopies(Number(event.target.value))}>
              {Array.from({ length: maximum }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <p className="order-print-total"><b>{count * copies} {selfbooth ? selfboothUnit(printSize) : "tờ 10 × 15 cm"}</b>
              {printSize === "strip" && <span>Máy cắt thành {count * copies * 2} dải nhỏ.</span>}</p>
            {selfbooth && <p className="soft-note">Bấm In mở cửa sổ in: chọn máy DNP DS820 ở quầy, giấy 8 × 12 inch, lề Không có.</p>}
            {!selfbooth && <p className="soft-note">In trên PC đang cắm RX1 và chạy chương trình in. Màu, độ nét và cắt giấy theo bộ in RX1 của máy đó.</p>}
            {!maximum && <p className="soft-note">File vượt 20 tờ. Tải các tờ để chia lượt in.</p>}
          </div>
        </div>
        <p className="soft-note">In lại là thao tác hỗ trợ, không trừ lượt và không cộng tiền. Khách mua thêm bản in: dùng “Thêm lượt in”.</p>
      </> : !loadError && (composite ? <div className="order-print-composite">
        <img src={assetUrl(`${composite.url}?size=preview`)} alt={`Ảnh ghép khung của đơn ${booking.code}`} />
        <div>
          <h3>Chưa có file in — in từ ảnh ghép</h3>
          <p>Ảnh ghép khung khách đã chọn (đúng màu, chữ, nhãn dán) được làm thành tờ in {printSize === "strip"
            ? "10 × 15 cm, máy cắt đôi thành 2 dải 5 × 15 cm" : "10 × 15 cm"}, in qua RX1 trên máy này và lưu vào đơn để in lại sau.</p>
          <label>Số bộ in<select aria-label="Số bộ in" value={copies} disabled={locked || !maximum} onChange={(event) => setCopies(Number(event.target.value))}>
            {Array.from({ length: maximum }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <div className="order-print-composite-actions">
            <Button disabled={busy || !maximum} onClick={() => printComposite(false)}><Printer size={16} />
              {busy ? "Đang xử lý…" : archivePending ? "Lưu kết quả in" : "In từ ảnh ghép"}</Button>
            {!archivePending && <Button className="outline" disabled={busy} onClick={() => printComposite(true)}>Chỉ lưu file in</Button>}
          </div>
          <p className="soft-note">Muốn đổi ảnh hoặc khung: bấm “Ghép ảnh thủ công”.</p>
        </div>
      </div> : <div className="order-print-empty">
        <ImageIcon /><h3>{details.mediaDeleted ? "Ảnh đã hết hạn lưu trữ" : "Chưa có file in đã lưu"}</h3>
        <p>{details.mediaDeleted ? "File cũ không còn để in lại."
          : details.photoCount ? `Album có ${details.photoCount} ảnh gốc. Ghép ảnh để in như ở máy chụp: chọn khung, chạm ảnh để đặt vào khung.`
            : "Album chưa có ảnh gốc. Khi ảnh tải lên xong, bạn có thể ghép để in hoặc thêm file từ máy quầy."}</p>
        {canCompose && <Button onClick={() => setManual(true)}>Ghép ảnh để in</Button>}
      </div>)}
      <div className="order-print-actions">
        <Button className="outline" disabled={busy} onClick={() => { setFailedImage(""); setRefresh((value) => value + 1); }}><RefreshCw size={15} /> Làm mới</Button>
        {details.accessToken && <a className="button outline" href={`/album/${details.accessToken}`} target="_blank" rel="noreferrer">Mở album <ExternalLink size={15} /></a>}
        {job && <a className="button outline" href={assetUrl(`${job.image}?download=1`)}><Download size={15} /> {count > 1 ? "Tải tất cả tờ (ZIP)" : "Tải file in"}</a>}
        {(job || composite) && canCompose && <Button className="outline" disabled={busy} onClick={() => setManual(true)}>Ghép ảnh thủ công</Button>}
        <Button className="outline" disabled={busy || loading || !canSell} onClick={() => onExtra(details)}>+ Thêm lượt in</Button>
        {job && <Button disabled={busy || !canOperate || !maximum || copies > maximum} onClick={reprint}><Printer size={16} />
          {busy ? "Đang xử lý…" : archivePending ? "Lưu kết quả in" : selfbooth ? "In 20×30 (DS820)" : "In lại qua RX1"}</Button>}
      </div>
    </section>
  </div>;
}
