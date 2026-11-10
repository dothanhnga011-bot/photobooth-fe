import { useEffect, useRef, useState } from "react";
import { Download, ImagePlus, RefreshCw, Save } from "lucide-react";
import { api, formatDateTime } from "../api.js";
import { Button, ErrorBox } from "../studio.jsx";
import { useLiveData } from "../use-live-data.js";
import defaultPreview from "./assets/rx1-preview-default.jpg";
import rx1Driver from "./installers/open-rx1-driver.ps1?raw";
import rx1Color from "./installers/configure-rx1-color.ps1?raw";
import { printerColorInstaller, printerDriverLauncher } from "./printer-installer.js";
import { download } from "./kiosk-autostart.js";
import "./rx1-output.css";

function DriverTools() {
  const [message, setMessage] = useState("");
  function driver(mode) {
    const name = mode === "preferences" ? "mo-driver-RX1.bat" : "mo-thuoc-tinh-RX1.bat";
    download(name, printerDriverLauncher(rx1Driver, mode));
    setMessage(`Đã tải ${name}. Chạy file trên PC Windows cắm RX1 bằng tài khoản đang dùng kiosk. Đóng cửa sổ của từng hàng in để mở hàng tiếp theo.`);
  }
  return <section className="rx1-driver">
    <h3>Cài đặt driver trên PC RX1</h3>
    <p>Gamma và DPI lưu trực tiếp ở trên. Với tuỳ chọn riêng của DNP, tải công cụ bên dưới rồi chạy trên PC Windows cắm máy in.</p>
    <div className="rx1-driver-actions">
      <Button className="outline" onClick={() => driver("preferences")}><Download size={16} /> Tải công cụ mở driver</Button>
      <Button className="outline" onClick={() => driver("properties")}><Download size={16} /> Tải công cụ mở thuộc tính / ICC</Button>
      <Button className="outline" onClick={() => {
        download("cai-mau-RX1.bat", printerColorInstaller(rx1Color));
        setMessage("Đã tải cai-mau-RX1.bat. Đợi in xong, chạy trên PC cắm RX1 bằng tài khoản kiosk và cho phép quyền quản trị Windows. Công cụ sao lưu trước khi đặt System ICM / Pictures / Color cho các hàng RX1.");
      }}><Download size={16} /> Tải công cụ đồng bộ ICM</Button>
    </div>
    <ul>
      <li><strong>Driver:</strong> chỉnh Sharpness, Color Adjustment và các tuỳ chọn DNP trong Printing Preferences của từng hàng in.</li>
      <li><strong>ICC:</strong> trong Printer Properties, mở Color Management → Devices, chọn đúng hàng RX1 và profile của giấy đang dùng.</li>
      <li><strong>Đồng bộ ICM:</strong> đặt cùng chế độ quản lý màu cho tờ lớn và cắt đôi, có sao lưu để khôi phục. ICC vẫn kiểm tra trong Windows.</li>
    </ul>
    <p>Cài đặt driver áp dụng cho PC chạy công cụ. Nếu chỉnh trên điện thoại hoặc máy khác, chuyển file sang PC RX1 để chạy.</p>
    {message && <p className="rx1-driver-message" role="status">{message}</p>}
  </section>;
}

