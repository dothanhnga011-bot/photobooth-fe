import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Monitor, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, assetUrl } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { fileData, imageData } from "./image-data";

const MAX_IMAGES = 6;
const blank = { name: "", rooms: [], title: "", subtitle: "", interval: 6, images: [], active: true };

// Ảnh trong trình sửa: ảnh đã lưu { _id, url } hoặc ảnh mới chọn { data }.
const imageSrc = (image) => image.data || assetUrl(image.url);

function ScreenPreview({ screen }) {
  const [index, setIndex] = useState(0);
  const images = screen.images || [];
  useEffect(() => {
    setIndex(0);
    if (images.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % images.length), Math.max(2, screen.interval || 6) * 1000);
    return () => clearInterval(timer);
  }, [images.length, screen.interval]);
  const image = images[index % Math.max(1, images.length)];
  return (
    <div className={`idle-preview ${image ? "has-image" : ""}`} aria-label="Xem trước màn hình chờ">
      {image && <img className="idle-selfbooth" src={imageSrc(image)} alt="" />}
      <strong>{screen.title || "Cười lên, mình chụp nhé!"}</strong>
      <span>{screen.subtitle || "chụp xong in ngay · nhận ảnh trên điện thoại"}</span>
      <em>Chạm để bắt đầu</em>
      {images.length > 1 && (
        <small className="idle-dots" aria-hidden="true">
          {images.map((img, i) => <i key={img._id || i} className={i === index ? "on" : ""} />)}
        </small>
      )}
    </div>
  );
}

