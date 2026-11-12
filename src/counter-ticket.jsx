import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { api, money } from "./api";
import { includedSheets, isStrip, piecesLabel } from "./kiosk/print-count.js";
import { polaroidLayout } from "./polaroid-layouts.js";
import { Button, ErrorBox, useStudio, useToast } from "./studio";
import { FieldError, chosen, useValidation } from "./validate";

const RULES = {
  package: ["Gói chụp", chosen],
  room: ["Máy / phòng chụp", chosen],
};

// Số tờ khách nhận: "2 tờ nhỏ (1 tờ 10 × 15 cắt đôi)" / "2 tờ 10 × 15 cm" / "2 tấm Instax".
const printsText = (pack) => {
  const sheets = includedSheets(pack);
  const pieces = piecesLabel(pack, sheets);
  if (isStrip(pack)) return `${pieces} (${sheets} tờ 10 × 15 cắt đôi)`;
  return pack.printSize === "instax" ? pieces : `${pieces} 10 × 15 cm`;
};

// Layout Polaroid (khổ Instax): mã nhập ở phòng Polaroid; gói khác: mã nhập ở phòng photobooth.
const isPolaroid = (pack) => pack?.printSize === "instax";
const roomKind = (room) => (room.kind === "polaroid" ? "polaroid" : "photobooth");

export function CounterTicket({ onClose, onCreated, initialDraft = null, assignedBranch = "" }) {
  const { packages = [], rooms = [], settings = {} } = useStudio();
  // Gói photobooth và layout Polaroid đang bán (layout Polaroid chỉ 1 ảnh / 3 phút hoặc 2 ảnh / 5 phút).
  const counterPackages = packages.filter((p) => p.active !== false && (!isPolaroid(p) || polaroidLayout(p.selectCount)));
  // Mã lấy chi nhánh từ phòng trên máy chủ; nhân viên chỉ chọn máy phù hợp với gói.
  const roomsFor = (pack) => rooms.filter((r) => r.active !== false &&
    roomKind(r) === (isPolaroid(pack) ? "polaroid" : "photobooth") &&
    (!assignedBranch || r.branch === assignedBranch) &&
    (!pack?.branches?.length || pack.branches.includes(r.branch)));
  // Mặc định gói photobooth (bán nhiều nhất); chi nhánh chỉ có phòng Polaroid thì mặc định layout Polaroid.
  const firstPackage = counterPackages.find((p) => !isPolaroid(p) && roomsFor(p).length)
    || counterPackages.find((p) => roomsFor(p).length) || counterPackages[0];
  const [form, setForm] = useState({
    package: firstPackage?._id || "",
    room: roomsFor(firstPackage)[0]?._id || "",
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
  const eligibleRooms = roomsFor(pack);
  const selectedRoom = eligibleRooms.find((room) => room._id === form.room) || eligibleRooms[0];
  const layout = isPolaroid(pack) ? polaroidLayout(pack.selectCount) : null;
  const change = (key, value) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Đổi loại gói: chuyển sang máy phù hợp, không giữ nhầm phòng của gói trước.
      if (key === "package") {
        const allowed = roomsFor(packages.find((p) => p._id === value));
        if (!allowed.some((room) => room._id === next.room)) next.room = allowed[0]?._id || "";
      }
      return next;
    });
    v.clear(key);
  };
  async function create(e) {
    e.preventDefault();
    if (lock.current) return;
    const selection = { ...form, room: selectedRoom?._id || "" };
    if (!v.check(selection, RULES)) return;
    if (quote?.key !== quoteKey || quote.error)
      return toast.warning(
        quote?.error || "Đang tính tiền, vui lòng đợi một chút.",
      );
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const fingerprint = JSON.stringify(selection);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, key: crypto.randomUUID() };
      const result = await api("/admin/tickets/draft", {
        method: "POST",
        body: {
          room: selectedRoom._id,
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
                ticket.printSize === "instax" ? "phòng Polaroid đang trống" : "phòng Photobooth đang trống"
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
              Mã dùng một lần trong 2 giờ từ lúc xác nhận đã thu. Chụp xong, máy chụp
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
            {ticket.roomName && <p>Máy / phòng chụp: <strong>{ticket.roomName}</strong>.</p>}
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
              {!eligibleRooms.length && <ErrorBox error={`Chưa có phòng ${layout ? "Polaroid" : "photobooth"} đang hoạt động phù hợp với gói này.`} />}
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
                  {[["Photobooth", counterPackages.filter((p) => !isPolaroid(p))],
                    ["Polaroid (nhập mã ở phòng Polaroid)", counterPackages.filter(isPolaroid)]]
                    .filter(([, list]) => list.length)
                    .map(([group, list]) => (
                      <optgroup key={group} label={group}>
                        {list.map((p) => (
                          <option key={p._id} value={p._id}>
                            {isPolaroid(p) ? `${polaroidLayout(p.selectCount).label} · ${p.name}` : p.name} — {money(p.price)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
                <FieldError error={v.errors.package} />
              </label>
              {pack && (
                <p className="muted">
                  {layout
                    ? `Phòng Polaroid · chọn ${layout.selectCount} ảnh · ${layout.duration} phút chụp, bấm dây không giới hạn · in 1 tấm Instax`
                    : `${pack.shots || "—"} lần chụp · ${printsText(pack)}`}
                </p>
              )}
              {eligibleRooms.length > 1 ? (
                <label>
                  Máy / phòng chụp
                  <select name="room" aria-invalid={Boolean(v.errors.room)} value={selectedRoom?._id || ""}
                    onChange={(e) => change("room", e.target.value)}>
                    {eligibleRooms.map((room) => <option key={room._id} value={room._id}>
                      {room.name}{room.machineCode ? ` · ${room.machineCode}` : ""}
                    </option>)}
                  </select>
                  <FieldError error={v.errors.room} />
                </label>
              ) : selectedRoom && <p className="muted">Máy / phòng chụp: <strong>{selectedRoom.name}</strong></p>}
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
              <Button className="full" disabled={busy || !selectedRoom || !counterPackages.length}>
                {busy ? "Đang tạo phiếu…" : "Tạo phiếu chụp"}
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
