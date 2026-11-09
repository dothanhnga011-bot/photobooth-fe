import { useEffect, useState } from "react";
import { ImagePlus, Pencil, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { api } from "../api";
import { COLOR_FILTERS, FILTER_CSS, customCss, NEUTRAL_CUSTOM } from "../color-filters.js";
import { Button, ErrorBox, useStudio, useToast } from "../studio";

// Thanh trượt của filter tự tạo: [khóa, nhãn, nhỏ nhất, lớn nhất, đơn vị].
const SLIDERS = [
  ["brightness", "Độ sáng", 50, 150, "%"],
  ["contrast", "Độ tương phản", 50, 200, "%"],
  ["saturate", "Độ bão hòa", 0, 200, "%"],
  ["sepia", "Hiệu ứng sepia", 0, 100, "%"],
  ["hueRotate", "Xoay màu", -180, 180, "°"],
];
// Ảnh mẫu mặc định: ảnh chụp thật tại tiệm (da, tóc, áo, nền hồng) để thấy filter đổi màu thế nào.
const SAMPLE = "/filter-sample.jpg";
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");

// Ảnh mẫu chia đôi: bên trái ảnh gốc, bên phải đã áp filter; kéo thanh để so sánh.
function Compare({ src, css }) {
  const [split, setSplit] = useState(50);
  return (
    <div className="filter-compare">
      <div className="filter-compare-frame">
        <img src={src} alt="Ảnh gốc" />
        <img src={src} alt="Đã áp filter" style={{ filter: css, clipPath: `inset(0 0 0 ${split}%)` }} />
        <i style={{ left: `${split}%` }} aria-hidden="true" />
        <span className="filter-compare-tag before">Ảnh gốc</span>
        <span className="filter-compare-tag after">Đã áp filter</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={split}
        aria-label="Kéo thanh trượt để so sánh Trước / Sau"
        onChange={(e) => setSplit(Number(e.target.value))}
      />
      <small className="muted">Kéo thanh trượt để so sánh Trước / Sau</small>
    </div>
  );
}

function FilterEditor({ filter, sample, onSample, busy, onClose, onSave }) {
  const [edit, setEdit] = useState(filter);
  return (
    <div className="modal-backdrop">
      <section className="modal filter-editor" role="dialog" aria-modal="true" aria-label="Thiết lập filter">
        <div className="modal-header">
          <h2>{filter.isNew ? "Thêm mới filter" : "Chỉnh sửa filter"}</h2>
          <button type="button" className="icon-button" aria-label="Đóng" onClick={onClose}><X /></button>
        </div>
        <div className="filter-editor-body">
          <div className="filter-editor-fields">
            <label>
              Tên filter
              <input autoFocus maxLength={40} placeholder="Nhập tên của filter" value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            {SLIDERS.map(([key, label, min, max, unit]) => (
              <label key={key} className="filter-slider">
                <span>
                  {label} <b>{edit[key]}{unit}</b>
                </span>
                <input type="range" min={min} max={max} value={edit[key]}
                  onChange={(e) => setEdit({ ...edit, [key]: Number(e.target.value) })} />
              </label>
            ))}
            <div className="inline-actions">
              <Button type="button" className="outline small" onClick={() => setEdit({ ...edit, ...NEUTRAL_CUSTOM })}>
                Đặt lại
              </Button>
              <label className="button outline small">
                <ImagePlus size={15} /> Đổi ảnh mẫu
                <input type="file" accept="image/*" hidden onChange={onSample} />
              </label>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
              Kích hoạt (khách thấy filter này ở mục “Màu ảnh” trên máy chụp)
            </label>
          </div>
          <Compare src={sample} css={customCss(edit)} />
        </div>
        <div className="resource-editor-footer">
          <span />
          <div>
            <Button type="button" className="outline" onClick={onClose} disabled={busy}>Hủy bỏ</Button>
            <Button disabled={busy || !edit.name.trim()} onClick={() => onSave(edit)}>
              {busy ? "Đang lưu…" : filter.isNew ? "Tạo mới" : "Lưu"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

// Thiết lập → Quản lý filter (như Snapbox /setting/filter): bật filter có sẵn và tự tạo filter
// bằng các chỉ số độ sáng, tương phản, bão hòa, sepia, xoay màu.
export function FiltersManager({ notify }) {
  const toast = useToast();
  const { reload } = useStudio();
  const [enabled, setEnabled] = useState(null);
  const [custom, setCustom] = useState([]);
  const [edit, setEdit] = useState(null);
  const [sample, setSample] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/admin/settings").then(
      (value) => {
        setEnabled(value.enabledFilters?.length ? value.enabledFilters : Object.keys(COLOR_FILTERS));
        setCustom(value.customFilters || []);
      },
      (e) => setError(e.message),
    );
  }, []);
  useEffect(() => () => sample !== SAMPLE && URL.revokeObjectURL(sample), [sample]);
  async function run(action, message) {
    if (busy) return false;
    setBusy(true);
    try {
      await action();
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
  const saveCustom = (list, message) =>
    run(async () => {
      const value = await api("/admin/settings/custom-filters", {
        method: "PUT",
        body: { customFilters: list.map(({ isNew, ...f }) => ({ ...f, name: f.name.trim() })) },
      });
      setCustom(value.customFilters || []);
    }, message);
  const saveEnabled = () =>
    run(() => api("/admin/settings/filters", { method: "PUT", body: { enabledFilters: enabled } }),
      "Đã cập nhật bộ lọc có sẵn dành cho khách.");
  async function save(filter) {
    const exists = custom.some((f) => f.id === filter.id);
    const list = exists ? custom.map((f) => (f.id === filter.id ? filter : f)) : [...custom, filter];
    if (await saveCustom(list, exists ? "Cập nhật filter thành công!" : "Thêm mới filter thành công!")) setEdit(null);
  }
  const remove = (filter) => {
    if (!window.confirm(`Xóa filter “${filter.name}”? Ảnh khách đã chỉnh trước đó vẫn giữ màu cũ.`)) return;
    saveCustom(custom.filter((f) => f.id !== filter.id), "Xóa filter thành công!");
  };
  const toggle = (filter) =>
    saveCustom(custom.map((f) => (f.id === filter.id ? { ...f, active: !f.active } : f)),
      filter.active ? `Đã tắt filter “${filter.name}”.` : `Đã kích hoạt filter “${filter.name}”.`);
  const pickSample = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setSample(URL.createObjectURL(file));
  };
  return (
    <div className="kiosk-content filters-manager">
      <ErrorBox error={error} />
      <section className="panel kiosk-content-section">
        <div className="section-title-row">
          <div>
            <h3>Filter tự tạo của tiệm</h3>
            <p className="muted">Khách thấy các filter đang kích hoạt ở mục “Màu ảnh” trên màn chọn ảnh của máy chụp. Màu chỉ áp lên ảnh trong khung; ảnh xem trước, ảnh trong album và ảnh in cùng một màu.</p>
          </div>
          <Button onClick={() => setEdit({ id: newId(), name: "", ...NEUTRAL_CUSTOM, active: true, isNew: true })}>
            <Plus size={16} /> Thêm mới
          </Button>
        </div>
        {custom.length ? (
          <ul className="filter-cards">
            {custom.map((f) => (
              <li key={f.id} className={f.active ? "" : "is-off"}>
                <img src={sample} alt="" style={{ filter: customCss(f) }} />
                <div>
                  <strong>{f.name}</strong>
                  <small>
                    Sáng {f.brightness}% · Tương phản {f.contrast}% · Bão hòa {f.saturate}%
                    {f.sepia ? ` · Sepia ${f.sepia}%` : ""}{f.hueRotate ? ` · Xoay màu ${f.hueRotate}°` : ""}
                  </small>
                  <label className="switch">
                    <input type="checkbox" checked={f.active} disabled={busy} onChange={() => toggle(f)}
                      aria-label={`${f.active ? "Tắt" : "Kích hoạt"} filter ${f.name}`} />
                    <span>{f.active ? "Kích hoạt" : "Không kích hoạt"}</span>
                  </label>
                </div>
                <div className="inline-actions">
                  <button className="icon-button" aria-label={`Sửa filter ${f.name}`} onClick={() => setEdit({ ...f })}><Pencil size={16} /></button>
                  <button className="icon-button" aria-label={`Xóa filter ${f.name}`} disabled={busy} onClick={() => remove(f)}><Trash2 size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <SlidersHorizontal />
            <h3>Chưa có filter tự tạo</h3>
            <p>Bấm “Thêm mới” để pha màu riêng cho tiệm (VD: Trắng hồng, Film ấm…).</p>
          </div>
        )}
      </section>
      <section className="panel kiosk-content-section">
        <h3>Bộ lọc có sẵn</h3>
        <p className="muted">Chọn các bộ lọc có sẵn khách được phép dùng. Chỉ bật “Gốc” và không có filter tự tạo thì máy chụp ẩn mục “Màu ảnh”.</p>
        {!enabled ? (
          <p className="muted">Đang tải…</p>
        ) : (
          <>
            <ul className="filter-cards builtin">
              {Object.entries(COLOR_FILTERS).map(([key, label]) => (
                <li key={key} className={enabled.includes(key) ? "" : "is-off"}>
                  <img src={sample} alt="" style={{ filter: FILTER_CSS[key] }} />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={enabled.includes(key)}
                      disabled={key === "original" || busy}
                      onChange={(event) =>
                        setEnabled((current) =>
                          event.target.checked
                            ? [...new Set([...current, key])]
                            : current.filter((value) => value !== key))}
                    />
                    {label}
                  </label>
                </li>
              ))}
            </ul>
            <div className="inline-actions">
              <Button disabled={busy} onClick={saveEnabled}>{busy ? "Đang lưu…" : "Lưu bộ lọc có sẵn"}</Button>
              <label className="button outline">
                <ImagePlus size={16} /> Đổi ảnh mẫu
                <input type="file" accept="image/*" hidden onChange={pickSample} />
              </label>
            </div>
          </>
        )}
      </section>
      {edit && (
        <FilterEditor
          filter={edit}
          sample={sample}
          onSample={pickSample}
          busy={busy}
          onClose={() => setEdit(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
