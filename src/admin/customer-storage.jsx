import { useState } from "react";
import { ChevronDown, Search, Trash2, Users } from "lucide-react";
import { api, formatDateTime } from "../api";
import { Button, ErrorBox, useToast } from "../studio";
import { useStorageMonitor } from "./storage-monitor";
import { storageCount, storageSize } from "./storage-ui";

const searchable = (text) =>
  String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Stored photos of each customer, newest first. Staff can look; an admin can delete everything
// one customer has in storage (photos, every size of them, print sheets) after confirming.
export function CustomerStorage({ canManageStorage = false }) {
  const toast = useToast();
  const { publishSummary } = useStorageMonitor();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  async function load() {
    setLoading(true);
    try {
      setRows(await api("/admin/storage/customers"));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  async function remove(row) {
    if (busy) return;
    const extra = row.pendingPrints
      ? `\nVé còn ${row.pendingPrints} lệnh in chưa in: lệnh in cũng bị xoá và tờ được trả lại.`
      : "";
    if (!window.confirm(
      `Xoá toàn bộ ảnh của vé #${row.code}${row.name ? ` (${row.name})` : ""}?\n` +
        `${storageCount.format(row.photos)} ảnh · ${storageCount.format(row.files)} file · ${storageSize(row.bytes)}.` +
        extra +
        "\nKhách sẽ không xem, tải hay in được các ảnh này nữa. Không thể khôi phục.",
    ))
      return;
    setBusy(row.id);
    try {
      const result = await api(`/admin/storage/customers/${row.id}`, { method: "DELETE" });
      publishSummary(result.summary);
      setRows((current) => current?.filter((r) => r.id !== row.id) || current);
      toast.success(`Đã xoá ảnh của vé #${row.code}, giải phóng ${storageSize(row.bytes)}.`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy("");
    }
  }
  const term = searchable(query.trim());
  const shown = (rows || []).filter((row) =>
    !term || searchable(`${row.code} ${row.name} ${row.phone}`).includes(term));
  return (
    <details
      className="panel storage-customers"
      onToggle={(e) => {
        if (e.currentTarget.open && !rows && !loading) load();
      }}
    >
      <summary>
        <Users size={17} aria-hidden="true" />
        <span>Dữ liệu từng khách</span>
        {rows && <span className="storage-customers-count">{storageCount.format(rows.length)} khách</span>}
        <ChevronDown size={18} className="storage-disclosure-icon" aria-hidden="true" />
      </summary>
      <div className="storage-customers-body">
        <ErrorBox error={error} />
        {rows && rows.length > 0 && (
          <label className="storage-customers-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Tìm mã vé, tên, số điện thoại…"
              aria-label="Tìm khách"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        {!rows ? (
          <p className="storage-customers-empty" role="status">
            {loading ? "Đang tải danh sách khách…" : error ? "" : "Mở để xem ảnh của từng khách."}
          </p>
        ) : !rows.length ? (
          <p className="storage-customers-empty">Không còn khách nào có ảnh đang lưu.</p>
        ) : (
          <ul className="storage-customers-list">
            {shown.map((row) => (
              <li key={row.id}>
                <div className="storage-customer-info">
                  <strong>
                    #{row.code}
                    {row.name && <span> · {row.name}</span>}
                  </strong>
                  <small>
                    {storageCount.format(row.photos)} ảnh · {storageSize(row.bytes)}
                    {row.lastPhotoAt && ` · chụp ${formatDateTime(row.lastPhotoAt)}`}
                  </small>
                  {row.pendingPrints > 0 && (
                    <span className="badge pending">{row.pendingPrints} lệnh in đang chờ</span>
                  )}
                </div>
                {canManageStorage && (
                  <Button
                    className="outline small storage-customer-delete"
                    disabled={Boolean(busy) || row.status === "checked_in"}
                    aria-busy={busy === row.id}
                    aria-label={`Xoá ảnh của vé #${row.code}`}
                    title={row.status === "checked_in" ? "Khách đang chụp" : "Xoá toàn bộ ảnh của khách này"}
                    onClick={() => remove(row)}
                  >
                    <Trash2 size={15} aria-hidden="true" /> {busy === row.id ? "Đang xoá…" : "Xoá"}
                  </Button>
                )}
              </li>
            ))}
            {!shown.length && <li className="storage-customers-empty">Không có khách khớp “{query}”.</li>}
          </ul>
        )}
        <div className="storage-customers-foot">
          <Button className="outline small" onClick={load} disabled={loading || Boolean(busy)}>
            {loading ? "Đang tải…" : "Tải lại danh sách"}
          </Button>
          {!canManageStorage && <small>Chỉ quản trị viên xoá được ảnh của khách.</small>}
        </div>
      </div>
    </details>
  );
}
