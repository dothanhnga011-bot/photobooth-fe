import { useState } from "react";
import { Clock3, Infinity as InfinityIcon, Package, Printer, Search, X } from "lucide-react";
import { money } from "../api";
import { Button, ErrorBox, useStudio } from "../studio";
import { FieldError } from "../validate";
import { definitions, DEFAULT_STAFF_PERMISSIONS, PERMISSION_GROUPS, ROOM_KINDS } from "./config";
import { includedSheets, isInstax, isStrip, piecesLabel, printSizeOf } from "../kiosk/print-count.js";
import { LayoutArt, LayoutCard } from "../kiosk/KioskPolaroid.jsx";
import { LAYOUT_COUNTS } from "../polaroid-layouts.js";

// Loại phòng quyết định màn đầu tiên khách thấy sau “Chạm để bắt đầu”.
const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(([, items]) => items.map(([key]) => key));
const plain = (value) =>
  String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();

// Phân quyền truy cập chức năng của nhân viên (như trang Tài khoản của Snapbox).
function PermissionsField({ value, onChange }) {
  const [query, setQuery] = useState("");
  const selected = value ?? DEFAULT_STAFF_PERMISSIONS;
  const toggle = (key) =>
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  const groups = PERMISSION_GROUPS.map(([group, items]) => [
    group,
    items.filter(([, label]) => plain(label).includes(plain(query.trim()))),
  ]).filter(([, items]) => items.length);
  return (
    <div className="permissions-field">
      <div className="permissions-tools">
        <div className="catalog-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Tìm kiếm quyền" placeholder="Tìm kiếm quyền…" value={query}
            onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="muted">Đã chọn {selected.length}/{ALL_PERMISSIONS.length}</span>
        <button type="button" className="link-button" onClick={() => onChange(ALL_PERMISSIONS)}>Chọn tất cả</button>
        <button type="button" className="link-button" onClick={() => onChange([])}>Bỏ chọn tất cả</button>
      </div>
      {groups.map(([group, items]) => (
        <fieldset key={group} className="permission-group">
          <legend>{group}</legend>
          {items.map(([key, label]) => (
            <label className="checkbox" key={key}>
              <input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} />
              {label}
            </label>
          ))}
        </fieldset>
      ))}
      {!groups.length && <p className="muted">Không tìm thấy quyền phù hợp.</p>}
      <small className="muted">Nhân viên luôn xem được Tổng hợp (không kèm tiền nếu chưa có quyền doanh thu), đơn hàng, hàng chờ in và máy ở chi nhánh được phân công.</small>
    </div>
  );
}

// Layout Polaroid: chọn số ảnh bằng hình layout (1–6 ảnh; số khác đã lưu trước đây vẫn giữ được).
function LayoutPicker({ value, onChange }) {
  const current = Number(value) || 1;
  const counts = LAYOUT_COUNTS.includes(current) ? LAYOUT_COUNTS : [...LAYOUT_COUNTS, current].sort((a, b) => a - b);
  return (
    <div className="layout-picker" role="radiogroup" aria-label="Số ảnh trong layout">
      {counts.map((n) => (
        <label key={n} className={`layout-pick${n === current ? " is-selected" : ""}`}>
          <input type="radio" name="selectCount" value={n} checked={n === current} onChange={() => onChange(n)} />
          <LayoutArt count={n} />
          {n} ảnh
        </label>
      ))}
    </div>
  );
}

// Chi nhánh áp dụng bảng giá: để trống = cấu hình chung cho mọi chi nhánh.
function BranchesField({ value = [], onChange }) {
  const { rooms = [] } = useStudio();
  const branches = [...new Set([...rooms.map((r) => r.branch), ...value].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "vi"));
  return (
    <div className="check-list">
      <label className="checkbox">
        <input type="checkbox" checked={!value.length} onChange={() => onChange([])} />
        Tất cả chi nhánh (cấu hình chung)
      </label>
      {branches.map((name) => (
        <label className="checkbox" key={name}>
          <input
            type="checkbox"
            checked={value.includes(name)}
            onChange={() => onChange(value.includes(name) ? value.filter((b) => b !== name) : [...value, name])}
          />
          {name}
        </label>
      ))}
    </div>
  );
}

