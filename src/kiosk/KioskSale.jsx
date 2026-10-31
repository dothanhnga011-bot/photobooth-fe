import { useEffect, useRef, useState } from "react";
import {
  PiArrowLeftBold,
  PiArrowRightBold,
  PiBackspaceBold,
  PiMoneyWavyDuotone,
  PiMinusBold,
  PiPlusBold,
  PiTicketBold,
  PiTicketDuotone,
  PiWarningCircleBold,
} from "react-icons/pi";
import { money } from "../api";
import { Brand, Button, ErrorBox } from "../studio";
import { billAcceptor } from "./bill-acceptor.js";
import { useKioskText } from "./use-kiosk-text.js";
import {
  extraSheets,
  includedSheets,
  isInstax,
  isStrip,
  MIN_PIECES,
  minSheets,
  pieceUnit,
  piecesLabel,
  piecesPerSheet,
  printSizeOf,
  saleTotal,
} from "./print-count.js";

const IDLE_SECONDS = 120;
const SIM_BILLS = [10000, 20000, 50000, 100000];
const FOLDER_NOTE = "Máy chụp chưa đọc được thư mục ảnh của máy ảnh — nhờ nhân viên mở “Cài đặt máy chụp” để chọn / cho phép thư mục.";

// Phòng photobooth: Chạm để bắt đầu → chọn cách thanh toán. Nhập mã: khách đã chuyển khoản ở quầy,
// nhập mã rồi vào chụp luôn. Tiền mặt: chọn loại tờ → số lượng → đút tiền → vào chụp.
export function KioskPayChoice({ onCode, onCash, onBack }) {
  const t = useKioskText();
  return (
    <section className="kiosk-flow method-screen">
      <header className="flow-head">
        <Brand />
        <h1>{t("method.title")}</h1>
        <p>{t("method.subtitle")}</p>
      </header>
      <div className="kiosk-method-grid" role="group" aria-label={t("method.title")}>
        <button type="button" className="kiosk-method is-code" onClick={onCode}>
          <PiTicketDuotone aria-hidden="true" />
          <strong>{t("method.code")}</strong>
          <small>{t("method.codeHint")}</small>
        </button>
        <button type="button" className="kiosk-method is-cash" onClick={onCash}>
          <PiMoneyWavyDuotone aria-hidden="true" />
          <strong>{t("method.cash")}</strong>
          <small>{t("method.cashHint")}</small>
        </button>
      </div>
      <footer className="flow-foot">
        <Button className="outline" onClick={onBack}>
          <PiArrowLeftBold aria-hidden="true" /> Quay lại
        </Button>
      </footer>
    </section>
  );
}

// Mã chụp nhân viên tạo ở quầy sau khi khách chuyển khoản: mã đã gồm gói, khổ ảnh và số bản in.
export function KioskCode({ code, setCode, onSubmit, onBack, busy, error, device, cameraReady }) {
  const t = useKioskText();
  return (
    <section className="kiosk-flow code-screen">
      <header className="flow-head">
        <Brand />
        <h1>{t("code.title")}</h1>
        <p>{t("code.subtitle")}</p>
      </header>
      <ErrorBox error={error} />
      {!device && (
        <p className="soft-note">Máy chụp chưa được gán phòng. Mở liên kết Cài máy chụp trong Quản trị → Quản lý máy.</p>
      )}
      {!cameraReady && <p className="soft-note">{FOLDER_NOTE}</p>}
      <form className="payment-voucher code-card" onSubmit={onSubmit}>
        <label htmlFor="kiosk-code">Mã chụp</label>
        <input id="kiosk-code" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
          autoComplete="one-time-code" placeholder="••••••" value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        <div className="voucher-keypad" aria-label="Bàn phím nhập mã">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((key) =>
            <button type="button" key={key} aria-label={key === "clear" ? "Xóa hết mã" : key === "back" ? "Xóa một số" : key}
              onClick={() => setCode((value) => key === "clear" ? "" : key === "back" ? value.slice(0, -1) : (value + key).slice(0, 6))}>
              {key === "clear" ? "Xóa" : key === "back" ? <PiBackspaceBold /> : key}
            </button>
          )}
        </div>
        <Button type="submit" disabled={busy || !device || !cameraReady || code.length !== 6}>
          {busy ? "Đang kiểm tra…" : t("code.submit")} <PiArrowRightBold aria-hidden="true" />
        </Button>
      </form>
      <footer className="flow-foot">
        <Button className="outline" disabled={busy} onClick={onBack}>
          <PiArrowLeftBold aria-hidden="true" /> Quay lại
        </Button>
      </footer>
    </section>
  );
}

