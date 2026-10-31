import { useState } from "react";
import { PiArrowLeftBold, PiArrowRightBold, PiCameraBold } from "react-icons/pi";
import { money } from "../api";
import { layoutSlots } from "../polaroid-layouts.js";
import { Brand, Button, ErrorBox } from "../studio";
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

// Một thẻ ở màn Chọn layout: hình layout, "N ảnh", tên layout · số lần chụp, giá, nút mũi tên.
export function LayoutCard({ pack, onPick, as: Tag = "button" }) {
  const t = useKioskText();
  const photos = t("layout.photos", { n: pack.selectCount || 1 });
  return (
    <Tag {...(Tag === "button" ? { type: "button", onClick: onPick } : {})} className="kiosk-layout"
      aria-label={Tag === "button" ? `${photos} · ${pack.name} · ${money(pack.price)}` : undefined}>
      <LayoutArt count={pack.selectCount} />
      <strong>{photos}</strong>
      <small>{[pack.name, pack.shots && `${pack.shots} lần chụp`].filter(Boolean).join(" · ")}</small>
      <b>{money(pack.price)}</b>
      <span className="kiosk-layout-go" aria-hidden="true"><PiArrowRightBold /></span>
    </Tag>
  );
}

// Phòng Polaroid: Chạm để bắt đầu → chọn layout (các gói khổ Instax: số ảnh, giá) → thông báo "Chọn
// layout này, vào chụp nha!" → vào chụp (bấm dây); khách trả tiền ở quầy. Chữ trên màn sửa ở quản trị.
// instax: tình trạng máy in Instax (chưa sẵn sàng vẫn cho chụp — lệnh in chờ tới khi máy in kết nối).
export function KioskLayouts({ layouts, instax, busy, error, onStart, onBack }) {
  const t = useKioskText();
  const [chosen, setChosen] = useState(null);
  return (
    <section className="kiosk-flow layout-screen">
      <header className="flow-head">
        <Brand />
        <h1>{t("layout.title")}</h1>
        <p>{t("layout.subtitle")}</p>
      </header>
      <ErrorBox error={error} />
      <div className="kiosk-layout-grid" role="group" aria-label={t("layout.title")}>
        {layouts.map((pack) => <LayoutCard key={pack._id} pack={pack} onPick={() => setChosen(pack)} />)}
        {!layouts.length && (
          <p className="soft-note">Chưa có layout cho phòng Polaroid. Nhờ nhân viên thêm layout ở Khổ ảnh & bảng giá → Polaroid.</p>
        )}
      </div>
      {instax && !instax.ready && (
        <p className="soft-note layout-printer-note">
          {(instax.message || "Máy in Instax chưa sẵn sàng").replace(/\.$/, "")} — ảnh sẽ in khi máy in sẵn sàng.
        </p>
      )}
      <footer className="flow-foot">
        <Button className="outline" disabled={busy} onClick={onBack}>
          <PiArrowLeftBold aria-hidden="true" /> Quay lại
        </Button>
      </footer>
      {chosen && (
        <div className="layout-confirm" role="dialog" aria-modal="true" aria-labelledby="layout-confirm-title">
          <div className="layout-confirm-card">
            <LayoutArt count={chosen.selectCount} />
            <h2 id="layout-confirm-title">{t("layout.confirm")}</h2>
            <p>
              {t("layout.photos", { n: chosen.selectCount || 1 })} · {chosen.name} · <b>{money(chosen.price)}</b>
            </p>
            <div className="layout-confirm-actions">
              <Button className="outline" disabled={busy} onClick={() => setChosen(null)}>
                {t("layout.back")}
              </Button>
              <Button disabled={busy} onClick={() => onStart(chosen)}>
                <PiCameraBold aria-hidden="true" /> {busy ? "Đang mở…" : t("layout.go")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
