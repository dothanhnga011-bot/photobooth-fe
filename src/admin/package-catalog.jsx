import {
  Camera,
  Clock3,
  Images,
  Pencil,
  Plus,
  Power,
  Printer,
} from "lucide-react";
import { money } from "../api";
import { LayoutArt } from "../kiosk/KioskPolaroid.jsx";
import { includedSheets, INSTAX_SHEETS, isInstax, isStrip, piecesLabel, printSizeOf } from "../kiosk/print-count.js";

// Khổ ảnh khách thấy ở màn “Chọn khổ ảnh” (phòng Photobooth) / “Chọn layout” (phòng Polaroid) của
// máy chụp; mỗi gói đang bật là một thẻ.
// [khổ, tên nhóm, tên ngắn trong nút / lời nhắn, mô tả]
const SIZE_GROUPS = [
  ["strip", "Khổ nhỏ", "gói khổ nhỏ", "1 tờ 10 × 15 cm cắt đôi thành 2 tờ nhỏ (5 × 15 cm) · khách in tối thiểu 2 tờ nhỏ"],
  ["full", "Khổ to", "gói khổ to", "Ảnh 10 × 15 cm nguyên tờ · khách in tối thiểu 2 tờ"],
  ["instax", "Layout Polaroid", "layout", "Phòng Polaroid: mỗi layout là số ảnh ghép trên thẻ Instax Wide (ảnh ngang, in ở máy Instax Link WIDE). Khách chọn layout, bấm dây chụp, trả tiền ở quầy"],
];
const ART = { strip: 2, full: 2, instax: 1 };

// sizes: các khổ của loại hình đang xem (Photobooth: khổ nhỏ + khổ to; Polaroid: layout Instax).
export function PackageCatalog({
  items,
  onEdit,
  onDeactivate,
  onCreate,
  filtered = false,
  sizes = SIZE_GROUPS.map(([size]) => size),
}) {
  if (!items.length && filtered) {
    return (
      <div className="package-catalog-empty" role="status">
        <span className="package-empty-icon" aria-hidden="true">
          <Camera size={28} strokeWidth={1.5} />
        </span>
        <h3>Không tìm thấy gói chụp</h3>
        <p>Thử tên khác hoặc đổi bộ lọc trạng thái.</p>
      </div>
    );
  }

  const groups = SIZE_GROUPS.filter(([size]) => sizes.includes(size));
  return (
    <div className={`package-size-groups${groups.length === 1 ? " is-single" : ""}`}>
      {groups.map(([size, title, short, note]) => {
        const group = items.filter((item) => printSizeOf(item) === size);
        if (!group.length && filtered) return null;
        const active = group.filter((item) => item.active).length;
        return (
          <section key={size} className="package-size-group" aria-label={title}>
            <header className="package-size-head">
              <span className={`package-size-art is-${size}`} aria-hidden="true">
                {Array.from({ length: ART[size] }, (_, i) => <i key={i} />)}
              </span>
              <div>
                <h3>
                  {title} <small>{active} {size === "instax" ? "layout" : "gói"} đang bán</small>
                </h3>
                <p>{note}</p>
              </div>
              {onCreate && (
                <button
                  type="button"
                  className="package-card-action package-size-add"
                  onClick={() => onCreate(size)}
                >
                  <Plus size={16} aria-hidden="true" />
                  Thêm {short}
                </button>
              )}
            </header>
            {group.length ? (
              <PackageCards items={group} onEdit={onEdit} onDeactivate={onDeactivate} />
            ) : (
              <p className="package-size-empty">
                {size === "instax"
                  ? "Chưa có layout Polaroid — bấm “Tạo 6 layout mẫu” ở trên hoặc “Thêm layout”. Phòng Polaroid hiện các layout đang bán ở màn Chọn layout."
                  : `Chưa có ${short} — máy chụp chỉ hiện khổ ảnh có gói đang bán.`}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PackageCards({ items, onEdit, onDeactivate }) {
  return (
    <ul className="package-catalog-grid" aria-label="Danh sách gói chụp">
      {items.map((item) => (
        <li key={item._id} className="package-catalog-item">
          <article
            className={`package-card${item.active ? "" : " is-inactive"}`}
          >
            <div className="package-card-heading">
              <div className="package-card-topline">
                {isInstax(item) ? (
                  <span className="package-card-layout">
                    <LayoutArt count={item.selectCount} />
                  </span>
                ) : (
                  <span className="package-card-icon" aria-hidden="true">
                    <Camera size={23} strokeWidth={1.6} />
                  </span>
                )}
                <span
                  className={`package-card-status ${item.active ? "is-active" : "is-inactive"}`}
                >
                  <span aria-hidden="true" />
                  {item.active ? "Đang hoạt động" : "Đã tắt"}
                </span>
              </div>
              <h3 className="package-card-name">{item.name || item.code}</h3>
              {item.description && (
                <p className="package-card-description">{item.description}</p>
              )}
            </div>

            <div className="package-card-price">
              <span>{isInstax(item) ? "Giá layout" : "Giá gói"}</span>
              <strong>{money(item.price)}</strong>
            </div>

            <dl className="package-card-details">
              <div>
                <dt>
                  <Clock3 size={17} aria-hidden="true" />
                  Thời gian chụp
                </dt>
                <dd>
                  <strong>{item.duration ?? "—"}</strong> phút
                </dd>
              </div>
              <div>
                <dt>
                  <Printer size={17} aria-hidden="true" />
                  {isInstax(item) ? "Tấm Instax Wide" : "Tờ in 10 × 15"}
                </dt>
                <dd>
                  <strong>{isInstax(item) ? INSTAX_SHEETS : item.prints ?? 0}</strong> {isInstax(item) ? "tấm" : "tờ"}
                  {isStrip(item) && <small> = {piecesLabel(item, includedSheets(item))}</small>}
                </dd>
              </div>
            </dl>

            <p className="package-card-included">
              <Images size={17} aria-hidden="true" />
              {isInstax(item)
                ? `Layout ${item.selectCount || 1} ảnh · chụp không giới hạn · Instax Wide`
                : `${item.shots || 12} lần chụp · chọn ${item.selectCount || 4} ảnh · ${isStrip(item) ? "khổ nhỏ (cắt đôi)" : "khổ to 10 × 15"}`}
            </p>
            <p className="package-card-branches">
              {item.branches?.length ? `Cấu hình riêng: ${item.branches.join(", ")}` : "Cấu hình chung · mọi chi nhánh"}
            </p>

            <div className="package-card-actions">
              <button
                type="button"
                className="package-card-action package-card-edit"
                onClick={() => onEdit(item)}
                aria-label={`Chỉnh sửa ${item.name || item.code}`}
                title={`Chỉnh sửa ${isInstax(item) ? "layout" : "gói"} ${item.name || item.code}`}
              >
                <Pencil size={16} aria-hidden="true" />
                Chỉnh sửa
              </button>
              {item.active && (
                <button
                  type="button"
                  className="package-card-action package-card-deactivate"
                  onClick={() => onDeactivate(item)}
                  aria-label={`Ngừng sử dụng ${item.name || item.code}`}
                  title={`Ngừng sử dụng ${isInstax(item) ? "layout" : "gói"} ${item.name || item.code}`}
                >
                  <Power size={16} aria-hidden="true" />
                  Ngừng
                </button>
              )}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