// Chọn khổ ảnh từ những gói thật trong Bảng giá, giữ đúng giá đã cấu hình. Khách đã chuyển khoản
// ở quầy vẫn nhập được mã (nút phụ), ví dụ khi máy đọc tiền đang hỏng. Khổ Instax khóa khi máy
// Instax chưa sẵn sàng (instax: tình trạng máy in máy chủ báo về).
export function KioskPackages({ packages, instax, onPick, onCode, onBack }) {
  const t = useKioskText();
  const [selectedId, setSelectedId] = useState("");
  const blocked = (pack) => isInstax(pack) && !instax?.ready;
  const selected = packages.find((pack) => pack._id === selectedId && !blocked(pack));
  return (
    <section className="kiosk-flow package-screen size-screen">
      <header className="flow-head">
        <Brand />
        <h1>{t("package.title")}</h1>
        <p>{t("package.subtitle")}</p>
      </header>
      <div className="kiosk-size-grid" role="group" aria-label="Chọn khổ ảnh và gói chụp">
        {packages.map((pack) => (
          <button
            type="button"
            key={pack._id}
            className={`kiosk-size ${printSizeOf(pack)} ${selectedId === pack._id ? "active" : ""}`}
            aria-pressed={selectedId === pack._id}
            disabled={blocked(pack)}
            onClick={() => setSelectedId(pack._id)}
          >
            <span className="kiosk-size-art" aria-hidden="true">{isInstax(pack) ? <i /> : <><i /><i /></>}</span>
            <strong>{pack.name}</strong>
            <small>{pack.shots} lần chụp · kèm {piecesLabel(pack, includedSheets(pack))}</small>
            <b>{money(pack.price)}</b>
            {pack.description && <small>{pack.description}</small>}
            {blocked(pack) && (
              <em className="kiosk-size-off">
                {(instax?.message || "Máy in Instax chưa sẵn sàng").replace(/\.$/, "")} — nhờ nhân viên hỗ trợ.
              </em>
            )}
          </button>
        ))}
        {!packages.length && <p className="soft-note">Chưa có gói chụp cho máy này. Nhờ nhân viên kiểm tra mục Khổ ảnh & bảng giá.</p>}
      </div>
      <footer className="flow-foot kiosk-step-nav">
        <Button className="outline" onClick={onBack}>
          <PiArrowLeftBold aria-hidden="true" /> Quay lại
        </Button>
        {onCode && (
          <Button className="outline" onClick={onCode}>
            <PiTicketBold aria-hidden="true" /> Đã có mã chụp
          </Button>
        )}
        <Button disabled={!selected} onClick={() => onPick(selected)}>
          Tiếp tục <PiArrowRightBold aria-hidden="true" />
        </Button>
      </footer>
    </section>
  );
}

