// Thêm / sửa khung phòng Selfbooth (tờ 20 × 30 máy DS820) — hộp "Chỉnh sửa khung ảnh" giống trang quản trị của web
// Selfbooth (19/11 chủ tiệm: "admin ghép khung như Selfbooth"): tên khung, tên bộ chủ đề, thứ tự trong bộ, khổ khung;
// bên phải là ảnh khung với Tự nhận diện / Thay ảnh / xoay 90° / Hoàn tác, Chọn – chỉnh ô / Vẽ vùng ảnh, kéo – đổi cỡ –
// xoay từng ô ngay trên ảnh, ô số (px), góc xoay, căn giữa, Trước / Sau / Nhân đôi / Xoá ô
// (frame-image-field.jsx, frame-region-editor.jsx chép từ Selfbooth). Khung PTB (QR, ngày in) vẫn dùng trình cũ.
import { useState } from "react";
import { Image as ImageIcon, X } from "lucide-react";
import { api } from "../api";
import { Button, ErrorBox, useToast } from "../studio";
import { isPhotoRegion } from "../frame-utils.js";
import { FrameImageField } from "./frame-image-field.jsx";

// Ô của khung đã lưu → ô của trình ghép (chỉ vùng ảnh, theo số ảnh).
const editorSlots = (slots = []) => slots.filter(isPhotoRegion)
  .map((s, i) => ({ s, n: s.photo || i + 1 }))
  .sort((a, b) => a.n - b.n)
  .map(({ s }) => ({ x: s.x, y: s.y, w: s.w, h: s.h, ...(s.angle ? { angle: s.angle } : {}) }));
// Ô của trình ghép → ô lưu trên máy chủ: ô thứ n là ảnh số n.
const savedSlots = (slots) => slots.map((s, i) => ({
  x: s.x, y: s.y, w: s.w, h: s.h, ...(s.angle ? { angle: s.angle } : {}), kind: "photo", photo: i + 1,
}));

export function SelfboothFrameEditor({ frame: initial, themes = [], themeKinds = {}, onClose, onSaved }) {
  const toast = useToast();
  const [frame, setFrame] = useState(() => ({
    ...initial,
    printSize: "large",
    themeName: initial.themeName === "__new" ? "" : initial.themeName || "",
    slots: editorSlots(initial.slots),
  }));
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setFrame((f) => ({ ...f, ...patch }));
  // Gợi ý tên bộ: chủ đề của phòng Selfbooth.
  const selfboothThemes = themes.filter((name) => themeKinds[name] === "polaroid");

  async function save(event) {
    event.preventDefault();
    if (busy || imageBusy) return;
    if (!frame.image) return toast.error("Vui lòng chọn ảnh khung.");
    if (!frame.slots.length) return toast.error("Khung cần ít nhất 1 ô ảnh — bấm Tự nhận diện hoặc Vẽ vùng ảnh.");
    const themeName = frame.themeName.trim();
    const name = frame.name.trim() || themeName || "Khung Selfbooth";
    setBusy(true);
    setError("");
    try {
      await api(`/admin/frames${frame._id ? `/${frame._id}` : ""}`, {
        method: frame._id ? "PUT" : "POST",
        timeout: 120000,
        body: {
          name, themeName, order: Math.max(0, Math.min(999, Math.round(Number(frame.order) || 0))),
          printSize: "large", image: frame.image, slots: savedSlots(frame.slots), sheet: false,
          dateColor: frame.dateColor || "#2f1a12", shots: 0, active: frame.active !== false,
        },
      });
      onSaved(frame._id ? `Đã cập nhật khung “${name}”.` : `Đã thêm khung “${name}”.`);
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal catalog-editor catalog-editor-frames selfbooth-frame-editor" role="dialog" aria-modal="true"
        aria-label={frame._id ? "Chỉnh sửa khung ảnh" : "Thêm khung ảnh"}>
        <div className="modal-header">
          <div className="resource-editor-title">
            <span className="resource-editor-icon"><ImageIcon size={23} aria-hidden="true" /></span>
            <div>
              <h2>{frame._id ? "Chỉnh sửa khung ảnh" : "Thêm khung ảnh"}</h2>
              <p>Đặt tên, gom chủ đề và kiểm tra các ô đặt ảnh.</p>
            </div>
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose} className="icon-button" disabled={busy}><X /></button>
        </div>
        <ErrorBox error={error} />
        <form onSubmit={save} noValidate>
          <div className="resource-editor-content">
            <div className="resource-editor-fields">
              <label className="form-field resource-field">
                <span>Tên khung</span>
                <input name="name" maxLength={200} value={frame.name || ""} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label className="form-field resource-field">
                <span>Tên bộ chủ đề (cùng tên để gom chung)</span>
                <input name="themeName" maxLength={100} list="selfbooth-frame-themes" value={frame.themeName}
                  onChange={(e) => set({ themeName: e.target.value })} />
                <datalist id="selfbooth-frame-themes">
                  {selfboothThemes.map((name) => <option key={name} value={name} />)}
                </datalist>
              </label>
              <div className="selfbooth-frame-row">
                <label className="form-field resource-field">
                  <span>Thứ tự trong bộ</span>
                  <input name="order" type="number" inputMode="numeric" min={0} max={999} value={frame.order ?? 1}
                    onChange={(e) => set({ order: e.target.value })} />
                </label>
                <label className="form-field resource-field resource-field-printSize">
                  <span>Kích thước khung</span>
                  <select name="printSize" value="large" disabled>
                    <option value="large">20×30 cm · Cả tờ</option>
                  </select>
                </label>
              </div>
              <p className="soft-note">Phòng Selfbooth in tờ 20 × 30 cm ở máy DNP DS820. Khung cùng tên bộ được ghép cùng nhau trên điện thoại của khách.</p>
            </div>
            <div className="form-field resource-field selfbooth-frame-image">
              <span>Ảnh khung</span>
              <FrameImageField value={{ image: frame.image || "", slots: frame.slots }} onBusyChange={setImageBusy}
                onChange={(next) => set({ image: next.image, slots: next.slots })} />
            </div>
          </div>
          <div className="resource-editor-footer">
            <label className="checkbox">
              <input type="checkbox" checked={frame.active !== false} onChange={(e) => set({ active: e.target.checked })} />{" "}
              Đang hoạt động
            </label>
            <div>
              <Button type="button" className="outline" onClick={onClose} disabled={busy}>Huỷ</Button>
              <Button disabled={busy || imageBusy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</Button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
