import { useState } from "react";
import { Camera, RectangleHorizontal } from "lucide-react";

// Hai loại hình chụp của tiệm: phòng Photobooth (khổ nhỏ / khổ to, in máy DNP) và phòng Polaroid
// (layout trên thẻ Instax Wide). Khổ ảnh & bảng giá và Chủ đề tách theo loại để chỉnh riêng từng loại.
export const SERVICES = [
  ["photobooth", "Photobooth", "Khổ nhỏ, khổ to · in máy DNP", Camera],
  ["polaroid", "Polaroid", "Layout Instax Wide · in máy Instax Link WIDE", RectangleHorizontal],
];
// Loại hình của khung / gói theo khổ in.
export const serviceOf = (printSize) => (printSize === "instax" ? "polaroid" : "photobooth");

// Nhớ loại đang xem giữa các trang và lần mở sau (chỉ trên trình duyệt này).
const KEY = "admin-service-tab";
export function useServiceTab() {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "polaroid" ? "polaroid" : "photobooth";
    } catch {
      return "photobooth";
    }
  });
  const change = (next) => {
    setValue(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* chỉ để nhớ tab */
    }
  };
  return [value, change];
}

// counts: { photobooth, polaroid } — số mục của từng loại, hiện cạnh tên.
export function ServiceTabs({ value, onChange, counts = {} }) {
  return (
    <div className="service-tabs" role="tablist" aria-label="Loại hình chụp">
      {SERVICES.map(([key, title, note, Icon]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          className={`service-tab${value === key ? " is-active" : ""}`}
          onClick={() => onChange(key)}
        >
          <Icon size={22} aria-hidden="true" />
          <span>
            <strong>
              {title}
              {Number.isInteger(counts[key]) && <em>{counts[key]}</em>}
            </strong>
            <small>{note}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