function TonePreview({ gamma }) {
  const [file, setFile] = useState(null);
  const [pixels, setPixels] = useState(null);
  const [error, setError] = useState("");
  const original = useRef(null), adjusted = useRef(null);
  useEffect(() => {
    let active = true;
    const url = file ? URL.createObjectURL(file) : defaultPreview;
    const image = new Image();
    setError(""); setPixels(null);
    image.onload = () => {
      if (!active) return;
      try {
        const scale = Math.min(1, 600 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setPixels(context.getImageData(0, 0, canvas.width, canvas.height));
      } catch { setError("Không đọc được ảnh này. Hãy chọn ảnh JPG hoặc PNG khác."); }
    };
    image.onerror = () => { if (active) setError(file
      ? "Không mở được ảnh. Hãy chọn ảnh JPG hoặc PNG."
      : "Không tải được ảnh mẫu. Bạn có thể chọn ảnh khác để xem thử."); };
    image.src = url;
    return () => { active = false; image.onload = image.onerror = null; if (file) URL.revokeObjectURL(url); };
  }, [file]);
  useEffect(() => {
    if (!pixels) return;
    const result = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
    const table = Array.from({ length: 256 }, (_, value) => Math.round(255 * Math.pow(value / 255, gamma)));
    for (let index = 0; index < result.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) result.data[index + channel] = table[result.data[index + channel]];
    }
    for (const [canvas, data] of [[original.current, pixels], [adjusted.current, result]]) {
      canvas.width = data.width; canvas.height = data.height;
      canvas.getContext("2d").putImageData(data, 0, 0);
    }
  }, [pixels, gamma]);
  return <section className="rx1-preview">
    <h3>Xem thử trên ảnh của bạn</h3>
    <label className="button outline rx1-file"><ImagePlus size={17} /> Chọn ảnh xem thử
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
        const selected = event.target.files?.[0];
        event.target.value = "";
        if (!selected) return;
        if (selected.size > 25 * 1024 * 1024) { setError("Chọn ảnh dưới 25 MB để xem thử."); return; }
        setFile(selected);
      }} />
    </label>
    <ErrorBox error={error} />
    {pixels ? <div className="rx1-preview-pair">
      <figure><figcaption>Ảnh nguồn</figcaption><canvas ref={original} aria-label="Ảnh nguồn" /></figure>
      <figure><figcaption>Gamma {gamma.toFixed(2)}</figcaption><canvas ref={adjusted} aria-label="Ảnh xem thử gamma" /></figure>
    </div> : <div className="rx1-preview-empty" role="status">{error ? "Chọn ảnh khác để xem thử." : "Đang tải ảnh xem thử…"}</div>}
    <p>Bạn có thể chọn ảnh khác để thử; tải lại trang sẽ trở về ảnh mẫu mặc định. Ảnh xem thử được xử lý ngay trên máy bạn. Màu trên giấy còn phụ thuộc ICC, driver và ánh sáng xem ảnh.</p>
  </section>;
}

