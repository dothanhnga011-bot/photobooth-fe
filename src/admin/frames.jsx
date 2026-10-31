import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Copy,
  ImagePlus,
  Pencil,
  Plus,
  Power,
  QrCode,
  ScanSearch,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { api, assetUrl } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { compareFrameOrder } from "../frame-catalog-data";
import { detectSlots, frameCapacity, isPhotoRegion, printDate } from "../frame-utils";
import { serviceOf } from "./service-tabs";

const PAGE_SIZE = 12;
const MAX_BYTES = 10 * 1024 * 1024;
const SIZES = { full: "Size lớn", strip: "Size nhỏ", instax: "Size Instax" };
const SIZE_NOTES = {
  full: "In nguyên tờ 10 × 15 cm",
  strip: "2 dải 5 × 15 cm trên một tờ, máy in cắt đôi",
  instax: "Thẻ Instax Wide, ảnh ngang 3 : 2 (máy Instax Link WIDE)",
};
const FRAME_TITLES = { full: "size lớn", strip: "size nhỏ", instax: "Instax Wide" };
// Cỡ ảnh khung theo khổ: tờ 10 × 15 và thẻ Instax Wide đều 1200 × 1800 (3 : 2; Instax Wide thường ngang).
const FRAME_PIXELS = { full: [1200, 1800], strip: [1200, 1800], instax: [1200, 1800] };
const pixelsText = (printSize) => {
  const [w, h] = FRAME_PIXELS[printSize] || FRAME_PIXELS.full;
  return `${w} × ${h} hoặc ${h} × ${w}`;
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// ─── Danh sách khung (như Snapbox /setting/frame): lọc chủ đề, kích thước, phân trang ──────
export function FramesManager({ notify }) {
  const toast = useToast();
  const { reload: reloadCatalog, settings = {} } = useStudio();
  const [frames, setFrames] = useState(null);
  const [themes, setThemes] = useState([]);
  // Loại hình của từng chủ đề (Photobooth / Polaroid): khung chỉ gán vào chủ đề cùng loại với khổ khung.
  const [themeKinds, setThemeKinds] = useState({});
  const [theme, setTheme] = useState("all");
  const [size, setSize] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () =>
    Promise.all([api("/admin/frames"), api("/admin/themes")]).then(([list, themeList]) => {
      setFrames(list);
      setThemes(themeList.map((t) => t.name));
      setThemeKinds(Object.fromEntries(themeList.map((t) => [t.name, t.kind || "photobooth"])));
    }, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const themeOrder = (settings.themes || []).map((t) => t.name);
  const rank = (name) => {
    const index = themeOrder.indexOf(name);
    return index < 0 ? themeOrder.length : index;
  };
  const sorted = useMemo(() => [...(frames || [])].sort((a, b) =>
    rank(a.themeName?.trim()) - rank(b.themeName?.trim()) ||
    String(a.themeName || "").localeCompare(String(b.themeName || ""), "vi") ||
    compareFrameOrder(a, b)), [frames, themeOrder.join()]);
  const visible = sorted.filter((f) =>
    (theme === "all" || (theme === "none" ? !f.themeName?.trim() : f.themeName?.trim() === theme)) &&
    (size === "all" || (f.printSize || "full") === size));
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const shown = visible.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE);
  useEffect(() => setPage(1), [theme, size]);
  const run = async (action, message) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await load();
      reloadCatalog?.();
      if (message) notify(message);
    } catch (e) {
      toast.error(e.message);
      if (e.status === 409) load();
    } finally {
      setBusy(false);
    }
  };
  // Thứ tự khách thấy trong cùng chủ đề.
  const move = (frame, direction) => {
    const siblings = sorted.filter((f) => (f.themeName?.trim() || "") === (frame.themeName?.trim() || ""));
    run(() => api(`/admin/frames/${frame._id}/move`, {
      method: "POST",
      body: { direction, expectedIds: siblings.map((f) => f._id) },
    }), "Đã đổi thứ tự khung.");
  };
  const toggle = (frame) =>
    run(async () => {
      const full = await api(`/admin/frames/${frame._id}`);
      await api(`/admin/frames/${frame._id}`, { method: "PUT", body: { ...stripFrame(full), active: !frame.active } });
    }, frame.active ? "Đã tắt khung — khách không thấy khung này." : "Đã bật khung.");
  const remove = (frame) => {
    if (!window.confirm(`Xóa khung “${frame.name}”? Ảnh khách đã in không bị ảnh hưởng.`)) return;
    run(() => api(`/admin/frames/${frame._id}`, { method: "DELETE" }), "Đã xóa khung.");
  };
  const edit = (frame) =>
    run(async () => setEditing(await api(`/admin/frames/${frame._id}`)));

  if (editing)
    return (
      <FrameEditor
        frame={editing}
        themes={themes}
        themeKinds={themeKinds}
        frames={frames || []}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          setEditing(null);
          await load();
          reloadCatalog?.();
          notify(message);
        }}
      />
    );
  return (
    <div className="frames-manager">
      <ErrorBox error={error} />
      <div className="frames-toolbar">
        <label>
          Chủ đề:
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="all">Tất cả</option>
            {themes.map((name) => <option key={name} value={name}>{name}</option>)}
            {frames?.some((f) => !f.themeName?.trim()) && <option value="none">Khung lẻ</option>}
          </select>
        </label>
        <label>
          Kích thước:
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="all">Tất cả</option>
            <option value="full">Size lớn</option>
            <option value="strip">Size nhỏ</option>
            <option value="instax">Size Instax</option>
          </select>
        </label>
        <div className="frames-add">
          <Button onClick={() => setAdding(!adding)} aria-expanded={adding}>
            <Plus size={16} aria-hidden="true" /> Thêm mới frame <ChevronDown size={15} aria-hidden="true" />
          </Button>
          {adding && (
            <div className="frames-add-menu" role="menu">
              {Object.entries(SIZES).map(([key, label]) => (
                <button key={key} type="button" role="menuitem" onClick={() => {
                  setAdding(false);
                  setEditing(newFrame(key, theme !== "all" && theme !== "none" && (themeKinds[theme] || "photobooth") === serviceOf(key)
                    ? theme
                    : themes.find((name) => (themeKinds[name] || "photobooth") === serviceOf(key)) || "", frames || []));
                }}>
                  {label}
                  <small>{SIZE_NOTES[key]}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="frames-count">{frames ? `${visible.length} khung` : "Đang tải…"}</span>
      </div>
      {frames && !visible.length && (
        <div className="empty-state">
          <ImagePlus />
          <h3>{frames.length ? "Không có khung phù hợp bộ lọc" : "Chưa có khung ảnh"}</h3>
          <p>Bấm “Thêm mới frame”, chọn size rồi tải khung PNG từ Canva lên.</p>
        </div>
      )}
      <ul className="frames-grid">
        {shown.map((frame) => (
          <li key={frame._id} className={frame.active ? "" : "is-off"}>
            <button type="button" className="frames-card-image" onClick={() => edit(frame)} aria-label={`Sửa khung ${frame.name}`}>
              <img src={assetUrl(frame.thumb || frame.image)} alt="" loading="lazy" decoding="async" />
              {!frame.active && <span className="frames-off">Đã tắt</span>}
            </button>
            <dl>
              <div><dt>Kích thước</dt><dd>{SIZES[frame.printSize || "full"]}</dd></div>
              <div><dt>Chủ đề</dt><dd>{frame.themeName?.trim() || "Khung lẻ"}</dd></div>
              <div><dt>Ảnh ghép</dt><dd>{frameCapacity(frame)} ảnh</dd></div>
            </dl>
            <div className="frames-card-actions">
              <button type="button" title="Sửa" aria-label={`Sửa ${frame.name}`} onClick={() => edit(frame)}><Pencil size={15} /></button>
              <button type="button" title="Lên trước" aria-label={`Đưa ${frame.name} lên trước`} disabled={busy} onClick={() => move(frame, "up")}><ArrowUp size={15} /></button>
              <button type="button" title="Xuống sau" aria-label={`Đưa ${frame.name} xuống sau`} disabled={busy} onClick={() => move(frame, "down")}><ArrowDown size={15} /></button>
              <button type="button" title={frame.active ? "Tắt khung" : "Bật khung"} aria-label={`${frame.active ? "Tắt" : "Bật"} ${frame.name}`} disabled={busy} onClick={() => toggle(frame)}><Power size={15} /></button>
              <button type="button" title="Xóa" aria-label={`Xóa ${frame.name}`} disabled={busy} onClick={() => remove(frame)}><Trash2 size={15} /></button>
            </div>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="frames-pages" aria-label="Trang">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Trang trước">‹</button>
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <button type="button" key={n} className={n === Math.min(page, pages) ? "active" : ""} aria-current={n === page ? "page" : undefined} onClick={() => setPage(n)}>{n}</button>
          ))}
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Trang sau">›</button>
        </nav>
      )}
    </div>
  );
}

// Dữ liệu gửi lên máy chủ (bỏ trường máy chủ tự quản lý).
const stripFrame = ({ name, themeName, order, printSize, image, slots, sheet, dateColor, shots, active }) =>
  ({ name, themeName, order, printSize, image, slots, sheet, dateColor, shots, active });
function newFrame(printSize, themeName, frames) {
  const same = frames.filter((f) => (f.themeName?.trim() || "") === themeName);
  return {
    name: "",
    themeName,
    printSize,
    order: Math.min(999, 1 + Math.max(0, ...same.map((f) => f.order || 0))),
    image: "",
    slots: [],
    sheet: true,
    dateColor: "#2f1a12",
    shots: 0,
    active: true,
  };
}

// Ảnh khung: PNG / JPG ≤ 10 MB, đúng 1200 × 1800 hoặc 1800 × 1200 (Instax Wide cũng vậy, thường
// ngang); ảnh cùng tỉ lệ được đưa về đúng cỡ, giữ nền trong suốt.
async function readFrameFile(file, printSize = "full") {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Vui lòng chọn ảnh khung PNG (hoặc JPG).");
  if (file.size > MAX_BYTES) throw new Error("Ảnh khung tối đa 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Không đọc được ảnh khung."));
      im.src = url;
    });
    const portrait = image.naturalHeight >= image.naturalWidth;
    const [short, long] = FRAME_PIXELS[printSize] || FRAME_PIXELS.full;
    const [w, h] = portrait ? [short, long] : [long, short];
    const ratio = image.naturalWidth / image.naturalHeight;
    if (Math.abs(ratio - w / h) > 0.01)
      throw new Error(`Ảnh khung ${image.naturalWidth} × ${image.naturalHeight} px không đúng tỉ lệ ${SIZES[printSize] || SIZES.full}. Cần ${pixelsText(printSize)} px.`);
    let data;
    if (image.naturalWidth === w && image.naturalHeight === h)
      data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    else {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, w, h);
      data = canvas.toDataURL("image/png");
      canvas.width = canvas.height = 0;
    }
    if (data.length > 14_000_000) throw new Error("Ảnh khung quá lớn sau khi chuyển. Hãy xuất PNG nhẹ hơn từ Canva.");
    return { data, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Ảnh khung đã tải có đúng tỉ lệ của khổ đang chọn không ("" = đúng).
async function frameRatioError(src, printSize) {
  const image = await new Promise((resolve, reject) => {
    const im = new Image();
    if (!/^(data|blob):/.test(src)) im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Không đọc được ảnh khung."));
    im.src = src;
  });
  const [short, long] = FRAME_PIXELS[printSize] || FRAME_PIXELS.full;
  const ratio = Math.min(image.naturalWidth, image.naturalHeight) / Math.max(image.naturalWidth, image.naturalHeight);
  return Math.abs(ratio - short / long) > 0.01
    ? `Ảnh khung không đúng tỉ lệ ${SIZES[printSize]} (cần ${pixelsText(printSize)} px) — tải lại ảnh khung khác.`
    : "";
}

// Tự nhận các ô trong suốt / trắng làm vùng ảnh. Khung nhỏ: ô ở dải phải trùng hàng với ô dải trái
// nhận cùng số ảnh (in ra 2 dải giống nhau).
async function autoRegions(src, printSize) {
  const image = await new Promise((resolve, reject) => {
    const im = new Image();
    if (!/^(data|blob):/.test(src)) im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Không đọc được ảnh khung."));
    im.src = src;
  });
  const k = Math.min(1, 800 / Math.max(image.naturalWidth, image.naturalHeight));
  const probe = document.createElement("canvas");
  probe.width = Math.round(image.naturalWidth * k);
  probe.height = Math.round(image.naturalHeight * k);
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, probe.width, probe.height);
  const slots = detectSlots(ctx.getImageData(0, 0, probe.width, probe.height));
  probe.width = probe.height = 0;
  let next = 0;
  const left = [];
  return slots.map((s) => {
    if (printSize === "strip" && s.x + s.w / 2 > 0.5) {
      const twin = left.find((l) => Math.abs(l.y - s.y) < 0.03 && Math.abs(l.h - s.h) < 0.03);
      if (twin) return { ...s, kind: "photo", photo: twin.photo };
    }
    const region = { ...s, kind: "photo", photo: ++next };
    if (s.x + s.w / 2 <= 0.5) left.push(region);
    return region;
  });
}

const HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const MIN = 0.02;
// Kéo vùng: di chuyển hoặc kéo giãn từng cạnh / góc, luôn nằm trong khung.
function dragRegion(start, mode, dx, dy) {
  let { x, y, w, h } = start;
  if (mode === "move") return { ...start, x: clamp(x + dx, 0, 1 - w), y: clamp(y + dy, 0, 1 - h) };
  if (mode.includes("e")) w = clamp(w + dx, MIN, 1 - x);
  if (mode.includes("s")) h = clamp(h + dy, MIN, 1 - y);
  if (mode.includes("w")) {
    const nx = clamp(x + dx, 0, x + w - MIN);
    w += x - nx;
    x = nx;
  }
  if (mode.includes("n")) {
    const ny = clamp(y + dy, 0, y + h - MIN);
    h += y - ny;
    y = ny;
  }
  return { ...start, x, y, w, h };
}

// ─── Thêm / sửa khung (như Snapbox "Thêm mới frame size lớn"): form bên trái, khung bên phải ────
function FrameEditor({ frame: initial, themes, themeKinds = {}, frames, onClose, onSaved }) {
  const toast = useToast();
  const [frame, setFrame] = useState(initial);
  const [selected, setSelected] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newTheme, setNewTheme] = useState("");
  const [over, setOver] = useState(false);
  const canvas = useRef(null);
  const gesture = useRef(null);
  const fileInput = useRef(null);
  const set = (patch) => setFrame((f) => ({ ...f, ...patch }));
  const slots = frame.slots || [];
  const setSlots = (next) => set({ slots: typeof next === "function" ? next(slots) : next });
  const capacity = frameCapacity(frame);
  const maxPhoto = Math.max(0, ...slots.filter(isPhotoRegion).map((s) => s.photo || 0));
  const strip = frame.printSize === "strip";
  const imageSrc = frame.image?.startsWith("data:") ? frame.image : assetUrl(frame.image);
  const sameKind = themes.filter((name) => (themeKinds[name] || "photobooth") === serviceOf(frame.printSize));
  const themeOptions = [...new Set([...sameKind, frame.themeName].filter((name) => name && name !== "__new"))];

  async function pickFile(file) {
    if (!file) return;
    setError("");
    try {
      const { data } = await readFrameFile(file, frame.printSize);
      const regions = slots.length ? slots : await autoRegions(data, frame.printSize).catch(() => []);
      set({ image: data, sheet: true, slots: regions });
      setSelected(-1);
      toast.success(regions.length && !slots.length
        ? `Đã nhận ${new Set(regions.map((r) => r.photo)).size} ảnh (${regions.length} vùng) từ các ô trong suốt — kiểm tra và căn chỉnh lại nếu cần.`
        : "Đã tải ảnh khung. Bấm “Thêm vùng ảnh” để đặt ô ảnh.");
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    }
  }
  const add = (kind) => {
    const region = kind === "photo"
      ? { x: 0.1, y: 0.1, w: strip ? 0.35 : 0.5, h: 0.2, kind, photo: maxPhoto + 1 }
      : kind === "qr"
        ? { x: 0.06, y: 0.84, w: 0.12, h: 0.08, kind }
        : { x: 0.22, y: 0.88, w: 0.22, h: 0.04, kind };
    setSlots([...slots, region]);
    setSelected(slots.length);
  };
  // Sao chép: khung nhỏ chép sang dải bên kia cùng vị trí (in ra 2 dải giống nhau); khung lớn
  // chép lệch xuống một chút. Bản sao vùng ảnh giữ nguyên số ảnh.
  const duplicate = (index) => {
    const s = slots[index];
    const copy = strip
      ? { ...s, x: clamp(s.x + (s.x + s.w / 2 < 0.5 ? 0.5 : -0.5), 0, 1 - s.w) }
      : { ...s, x: clamp(s.x + 0.03, 0, 1 - s.w), y: clamp(s.y + 0.03, 0, 1 - s.h) };
    setSlots([...slots, copy]);
    setSelected(slots.length);
  };
  const removeRegion = (index) => {
    setSlots(slots.filter((_, i) => i !== index));
    setSelected(-1);
  };
  const begin = (event, index, mode) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = canvas.current.getBoundingClientRect();
    gesture.current = { index, mode, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, start: { ...slots[index] } };
    setSelected(index);
  };
  const moveTo = (event) => {
    const g = gesture.current;
    if (!g) return;
    const next = dragRegion(g.start, g.mode, (event.clientX - g.x) / g.width, (event.clientY - g.y) / g.height);
    setSlots((list) => list.map((s, i) => (i === g.index ? next : s)));
  };
  const end = () => {
    gesture.current = null;
  };
  // Phím mũi tên dịch vùng đang chọn 1 px (Shift: 10 px), Delete xóa vùng.
  useEffect(() => {
    const onKey = (event) => {
      if (selected < 0 || !slots[selected] || /input|select|textarea/i.test(event.target.tagName)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeRegion(selected);
        return;
      }
      const step = (event.shiftKey ? 10 : 1) / 1800;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (!d) return;
      event.preventDefault();
      setSlots((list) => list.map((s, i) => (i === selected ? dragRegion(s, "move", d[0], d[1]) : s)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function save() {
    const themeName = (frame.themeName === "__new" ? newTheme : frame.themeName || "").trim();
    if (frame.themeName === "__new" && !themeName) return toast.error("Vui lòng nhập tên chủ đề mới.");
    if (!frame.image) return toast.error("Vui lòng tải ảnh khung lên.");
    if (!capacity) return toast.error("Khung cần ít nhất 1 vùng ảnh — bấm “Thêm vùng ảnh”.");
    // Đổi kích thước sau khi đã tải ảnh: ảnh phải đúng tỉ lệ của khổ mới.
    const mismatch = await frameRatioError(imageSrc, frame.printSize).catch(() => "");
    if (mismatch) return toast.error(mismatch);
    const count = frames.filter((f) => (f.themeName?.trim() || "") === themeName && f.printSize === frame.printSize).length;
    const name = frame.name.trim() || `${themeName || "Khung"} · ${SIZES[frame.printSize]} ${String(count + (frame._id ? 0 : 1)).padStart(2, "0")}`;
    setBusy(true);
    setError("");
    try {
      const body = stripFrame({ ...frame, name, themeName });
      await api(`/admin/frames${frame._id ? `/${frame._id}` : ""}`, {
        method: frame._id ? "PUT" : "POST",
        body,
        timeout: 120000,
      });
      onSaved(frame._id ? `Đã cập nhật khung “${name}”.` : `Đã thêm khung “${name}”.`);
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const current = slots[selected];
  return (
    <div className="frame-editor-page">
      <header className="frame-editor-head">
        <button type="button" className="icon-button" aria-label="Quay lại danh sách khung" onClick={onClose}><ArrowLeft size={18} /></button>
        <h3>{frame._id ? "Cập nhật frame" : "Thêm mới frame"} {FRAME_TITLES[frame.printSize] || FRAME_TITLES.full}</h3>
      </header>
      <ErrorBox error={error} />
      <div className="frame-editor-layout">
        <aside className="frame-editor-form">
          <label>
            <span>* Chủ đề</span>
            <select value={frame.themeName || ""} onChange={(e) => set({ themeName: e.target.value })}>
              <option value="">Khung lẻ (không chủ đề)</option>
              {themeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value="__new">+ Chủ đề mới…</option>
            </select>
          </label>
          {frame.themeName === "__new" && (
            <label>
              <span>Tên chủ đề mới</span>
              <input autoFocus maxLength={100} value={newTheme} onChange={(e) => setNewTheme(e.target.value)} />
            </label>
          )}
          <label>
            <span>Tên khung</span>
            <input maxLength={200} placeholder="Để trống: tự đặt theo chủ đề" value={frame.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            <span>Kích thước</span>
            <select value={frame.printSize} onChange={(e) => set({ printSize: e.target.value })}>
              <option value="full">Size lớn — in nguyên tờ 10 × 15</option>
              <option value="strip">Size nhỏ — 2 dải trên một tờ, cắt đôi</option>
              <option value="instax">Size Instax — thẻ Instax Wide, ảnh ngang 3 : 2</option>
            </select>
          </label>
          <label className="frame-color">
            <span>Chọn màu chữ ngày in</span>
            <input type="color" value={frame.dateColor || "#2f1a12"} onChange={(e) => set({ dateColor: e.target.value })} />
            <small style={{ color: frame.dateColor }}>{printDate()}</small>
          </label>
          <label>
            <span>* Số lượng ảnh được chụp</span>
            <input type="number" inputMode="numeric" min={0} max={40} value={frame.shots || 0}
              onChange={(e) => set({ shots: clamp(Number(e.target.value) || 0, 0, 40) })} />
          </label>
          <div className="frame-capacity">
            <span>Số lượng ảnh trong khung ảnh</span>
            <strong>{capacity}</strong>
            <small>{slots.filter(isPhotoRegion).length} vùng ảnh · vùng cùng số in cùng một ảnh</small>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={frame.active !== false} onChange={(e) => set({ active: e.target.checked })} />
            Đang hoạt động (khách thấy khung này)
          </label>
          <div className="frame-editor-actions">
            <Button className="outline" onClick={onClose} disabled={busy}>Hủy</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Đang lưu…" : "Hoàn thành"}</Button>
          </div>
        </aside>

        <section className="frame-editor-stage">
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          {!frame.image ? (
            <div
              role="button"
              tabIndex={0}
              className={`frame-upload ${over ? "over" : ""}`}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files?.[0]); }}
            >
              <Upload size={26} aria-hidden="true" />
              <strong>Kéo thả frame ở đây để upload</strong>
              <small>PNG – max 10 MB – size {pixelsText(frame.printSize)}</small>
              <span className="button outline small">Chọn frame</span>
              <small>Thiết kế trên Canva → để trong suốt các ô ảnh → tải PNG lên đây.</small>
            </div>
          ) : (
            <>
              <div className="frame-tools">
                <button type="button" onClick={() => add("photo")}><Square size={15} /> Thêm vùng ảnh</button>
                <button type="button" onClick={() => add("qr")}><QrCode size={15} /> Thêm QR</button>
                <button type="button" onClick={() => add("date")}><CalendarDays size={15} /> Thêm ngày in</button>
                <button type="button" onClick={async () => {
                  const regions = await autoRegions(imageSrc, frame.printSize).catch(() => []);
                  if (!regions.length) return toast.warning("Không thấy ô trong suốt / trắng nào trong khung.");
                  setSlots([...regions, ...slots.filter((s) => !isPhotoRegion(s))]);
                  setSelected(-1);
                  toast.success(`Đã nhận ${new Set(regions.map((r) => r.photo)).size} ảnh (${regions.length} vùng).`);
                }}><ScanSearch size={15} /> Tự nhận vùng ảnh</button>
                <button type="button" onClick={() => fileInput.current?.click()}><ImagePlus size={15} /> Đổi ảnh khung</button>
              </div>
              {current && (
                <div className="frame-region-bar">
                  {isPhotoRegion(current) ? (
                    <label>
                      Vùng đang chọn: ảnh số
                      <select value={current.photo || 1} onChange={(e) => setSlots(slots.map((s, i) => (i === selected ? { ...s, photo: Number(e.target.value) } : s)))}>
                        {Array.from({ length: Math.min(40, maxPhoto + 1) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                  ) : (
                    <span>Vùng đang chọn: {current.kind === "qr" ? "mã QR album" : "ngày in"}</span>
                  )}
                  <small>Kéo để di chuyển · kéo các cạnh / góc để giãn · phím mũi tên để dịch từng chút</small>
                </div>
              )}
              <div className="frame-board-wrap">
                <div ref={canvas} className="frame-board" onPointerDown={() => setSelected(-1)}>
                  <img src={imageSrc} alt="Khung đang chỉnh" draggable="false" crossOrigin="anonymous" />
                  {slots.map((region, index) => (
                    <div
                      key={index}
                      className={`frame-region kind-${region.kind || "photo"} ${selected === index ? "selected" : ""} ${isPhotoRegion(region) && slots.findIndex((s) => isPhotoRegion(s) && s.photo === region.photo) !== index ? "is-copy" : ""}`}
                      style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
                      onPointerDown={(event) => begin(event, index, "move")}
                      onPointerMove={moveTo}
                      onPointerUp={end}
                      onPointerCancel={end}
                    >
                      <strong>{isPhotoRegion(region) ? region.photo : region.kind === "qr" ? "QR" : printDate()}</strong>
                      {selected === index && (
                        <>
                          <div className="frame-region-tools">
                            <button type="button" aria-label="Sao chép vùng" onPointerDown={(e) => e.stopPropagation()} onClick={() => duplicate(index)}><Copy size={13} /></button>
                            <button type="button" aria-label="Xóa vùng" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeRegion(index)}><Trash2 size={13} /></button>
                          </div>
                          {HANDLES.map((handle) => (
                            <span key={handle} className={`frame-handle h-${handle}`}
                              onPointerDown={(event) => begin(event, index, handle)}
                              onPointerMove={moveTo} onPointerUp={end} onPointerCancel={end} />
                          ))}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
