import { useEffect, useState } from "react";
import { Activity, ArrowDown, ArrowUp, CalendarDays, Image, Layers, Pencil, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { api, assetUrl, formatDate } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { TableHeading } from "./table-heading";
import { SERVICES, ServiceTabs, useServiceTab } from "./service-tabs";

const SIZES = { full: "10 × 15 cm", strip: "5 × 15 cm", instax: "Instax Wide" };
const searchable = (value) =>
  String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();

function NameDialog({ title, initial = "", busy, onClose, onSave }) {
  const [name, setName] = useState(initial);
  return (
    <div className="modal-backdrop">
      <section className="modal theme-name-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Đóng" onClick={onClose}><X /></button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name.trim());
          }}
        >
          <label>
            Tên chủ đề
            <input autoFocus maxLength={100} value={name} placeholder="VD: Kawaii, Limited, Giáng sinh…"
              onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="resource-editor-footer">
            <span />
            <div>
              <Button type="button" className="outline" onClick={onClose} disabled={busy}>Huỷ</Button>
              <Button disabled={busy || !name.trim()}>{busy ? "Đang lưu…" : "Lưu"}</Button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

// Thiết lập → Chủ đề (như Snapbox /setting/theme): mỗi chủ đề là một bộ khung khách chọn để ghép.
// Chủ đề tách theo loại hình chụp: phòng Photobooth (khung 10 × 15) và phòng Polaroid (khung Instax Wide).
export function ThemesManager({ notify, onOpenFrames }) {
  const toast = useToast();
  const { reload } = useStudio();
  const [service, setService] = useServiceTab();
  const [themes, setThemes] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/admin/themes").then(setThemes, (e) => setError(e.message));
  }, []);
  async function run(request, message) {
    if (busy) return false;
    setBusy(true);
    try {
      setThemes(await request());
      reload?.();
      notify(message);
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const kindOf = (theme) => theme.kind || "photobooth";
  const ofService = (themes || []).filter((t) => kindOf(t) === service);
  const serviceName = SERVICES.find(([key]) => key === service)[1];
  const visible = ofService.filter(
    (t) =>
      searchable(t.name).includes(searchable(query.trim())) &&
      (status === "all" || t.active === (status === "active")),
  );
  const filtered = Boolean(query.trim()) || status !== "all";
  const toggle = (theme) => {
    if (!window.confirm(`Bạn có muốn ${theme.active ? "tắt" : "bật"} chủ đề “${theme.name}”? ${theme.active ? "Khách sẽ không thấy các khung của chủ đề này." : "Khách sẽ thấy lại các khung của chủ đề này."}`)) return;
    run(() => api("/admin/themes", { method: "PUT", body: { name: theme.name, active: !theme.active } }),
      `Đã ${theme.active ? "tắt" : "bật"} chủ đề “${theme.name}”.`);
  };
  // Đổi chỗ với chủ đề liền trước / sau cùng loại hình (thứ tự chung của mọi chủ đề vẫn lưu một danh sách).
  const move = (index, by) => {
    const names = themes.map((t) => t.name);
    const [a, b] = [names.indexOf(ofService[index].name), names.indexOf(ofService[index + by].name)];
    [names[a], names[b]] = [names[b], names[a]];
    run(() => api("/admin/themes/order", { method: "PUT", body: { names } }), "Đã đổi thứ tự chủ đề.");
  };
  const remove = (theme) => {
    if (!window.confirm(`Bạn có muốn xoá chủ đề “${theme.name}”? ${theme.frames ? `${theme.frames} khung trong chủ đề sẽ thành khung lẻ (không bị xoá).` : ""}`)) return;
    run(() => api(`/admin/themes/${encodeURIComponent(theme.name)}`, { method: "DELETE" }), `Đã xoá chủ đề “${theme.name}”.`);
  };
  async function saveName(name) {
    if (!name) return;
    const ok = dialog.theme
      ? await run(() => api("/admin/themes", { method: "PUT", body: { name: dialog.theme.name, newName: name } }),
        `Đã đổi tên chủ đề thành “${name}”.`)
      : await run(() => api("/admin/themes", { method: "POST", body: { name, kind: service } }),
        `Đã thêm chủ đề ${serviceName} “${name}”.`);
    if (ok) setDialog(null);
  }
  const active = ofService.filter((t) => t.active).length;
  const counts = themes
    ? Object.fromEntries(SERVICES.map(([key]) => [key, themes.filter((t) => kindOf(t) === key).length]))
    : {};
  return (
    <>
      <ErrorBox error={error} />
      <ServiceTabs value={service} onChange={setService} counts={counts} />
      <section className="catalog-toolbar" aria-label="Quản lý chủ đề">
        <div className="catalog-intro">
          <span className="catalog-intro-icon"><Layers size={24} aria-hidden="true" /></span>
          <div className="catalog-intro-copy">
            <h3>Chủ đề phòng {serviceName}</h3>
            <p>
              Khung cùng chủ đề được ghép thành một bộ. Thêm khung vào chủ đề ở mục Khung ảnh
              {service === "polaroid" ? " (khung Size Instax — thẻ Instax Wide ngang)." : " (khung size lớn / size nhỏ 10 × 15)."}
            </p>
          </div>
          <div className="inline-actions">
            <Button className="outline" onClick={onOpenFrames}><Image size={16} aria-hidden="true" /> Khung ảnh</Button>
            <Button onClick={() => setDialog({})}><Plus size={17} aria-hidden="true" /> Thêm mới chủ đề</Button>
          </div>
        </div>
        <div className="catalog-controls">
          <div className="catalog-search">
            <Search size={18} aria-hidden="true" />
            <input type="search" aria-label="Tìm chủ đề" placeholder="Tìm kiếm tên chủ đề…" value={query}
              onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select aria-label="Lọc trạng thái" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Hoạt động</option>
            <option value="inactive">Không hoạt động</option>
          </select>
        </div>
        <div className="catalog-results" aria-live="polite">
          <span>{themes ? `${visible.length} / ${ofService.length} chủ đề` : "Đang tải…"}</span>
          {themes && (
            <div className="catalog-counts">
              <span><i />{active} hoạt động</span>
              <span>{ofService.length - active} không hoạt động</span>
            </div>
          )}
        </div>
      </section>
      <div className="table-wrap themes-table">
        <table>
          <thead>
            <tr>
              <TableHeading icon={Layers}>Chủ đề</TableHeading>
              <TableHeading icon={Image}>Tổng frame</TableHeading>
              <TableHeading icon={Activity}>Trạng thái</TableHeading>
              <TableHeading icon={CalendarDays}>Ngày tạo</TableHeading>
              <TableHeading icon={SlidersHorizontal}>Hành động</TableHeading>
            </tr>
          </thead>
          <tbody>
            {visible.map((theme) => {
              const index = ofService.indexOf(theme);
              return (
                <tr key={theme.name}>
                  <td data-label="Chủ đề">
                    <div className="theme-cell">
                      <div className="theme-thumbs" aria-hidden="true">
                        {theme.previews.length
                          ? theme.previews.slice(0, 3).map((src) => <img key={src} src={assetUrl(src)} alt="" loading="lazy" />)
                          : <Layers size={20} />}
                      </div>
                      <div>
                        <strong>{theme.name}</strong>
                        <small>Thứ tự hiện cho khách: {index + 1}</small>
                      </div>
                    </div>
                  </td>
                  <td data-label="Tổng frame">
                    <strong>{theme.frames}</strong> khung
                    <small>
                      {theme.slots} ô ảnh
                      {theme.sizes.length > 0 && ` · ${theme.sizes.map((s) => SIZES[s] || s).join(", ")}`}
                      {theme.activeFrames < theme.frames && ` · ${theme.frames - theme.activeFrames} khung đang tắt`}
                    </small>
                  </td>
                  <td data-label="Trạng thái">
                    <label className="switch">
                      <input type="checkbox" checked={theme.active} disabled={busy} onChange={() => toggle(theme)}
                        aria-label={`${theme.active ? "Tắt" : "Bật"} chủ đề ${theme.name}`} />
                      <span>{theme.active ? "Hoạt động" : "Không hoạt động"}</span>
                    </label>
                  </td>
                  <td data-label="Ngày tạo">{theme.createdAt ? formatDate(theme.createdAt) : "—"}</td>
                  <td data-label="Hành động">
                    <div className="inline-actions">
                      <button className="icon-button" title="Lên trước" aria-label={`Đưa ${theme.name} lên trước`}
                        disabled={busy || filtered || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
                      <button className="icon-button" title="Xuống sau" aria-label={`Đưa ${theme.name} xuống sau`}
                        disabled={busy || filtered || index === ofService.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
                      <button className="icon-button" title="Đổi tên" aria-label={`Đổi tên ${theme.name}`}
                        onClick={() => setDialog({ theme })}><Pencil size={16} /></button>
                      <button className="icon-button" title="Xoá chủ đề" aria-label={`Xoá chủ đề ${theme.name}`}
                        disabled={busy} onClick={() => remove(theme)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {themes && !visible.length && (
          <div className="empty-state">
            {filtered ? "Không có chủ đề phù hợp." : `Chưa có chủ đề phòng ${serviceName}. Thêm chủ đề rồi gán khung ở mục Khung ảnh.`}
          </div>
        )}
      </div>
      {filtered && ofService.length > 1 && <p className="muted soft-note">Bỏ tìm kiếm / bộ lọc để đổi thứ tự chủ đề.</p>}
      {dialog && (
        <NameDialog
          title={dialog.theme ? `Đổi tên chủ đề “${dialog.theme.name}”` : `Thêm mới chủ đề ${serviceName}`}
          initial={dialog.theme?.name}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={saveName}
        />
      )}
    </>
  );
}