function ScreenEditor({ screen, rooms, takenBy, busy, onClose, onSave }) {
  const toast = useToast();
  const [edit, setEdit] = useState(screen);
  const set = (patch) => setEdit((v) => ({ ...v, ...patch }));
  async function addImages(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    const room = MAX_IMAGES - edit.images.length;
    if (files.length > room) toast.warning(`Mỗi màn hình chờ tối đa ${MAX_IMAGES} ảnh — chỉ thêm ${room} ảnh đầu.`);
    const added = [];
    for (const file of files.slice(0, room)) {
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error("big");
        // GIF động giữ nguyên để không mất chuyển động; ảnh khác thu về 1920 px.
        if (file.type === "image/gif" && file.size > 3 * 1024 * 1024) throw new Error("gif");
        const data = file.type === "image/gif"
          ? await fileData(file)
          : await imageData(file, 1920, "image/jpeg", 0.85);
        added.push({ data });
      } catch (e) {
        toast.error(
          e.message === "gif"
            ? `Ảnh GIF “${file.name}” lớn hơn 3 MB. Vui lòng nén bớt.`
            : e.message === "big"
              ? `Ảnh “${file.name}” lớn hơn 10 MB.`
              : `Không đọc được ảnh “${file.name}”. Vui lòng chọn JPG, PNG, WebP hoặc GIF.`,
        );
      }
    }
    if (added.length) set({ images: [...edit.images, ...added] });
  }
  const move = (index, by) => {
    const images = [...edit.images];
    [images[index], images[index + by]] = [images[index + by], images[index]];
    set({ images });
  };
  const toggleRoom = (id) =>
    set({ rooms: edit.rooms.includes(id) ? edit.rooms.filter((r) => r !== id) : [...edit.rooms, id] });
  return (
    <div className="modal-backdrop">
      <section className="modal screen-editor" role="dialog" aria-modal="true" aria-label="Thiết lập màn hình chờ">
        <div className="modal-header">
          <div>
            <h2>{edit.isDefault ? "Cấu hình chung" : edit._id ? "Cập nhật cấu hình riêng" : "Tạo mới cấu hình riêng"}</h2>
            <p>{edit.isDefault ? "Áp dụng cho mọi máy chưa có cấu hình riêng." : "Chỉ áp dụng cho các máy được chọn."}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Đóng" onClick={onClose}><X /></button>
        </div>
        <div className="screen-editor-body">
          <div className="screen-editor-fields">
            {!edit.isDefault && (
              <>
                <label>
                  Tên cấu hình
                  <input maxLength={100} value={edit.name} placeholder="VD: Máy chi nhánh Bắc Giang"
                    onChange={(e) => set({ name: e.target.value })} />
                </label>
                <fieldset className="check-list">
                  <legend>Máy được áp dụng</legend>
                  {rooms.map((room) => (
                    <label className="checkbox" key={room._id}>
                      <input type="checkbox" checked={edit.rooms.includes(room._id)} onChange={() => toggleRoom(room._id)} />
                      {room.name}
                      <small>
                        {room.branch}
                        {takenBy[room._id] && takenBy[room._id] !== edit._id && " · đang theo cấu hình riêng khác (sẽ chuyển sang đây)"}
                      </small>
                    </label>
                  ))}
                  {!rooms.length && <p className="muted">Chưa có máy. Thêm máy ở mục Quản lý máy.</p>}
                </fieldset>
              </>
            )}
            <label>
              Dòng chữ lớn
              <input maxLength={60} placeholder="Cười lên, mình chụp nhé!" value={edit.title}
                onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label>
              Dòng chữ nhỏ
              <input maxLength={120} placeholder="chụp xong in ngay · nhận ảnh trên điện thoại" value={edit.subtitle}
                onChange={(e) => set({ subtitle: e.target.value })} />
            </label>
            <label>
              Thời gian mỗi ảnh (giây)
              <input type="number" inputMode="numeric" min={2} max={60} value={edit.interval}
                onChange={(e) => set({ interval: Number(e.target.value) || 6 })} />
            </label>
            <div className="screen-images">
              <span>Ảnh màn hình chờ ({edit.images.length}/{MAX_IMAGES}) · JPG, PNG, WebP, GIF · nên dùng 1920 × 1080</span>
              <ul>
                {edit.images.map((image, index) => (
                  <li key={image._id || index}>
                    <img src={imageSrc(image)} alt={`Ảnh ${index + 1}`} />
                    <div>
                      <button type="button" className="icon-button" aria-label="Lên trước" disabled={!index} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
                      <button type="button" className="icon-button" aria-label="Xuống sau" disabled={index === edit.images.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
                      <button type="button" className="icon-button" aria-label={`Bỏ ảnh ${index + 1}`}
                        onClick={() => set({ images: edit.images.filter((_, i) => i !== index) })}><Trash2 size={15} /></button>
                    </div>
                  </li>
                ))}
              </ul>
              {edit.images.length < MAX_IMAGES && (
                <label className="button outline">
                  <ImagePlus size={16} /> Chọn ảnh
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={addImages} />
                </label>
              )}
            </div>
            {!edit.isDefault && (
              <label className="checkbox">
                <input type="checkbox" checked={edit.active} onChange={(e) => set({ active: e.target.checked })} />
                Đang dùng
              </label>
            )}
          </div>
          <ScreenPreview screen={edit} />
        </div>
        <div className="resource-editor-footer">
          <span />
          <div>
            <Button type="button" className="outline" onClick={onClose} disabled={busy}>Huỷ</Button>
            <Button disabled={busy} onClick={() => onSave(edit)}>{busy ? "Đang lưu…" : edit._id ? "Cập nhật" : "Tạo mới"}</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

// Thiết lập → Màn hình chờ (như Snapbox /setting/screen): cấu hình chung và cấu hình riêng từng máy.
export function ScreensManager({ notify }) {
  const toast = useToast();
  const { reload } = useStudio();
  const [screens, setScreens] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/admin/screens").then(setScreens, (e) => setError(e.message));
    api("/admin/rooms").then((list) => setRooms(list.filter((r) => r.active)), () => {});
  }, []);
  const roomName = Object.fromEntries(rooms.map((r) => [r._id, r.name]));
  const takenBy = Object.fromEntries(
    (screens || []).filter((s) => !s.isDefault).flatMap((s) => s.rooms.map((r) => [r, s._id])),
  );
  async function save(screen) {
    if (busy) return;
    if (!screen.isDefault && !screen.name.trim()) return toast.error("Vui lòng nhập tên cấu hình.");
    if (!screen.isDefault && !screen.rooms.length) return toast.error("Vui lòng chọn máy muốn cấu hình.");
    setBusy(true);
    try {
      const body = {
        name: screen.name,
        rooms: screen.rooms,
        title: screen.title,
        subtitle: screen.subtitle,
        interval: screen.interval,
        active: screen.active,
        images: screen.images.map((image) => (image.data ? { data: image.data } : { _id: image._id })),
      };
      setScreens(await api(`/admin/screens${screen._id ? `/${screen._id}` : ""}`, {
        method: screen._id ? "PUT" : "POST", body, timeout: 60000,
      }));
      setEdit(null);
      reload?.();
      notify(screen._id ? "Cập nhật thành công." : "Tạo mới thành công.");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(screen) {
    if (!window.confirm(`Bạn có muốn xoá màn hình chờ “${screen.name}”? Các máy của cấu hình này sẽ dùng cấu hình chung.`)) return;
    try {
      setScreens(await api(`/admin/screens/${screen._id}`, { method: "DELETE" }));
      reload?.();
      notify("Xoá thành công.");
    } catch (e) {
      toast.error(e.message);
    }
  }
  const general = screens?.find((s) => s.isDefault);
  const own = screens?.filter((s) => !s.isDefault) || [];
  const card = (screen) => (
    <article className="panel screen-card" key={screen._id}>
      <div className="screen-thumbs">
        {screen.images.length ? (
          screen.images.slice(0, 3).map((image) => <img key={image._id} src={assetUrl(image.url)} alt="" />)
        ) : (
          <span className="screen-empty"><Monitor size={22} aria-hidden="true" /> Chưa có hình ảnh</span>
        )}
        {screen.images.length > 3 && <span className="screen-more">+{screen.images.length - 3}</span>}
      </div>
      <div className="screen-info">
        <div className="screen-title">
          <h3>{screen.name || "Cấu hình chung"}</h3>
          {!screen.isDefault && (
            <span className={`badge ${screen.active ? "confirmed" : "cancelled"}`}>{screen.active ? "Đang dùng" : "Đã tắt"}</span>
          )}
        </div>
        <p>
          <b>{screen.title || "Cười lên, mình chụp nhé!"}</b>
          {screen.subtitle && <> · {screen.subtitle}</>}
        </p>
        <small>
          {screen.isDefault
            ? "Áp dụng cho mọi máy chưa có cấu hình riêng"
            : `Máy được áp dụng: ${screen.rooms.map((r) => roomName[r] || "Máy chưa có tên").join(", ") || "—"}`}
          {screen.images.length > 1 && ` · ${screen.images.length} ảnh, ${screen.interval} giây/ảnh`}
        </small>
      </div>
      <div className="inline-actions">
        <Button className="outline small" onClick={() => setEdit({ ...blank, ...screen })}>
          <Pencil size={15} /> Thiết lập
        </Button>
        {!screen.isDefault && (
          <button className="icon-button" aria-label={`Xoá ${screen.name}`} onClick={() => remove(screen)}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </article>
  );
  return (
    <div className="screens-manager">
      <ErrorBox error={error} />
      {!screens ? (
        <p className="muted">Đang tải màn hình chờ…</p>
      ) : (
        <>
          <h3 className="section-title">Cấu hình chung</h3>
          {general && card(general)}
          <div className="section-title-row">
            <h3 className="section-title">Cấu hình riêng</h3>
            <Button onClick={() => setEdit({ ...blank })}><Plus size={16} /> Thêm mới</Button>
          </div>
          {own.map(card)}
          {!own.length && (
            <div className="empty-state">
              <Monitor />
              <h3>Chưa có cấu hình riêng</h3>
              <p>Tạo cấu hình riêng khi muốn một máy hiện ảnh / lời mời khác cấu hình chung.</p>
            </div>
          )}
        </>
      )}
      {edit && (
        <ScreenEditor
          screen={edit}
          rooms={rooms}
          takenBy={takenBy}
          busy={busy}
          onClose={() => setEdit(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
