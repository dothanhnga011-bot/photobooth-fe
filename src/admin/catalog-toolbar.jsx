import { Package, Plus, Search, X } from "lucide-react";
import { Button } from "../studio";

// Chữ theo loại hình đang xem: phòng Photobooth bán gói khổ nhỏ / khổ to, phòng Polaroid bán layout.
const TEXTS = {
  photobooth: {
    noun: "gói chụp",
    title: "Khổ ảnh & gói chụp phòng Photobooth",
    note: "Mỗi gói đang bán là một thẻ ở màn “Chọn khổ ảnh”: sửa khổ, giá, số lần chụp, số tờ in hoặc thêm gói mới.",
    add: "Thêm gói chụp",
    search: "Tìm tên gói, mô tả…",
  },
  polaroid: {
    noun: "layout",
    title: "Layout phòng Polaroid",
    note: "Mỗi layout đang bán là một thẻ ở màn “Chọn layout”: số ảnh trên thẻ Instax Wide, giá, số lần chụp tối đa.",
    add: "Thêm layout",
    search: "Tìm tên layout, mô tả…",
  },
};

// actions: nút thêm của từng loại (vd. "Tạo 6 layout mẫu" ở tab Polaroid).
export function CatalogToolbar({
  service = "photobooth",
  items,
  visibleCount,
  query,
  onQueryChange,
  status,
  onStatusChange,
  onCreate,
  actions = null,
  loading,
}) {
  const text = TEXTS[service] || TEXTS.photobooth;
  const active = items.filter((item) => item.active).length;
  return (
    <section className="catalog-toolbar" aria-label={`Quản lý ${text.noun}`}>
      <div className="catalog-intro">
        <span className="catalog-intro-icon">
          <Package size={24} aria-hidden="true" />
        </span>
        <div className="catalog-intro-copy">
          <h3>{text.title}</h3>
          <p>{text.note}</p>
        </div>
        <div className="inline-actions">
          {actions}
          <Button onClick={onCreate}>
            <Plus size={17} aria-hidden="true" />
            {text.add}
          </Button>
        </div>
      </div>
      <div className="catalog-controls">
        <div className="catalog-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label={`Tìm ${text.noun}`}
            placeholder={text.search}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="Xoá tìm kiếm"
              onClick={() => onQueryChange("")}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <select
          aria-label="Lọc trạng thái"
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="active">Đang hoạt động</option>
          <option value="inactive">Đã tắt</option>
        </select>
      </div>
      <div className="catalog-results" aria-live="polite">
        <span>
          {loading
            ? "Đang tải danh mục…"
            : `${visibleCount} / ${items.length} ${text.noun}`}
        </span>
        {!loading && (
          <div className="catalog-counts">
            <span>
              <i />
              {active} đang hoạt động
            </span>
            <span>{items.length - active} đã tắt</span>
          </div>
        )}
      </div>
    </section>
  );
}
