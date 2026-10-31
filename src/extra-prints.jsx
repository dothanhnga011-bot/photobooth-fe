import { useRef, useState } from "react";
import { X } from "lucide-react";
import { api, money } from "./api";
import { Button, ErrorBox, useStudio, useToast } from "./studio";
import {
  FieldError,
  custom,
  intRange,
  required,
  useValidation,
} from "./validate";

const RULES = {
  sheets: ["Số tờ in thêm", required, intRange(1, 20)],
  received: [
    "Xác nhận",
    custom((v) => v === true, "Vui lòng xác nhận đã nhận đủ tiền của khách."),
  ],
};

// Giá mỗi tờ in thêm: chỉ quản trị viên đặt/sửa, ngay tại đây (không còn trang Cài đặt studio).
// instax: giá mỗi tấm Instax Wide (phim Instax đắt hơn giấy DNP nên có giá riêng).
// price chưa có (undefined / null): tiệm chưa đặt giá. startOpen: mở sẵn ô nhập (hộp bán thêm ở quầy
// mở ngay khi chưa có giá; trang bảng giá chỉ ghi "Chưa đặt").
export function PriceEditor({ price, onSaved, instax = false, startOpen = !price }) {
  const field = instax ? "extraInstaxPrice" : "extraPrintPrice";
  const unit = instax ? "tấm" : "tờ";
  const set = price !== undefined && price !== null && price !== "";
  const toast = useToast();
  const [editing, setEditing] = useState(startOpen);
  const [value, setValue] = useState(price ? String(price) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000 || (amount > 0 && amount < 1000))
      return setError("Nhập giá từ 1.000 đ (hoặc 0 nếu tặng miễn phí) — kiểm tra có gõ thiếu số 0 không.");
    setBusy(true);
    setError("");
    try {
      await api("/admin/settings/extra-print-price", { method: "PUT", body: { [field]: amount } });
      await onSaved();
      toast.success(`Đã lưu giá in thêm${instax ? " Instax" : ""}: ${money(amount)} / ${unit}.`);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!editing)
    return (
      <p className="extra-price-line">
        Giá in thêm{instax ? " Instax" : ""}:{" "}
        {set ? <strong>{money(price)} / {unit}</strong> : <strong className="is-unset">Chưa đặt</strong>}{" "}
        <button type="button" className="link-button" onClick={() => setEditing(true)}>
          {set ? "Sửa giá" : "Đặt giá"}
        </button>
      </p>
    );
  return (
    <div className="extra-price-editor">
      <label>
        Giá mỗi {instax ? "tấm Instax" : "tờ"} in thêm (đ) — chỉ quản trị viên sửa
        <input
          name={field}
          type="number"
          min="0"
          step="1000"
          inputMode="numeric"
          placeholder="Ví dụ 20000"
          aria-invalid={Boolean(error)}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
        />
      </label>
      <div className="extra-price-buttons">
        {!startOpen && (
          <Button type="button" className="outline small" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>
            Hủy
          </Button>
        )}
        <Button type="button" className="small" disabled={busy || value === ""} onClick={save}>
          {busy ? "Đang lưu…" : "Lưu giá"}
        </Button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

// Bán thêm tờ in tại quầy (10 × 15 cm, hoặc tấm Instax với vé khổ Instax): cộng tờ vào vé.
export function ExtraPrints({ booking, onClose, onSold, canEditPrice = false }) {
  const { settings = {}, reload } = useStudio();
  const toast = useToast();
  const v = useValidation();
  const instax = booking.printSize === "instax";
  const unit = instax ? "tấm" : "tờ";
  const price = Number(instax ? settings.extraInstaxPrice : settings.extraPrintPrice) || 0;
  // Khách đã chọn thêm bản in trên kiosk: điền sẵn số tờ cần thu.
  const [form, setForm] = useState({
    sheets: String(Math.min(20, booking.requestedExtraPrints || 1)),
    paymentMethod: "cash",
  });
  const [received, setReceived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(null);
  const sheets = Number(form.sheets) || 0;
  const total = sheets * price;
  const change = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    v.clear(key);
  };
  async function sell(e) {
    e.preventDefault();
    if (busy || !v.check({ ...form, received }, RULES)) return;
    setBusy(true);
    setError("");
    try {
      // Bấm lại sau khi mất mạng dùng lại cùng mã yêu cầu: không cộng tiền 2 lần.
      const fingerprint = JSON.stringify(form);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, key: crypto.randomUUID() };
      const updated = await api(`/admin/bookings/${booking._id}/prints`, {
        method: "POST",
        body: {
          sheets,
          paymentMethod: form.paymentMethod,
          paymentReceived: true,
          expectedTotal: total,
          requestKey: request.current.key,
        },
      });
      onSold(updated, sheets);
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal counter-ticket extra-prints"
        role="dialog"
        aria-modal="true"
        aria-labelledby="extra-title"
      >
        <div className="modal-header">
          <h2 id="extra-title">
            Bán thêm tờ in
            <small className="transaction-reference">Vé #{booking.code}</small>
          </h2>
          <button
            className="icon-button"
            aria-label="Đóng"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <ErrorBox error={error} />
        <form className="transaction-form" onSubmit={sell} noValidate>
          <div className="transaction-fields">
            <p>
              Vé đang có <strong>{booking.prints ?? 1} {instax ? "tấm Instax" : "tờ in"}</strong> (khách đã
              gửi {booking.printSheets || 0} {unit}). {instax ? "Tấm" : "Tờ"} mua thêm được cộng ngay vào
              vé — khách chỉ cần bấm “Gửi in” lại trên điện thoại.
            </p>
            <div className="extra-print-fields">
              <label>
                {instax ? "Số tấm Instax in thêm" : "Số tờ in thêm (10 × 15 cm)"}
                <input
                  name="sheets"
                  type="number"
                  min="1"
                  max="20"
                  inputMode="numeric"
                  autoFocus
                  aria-invalid={Boolean(v.errors.sheets)}
                  value={form.sheets}
                  onChange={(e) => change("sheets", e.target.value)}
                />
                <FieldError error={v.errors.sheets} />
              </label>
              <label>
                Thanh toán
                <select
                  name="paymentMethod"
                  value={form.paymentMethod}
                  onChange={(e) => change("paymentMethod", e.target.value)}
                >
                  <option value="cash">Tiền mặt</option>
                  <option value="transfer">Chuyển khoản</option>
                </select>
              </label>
            </div>
            {canEditPrice ? (
              <PriceEditor key={price} price={price} instax={instax} onSaved={() => reload?.()} />
            ) : (
              !price && (
                <p className="soft-note">
                  Chưa có giá in thêm (đang tính 0 đ/{unit}). Nhờ quản trị viên đặt giá trước khi thu tiền.
                </p>
              )
            )}
          </div>
          <div className="transaction-confirmation">
            <div className="summary-total">
              <span>
                Tiền cần thu
                {price > 0 && <small>{money(price)} / {unit}</small>}
              </span>
              <strong>{money(total)}</strong>
            </div>
            <label className="checkbox">
              <input
                name="received"
                type="checkbox"
                aria-invalid={Boolean(v.errors.received)}
                checked={received}
                onChange={(e) => {
                  setReceived(e.target.checked);
                  v.clear("received");
                }}
              />
              <span>Tôi đã nhận đủ tiền mặt hoặc kiểm tra chuyển khoản.</span>
            </label>
            <FieldError error={v.errors.received} />
            <Button className="full" disabled={busy}>
              {busy ? "Đang lưu…" : `Xác nhận & cộng ${sheets || ""} ${unit} vào vé`}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
