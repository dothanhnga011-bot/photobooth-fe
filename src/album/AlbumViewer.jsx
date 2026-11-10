import { useEffect, useRef, useState } from "react";
import { PiArrowLeftBold, PiArrowRightBold, PiDownloadSimpleBold, PiImagesBold, PiPlayFill } from "react-icons/pi";
import { useToast } from "../studio";
import { api, getApiUrl } from "../api";
import { albumMediaSources, storageLink } from "../media-delivery.js";
import { PhotoThumb, photoUrl, thumbSources } from "./photo-thumb.jsx";
import { AlbumMedia } from "./album-media.jsx";
import { downloadEach, fetchFiles, savableOnIOS, usesShareSheet } from "./save-to-phone.js";

// Ảnh lớn: ảnh nhỏ của dải bên dưới (đã tải sẵn) hiện ngay, phóng vừa khung; ảnh nét (1600 px / ảnh
// ghép) đè lên khi tải xong. Mạng điện thoại chậm thì khách vẫn thấy ảnh ngay, không phải khung trống.
function StageImage({ sources, placeholder, alt }) {
  const [loaded, setLoaded] = useState(false);
  const [placeholderFailed, setPlaceholderFailed] = useState(false);
  return (
    <div className="album-viewer-photo">
      {placeholder && !loaded && !placeholderFailed && (
        <img
          className="album-viewer-placeholder"
          src={placeholder.src}
          crossOrigin={placeholder.cors ? "anonymous" : undefined}
          alt=""
          aria-hidden="true"
          onError={() => setPlaceholderFailed(true)}
        />
      )}
      <AlbumMedia
        className="album-viewer-main"
        sources={sources}
        alt={alt}
        fetchPriority="high"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

// Trang link ảnh (khách quét QR ở máy chụp / nhân viên bấm "Link ảnh"), như Snapbox: ảnh lớn ở giữa,
// dải ảnh nhỏ bên dưới — ảnh đã ghép khung, video tua nhanh rồi tới mọi ảnh gốc. "Lưu" đưa ảnh / video
// đang xem vào thư viện ảnh của điện thoại, "Lưu tất cả" đưa cả album (xem save-to-phone.js).
export function AlbumViewer({ token, booking }) {
  const toast = useToast();
  const [job, setJob] = useState(null);
  const composite = booking.composite ? getApiUrl(`/api/albums/${token}/composite`) : "";
  // Album cũ (trước khi máy chụp lưu ảnh ghép): ảnh ghép lấy từ lệnh in.
  useEffect(() => {
    if (composite) return;
    api(`/albums/${token}/print`, { allowNull: true }).then(setJob, () => {});
  }, [token, booking.printSheets, composite]);
  const sheet = !composite && job?._id ? getApiUrl(`/api/albums/${token}/prints/${job._id}`) : "";
  const video = booking.video ? getApiUrl(`/api/albums/${token}/video`) : "";
  const originals = booking.photos.filter((p) => p.kind === "original");
  // Máy chụp gửi ảnh xem trước trước (khách thấy ảnh ngay), ảnh gốc độ nét cao tới sau ít phút.
  const pendingOriginals = originals.filter((p) => p.originalPending).length;
  const delayedOriginals = Date.now() - new Date(booking.captureEndsAt).getTime() > 5 * 60 * 1000;
  const compositeThumbs = composite || sheet
    ? albumMediaSources(booking.composite, `${composite || sheet}?size=thumbnail`, "thumbnail")
    : [];
  const items = [
    ...(composite || sheet
      ? [{
          key: "composite",
          kind: "image",
          // Display a 1600 px derivative; Save still requests the untouched 20 MP composite.
          sources: albumMediaSources(booking.composite, composite ? `${composite}?size=preview` : sheet, composite ? "preview" : "original"),
          thumbs: compositeThumbs,
          placeholder: { src: compositeThumbs[0], cors: false },
          save: {
            url: composite ? `${composite}?download=1` : `${sheet}?download=1`,
            link: storageLink(booking.composite, "original"),
            name: `NXC-${booking.code}-anh-ghep.jpg`,
            type: "image/jpeg",
          },
          label: "Ảnh ghép khung",
        }]
      : []),
    ...(video
      ? [{
          key: "video",
          kind: "video",
          sources: albumMediaSources(booking.video, video),
          save: {
            url: `${video}?download=1`,
            link: storageLink(booking.video, "original"),
            name: `NXC-${booking.code}-video.${booking.video.mimeType === "video/webm" ? "webm" : "mp4"}`,
            type: booking.video.mimeType || "video/mp4",
          },
          label: "Video tua nhanh",
        }]
      : []),
    ...originals.map((photo, i) => ({
      key: photo.id,
      kind: "image",
      photo,
      sources: albumMediaSources(photo, photoUrl(token, photo.id, "preview"), "preview"),
      placeholder: thumbSources(photo, token)[0],
      save: {
        url: `${photoUrl(token, photo.id)}?download=1`,
        link: storageLink(photo, "download"),
        name: `NXC-${booking.code}-${String(i + 1).padStart(2, "0")}.jpg`,
        type: "image/jpeg",
      },
      label: `Ảnh ${i + 1}`,
    })),
  ];
  const [current, setCurrent] = useState(null);
  const index = Math.max(0, items.findIndex((item) => item.key === current));
  const item = items[index];
  const go = (by) => items.length && setCurrent(items[(index + by + items.length) % items.length].key);
  const rail = useRef(null);
  // Tải sẵn ảnh lớn liền trước / liền sau: vuốt sang là hiện ngay.
  const preloaded = useRef(new Set());
  useEffect(() => {
    if (items.length < 2) return;
    for (const by of [1, -1]) {
      const near = items[(index + by + items.length) % items.length];
      const src = near?.kind === "image" ? near.sources[0] : null;
      if (!src || preloaded.current.has(src)) continue;
      preloaded.current.add(src);
      const image = new Image();
      image.decoding = "async";
      image.src = src;
    }
  }, [index, items.length]);
  useEffect(() => {
    rail.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);
  useEffect(() => {
    const onKey = (event) => {
      if (/input|textarea|select/i.test(event.target.tagName)) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length]);
  // Vuốt ngang trên ảnh lớn để chuyển ảnh.
  const swipe = useRef(null);
  // Lưu vào thư viện ảnh. iPhone: tải tệp về trang rồi mở bảng chia sẻ ("Lưu N mục"). Tải lâu thì
  // Safari không cho mở bảng chia sẻ nữa: nút đổi thành "Bấm để lưu", bấm lần nữa là mở ngay.
  const [shareSheet] = useState(usesShareSheet);
  const fileCache = useRef(new Map());
  const [saving, setSaving] = useState(null); // { scope, done, total }
  const [ready, setReady] = useState(null); // { scope, files }
  const entriesOf = (list) =>
    list.map((entry) => entry.save).filter((entry) => !shareSheet || savableOnIOS(entry));
  async function share(scope, files) {
    try {
      await navigator.share({ files });
    } catch (e) {
      if (e?.name === "NotAllowedError") return setReady({ scope, files });
      if (e?.name !== "AbortError") toast.error("Không mở được bảng lưu ảnh. Vui lòng thử lại.");
    }
  }
  async function save(scope, list) {
    if (saving) return;
    if (list.some((entry) => entry.photo?.originalPending))
      return toast.info("Ảnh gốc đang tải lên. Vui lòng chờ rồi lưu ảnh lại.");
    const entries = entriesOf(list);
    if (!entries.length) {
      // Trường hợp video không đưa được vào app Ảnh của iOS (như WebM), tải về mục Tệp (Files)
      const directEntries = list.map((entry) => entry.save);
      if (directEntries.length) {
        toast.info("Đang tải video về mục Tệp (Files). (Định dạng WebM sẽ lưu vào Tệp thay vì app Ảnh).");
        return downloadEach(directEntries);
      }
      return;
    }
    if (!shareSheet) return downloadEach(entries);
    const unsavableVideo = shareSheet && list.find((entry) => entry.kind === "video" && !savableOnIOS(entry.save));
    if (ready?.scope === scope) {
      setReady(null);
      await share(scope, ready.files);
      if (unsavableVideo) {
        downloadEach([unsavableVideo.save]);
        toast.info("Ảnh đã lưu vào app Ảnh. Video đang được tải về mục Tệp (Files).");
      }
      return;
    }
    setReady(null);
    setSaving({ scope, done: 0, total: entries.length });
    let files;
    try {
      files = await fetchFiles(entries, fileCache.current, (done) =>
        setSaving((current) => current && { ...current, done }));
    } catch (e) {
      toast.error(e.message);
      return;
    } finally {
      setSaving(null);
    }
    await share(scope, files);
    if (unsavableVideo) {
      downloadEach([unsavableVideo.save]);
      toast.info("Ảnh đã lưu vào app Ảnh. Video đang được tải về mục Tệp (Files).");
    }
  }
  const buttonText = (scope, idle) =>
    saving?.scope === scope
      ? `Đang tải ${saving.done}/${saving.total}…`
      : ready?.scope === scope
        ? ready.files.length > 1 ? `Bấm để lưu ${ready.files.length} mục` : "Bấm để lưu vào Ảnh"
        : idle;
  if (!item) return null;
  const allCount = items.length;
  return (
    <section className="album-viewer" aria-label="Ảnh và video của bạn">
      <div
        className="album-viewer-stage"
        onPointerDown={(event) => { swipe.current = event.clientX; }}
        onPointerUp={(event) => {
          const dx = event.clientX - (swipe.current ?? event.clientX);
          swipe.current = null;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        }}
      >
        {items.length > 1 && (
          <button type="button" className="album-viewer-arrow is-prev" aria-label="Ảnh trước" onClick={() => go(-1)}>
            <PiArrowLeftBold />
          </button>
        )}
        {item.kind === "video" ? (
          <AlbumMedia key={item.save.url} as="video" sources={item.sources} controls autoPlay muted loop playsInline preload="metadata" />
        ) : (
          <StageImage
            key={item.save.url}
            sources={item.sources}
            placeholder={item.placeholder}
            alt={item.label}
          />
        )}
        {items.length > 1 && (
          <button type="button" className="album-viewer-arrow is-next" aria-label="Ảnh sau" onClick={() => go(1)}>
            <PiArrowRightBold />
          </button>
        )}
      </div>
      {pendingOriginals > 0 && (
        <p className="album-viewer-note" role="status">
          {delayedOriginals
            ? `Máy chụp chưa gửi đủ ảnh gốc (${pendingOriginals} ảnh). Bạn có thể quay lại link này sau hoặc nhờ nhân viên kiểm tra máy chụp.`
            : `Đang nhận ảnh gốc độ nét cao (${pendingOriginals} ảnh). Nút Lưu sẽ bật khi file gốc sẵn sàng.`}
        </p>
      )}
      <div className="album-viewer-actions">
        <button type="button" className="button small" disabled={Boolean(saving) || Boolean(item.photo?.originalPending)} onClick={() => save(item.key, [item])}>
          <PiDownloadSimpleBold aria-hidden="true" />
          {buttonText(item.key, item.kind === "video" ? "Lưu video" : item.key === "composite" ? "Lưu ảnh ghép" : "Lưu ảnh")}
        </button>
        {allCount > 1 && (
          <button type="button" className="button outline small" disabled={Boolean(saving) || pendingOriginals > 0} onClick={() => save("all", items)}>
            <PiImagesBold aria-hidden="true" /> {buttonText("all", `Lưu tất cả (${allCount})`)}
          </button>
        )}
      </div>
      <div className="album-viewer-rail" ref={rail} role="tablist" aria-label="Chọn ảnh">
        {items.map((entry, i) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={entry.label}
            className={i === index ? "is-active" : ""}
            onClick={() => setCurrent(entry.key)}
          >
            {entry.kind === "video" ? (
              <span className="album-viewer-play"><PiPlayFill aria-hidden="true" /></span>
            ) : entry.photo ? (
              <PhotoThumb photo={entry.photo} token={token} alt="" loading="lazy" decoding="async" />
            ) : (
              <AlbumMedia key={entry.save.url} sources={entry.thumbs} alt="" loading="lazy" decoding="async" />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