// Khách đếm theo tờ cầm trên tay (khổ nhỏ: 1 tờ 10 × 15 cắt đôi = 2 tờ nhỏ; Instax: mỗi tấm một
// thẻ), tối thiểu 2. Giá gói đã gồm số tờ của gói; chỉ tờ in thêm mới cộng vào tổng tiền.
// film: số tấm phim máy Instax còn — không bán quá số phim.
const PRINT_NOTES = {
  strip: "ảnh nhỏ: 1 tờ 10 × 15 cm cắt đôi thành 2 tờ",
  full: "ảnh lớn 10 × 15 cm nguyên tờ",
  instax: "ảnh Instax Wide (thẻ 8,6 × 10,8 cm) in ngay ở máy cạnh bạn",
};
export function KioskPrintCount({ pack, sheets, extraPrintPrice, film = null, onChange, onNext, onBack }) {
  const t = useKioskText();
  const strip = isStrip(pack);
  const perSheet = piecesPerSheet(pack);
  const least = minSheets(pack);
  const extra = extraSheets(pack, sheets);
  const canAdd = Number.isFinite(extraPrintPrice) && extraPrintPrice >= 0;
  const unit = pieceUnit(pack);
  const word = isInstax(pack) ? "tấm" : "tờ";
  const outOfFilm = isInstax(pack) && Number.isInteger(film) && sheets >= film;
  return (
    <section className="kiosk-flow print-screen">
      <header className="flow-head">
        <Brand />
        <h1>{t("print.title")}</h1>
        <p>
          {pack.name} · {PRINT_NOTES[printSizeOf(pack)]}
        </p>
      </header>
      <div className="print-choice">
        <div className="kiosk-counter" role="group" aria-label="Số bản in">
          <button type="button" aria-label="Giảm số bản in" disabled={sheets <= least} onClick={() => onChange(sheets - 1)}><PiMinusBold /></button>
          <output aria-live="polite">{sheets * perSheet}</output>
          <button type="button" aria-label="Tăng số bản in" disabled={!canAdd || extra >= 20 || outOfFilm} onClick={() => onChange(sheets + 1)}><PiPlusBold /></button>
        </div>
        <p className="print-unit">
          {unit} · mỗi người một {word}: đi {MIN_PIECES} người chọn {MIN_PIECES} {word}
          {strip && <small>{sheets} tờ 10 × 15 cm cắt đôi · mỗi lần bấm + thêm 2 tờ nhỏ</small>}
          {outOfFilm && <small>Máy Instax còn {film} tấm phim — chọn tối đa {film} tấm.</small>}
        </p>
        <div className="kiosk-price">
          <span>Tổng tiền</span>
          <strong>{money(saleTotal(pack, sheets, extraPrintPrice))}</strong>
          <small>
            {extra
              ? `${money(pack.price)} tiền gói + ${extra * perSheet} ${unit} in thêm (${money(extra * (Number(extraPrintPrice) || 0))})`
              : `Đã gồm ${piecesLabel(pack, sheets)} trong gói`}
          </small>
          {includedSheets(pack) < least && <small>In tối thiểu {MIN_PIECES} {word} — gói này kèm {piecesLabel(pack, includedSheets(pack))}.</small>}
          {!canAdd && <small>Nhân viên cần đặt “Giá in thêm” trong quản trị để khách chọn thêm bản in.</small>}
        </div>
      </div>
      <footer className="flow-foot kiosk-step-nav">
        <Button className="outline" onClick={onBack}><PiArrowLeftBold aria-hidden="true" /> Quay lại</Button>
        <Button onClick={onNext}>{t("print.next")} <PiArrowRightBold aria-hidden="true" /></Button>
      </footer>
    </section>
  );
}

