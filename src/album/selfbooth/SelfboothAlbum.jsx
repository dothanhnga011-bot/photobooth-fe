// Album phòng Selfbooth (in tờ 20 × 30 ở quầy, máy DNP DS820) — giao diện và các bước như album của web Selfbooth
// (14/11 chủ tiệm yêu cầu "làm theo Selfbooth"): 01 Ảnh (thư viện: thả tim, thêm ảnh từ điện thoại, xoá, tải,
// chọn nhiều; chạm ảnh để làm đẹp) → 02 Chủ đề (chọn một bộ khung) → 03 Ghép ảnh (mọi khung của bộ: chạm ô,
// chọn ảnh, kéo để dời, phóng to) → 04 Kết quả (mỗi khung là một tờ 20 × 30; chọn tờ muốn in trong số
// tờ của vé rồi gửi in lên Hàng chờ in của quầy — /albums/:token/print-pack; nhân viên in ra máy DS820).
// Không tính giờ (20/11 chủ tiệm, như web Selfbooth): khách chọn ảnh, chọn khung, ghép rồi xem bản hoàn thiện
// thong thả; chỉ khi khách bấm "Gửi in" thì lệnh in mới lên Hàng chờ in, nhân viên ở quầy bấm In.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PiCheckBold, PiImagesDuotone, PiPrinterDuotone, PiSelectionAllBold, PiStackDuotone, PiTicketBold,
} from "react-icons/pi";
import { RefreshCw } from "lucide-react";
import { api, formatDateTime } from "../../api";
import { Button, ErrorBox, useStudio, useToast } from "../../studio";
import { DEFAULT_ADJUST, isNeutral } from "../../beauty.js";
import { renderPrintFrame } from "../../kiosk/compose.js";

import {
  groupFramePacks, largePrint, loadFrameImage,
} from "../../frame-utils.js";
import { storageLink } from "../../media-delivery.js";
import { savePhoto } from "../../kiosk/direct-upload.js";
import { prepareCameraImageAsync } from "../../image-processing.js";
import { photoUrl } from "../photo-thumb.jsx";
import { printPackUpload } from "../print-upload.js";
import { mergeUploadedPhotos, uploadPhotos } from "../upload-photos.js";
import { downloadEach, fetchFiles, isIOS } from "../save-to-phone.js";
import { createStudioMedia } from "../studio-media.js";
import { createCanvasCache } from '../../canvas-cache.js';

import { BeautyEditor } from './BeautyEditor.jsx';
import { NO_MOVE } from './FrameEditor.jsx';
import { usePhotoSuggestions } from './use-photo-suggestions.js';
import { suggestionTarget } from './photo-suggestions.js';
import { capacityOf, isFilled, pad, slotsOf } from './album-helpers.js';
import { Gallery } from './Gallery.jsx';
import { ShortageDialog, ThemePicker } from './ThemeStep.jsx';
import { PackEditor, Result } from './ComposeSteps.jsx';

const STEPS = [
  ["Ảnh", PiImagesDuotone],
  ["Chọn khung", PiStackDuotone],
  ["Ghép ảnh", PiSelectionAllBold],
  ["Bản in", PiPrinterDuotone],
];
const ACCEPTED = /^image\/(jpeg|png|webp)$/;
const MAX_UPLOAD_MB = 40;
const SHARE_BATCH_BYTES = 128 * 1024 * 1024;

function canSharePhotos(files = [new File(["x"], "anh.jpg", { type: "image/jpeg" })]) {
  try {
    return typeof navigator.share === "function" && navigator.canShare?.({ files }) === true;
  } catch {
    return false;
  }
}