export function Rx1OutputManager({ notify }) {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [printers, setPrinters] = useState([]);
  const [statusError, setStatusError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    api("/admin/settings/rx1-output", { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setSaved(result.settings); setConfigured(result.configured);
      setForm({ gamma: result.settings.gamma.toFixed(2), maxResolution: result.settings.maxResolution });
    }, (cause) => { if (!controller.signal.aborted) setLoadError(cause.status === 404
      ? "Cần cập nhật máy chủ để dùng chức năng màu in RX1, rồi tải lại trang." : cause.message); });
    return () => controller.abort();
  }, [revision]);
  const refreshPrinters = useLiveData("/admin/print-jobs/printers", (rows) => {
    setPrinters(rows.filter((row) => row.room)); setStatusError("");
  }, (cause) => setStatusError(cause.message), 10000);
  const gamma = Number(form?.gamma);
  const valid = Boolean(form?.gamma.trim()) && Number.isFinite(gamma) && gamma >= 1 && gamma <= 2.2
    && Math.abs(gamma * 100 - Math.round(gamma * 100)) < 1e-8;
  const changed = form && (!configured || gamma !== saved?.gamma || form.maxResolution !== saved?.maxResolution);
  const defaultGamma = saved?.gamma ?? 1.5;
  const presets = [...new Set([1, 1.3, 1.5, 1.8, 2, 2.2, defaultGamma])].sort((a, b) => a - b);
  async function save(event) {
    event.preventDefault();
    if (!valid || busy || loadError) return;
    setBusy(true); setError("");
    try {
      const result = await api("/admin/settings/rx1-output", { method: "PUT", body: { gamma, maxResolution: form.maxResolution } });
      setSaved(result.settings); setConfigured(true);
      setForm({ gamma: result.settings.gamma.toFixed(2), maxResolution: result.settings.maxResolution });
      notify?.("Đã lưu màu in RX1. Các bộ in đã cập nhật sẽ tự nhận khi có kết nối.");
      refreshPrinters();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  return <div className="rx1-color-page">
    <ErrorBox error={loadError || error} />
    {loadError && <Button className="outline" onClick={() => setRevision((value) => value + 1)}>Thử tải lại cấu hình</Button>}
    {!form ? !loadError && <p role="status">Đang tải màu in RX1…</p> : <div className="rx1-color-grid">
      <form className="rx1-color-controls" onSubmit={save}>
        <h3>Cấu hình bản in</h3>
        <p>Áp dụng chung cho các máy DNP RX1 của tiệm, cho cả tờ lớn và tờ cắt đôi.</p>
        <label htmlFor="rx1-gamma">Độ tối bản in (gamma)</label>
        <div className="rx1-gamma-inputs">
          <input aria-label="Thanh chỉnh gamma" type="range" min="1.00" max="2.20" step="0.01" value={valid ? gamma : 1.5}
            disabled={busy || Boolean(loadError)} onChange={(event) => setForm({ ...form, gamma: event.target.value })} />
          <input id="rx1-gamma" type="number" min="1.00" max="2.20" step="0.01" value={form.gamma}
            disabled={busy || Boolean(loadError)} onChange={(event) => setForm({ ...form, gamma: event.target.value })} />
        </div>
        {!valid && <p className="field-error" role="alert">Nhập gamma từ 1.00 đến 2.20, tối đa 2 số thập phân.</p>}
        <p>Tăng gamma làm vùng trung gian tối hơn. Mức 1.00 giữ tông nguồn; 2.20 bù tối mạnh. Mặc định hiện tại là {defaultGamma.toFixed(2)}.</p>
        <div className="rx1-presets">{presets.map((value) => <button key={value} type="button"
          disabled={busy || Boolean(loadError)} aria-pressed={gamma === value}
          onClick={() => setForm({ ...form, gamma: value.toFixed(2) })}>{value.toFixed(2)}{value === defaultGamma ? " · Mặc định" : ""}</button>)}</div>
        <label className="rx1-dpi"><input type="checkbox" checked={form.maxResolution} disabled={busy || Boolean(loadError)}
          onChange={(event) => setForm({ ...form, maxResolution: event.target.checked })} /> Dùng DPI cao nhất driver hỗ trợ</label>
        <p>Cấu hình này bù tông khi in giấy. Ảnh gốc và album QR giữ màu nguồn.</p>
        <Button type="submit" disabled={busy || !valid || !changed || Boolean(loadError)}><Save size={16} /> {busy ? "Đang lưu…" : "Lưu cấu hình màu in"}</Button>
        <p className="rx1-save-note" role="status">{configured
          ? `Đã lưu gamma ${saved.gamma.toFixed(2)}. Bộ in đang chạy sẽ tự đồng bộ; tờ đã gửi giữ mức cũ.`
          : "Bấm Lưu để các máy dùng chung cấu hình trên web. Hiện các máy vẫn dùng cài đặt riêng đã có."}</p>
      </form>
      <TonePreview gamma={valid ? gamma : 1.5} />
    </div>}
    {form && !loadError && <DriverTools />}
    <section className="rx1-sync">
      <div className="rx1-sync-heading"><h3>Máy in đã nhận cấu hình</h3><Button className="outline small" onClick={() => refreshPrinters()}><RefreshCw size={15} /> Làm mới trạng thái</Button></div>
      {statusError && <p role="status">Chưa đọc được trạng thái: {statusError}</p>}
      {!printers.length && <p>Chưa có bộ in báo về. Sau khi phát hành web mới, cập nhật và mở lại chương trình in trên PC RX1 một lần để nhận cấu hình từ web.</p>}
      {printers.map((printer) => {
        const applied = printer.rx1Output;
        const running = printer.agent?.running;
        const fresh = applied && Date.now() - Date.parse(applied.at) < 120000;
        const matched = configured && applied && Math.abs(applied.gamma - saved.gamma) < 0.000001 && applied.maxResolution === saved.maxResolution;
        return <div className="rx1-sync-row" key={printer.room}>
          <strong>{printer.roomName || printer.branch || "Máy RX1"}</strong>
          <span>{!running ? "Chưa kết nối" : !applied ? "Cần cập nhật chương trình in" : !fresh ? "Đang chờ bộ in đồng bộ" : matched ? "Đã nhận cấu hình" : configured ? "Đang chờ nhận mức mới" : "Đang dùng cấu hình riêng"}</span>
          {applied && <small>Gamma {applied.gamma.toFixed(2)} · {formatDateTime(applied.at)}</small>}
        </div>;
      })}
    </section>
  </div>;
}
