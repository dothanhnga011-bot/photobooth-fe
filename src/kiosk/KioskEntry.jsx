import { useEffect, useState } from "react";
import { Brand, useStudio } from "../studio";
import { useKioskText } from "./use-kiosk-text.js";

export function KioskEntry({
  roomId,
  onTap,
  children,
}) {
  const t = useKioskText();
  const { settings = {}, screens = [] } = useStudio();
  // Màn hình chờ: cấu hình riêng của máy này, không có thì cấu hình chung (Thiết lập → Màn hình chờ).
  const screen =
    screens.find((s) => s.rooms?.includes(roomId)) || screens.find((s) => s.isDefault);
  const legacy = settings.kiosk || {};
  const idle = screen
    ? { title: screen.title, subtitle: screen.subtitle, images: screen.images.map((i) => i.url), interval: screen.interval }
    : { title: legacy.idleTitle, subtitle: legacy.idleSubtitle, images: legacy.idleImage ? [legacy.idleImage] : [], interval: 6 };
  const [slide, setSlide] = useState(0);
  const slides = idle.images.length;
  useEffect(() => {
    setSlide(0);
    if (slides < 2) return;
    const timer = setInterval(() => setSlide((i) => (i + 1) % slides), Math.max(2, idle.interval || 6) * 1000);
    return () => clearInterval(timer);
  }, [slides, idle.interval]);

  const image = idle.images[slide % Math.max(1, slides)];
  const oneLineTitle = typeof idle.title === "string" && /^touch\s+to\s+start\b/i.test(idle.title.trim());
  return (
      <section className="kiosk-entry kiosk-attract">
        <button
          type="button"
          className={`kiosk-tap ${image ? "has-image" : ""}`}
          onClick={onTap}
          aria-label="Chạm để bắt đầu"
        >
          {image && (
            <span className="kiosk-polaroid" aria-hidden="true">
              <img key={image} className="kiosk-slide" src={image} alt="" />
            </span>
          )}
          <span className="kiosk-tap-copy">
            <Brand />
            <strong className={oneLineTitle ? "kiosk-tap-title-one-line" : undefined}>
              {idle.title || <>Cười lên, <mark>mình chụp nhé!</mark></>}
            </strong>
            <span className="kiosk-hand">{idle.subtitle || "chụp xong in ngay · nhận ảnh trên điện thoại"}</span>
            <span className="kiosk-sticker">{t("start.tap")}</span>
          </span>
        </button>
        <div className="kiosk-attract-settings">{children}</div>
      </section>
  );
}