// Ảnh của từng ô của mọi khung trong bộ: lấy lần lượt ảnh trong `pool`; repeat (tự động ghép) thì quay vòng.
function autoLayouts(frames, pool, { repeat = false } = {}) {
  let k = 0;
  return Object.fromEntries(frames.map((f) => [f._id, slotsOf(f).map(() => ({
    photo: (repeat && pool.length ? pool[k++ % pool.length] : pool[k++]) || null, ...NO_MOVE,
  }))]));
}
// Trạng thái lưu trên máy (tải lại trang vẫn giữ). save(changes | (v) => changes).
function useSaved(key, initial) {
  const [value, setValue] = useState(() => {
    try { return { ...initial, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* chế độ riêng tư: chỉ giữ trong trang */ }
  }, [key, value]);
  return [value, (changes) => setValue((v) => ({ ...v, ...(typeof changes === "function" ? changes(v) : changes) }))];
}

// Ảnh nhỏ đã làm đẹp (cạnh dài `edge` px) cho ô ghép / dải ảnh: ảnh xem trước cỡ lớn chỉ giữ trong lúc thu nhỏ.
function useSmallEdits(media, adjustOf, edge = 720) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bộ nhớ đệm mới khi đổi album (media) hoặc cỡ ảnh nhỏ (edge)
  const cache = useMemo(() => createCanvasCache({ maxPixels: 8_000_000, maxEntries: 24 }), [media, edge]);
  useEffect(() => () => {
    for (const key of [...cache.keys()]) cache.delete(key);
  }, [cache]);
  return async (photo) => {
    const adjust = adjustOf(photo.id);
    const key = `${photo.id}:${JSON.stringify(adjust)}`;
    return cache.remember(key, async () => {
      const big = await media.edited(photo, adjust, 'preview');
      try {
        const scale = Math.min(1, edge / Math.max(big.width, big.height));
        const small = document.createElement("canvas");
        small.width = Math.max(1, Math.round(big.width * scale));
        small.height = Math.max(1, Math.round(big.height * scale));
        small.getContext("2d").drawImage(big, 0, 0, small.width, small.height);
        return small;
      } finally { big.width = big.height = 0; }
    });
  };
}