export function ResourceEditor({
  resource,
  edit,
  form,
  busy,
  error,
  onChange,
  onClose,
  onSubmit,
}) {
  const catalog = resource === "packages";
  const title =
    resource === "packages"
      ? `${edit._id ? "Chỉnh sửa" : "Thêm"} ${isInstax(edit) ? "layout Polaroid" : "gói chụp"}`
      : edit._id
        ? "Chỉnh sửa"
        : "Thêm mới";
  const update = (key, value) => {
    onChange({ ...edit, [key]: value });
    form.clear(key);
  };
  // Gói khổ Instax là layout của phòng Polaroid: đặt tên các ô theo layout.
  const POLAROID_LABELS = {
    name: "Tên layout (thẻ trên màn Chọn layout)",
    price: "Giá layout (VND)",
    prints: "Số tấm Instax kèm layout",
    selectCount: "Layout (số ảnh trên thẻ Instax Wide)",
    shots: "Số lần chụp tối đa (số lần bấm dây)",
  };
  const field = ([key, baseLabel, type = "text"]) => {
    const label = catalog && edit.printSize === "instax" ? POLAROID_LABELS[key] || baseLabel : baseLabel;
    if (type === "permissions" && edit.role !== "staff") return null;
    // Loại phòng: chỉ chọn lúc thêm phòng mới.
    if (type === "roomKind") {
      if (edit._id) return null;
      return (
        <div key={key} className={catalog ? "form-field resource-field resource-field-kind" : undefined}>
          <span>{label}</span>
          <div className="room-type-options" role="radiogroup" aria-label={label}>
            {ROOM_KINDS.map(([value, title, detail]) => (
              <label key={value} className={`room-type-option${(edit.kind || "photobooth") === value ? " is-selected" : ""}`}>
                <input type="radio" name="kind" value={value} checked={(edit.kind || "photobooth") === value}
                  onChange={() => update("kind", value)} />
                <strong>{title}</strong>
                <small>{detail}</small>
              </label>
            ))}
          </div>
        </div>
      );
    }
    if (type === "checkbox")
      return (
        <label key={key} className="checkbox">
          <input
            name={key}
            type="checkbox"
            checked={Boolean(edit[key])}
            onChange={(event) => update(key, event.target.checked)}
          />
          {label}
        </label>
      );
    const layoutPick = catalog && key === "selectCount" && isInstax(edit);
    const Field = ["branches", "permissions"].includes(type) || layoutPick ? "div" : "label";
    return (
      <Field
        key={key}
        className={catalog ? `form-field resource-field resource-field-${key}` : undefined}
      >
        <span>{label}</span>
        {type === "textarea" ? (
          <textarea
            name={key}
            aria-invalid={Boolean(form.errors[key])}
            value={edit[key] || ""}
            onChange={(event) => update(key, event.target.value)}
          />
        ) : type === "printSize" ? (
          // Gói phòng Photobooth chỉ đổi giữa khổ to / khổ nhỏ; layout Polaroid luôn là thẻ Instax Wide.
          isInstax(edit) ? (
            <span className="resource-field-fixed">Polaroid · thẻ Instax Wide ảnh ngang (phòng Polaroid, máy Instax Link WIDE)</span>
          ) : (
            <select
              name={key}
              value={edit[key] || "full"}
              onChange={(event) => update(key, event.target.value)}
            >
              <option value="full">Khổ to · ảnh 10 × 15 cm nguyên tờ (máy DNP)</option>
              <option value="strip">Khổ nhỏ · 1 tờ 10 × 15 cắt đôi thành 2 tờ nhỏ (máy DNP)</option>
            </select>
          )
        ) : layoutPick ? (
          <LayoutPicker value={edit[key]} onChange={(value) => update(key, value)} />
        ) : type === "flip" ? (
          <select
            value={edit[key] || "device"}
            onChange={(event) => update(key, event.target.value)}
          >
            <option value="device">Theo cài đặt trên máy chụp</option>
            <option value="on">Có lật ảnh (như gương)</option>
            <option value="off">Không lật ảnh</option>
          </select>
        ) : type === "branches" ? (
          <BranchesField value={edit[key] || []} onChange={(value) => update(key, value)} />
        ) : type === "permissions" ? (
          <PermissionsField value={edit[key]} onChange={(value) => update(key, value)} />
        ) : type === "role" ? (
          <select
            value={edit[key]}
            onChange={(event) => update(key, event.target.value)}
          >
            <option value="staff">Lễ tân</option>
            <option value="admin">Quản trị viên</option>
          </select>
        ) : type === "checkbox" ? (
          <input
            name={key}
            type="checkbox"
            checked={Boolean(edit[key])}
            onChange={(event) => update(key, event.target.checked)}
          />
        ) : (
          <input
            name={key}
            type={type}
            inputMode={type === "number" ? "numeric" : undefined}
            autoComplete={type === "password" ? "new-password" : undefined}
            placeholder={
              type === "password" && edit._id
                ? "Để trống nếu không đổi"
                : undefined
            }
            aria-invalid={Boolean(form.errors[key])}
            value={type === "date" ? String(edit[key] || "").slice(0, 10) : edit[key] ?? ""}
            onChange={(event) =>
              update(
                key,
                type === "number" && event.target.value !== ""
                  ? Number(event.target.value)
                  : event.target.value,
              )
            }
          />
        )}
        {catalog && key === "prints" && (
          <small className="field-hint">
            {isStrip(edit)
              ? `Tờ 10 × 15 = ${piecesLabel(edit, includedSheets(edit))} cho khách. Tối thiểu 1 tờ (khách thấy “2 tờ nhỏ”).`
              : isInstax(edit)
                ? "Số tấm Instax Wide. Tối thiểu 2 tấm. Khách mua thêm ở quầy tính theo giá in thêm Instax."
                : "Tờ 10 × 15. Tối thiểu 2 tờ. Khách chọn thêm ở máy chụp tính theo giá in thêm."}
          </small>
        )}
        <FieldError error={form.errors[key]} />
      </Field>
    );
  };
  return (
    <div className="modal-backdrop">
      <section
        className={`modal ${catalog ? `catalog-editor catalog-editor-${resource}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Chỉnh sửa dữ liệu"
      >
        <div className="modal-header">
          <div className="resource-editor-title">
            {catalog && (
              <span className="resource-editor-icon">
                <Package size={23} aria-hidden="true" />
              </span>
            )}
            <div>
              <h2>{title}</h2>
              {catalog && (
                <p>
                  {isInstax(edit)
                    ? "Mỗi layout là một thẻ ở màn “Chọn layout” của phòng Polaroid: số ảnh, giá và số tấm Instax đi kèm."
                    : "Mỗi gói là một thẻ ở màn “Chọn khổ ảnh” của máy chụp: khổ ảnh, giá và số tờ in đi kèm."}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="icon-button"
          >
            <X />
          </button>
        </div>
        <ErrorBox error={error} />
        <form onSubmit={onSubmit} noValidate>
          <div className="resource-editor-content">
            <div className="resource-editor-fields">
              {definitions[resource].map(field)}
            </div>
            {resource === "packages" && (
              <aside
                className="catalog-editor-preview"
                aria-label="Xem trước gói chụp"
              >
                <span className="catalog-preview-label">THẺ TRÊN MÁY CHỤP</span>
                {/* Cùng kiểu thẻ ở màn “Chọn khổ ảnh” của máy chụp (KioskPackages). */}
                {isInstax(edit) ? (
                  // Cùng thẻ ở màn “Chọn layout” của phòng Polaroid (KioskLayouts).
                  <div className="kiosk-layout-preview">
                    <LayoutCard as="div" pack={{ ...edit, name: edit.name || "Tên layout", price: Number(edit.price) || 0 }} />
                  </div>
                ) : (
                  <div className="kiosk-size-preview">
                    <div className={`kiosk-size ${printSizeOf(edit)}`}>
                      <span className="kiosk-size-art" aria-hidden="true"><i /><i /></span>
                      <strong>{edit.name || "Tên gói chụp"}</strong>
                      <small>{Number(edit.shots) || 0} lần chụp · kèm {piecesLabel(edit, includedSheets(edit))}</small>
                      <b>{money(Number(edit.price) || 0)}</b>
                      {edit.description && <small>{edit.description}</small>}
                    </div>
                  </div>
                )}
                <ul>
                  <li>
                    <Package size={17} aria-hidden="true" />
                    {edit.branches?.length ? `Chỉ bán tại ${edit.branches.join(", ")}` : "Bán tại mọi chi nhánh"}
                  </li>
                  <li>
                    <Clock3 size={17} aria-hidden="true" />
                    {Number(edit.duration) || 0} phút chụp
                  </li>
                  <li>
                    <Printer size={17} aria-hidden="true" />
                    {isInstax(edit)
                      ? `${piecesLabel(edit, includedSheets(edit))} · máy Instax cạnh máy chụp`
                      : `${includedSheets(edit)} tờ in 10 × 15 cm${isStrip(edit) ? ` · cắt đôi = ${piecesLabel(edit, includedSheets(edit))}` : ""}`}
                  </li>
                  <li>
                    <InfinityIcon size={17} aria-hidden="true" />
                    {isInstax(edit)
                      ? `Layout ${Number(edit.selectCount) || 1} ảnh · tối đa ${Number(edit.shots) || 0} lần bấm dây`
                      : `${Number(edit.shots) || 0} lần chụp · chọn ${Number(edit.selectCount) || 4} ảnh ghép khung`}
                  </li>
                </ul>
              </aside>
            )}
          </div>
          <div className={catalog ? "resource-editor-footer" : undefined}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={Boolean(edit.active)}
                onChange={(event) =>
                  onChange({ ...edit, active: event.target.checked })
                }
              />{" "}
              Đang hoạt động
            </label>
            <div>
              {catalog && (
                <Button
                  type="button"
                  className="outline"
                  onClick={onClose}
                  disabled={busy}
                >
                  Huỷ
                </Button>
              )}
              <Button disabled={busy} className={catalog ? "" : "full"}>
                {busy ? "Đang lưu…" : "Lưu thay đổi"}
              </Button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
