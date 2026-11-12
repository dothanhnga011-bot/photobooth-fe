import { PiArrowRightBold } from "react-icons/pi";
import { money } from "../api";
import { layoutSlots, polaroidLayout } from "../polaroid-layouts.js";
import { useKioskText } from "./use-kiosk-text.js";

// Hình layout: thẻ Instax Wide nằm ngang, các ô ảnh đúng vị trí trên khung trắng mẫu (5 ảnh = 2 ảnh to
// bên trái + 3 ảnh bé bên phải). Dùng ở máy chụp và trong quản trị.
export function LayoutArt({ count }) {
  return (
    <span className="layout-art" aria-hidden="true">
      {layoutSlots(count).map((s, i) => (
        <i key={i} style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }} />
      ))}
    </span>
  );
}

// Thẻ layout (xem trước ở quản trị): hình layout, "N ảnh", tên layout · thời gian chụp, giá, nút mũi tên.
export function LayoutCard({ pack, onPick, as: Tag = "button" }) {
  const t = useKioskText();
  const photos = t("layout.photos", { n: pack.selectCount || 1 });
  const layout = polaroidLayout(pack.selectCount || 1);
  return (
    <Tag {...(Tag === "button" ? { type: "button", onClick: onPick } : {})} className="kiosk-layout"
      aria-label={Tag === "button" ? `${photos} · ${pack.name} · ${money(pack.price)}` : undefined}>
      <LayoutArt count={pack.selectCount} />
      <strong>{layout?.label || photos}</strong>
      <small>Chọn {pack.selectCount || 1} ảnh · {layout?.duration ?? pack.duration} phút chụp</small>
      <small>Bấm dây không giới hạn{pack.name && pack.name !== layout?.label ? ` · ${pack.name}` : ""}</small>
      <b>{money(pack.price)}</b>
      <span className="kiosk-layout-go" aria-hidden="true"><PiArrowRightBold /></span>
    </Tag>
  );
}