export function SelfboothAlbum({ token, booking, setBooking, reload }) {
  const toast = useToast();
  const { frames: catalog = [], settings = {} } = useStudio();
  const media = useMemo(() => createStudioMedia(token), [token]);
  useEffect(() => () => media.clear(), [media]);
  const [saved, save] = useSaved(`selfbooth-album-v2-${token}`, {
    step: 0, hearts: [], adjusts: {}, packId: "", frameIndex: 0, layouts: {}, autoFill: false,
    requestKey: crypto.randomUUID(),
  });
  const originals = useMemo(() => booking.photos.filter((p) => p.kind === "original"), [booking.photos]);
  const ids = new Set(originals.map((p) => String(p.id)));
  const hearts = saved.hearts.filter((id) => ids.has(id));
  const heartsKey = hearts.join();
  const photos = originals.map((p) => ({ ...p, id: String(p.id), favorite: hearts.includes(String(p.id)) }));
  const photoOf = (id) => photos.find((p) => p.id === id);
  const newestFirst = [...photos].reverse();
  const favorites = photos.filter((p) => p.favorite);
  const adjustOf = (id) => ({ ...DEFAULT_ADJUST, ...saved.adjusts[id] });
  const small = useSmallEdits(media, adjustOf);
  // Phòng Selfbooth in tờ 20 × 30 máy DS820: album chỉ dùng khung khổ này.
  const size = "large";
  const unit = "tờ 20 × 30", word = "tờ";
  // Bộ khung: khung đúng khổ đang bật gom theo chủ đề (chủ đề đang tắt thì ẩn), theo thứ tự chủ đề của tiệm.
  const packs = useMemo(() => {
    const hidden = new Set((settings.themes || []).filter((t) => t.active === false).map((t) => t.name));
    const frames = catalog.filter((f) => f.active !== false && f.printSize === size && slotsOf(f).length &&
      !hidden.has(f.themeName?.trim()));
    return groupFramePacks(frames, (settings.themes || []).map((t) => t.name));
  }, [catalog, settings.themes, size]);
  const pack = packs.find((p) => p.id === saved.packId);
  const required = capacityOf(pack);
  const layoutsOf = (p, layouts) => p && p.frames.every((f) => layouts[f._id]?.length === slotsOf(f).length);
  const ready = Boolean(layoutsOf(pack, saved.layouts));
  const filled = ready && pack.frames.every((f) => isFilled(f, saved.layouts[f._id]));
  const quota = Math.max(1, Number(booking.prints) || 1);
  const used = Number(booking.printSheets) || 0;
  const [result, setResult] = useState(null);
  const submitted = result ? Math.max(used, result.printSheets) : used;
  const remaining = Math.max(0, quota - submitted);
  const [editing, setEditing] = useState(null);
  const [firstPhotosReady, setFirstPhotosReady] = useState(false);
  const [shortage, setShortage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [saveProgress, setSaveProgress] = useState("");
  const [readyToSave, setReadyToSave] = useState(null);
  const [savePlatform] = useState(() => {
    if (isIOS()) return "ios";
    const android = /Android/i.test(navigator.userAgent) || navigator.userAgentData?.platform === "Android";
    return android ? "android" : "desktop";
  });
  const mobileSave = savePlatform !== "desktop";
  const [saveAvailable] = useState(() => !mobileSave || canSharePhotos());
  const saveBrowser = savePlatform === "ios" ? "Safari" : "Chrome";
  const saveHint = !mobileSave ? ""
    : !saveAvailable ? `Mở liên kết album trong ${saveBrowser} để lưu vào thư viện ảnh.`
    : savePlatform === "ios" ? "Chọn “Lưu hình ảnh” trong bảng chia sẻ để lưu vào ứng dụng Ảnh."
    : "Chọn ứng dụng Thư viện ảnh trong bảng chia sẻ nếu điện thoại có tùy chọn này.";
  const savingPhotos = useRef(false);
  const [printing, setPrinting] = useState(false);
  const step = saved.step;
  const showReceipt = Boolean(result && step === 3);
  const suggestLimit = suggestionTarget({ total: photos.length, packCapacity: required, packCapacities: packs.map(capacityOf) });
  const { progress: suggestProgress, suggested: suggestedIds } = usePhotoSuggestions(token, photos, {
    limit: suggestLimit,
    paused: !firstPhotosReady || step !== 0 || Boolean(editing || busy || downloadingId),
  });
  const suggested = useMemo(() => new Set(suggestedIds), [suggestedIds]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const mutating = useRef(false);
  const bookingRef = useRef(booking);
  bookingRef.current = booking;

  // Ảnh bị xoá / bộ khung bị gỡ: đưa lựa chọn về trạng thái hợp lệ.
  const idsKey = [...ids].join();
  useEffect(() => setReadyToSave(null), [idsKey, token]);
  useEffect(() => {
    if (saved.packId && catalog.length && !pack) return save({ packId: "", layouts: {}, step: Math.min(saved.step, 1) });
    const stale = Object.values(saved.layouts).some((slots) => slots.some((s) => s.photo && !ids.has(s.photo)));
    if (stale) save((v) => ({
      layouts: Object.fromEntries(Object.entries(v.layouts).map(([id, slots]) =>
        [id, slots.map((s) => (s.photo && !ids.has(s.photo) ? { ...s, photo: null } : s))])),
      step: Math.min(v.step, 2),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ khi ảnh bị xoá / đổi bộ khung / danh mục tải xong; save và các giá trị khác đọc mới nhất
  }, [idsKey, saved.packId, packs.length]);
  useEffect(() => {
    if (saved.step >= 2 && !ready) save({ step: pack ? 1 : 0 });
    if (saved.step === 3 && !filled && ready) save({ step: 2 });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pack suy ra từ ready; save tạo mới mỗi lần vẽ
  }, [saved.step, ready, filled]);

  const frozen = printing || showReceipt;

  // ── Thư viện ──
  function toggleHeart(photo) {
    if (frozen) return;
    save((v) => ({ hearts: v.hearts.includes(photo.id) ? v.hearts.filter((h) => h !== photo.id) : [...v.hearts, photo.id] }));
  }
  function heartMany(list) {
    if (frozen || !list.length) return;
    save((v) => ({ hearts: [...v.hearts, ...list.filter((id) => !v.hearts.includes(id))] }));
    toast.success(`Đã thả tim ${list.length} ảnh đẹp được gợi ý.`);
  }
  async function removePhotos(list) {
    // Ảnh máy chụp chỉ ẩn trên điện thoại này (người đi cùng quét mã vẫn thấy); ảnh tự thêm thì xoá hẳn.
    const shared = list.some((id) => !photoOf(id)?.mine);
    const question = `Xóa ${list.length} ảnh khỏi thư viện của bạn?` +
      (shared ? "\nẢnh chụp ở tiệm chỉ ẩn trên điện thoại này — người đi cùng quét mã vẫn thấy." : "");
    if (mutating.current || frozen || !list.length || !window.confirm(question)) return false;
    mutating.current = true;
    setBusy(true);
    try {
      setBooking(await api(`/albums/${token}/photos`, { method: "DELETE", body: { ids: list } }));
      setEditing(null);
      toast.success(`Đã xóa ${list.length} ảnh.`);
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  async function upload(selected) {
    if (mutating.current || frozen) return;
    const files = selected.filter((f) => ACCEPTED.test(f.type) && f.size <= MAX_UPLOAD_MB * 1024 * 1024);
    if (selected.length > files.length)
      toast.warning(`Bỏ qua ${selected.length - files.length} tệp: chỉ nhận ảnh JPG, PNG, WebP dưới ${MAX_UPLOAD_MB} MB.`);
    if (!files.length) return;
    mutating.current = true;
    setBusy(true);
    setUploadProgress({ done: 0, total: files.length });
    try {
      let confirmed = 0;
      const { done, error: failed } = await uploadPhotos(files, {
        upload: async (file) => {
          const clientKey = crypto.randomUUID();
          const preview = file.type === "image/jpeg" ? await prepareCameraImageAsync(file, false).catch(() => undefined) : undefined;
          // guest: ảnh khách tự thêm chỉ điện thoại này thấy (máy chủ nhận ra máy qua cookie album_device).
          return savePhoto(`/albums/${token}/photos`, file, { name: file.name, clientKey, preview, onlyNewPhoto: true, guest: true });
        },
        onSaved: (response) => {
          const next = mergeUploadedPhotos(bookingRef.current, response);
          bookingRef.current = next;
          setBooking(next);
          setUploadProgress({ done: ++confirmed, total: files.length });
        },
      });
      if (failed) toast.error(done ? `Đã thêm ${done}/${files.length} ảnh. Chưa tải xong: ${failed.message}` : failed.message);
      else toast.success(`Đã thêm ${done} ảnh vào thư viện. Chỉ điện thoại của bạn thấy ảnh này.`);
    } finally {
      mutating.current = false;
      setBusy(false);
      setUploadProgress(null);
    }
  }
  const photoEntry = photo => ({
    url: `${photoUrl(token, photo.id)}?download=1`,
    link: storageLink(photo, "download"),
    name: `anh-${pad(photo.number)}.jpg`,
    type: "image/jpeg",
  });

  async function savePhotos(scope, work) {
    if (savingPhotos.current) return;
    savingPhotos.current = true;
    setDownloadingId(scope);
    try {
      await work();
    } catch (e) {
      if (e.name !== "AbortError") toast.error(`Không lưu được ảnh: ${e.message}`);
    } finally {
      savingPhotos.current = false;
      setDownloadingId(null);
      setSaveProgress("");
    }
  }
  async function prepareShare(scope, entries, total = entries.length, cache = new Map()) {
    const completed = total - entries.length;
    const progress = done => setSaveProgress(`Đang chuẩn bị ${completed + done}/${total} ảnh…`);
    progress(0);
    const prepared = await fetchFiles(entries, cache, progress, { maxBytes: SHARE_BATCH_BYTES });
    // A few requests can finish together after crossing the byte limit. Keep
    // their JPEGs for the next batch and release the shared files from the cache.
    let count = 0, bytes = 0;
    for (const file of prepared) {
      if (count && bytes + file.size > SHARE_BATCH_BYTES) break;
      bytes += file.size;
      count++;
    }
    let files = prepared.slice(0, count);
    while (files.length > 1 && !canSharePhotos(files)) files = files.slice(0, -1);
    if (!canSharePhotos(files)) throw new Error("Điện thoại chưa hỗ trợ lưu các ảnh này từ trình duyệt.");
    for (const entry of entries.slice(0, files.length)) cache.delete(entry.url);
    return { scope, files, total, cache, remaining: entries.slice(files.length) };
  }
  async function downloadFiles(files) {
    const entries = files.map(file => ({ url: URL.createObjectURL(file), name: file.name }));
    try { await downloadEach(entries); }
    finally { setTimeout(() => entries.forEach(entry => URL.revokeObjectURL(entry.url)), 30_000); }
  }
  async function shareBatch(batch, fromPreparation = false) {
    setReadyToSave(batch);
    const { scope, files, remaining, total, cache } = batch;
    // The browser lets a quick fetch use the tap that started it. After a slow fetch,
    // keep the prepared bytes and let the same button open the system sheet.
    if (fromPreparation && navigator.userActivation?.isActive === false) return;
    try { await navigator.share({ files }); }
    catch (e) {
      if (e.name === "AbortError" || (fromPreparation && e.name === "NotAllowedError")) return;
      throw new Error(`Chưa mở được bảng chia sẻ. Hãy thử lại trong ${saveBrowser}.`, { cause: e });
    }
    setReadyToSave(remaining.length ? { scope, files: [], remaining, total, cache } : null);
    if (remaining.length) setReadyToSave(await prepareShare(scope, remaining, total, cache));
  }
  function resumeSave(batch) {
    return savePhotos(batch.scope, async () => {
      if (batch.files.length) await shareBatch(batch);
      else await shareBatch(await prepareShare(batch.scope, batch.remaining, batch.total, batch.cache), true);
    });
  }
  function downloadAll() {
    if (!saveAvailable || !photos.length || photos.some(photo => photo.originalPending)) return;
    if (readyToSave?.scope === "all") return resumeSave(readyToSave);
    return savePhotos("all", async () => {
      const entries = photos.map(photoEntry);
      setReadyToSave(null);
      if (mobileSave) await shareBatch(await prepareShare("all", entries), true);
      else await downloadEach(entries);
    });
  }
  function downloadOne(photo, { inEditor = false } = {}) {
    if (!saveAvailable || photo.originalPending) return;
    const adjust = adjustOf(photo.id);
    const scope = inEditor ? `edit:${photo.id}:${JSON.stringify(adjust)}` : photo.id;
    if (readyToSave?.scope === scope) return resumeSave(readyToSave);
    return savePhotos(scope, async () => {
      setReadyToSave(null);
      const entry = photoEntry(photo);
      if (isNeutral(adjust)) {
        if (mobileSave) await shareBatch(await prepareShare(scope, [entry]), true);
        else await downloadEach([entry]);
      } else {
        // Render the guest JPEG from camera pixels, at up to 20MP, independently
        // of both the interactive preview and the 3000px print source.
        const canvas = await media.edited(photo, adjust, "download");
        let blob;
        try { blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("máy không đủ bộ nhớ"))), "image/jpeg", 0.95)); }
        finally { canvas.width = canvas.height = 0; }
        const file = new File([blob], entry.name, { type: entry.type });
        if (mobileSave) await shareBatch({ scope, files: [file], remaining: [], total: 1 }, true);
        else await downloadFiles([file]);
      }
    });
  }

  // ── Chủ đề & ghép ảnh ──
  const stepNav = useRef(null);
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    window.scrollTo({ top: 0 });
    stepNav.current?.querySelector('[aria-current="step"]')?.focus({ preventScroll: true });
  }, [step]);
  const go = (step) => {
    setError("");
    save(step === 1 && !pack && packs.length === 1 ? { step, packId: packs[0].id } : { step });
  };
  async function refreshAlbum() {
    if (refreshing) return;
    setRefreshing(true);
    try { await reload?.(); }
    finally { setRefreshing(false); }
  }
  function choosePack(id) {
    if (frozen) return;
    for (const frame of packs.find((p) => p.id === id)?.frames || []) loadFrameImage(frame.image).catch(() => {});
    if (id !== saved.packId) save({ packId: id, layouts: {}, frameIndex: 0, autoFill: false });
  }
  // Ghép tự động: ảnh yêu thích trước, rồi ảnh gợi ý, rồi các ảnh còn lại.
  const pool = (autoFill) => autoFill
    ? [...favorites, ...photos.filter((p) => !p.favorite && suggested.has(p.id)), ...photos.filter((p) => !p.favorite && !suggested.has(p.id))].map((p) => p.id)
    : favorites.map((p) => p.id);
  function toCompose() {
    if (!pack || !required || !photos.length) return;
    if (favorites.length < required && !ready) {
      if (saved.step !== 1) go(1);
      return setShortage(true);
    }
    beginCompose(saved.autoFill);
  }
  function beginCompose(autoFill) {
    if (!pack || !photos.length) return;
    setShortage(false);
    save({ step: 2, autoFill, ...(!ready || (autoFill && !saved.autoFill) ? { layouts: autoLayouts(pack.frames, pool(autoFill), { repeat: autoFill }), frameIndex: 0 } : {}) });
  }
  function reshuffle() {
    save({ layouts: autoLayouts(pack.frames, pool(saved.autoFill), { repeat: saved.autoFill }) });
    toast.success("Đã xếp lại ảnh trong bộ khung.");
  }
  const carousel = useMemo(() => {
    const usedIds = new Set(Object.values(saved.layouts).flat().map((s) => s.photo));
    return saved.autoFill ? [...favorites, ...photos.filter((p) => !p.favorite)] : photos.filter((p) => p.favorite || usedIds.has(p.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- theo mã ảnh và ảnh đã thả tim, không theo mảng photos mới mỗi lần hỏi lại
  }, [idsKey, heartsKey, saved.layouts, saved.autoFill]);

  // ── Kết quả: dựng tờ in 20 × 30 cho từng khung của bộ ──
  const [sheets, setSheets] = useState([]);
  const [sheetError, setSheetError] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [renderTurn, setRenderTurn] = useState(0);
  const sheetKey = JSON.stringify([saved.packId, saved.layouts, saved.adjusts]);
  const pendingPhotoIds = new Set(photos.filter((photo) => photo.originalPending).map((photo) => photo.id));
  const waitingForOriginals = filled && pack.frames.some((frame) =>
    saved.layouts[frame._id].some(({ photo }) => pendingPhotoIds.has(photo)));
  async function renderSheets(p, layouts, isLive = () => true) {
    const out = [];
    for (const frame of p.frames) {
      const slots = layouts[frame._id] || [];
      // Cùng ảnh ở các ô liền nhau: giải mã ảnh gốc một lần.
      const shots = slots.map((s) => ({ key: s.photo, photo: photoOf(s.photo) }));
      if (shots.some((s) => !s.photo)) throw new Error(`Khung “${frame.name}” còn ô chưa có ảnh.`);
      if (shots.some((s) => s.photo.originalPending)) throw new Error("Ảnh gốc đang tải lên. Khi ảnh sẵn sàng, bạn gửi in được với đầy đủ chất lượng.");
      const canvas = await renderPrintFrame(frame, shots, token, `${location.origin}/album/${token}`, {
        scale: 1, sharp: true, overlay: true, transforms: slots,
        sourceFor: (shot) => media.edited(shot.photo, adjustOf(shot.photo.id), "print"),
      });
      try {
        if (!isLive()) return null;
        // Tờ 20 × 30: đúng 2400 × 3600 (hoặc ngang) như máy chủ đòi; JPEG 0,95 giữ chi tiết mà vẫn gửi nhanh qua 4G.
        const sheet = largePrint(canvas);
        const data = await new Promise((resolve) => resolve(sheet.toDataURL("image/jpeg", 0.95)));
        const preview = canvas.toDataURL("image/jpeg", 0.85);
        if (sheet !== canvas) sheet.width = sheet.height = 0;
        out.push({ frameId: frame._id, name: frame.name, data, preview });
      } finally { canvas.width = canvas.height = 0; }
    }
    return out;
  }
  useEffect(() => {
    if (saved.step !== 3 || !filled || result) return;
    let live = true;
    setSheets([]);
    setSheetError("");
    if (waitingForOriginals) {
      setPicked(new Set());
      return;
    }
    renderSheets(pack, saved.layouts, () => live).then((list) => {
      if (!live || !list) return;
      setSheets(list);
      setPicked(new Set(list.slice(0, remaining).map((_, i) => i)));
    }, (e) => live && setSheetError(e.message));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sheetKey = bộ khung + bố cục + công thức làm đẹp; chỉ vẽ lại tờ in khi những thứ đó đổi
  }, [saved.step, sheetKey, filled, renderTurn, result, waitingForOriginals]);
  function togglePick(i) {
    if (printing) return;
    if (picked.has(i)) {
      setError("");
      return setPicked((old) => new Set([...old].filter((k) => k !== i)));
    }
    if (picked.size >= remaining)
      return toast.warning(remaining ? `Vé của bạn còn ${remaining} ${word} in — bỏ chọn một ${word} khác trước.` : `Vé đã dùng hết ${word} in.`);
    setPicked((old) => new Set(old).add(i));
  }

  // ── Gửi in (chỉ khi khách bấm) ──
  // Lệnh in đã chuẩn bị được giữ tới khi máy chủ nhận: thử lại gửi đúng các tấm đó (cùng mã lệnh in), máy chủ
  // nhận ra lần gửi trước nếu nó đã tới.
  const printLock = useRef(false);
  const prepared = useRef(null);
  const [failed, setFailed] = useState(false);
  function applyPrintQuota({ prints, printSheets }) {
    if (!Number.isFinite(prints) || !Number.isFinite(printSheets)) return;
    setBooking((current) => ({ ...current, prints, printSheets }));
  }
  function confirmPrint(job) {
    const done = prepared.current?.done;
    setResult({ previews: done?.previews, printSheets: job.printSheets ?? (used + (done?.count || 0)) });
    applyPrintQuota(job);
    save({ step: 3 });
    prepared.current = null;
    reload?.();
  }
  async function print() {
    if (printLock.current || result || (!remaining && !prepared.current)) return;
    printLock.current = true;
    setPrinting(true);
    setError("");
    setFailed(false);
    try {
      const lookup = () => api(`/albums/${token}/print?requestKey=${saved.requestKey}`, { allowNull: true });
      const existing = await lookup();
      if (existing) { confirmPrint(existing); return; }
      if (!prepared.current) {
        if (picked.size > remaining) throw new Error(`Vé chỉ còn ${remaining} ${word}. Hãy bỏ chọn bớt trước khi gửi in.`);
        const chosen = [...picked].sort((a, b) => a - b).filter((i) => sheets[i]);
        if (!chosen.length) throw new Error(`Chọn ít nhất 1 ${word} để in.`);
        prepared.current = {
          options: printPackUpload({
            images: chosen.map((i) => sheets[i].data), frameName: pack?.name || "Khung ảnh", requestKey: saved.requestKey,
          }),
          done: { count: chosen.length, previews: chosen.map((i) => sheets[i].preview) },
        };
      }
      confirmPrint(await api(`/albums/${token}/print-pack`, prepared.current.options));
    } catch (e) {
      // Mã 409 có thể là lệnh in trước đã tới (mất phản hồi): chỉ lệnh in đã lưu mới chứng minh điều đó.
      const previous = e.status === 409 && await api(`/albums/${token}/print?requestKey=${saved.requestKey}`, { allowNull: true }).catch(() => null);
      if (previous) confirmPrint(previous);
      else {
        if (e.status === 409 && e.data?.code === "PRINT_QUOTA") {
          prepared.current = null;
          applyPrintQuota(e.data);
          reload?.();
        } else if (e.status === 400) prepared.current = null;
        setError(e.message || "Chưa gửi in được — thử lại nhé.");
        setFailed(Boolean(prepared.current));
      }
    } finally {
      printLock.current = false;
      setPrinting(false);
    }
  }
  const pendingOriginals = pendingPhotoIds.size;

  const canOpen = (i) => i === 0 || (i === 1 && photos.length > 0) || (i === 2 && ready) || (i === 3 && filled);
  const expires = formatDateTime(booking.mediaExpiresAt);
  const editPhoto = editing && photoOf(editing);
  return (
    <section className="sb-album">
      <div className="studio-meta">
        <div className="studio-meta-heading">
          <h1 className="studio-album-title">Ảnh <em>của bạn</em></h1>
          <Button className="outline small studio-album-refresh" disabled={busy || refreshing} aria-busy={refreshing} onClick={refreshAlbum}>
            <RefreshCw aria-hidden="true" /> {refreshing ? "Đang làm mới…" : "Làm mới"}
          </Button>
        </div>
        <p className="studio-album-facts">
          <span><PiTicketBold aria-hidden="true" /> Vé <strong>#{booking.code}</strong></span>
          <span>{expires ? <>Ảnh đầu tiên hết hạn lúc <strong>{expires}</strong></> : "Ảnh được lưu 3 ngày"}</span>
        </p>
        {pendingOriginals > 0 && (step === 1 || step === 2) && (
          <p className="studio-originals-note" role="status">
            Đang nhận {pendingOriginals} ảnh gốc để in.
          </p>
        )}
      </div>
      <nav className="studio-steps" ref={stepNav} aria-label="Các bước làm ảnh">
        {STEPS.map(([label, Icon], i) => (
          <button key={label} type="button" className={i === step ? "active" : i < step ? "done" : ""}
            aria-current={i === step ? "step" : undefined} disabled={(frozen || !canOpen(i)) && i !== step}
            onClick={() => { if (i !== step) go(i); }}>
            <span aria-hidden="true">{i < step ? <PiCheckBold /> : <Icon />}</span>
            {label}
          </button>
        ))}
      </nav>
      <ErrorBox error={error} />
      {failed && step === 3 && !printing && !result && (
        <div className="print-retry" role="alert">
          <p>Chưa có xác nhận từ quầy. Bấm để kiểm tra yêu cầu vừa gửi.</p>
          <Button className="outline" onClick={() => print()}>Kiểm tra và thử lại</Button>
        </div>
      )}
      {showReceipt ? (
        <div className="print-confirmation">
          <span className="print-confirmation-check" aria-hidden="true"><PiCheckBold /></span>
          <h2>Đã gửi in!</h2>
          <p>Đọc mã <strong>#{booking.code}</strong> tại quầy để nhận ảnh.</p>
          <div className="print-confirmation-actions">
            <Button onClick={() => { setSheets([]); setPicked(new Set()); go(0); }}>
              <PiImagesDuotone aria-hidden="true" /> Về thư viện ảnh
            </Button>
            {remaining > 0 && (
              <Button className="outline" onClick={() => {
                setSheets([]);
                setPicked(new Set());
                setResult(null);
                save({ requestKey: crypto.randomUUID() });
              }}>In thêm ({remaining} {word} còn lại)</Button>
            )}
          </div>
          {result.previews?.length > 0 && (
            <div className="sheet-strip is-done">
              {result.previews.map((src, i) => <img key={i} src={src} alt={`Tấm đã gửi in ${i + 1}`} />)}
            </div>
          )}
          <p className="print-confirmation-ticket">Đã gửi {Math.min(quota, submitted)}/{quota} {word}</p>
        </div>
      ) : step === 0 ? (
        <Gallery token={token} photos={newestFirst} favorites={favorites.length} adjustOf={adjustOf} small={small} suspended={Boolean(editing)} busy={busy} frozen={frozen}
          uploadProgress={uploadProgress} selectedPack={pack} downloadingId={downloadingId} onFavorite={toggleHeart}
          saveProgress={downloadingId === "all" ? (saveProgress || "Đang tải ảnh…") : ""}
          readyToSave={readyToSave} mobileSave={mobileSave} saveAvailable={saveAvailable} saveHint={saveHint} onSaveAll={downloadAll}
          onFirstPhotosReady={() => setFirstPhotosReady(true)}
          suggestions={suggestedIds} capacity={pack ? required : 0} suggestProgress={suggestProgress} onHeartMany={heartMany}
          onDelete={removePhotos} onDownload={downloadOne} onEdit={(p) => setEditing(p.id)} onUpload={upload}
          onNext={() => go(1)} />
      ) : step === 1 ? (
        <ThemePicker packs={packs} selected={saved.packId} favorites={favorites.length} frozen={frozen} unit={unit}
          onSelect={choosePack} onBack={() => go(0)} onNext={toCompose} />
      ) : step === 2 && ready ? (
        <PackEditor token={token} pack={pack} layouts={saved.layouts} index={saved.frameIndex} photos={carousel}
          small={small} photoOf={photoOf} adjustOf={adjustOf} frozen={frozen}
          onIndex={(frameIndex) => save({ frameIndex })}
          onSlots={(frameId, slots) => save((v) => ({ layouts: { ...v.layouts, [frameId]: slots } }))}
          onReshuffle={reshuffle} onBack={() => go(1)} onNext={() => go(3)} />
      ) : step === 3 && filled ? (
        <Result sheets={sheets} error={sheetError} waiting={waitingForOriginals} picked={picked} remaining={remaining} quota={quota}
          printing={printing} failed={failed} unit={unit} word={word} onToggle={togglePick} onPrint={() => print()} onBack={() => go(2)}
          onRetry={() => setRenderTurn((n) => n + 1)} />
      ) : null}
      {shortage && pack && (
        <ShortageDialog pack={pack} required={required} favorites={favorites.length} totalPhotos={photos.length}
          onMore={() => { setShortage(false); go(0); }} onAutomatic={() => beginCompose(true)} onClose={() => setShortage(false)} />
      )}
      {editPhoto && (
        <BeautyEditor token={token} media={media} photo={editPhoto} photos={newestFirst} adjust={saved.adjusts[editPhoto.id]} disabled={frozen}
          onChange={(adjust) => save((v) => ({ adjusts: { ...v.adjusts, [editPhoto.id]: adjust } }))}
          onNavigate={setEditing} onDownload={saveAvailable ? photo => downloadOne(photo, { inEditor: true }) : undefined}
          downloading={Boolean(downloadingId)} downloadLabel={mobileSave ? "Lưu vào thư viện" : undefined}
          onApplyAll={(adjust) => {
            if (frozen) return;
            save((v) => ({ adjusts: { ...v.adjusts, ...Object.fromEntries(photos.map(p => [p.id, { ...adjust }])) } }));
            toast.success(`Đã áp dụng chỉnh sửa cho ${photos.length} ảnh.`);
          }}
          onFavorite={toggleHeart} onDelete={removePhotos} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
