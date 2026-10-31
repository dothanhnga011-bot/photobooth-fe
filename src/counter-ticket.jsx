import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { api, money } from "./api";
import { includedSheets, isStrip, piecesLabel } from "./kiosk/print-count.js";
import { Button, ErrorBox, useStudio, useToast } from "./studio";
import {
  FieldError,
  chosen,
  maxLength,
  phoneVN,
  required,
  useValidation,
} from "./validate";

const RULES = {
  package: ["Gói chụp", chosen],
  branch: ["Chi nhánh", chosen],
  // Bắt buộc: tên và số điện thoại để tra cứu lại album của khách.
  name: ["Tên khách", required, maxLength(100)],
  phone: ["Số điện thoại khách", required, phoneVN],
};

// Số tờ khách nhận: "2 tờ nhỏ (1 tờ 10 × 15 cắt đôi)" / "2 tờ 10 × 15 cm" / "2 tấm Instax".
const printsText = (pack) => {
  const sheets = includedSheets(pack);
  const pieces = piecesLabel(pack, sheets);
  if (isStrip(pack)) return `${pieces} (${sheets} tờ 10 × 15 cắt đôi)`;
  return pack.printSize === "instax" ? pieces : `${pieces} 10 × 15 cm`;
};

export function CounterTicket({ onClose, onCreated, initialDraft = null, assignedBranch = "" }) {
  const { packages = [], rooms = [], settings = {} } = useStudio();
  const branches = [...new Set(rooms.map((r) => r.branch).filter(Boolean))]
    .filter((name) => !assignedBranch || name === assignedBranch);
  const [form, setForm] = useState({
    package: packages[0]?._id || "",
    branch: initialDraft?.branch || assignedBranch || branches[0] || "",
    name: "",
    phone: "",
    // Khách mua mã ở quầy thường chuyển khoản (trả tiền mặt thì đút vào máy ở phòng đút tiền):
    // tiệm đã nhập tài khoản / QR ngân hàng thì mặc định chuyển khoản, QR hiện ngay.
    paymentMethod: settings.bankAccount || settings.bankQrImage ? "transfer" : "cash",
  });
  const [ticket, setTicket] = useState(initialDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [quote, setQuote] = useState(null);
  const [received, setReceived] = useState(false);
  const toast = useToast();
  const v = useValidation();
  const quoteKey = form.package;
  useEffect(() => {
    if (!form.package) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api("/admin/tickets/quote", {
        method: "POST",
        body: { package: form.package },
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted)
            setQuote({ ...result, key: quoteKey });
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setQuote({ error: e.message, key: quoteKey });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.package, quoteKey]);
  const request = useRef(null);
  const lock = useRef(false);
  const pack = packages.find((p) => p._id === form.package);
  const change = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    v.clear(key);
  };
  async function create(e) {
    e.preventDefault();
    if (lock.current) return;
    if (!v.check(form, RULES)) return;
    if (quote?.key !== quoteKey || quote.error)
      return toast.warning(
        quote?.error || "Đang tính tiền, vui lòng đợi một chút.",
      );
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const fingerprint = JSON.stringify(form);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, key: crypto.randomUUID() };
      const result = await api("/admin/tickets/draft", {
        method: "POST",
        body: {
          name: form.name,
          phone: form.phone,
          branch: form.branch,
          package: form.package,
          expectedTotal: quote.total,
          requestKey: request.current.key,
        },
      });
      setTicket(result);
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function activate() {
    if (lock.current || !ticket || !received) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const active = await api(`/admin/tickets/${ticket._id}/activate`, {
        method: "PATCH",
        body: {
          paymentReceived: true,
          paymentMethod: form.paymentMethod,
          expectedTotal: ticket.total,
        },
      });
      setTicket(active);
      onCreated(active);
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal counter-ticket"
        role="dialog"
        aria-modal="true"
        aria-labelledby="counter-title"
      >
        <div className="modal-header">
          <h2 id="counter-title">
            {ticket?.code ? "Mã chụp đã sẵn sàng" : ticket ? "Chờ xác nhận đã thu" : "Tạo mã chụp cho khách"}
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
        {ticket?.code ? (
          <div className="counter-receipt">
            <span className="badge confirmed">
              <Check size={14} /> Đã nhận {money(ticket.total)}
            </span>
            <p>
              Mời khách vào{" "}
              {ticket.roomName ? (
                <strong>{ticket.roomName}</strong>
              ) : (
                "phòng chụp đang trống"
              )}{" "}
              và nhập mã này trên màn hình máy chụp.
            </p>
            <div className="ticket-code" aria-label="Mã chụp của khách">
              {ticket.code}
            </div>
            <p>
              {ticket.packageName} · {printsText(ticket)}
            </p>
            {/* Phòng photobooth: chạm → chọn cách thanh toán → "Nhập mã" → nhập 6 số. */}
            <p className="ticket-steps">
              Trên máy chụp: chạm <b>“Chạm để bắt đầu”</b> →{" "}
              bấm <b>“Nhập mã”</b> → nhập 6 số → bắt đầu chụp.
            </p>
            <p className="soft-note">
              Mã dùng một lần trong 2 giờ từ lúc xác nhận đã thu, ở phòng nào cũng được. Chụp xong, máy chụp
              hiện mã QR để khách quét nhận ảnh trên điện thoại.
            </p>
            <Button
              className="outline full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(ticket.code);
                  setCopied(true);
                  toast.success(`Đã sao chép mã ${ticket.code}.`);
                } catch {
                  toast.warning(
                    "Không sao chép được. Bạn có thể đọc hoặc ghi lại mã 6 số phía trên.",
                  );
                }
              }}
            >
              <Copy size={16} />
              {copied ? "Đã sao chép mã" : "Sao chép mã"}
            </Button>
            <Button className="full" onClick={onClose}>
              Xong
            </Button>
          </div>
        ) : ticket ? (
          <div className="counter-receipt">
            <p>Đã ghi nhận gói <strong>{ticket.packageName}</strong>. Chưa cấp mã cho khách.</p>
            <div className="summary-total"><span>Tiền cần thu</span><strong>{money(ticket.total)}</strong></div>
            <label>
              Thanh toán
              <select value={form.paymentMethod} onChange={(e) => change("paymentMethod", e.target.value)}>
                <option value="cash">Tiền mặt</option>
                <option value="transfer">Chuyển khoản</option>
              </select>
            </label>
            {form.paymentMethod === "transfer" && settings.bankAccount && (
              <p className="soft-note">{settings.bank} · {settings.bankAccount} · {settings.bankOwner}</p>
            )}
            <label className="checkbox">
              <input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} />
              <span>Tôi đã nhận đủ tiền mặt hoặc kiểm tra chuyển khoản đã vào tài khoản.</span>
            </label>
            <Button className="full" disabled={busy || !received} onClick={activate}>
              {busy ? "Đang kích hoạt…" : "Xác nhận đã thu & hiện mã 6 số"}
            </Button>
          </div>
        ) : (
          <form className="transaction-form" onSubmit={create} noValidate>
            <div className="transaction-fields">
              <p>
                Chọn gói và tạo phiếu trước. Mã 6 số chỉ xuất hiện sau khi xác nhận đã thu tiền.
              </p>
              <label>
                Gói chụp
                <select
                  name="package"
                  autoFocus
                  aria-invalid={Boolean(v.errors.package)}
                  value={form.package}
                  onChange={(e) => change("package", e.target.value)}
                >
                  <option value="">Chọn gói</option>
                  {packages.filter((p) => p.printSize !== "instax").map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name} — {money(p.price)}
                    </option>
                  ))}
                </select>
                <FieldError error={v.errors.package} />
              </label>
              {pack && (
                <p className="muted">
                  {pack.shots || "—"} lần chụp · {printsText(pack)}
                </p>
              )}
              <label>
                Tên khách
                <input
                  name="name"
                  autoComplete="off"
                  aria-invalid={Boolean(v.errors.name)}
                  value={form.name}
                  onChange={(e) => change("name", e.target.value)}
                />
                <FieldError error={v.errors.name} />
              </label>
              <label>
                Số điện thoại khách
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="VD: 0912345678"
                  aria-invalid={Boolean(v.errors.phone)}
                  value={form.phone}
                  onChange={(e) =>
                    change(
                      "phone",
                      e.target.value.replace(/[^\d]/g, "").slice(0, 10),
                    )
                  }
                />
                <FieldError error={v.errors.phone} />
                <small className="muted">Dùng để tra cứu lại album của khách.</small>
              </label>
              <label>
                Chi nhánh
                <select value={form.branch} onChange={(e) => change("branch", e.target.value)}>
                  <option value="">Chọn chi nhánh</option>
                  {branches.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
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
              {form.paymentMethod === "transfer" && (
                <div className="soft-note">
                  {settings.bankAccount && (
                    <p>
                      {settings.bank} · {settings.bankAccount}
                      <br />
                      {settings.bankOwner}
                    </p>
                  )}
                  {settings.bankQrImage && (
                    <div className="bank-qr-wrap">
                      <img
                        src={settings.bankQrImage}
                        alt="Mã QR chuyển khoản"
                        className="bank-qr-img"
                      />
                    </div>
                  )}
                  <small>Kiểm tra tiền đã vào tài khoản ở bước xác nhận tiếp theo.</small>
                </div>
              )}
            </div>
            <div className="transaction-confirmation">
              <div className="summary-total">
                <span>Tiền cần thu</span>
                <strong>
                  {quote?.key === quoteKey && !quote.error
                    ? money(quote.total)
                    : "…"}
                </strong>
              </div>
              {quote?.key === quoteKey && <ErrorBox error={quote.error} />}
              <Button className="full" disabled={busy}>
                {busy ? "Đang tạo phiếu…" : "Tạo phiếu chụp"}
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
