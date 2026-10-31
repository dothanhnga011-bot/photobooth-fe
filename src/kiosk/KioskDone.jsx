import {
  PiFilmStripDuotone,
  PiPrinterDuotone,
  PiWarningCircleDuotone,
} from "react-icons/pi";
import { QRCodeSVG } from "qrcode.react";
import { Brand, Button } from "../studio";
import { useKioskText } from "./use-kiosk-text.js";

const PRINT_TEXT = {
  sending: "Đang gửi ảnh tới máy in…",
  waiting: "Đang chờ tải ảnh lên để in…",
  sent: "Đang chờ máy in nhận lệnh…",
  stalled: "Máy in chưa nhận lệnh — nhờ nhân viên kiểm tra giúp bạn",
  printing: "Máy in đang in — lấy ảnh tại khay ảnh",
  printed: "Ảnh đang được in — lấy ảnh tại khay ảnh",
  manual: "Nhờ nhân viên in ảnh giúp bạn",
  failed: "Chưa in được — nhờ nhân viên in lại giúp bạn",
};
// Khổ Instax: máy Instax Link WIDE đặt cạnh máy chụp, ảnh ra ngay tại đó.
const INSTAX_TEXT = {
  sent: "Đang chờ máy Instax nhận lệnh…",
  stalled: "Máy Instax chưa nhận lệnh — nhờ nhân viên kiểm tra giúp bạn",
  printing: "Máy Instax cạnh bạn đang in — mỗi tấm khoảng 15 giây",
  printed: "Lấy ảnh ở máy Instax cạnh bạn — ảnh hiện màu dần sau ít phút",
};
const PRINT_WARN = new Set(["stalled", "manual", "failed"]);

// Màn cuối: ảnh đã ghép khung (trái), mã QR tải ảnh & video (giữa), video tua nhanh (phải). Phòng
// Polaroid (khổ Instax) không quay video: chỉ ảnh đã ghép và mã QR tải toàn bộ ảnh gốc.
export function KioskDone({ done, pending, left, nextGuest }) {
  const t = useKioskText();
  const print = done.print?.status;
  const framed = done.framed !== false;
  const instax = done.printSize === "instax";
  return (
    <section className="kiosk-flow done-screen">
      <header className="flow-head">
        <Brand />
      </header>
      <div className={`done-cards${instax ? " no-video" : ""}`}>
        <figure className="done-card">
          {done.composite ? (
            <img src={done.composite} alt={framed ? "Ảnh đã ghép khung" : "Ảnh của bạn"} />
          ) : (
            <div className="done-empty">Ảnh của bạn</div>
          )}
          <figcaption>{framed ? "Ảnh đã ghép" : "Ảnh của bạn"}</figcaption>
        </figure>
        <figure className="done-card done-qr">
          <QRCodeSVG value={done.url} size={260} marginSize={2} />
          <figcaption>Quét QR</figcaption>
        </figure>
        {!instax && <figure className="done-card">
          {done.video ? (
            <video src={done.video} autoPlay loop muted playsInline />
          ) : (
            <div className="done-empty">
              <PiFilmStripDuotone aria-hidden="true" />
              {done.videoPending ? "Đang làm video…" : "Chưa có video"}
            </div>
          )}
          <figcaption>Video</figcaption>
        </figure>}
      </div>
      {/* Chỉ hứa "lấy ảnh" khi ảnh đang in; in trục trặc thì dòng trạng thái bên dưới mời nhân viên giúp. */}
      <h1 className="done-title">
        {t(instax ? "done.polaroidTitle" : "done.title")}
        {done.prints > 0 && framed && !PRINT_WARN.has(print) &&
          (instax ? " Lấy ảnh ở máy Instax cạnh bạn." : " Lấy ảnh tại khay ảnh.")}
      </h1>
      <p className={`done-print ${PRINT_WARN.has(print) ? "is-warn" : ""}`} role="status">
        {PRINT_WARN.has(print) ? <PiWarningCircleDuotone aria-hidden="true" /> : <PiPrinterDuotone aria-hidden="true" />}
        {!done.prints
          ? "Gói của bạn không kèm tờ in — tải ảnh bằng mã QR."
          : framed
            ? (instax && INSTAX_TEXT[print]) || PRINT_TEXT[print] || PRINT_TEXT.sending
            : "Chưa có khung ảnh để in — nhờ nhân viên in giúp bạn."}
        {" · "}Vé {done.code} · ảnh lưu 24 giờ
      </p>
      {pending > 0 && <p className="done-sync">Đang tải {pending} ảnh gốc lên album — vui lòng giữ nguyên màn hình…</p>}
      <footer className="flow-foot">
        <Button className="kiosk-next" onClick={nextGuest}>Khách tiếp theo ({left}s)</Button>
      </footer>
    </section>
  );
}