// Màn đọc tiền: máy nhận tiền chỉ nhận tờ tiền ở màn này, mỗi tờ được cộng ngay trên màn hình.
// Đủ tiền thì tự mở lượt chụp. Chế độ thử (chưa lắp máy nhận tiền) có nút bỏ qua và các nút giả
// lập đút tiền — lượt thử không tính tiền.
export function KioskPayment({ pack, total, sheets, bills, onBill, onPaid, onSkip, onBack, onIdle, testMode, busy, error, cameraReady, cashReady }) {
  const t = useKioskText();
  const [status, setStatus] = useState(billAcceptor.status);
  const [idle, setIdle] = useState(IDLE_SECONDS);
  const [simulated, setSimulated] = useState(0);
  const received = bills.reduce((sum, bill) => sum + bill.amount, 0) + simulated;
  const remaining = Math.max(0, total - received);
  const paidOnce = useRef(false);
  useEffect(() => billAcceptor.onStatus(setStatus), []);
  // Máy nhận tiền chỉ mở nhận tiền khi đang ở màn này.
  useEffect(() => {
    let active = true;
    billAcceptor.accepting = () => cashReady && billAcceptor.connected && cameraReady && !paidOnce.current;
    billAcceptor.connect(false).then(
      (connected) => {
        if (active) billAcceptor.setEnabled(cashReady && Boolean(connected) && cameraReady && !paidOnce.current).catch(() => {});
      },
      () => { if (active) billAcceptor.setEnabled(false).catch(() => {}); },
    );
    const off = billAcceptor.onBill((amount) => {
      setIdle(IDLE_SECONDS);
      onBill(amount);
    });
    return () => {
      active = false;
      off();
      billAcceptor.accepting = () => billAcceptor.enabled;
      billAcceptor.setEnabled(false).catch(() => {});
    };
  }, [cameraReady, cashReady]);
  useEffect(() => {
    if (!cameraReady || !total || received < total || paidOnce.current) return;
    paidOnce.current = true;
    billAcceptor.setEnabled(false).catch(() => {});
    if (simulated) onSkip();
    else onPaid();
  }, [received, cameraReady]);
  // Không ai thao tác: chưa đút tiền thì về màn chờ; đã đút tiền thì giữ lại (gọi nhân viên).
  useEffect(() => {
    const timer = setInterval(() => setIdle((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!idle && !bills.length && !busy) onIdle();
  }, [idle]);
  return (
    <section className="kiosk-flow pay-screen">
      <header className="flow-head">
        <h1>{t("pay.title")}</h1>
        <p>{pack.name} · {piecesLabel(pack, sheets)} · đưa tờ tiền thẳng, không gấp</p>
      </header>
      <ErrorBox error={error} />
      {!cameraReady && <p className="soft-note">{FOLDER_NOTE} Máy nhận tiền đang khóa.</p>}
      <div className="pay-board">
        <div>
          <span>Tổng tiền</span>
          <strong>{money(total)}</strong>
        </div>
        <div>
          <span>Đã nhận{bills.length ? ` · ${bills.length} tờ tiền` : ""}</span>
          <strong className="pay-received">{money(received)}</strong>
        </div>
        <div className={remaining ? "pay-due" : "pay-done"}>
          <span>{remaining ? "Còn thiếu" : "Đã đủ tiền"}</span>
          <strong>{remaining ? money(remaining) : "✓"}</strong>
        </div>
      </div>
      <div className="pay-machine">
        <PiMoneyWavyDuotone aria-hidden="true" />
        <p>
          {busy
            ? "Đã đủ tiền — đang mở lượt chụp…"
            : received > total
              ? `Bạn đã đút dư ${money(received - total)} — máy không trả tiền thừa, nhờ nhân viên hỗ trợ nhé.`
              : "Máy nhận tiền ở phía dưới màn hình. Máy nhận các tờ 10.000 – 500.000 đ."}
        </p>
        <small className={billAcceptor.connected ? "" : "is-warn"}>{status}</small>
      </div>
      {received >= total && error && !busy && (
        <Button className="kiosk-next" onClick={simulated ? onSkip : onPaid}>
          Thử mở lượt chụp lại <PiArrowRightBold aria-hidden="true" />
        </Button>
      )}
      {testMode && (
        <div className="pay-test" aria-label="Chế độ thử">
          <span>
            <PiWarningCircleBold aria-hidden="true" /> Chế độ thử — chưa lắp máy nhận tiền. Lượt thử không tính doanh thu.
          </span>
          <div>
            {SIM_BILLS.map((amount) => (
              <Button key={amount} className="outline small" disabled={busy}
                onClick={() => setSimulated((n) => n + amount)}>
                + {money(amount)}
              </Button>
            ))}
          </div>
        </div>
      )}
      <footer className="flow-foot">
        <Button className="outline" disabled={busy || bills.length > 0} onClick={onBack}>
          <PiArrowLeftBold aria-hidden="true" /> {bills.length ? `Đã nhận tiền (${idle}s)` : `Quay lại (${idle}s)`}
        </Button>
        {testMode && (
          <Button className="kiosk-next" disabled={busy} onClick={onSkip}>
            Tiếp — bỏ qua đút tiền (thử) <PiArrowRightBold aria-hidden="true" />
          </Button>
        )}
      </footer>
    </section>
  );
}
