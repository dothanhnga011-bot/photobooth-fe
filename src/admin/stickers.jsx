import { useEffect, useState } from "react";
import { ImagePlus, Sticker, Trash2 } from "lucide-react";
import { api, assetUrl } from "../api";
import { ErrorBox, useStudio, useToast } from "../studio";
import { imageData } from "./image-data";

// PNG nhiều chi tiết có thể vượt giới hạn máy chủ: thu nhỏ dần tới khi vừa.
async function stickerImage(file) {
  for (const edge of [512, 384, 256, 192]) {
    const image = await imageData(file, edge, "image/png");
    if (image.length <= 690_000) return image;
  }
  throw new Error(`Ảnh “${file.name}” quá nhiều chi tiết. Vui lòng chọn ảnh đơn giản hơn.`);
}
const nameOf = (file) =>
  file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 100) || "Nhãn dán";

// Thiết lập → Nhãn dán (như Snapbox /setting/sticker): tải lên nhiều ảnh PNG nền trong suốt.
export function StickersManager({ notify }) {
  const toast = useToast();
  const { reload } = useStudio();
  const [stickers, setStickers] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = () => api("/admin/stickers").then(setStickers);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function upload(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length || busy) return;
    let added = 0;
    try {
      for (const [index, file] of files.entries()) {
        setBusy(`Đang tải lên ${index + 1}/${files.length}…`);
        if (!/^image\/(png|webp|jpeg)$/.test(file.type)) {
          toast.error(`“${file.name}”: chỉ được phép đăng ảnh PNG/WebP/JPG.`);
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`“${file.name}”: dung lượng ảnh không được quá 10 MB.`);
          continue;
        }
        try {
          await api("/admin/stickers", {
            method: "POST",
            body: { name: nameOf(file), image: await stickerImage(file), order: (stickers?.length || 0) + index, active: true },
          });
          added++;
        } catch (e) {
          toast.error(e.message);
        }
      }
      await load();
      reload?.();
      if (added) notify(`Thêm mới ${added} nhãn dán thành công.`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy("");
    }
  }
  async function remove(sticker) {
    if (!window.confirm(`Xóa nhãn dán “${sticker.name}”? Ảnh khách đã in không bị ảnh hưởng.`)) return;
    try {
      await api(`/admin/stickers/${sticker._id}`, { method: "DELETE" });
      await load();
      reload?.();
      notify("Xóa nhãn dán thành công.");
    } catch (e) {
      toast.error(e.message);
    }
  }
  return (
    <div className="kiosk-content">
      <ErrorBox error={error} />
      <section className="panel kiosk-content-section">
        <div className="section-title-row">
          <div>
            <h3>Quản lý nhãn dán</h3>
            <p className="muted">
              Máy chụp chỉ dùng các nhãn dán ở đây (mục “Nhãn dán” trên màn chọn ảnh). Nên dùng ảnh PNG nền trong suốt;
              chọn được nhiều ảnh một lần.
            </p>
          </div>
        </div>
        {!stickers ? (
          <p className="muted">Đang tải…</p>
        ) : (
          <>
            <ul className="sticker-library">
              <li className="sticker-library-add">
                <label className={busy ? "is-busy" : ""} aria-disabled={Boolean(busy)}>
                  <ImagePlus size={24} />
                  <span>{busy || "Thêm mới"}</span>
                  <input type="file" accept="image/png,image/webp,image/jpeg" multiple hidden disabled={Boolean(busy)} onChange={upload} />
                </label>
              </li>
              {stickers.map((s) => (
                <li key={s._id} title={s.name}>
                  <img src={assetUrl(s.thumb || s.image)} alt={s.name} loading="lazy" decoding="async" />
                  <button className="icon-button" aria-label={`Xóa nhãn dán ${s.name}`} disabled={Boolean(busy)} onClick={() => remove(s)}>
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
            {!stickers.length && (
              <div className="empty-state">
                <Sticker />
                <h3>Chưa có nhãn dán riêng</h3>
                <p>Máy chụp đang ẩn mục “Nhãn dán”. Bấm “Thêm mới” để tải nhãn dán của tiệm lên.</p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
