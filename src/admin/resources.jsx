import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  X,
  ExternalLink,
  DoorOpen,
  Package,
  Users,
  Info,
  Activity,
  SlidersHorizontal,
  Power,
  Download,
  LoaderCircle,
  Monitor,
  Printer,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, money } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { useValidation } from "../validate";
import { RESOURCE_LABELS, RESOURCE_RULES, ROOM_KIND_NAMES, definitions, DEFAULT_STAFF_PERMISSIONS, PERMISSION_GROUPS, can } from "./config";
import { PriceEditor } from "../extra-prints";
import { TableHeading } from "./table-heading";
import { Guide } from "../guide";
import { download, macScript, windowsScript } from "./kiosk-autostart";
import { CatalogToolbar } from "./catalog-toolbar";
import { PackageCatalog } from "./package-catalog";
import { ResourceEditor } from "./resource-editor";
import { ServiceTabs, serviceOf, useServiceTab } from "./service-tabs";
import { LAYOUT_COUNTS } from "../polaroid-layouts.js";
import { createSampleLayouts } from "./polaroid-presets";

const searchable = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

// Lần cuối máy chụp báo còn mở trong 3 phút: coi như đang Online.
const ONLINE_MS = 3 * 60 * 1000;
const FLIP_LABELS = { on: "Có lật ảnh", off: "Không lật ảnh", device: "Theo cài đặt trên máy" };
const PERMISSION_LABELS = Object.fromEntries(PERMISSION_GROUPS.flatMap(([, items]) => items));
const isOnline = (room) => Boolean(room.lastSeenAt) && Date.now() - new Date(room.lastSeenAt) < ONLINE_MS;

const RESOURCE_ICONS = {
  rooms: DoorOpen,
  packages: Package,
  users: Users,
};

const clock = (value) =>
  new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
// Hộp phim Instax Wide có 10 tấm: còn ≤ 3 tấm thì nhắc thay phim.
const FILM_LOW = 3;
const AGENT_SIZES = { full: "DNP", strip: "DNP", instax: "Instax" };
// Chương trình in tự động (print agent) và máy Instax của từng chi nhánh.
function PrinterStatus({ printers }) {
  return (
    <section className="panel printer-status" aria-label="Máy in">
      <h3>
        <Printer size={17} aria-hidden="true" /> Máy in tự động
      </h3>
      {printers.map(({ branch, at, instax, agent }) => {
        const low = instax?.ready && Number.isInteger(instax.film) && instax.film <= FILM_LOW;
        const kinds = [...new Set((agent?.printSizes || []).map((s) => AGENT_SIZES[s]))].join(" + ");
        return (
          <div key={branch} className="printer-status-branch">
            {agent && (
              <p className={agent.running ? "is-ready" : "is-warn"}>
                <strong>{branch}</strong> · Chương trình in tự động{" "}
                {agent.running
                  ? `đang chạy${kinds ? ` (${kinds})` : ""}`
                  : "không chạy — lệnh in sẽ không tự in, bật lại print-agent trên máy cạnh máy in"}
                <small> · báo lúc {clock(agent.at)}</small>
              </p>
            )}
            {instax && (
              <p className={instax.ready && !low ? "is-ready" : "is-warn"}>
                <strong>{agent ? "Máy Instax Link WIDE" : branch}</strong> ·{" "}
                {instax.ready ? (low ? "Sắp hết phim — chuẩn bị hộp phim mới" : "Sẵn sàng") : instax.message}
                {Number.isInteger(instax.film) && ` · còn ${instax.film} tấm phim`}
                {Number.isInteger(instax.battery) && ` · pin ${instax.battery}%${instax.charging ? " (đang sạc)" : ""}`}
                {at && <small> · báo lúc {clock(at)}</small>}
              </p>
            )}
          </div>
        );
      })}
      <small className="muted">
        Phòng Photobooth in ở máy DNP; phòng Polaroid in Instax Wide. Máy Instax chưa sẵn sàng hay hết phim thì lệnh in
        Polaroid chờ trong hàng và tự in khi máy in kết nối lại.
        In lỗi (hết phim, mất kết nối) sẽ báo ngay trên trang quản trị.
      </small>
    </section>
  );
}

export function ResourceManager({ resource, notify, me }) {
  const toast = useToast();
  const { settings = {}, reload: reloadCatalog } = useStudio();
  const form = useValidation();
  const kind = RESOURCE_LABELS[resource] || "mục";
  const [items, setItems] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  // Máy in Instax cạnh máy chụp (print agent báo về mỗi phút): sẵn sàng, số phim, pin.
  const [printers, setPrinters] = useState([]);
  // Khung ảnh có trang riêng (admin/frames.jsx); đây là máy, gói chụp và tài khoản.
  const isCatalog = resource === "packages";
  const canManage = me?.role === "admin";
  const filtered = Boolean(query.trim()) || status !== "all";
  // Khổ ảnh & bảng giá: xem riêng gói phòng Photobooth (khổ nhỏ / khổ to) và layout phòng Polaroid.
  const [service, setService] = useServiceTab();
  const serviceItems = isCatalog ? items.filter((item) => serviceOf(item.printSize) === service) : items;
  const serviceCounts = {
    photobooth: items.filter((item) => serviceOf(item.printSize) === "photobooth").length,
    polaroid: items.filter((item) => serviceOf(item.printSize) === "polaroid").length,
  };
  const visibleItems = serviceItems.filter(
    (item) =>
      searchable(
        [item.name, item.description].filter(Boolean).join(" "),
      ).includes(searchable(query.trim())) &&
      (status === "all" || Boolean(item.active) === (status === "active")),
  );
  const load = async () => {
    setLoading(true);
    if (resource === "rooms")
      api("/admin/print-jobs/printers").then(setPrinters, () => setPrinters([]));
    try {
      setItems(await api(`/admin/${resource}`));
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setEdit(null);
    setError("");
    setDevice(null);
    setQuery("");
    setStatus("all");
    load();
  }, [resource]);
  const openEditor = (item) => {
    if (!canManage) return;
    setError("");
    form.setErrors({});
    setEdit(item);
  };
  const fields = definitions[resource];
  // Gói mới theo khổ ảnh: khổ nhỏ kèm 1 tờ (cắt đôi = 2 tờ nhỏ), khổ to kèm 2 tờ; layout Polaroid
  // (khổ Instax) mặc định 4 ảnh, 5 phút chụp không giới hạn lần bấm, in 1 tấm.
  function newItem(printSize = "full") {
    openEditor(
      Object.fromEntries([
        ...fields.map(([key, , type]) => [
          key,
          type === "number"
            ? key === "duration"
              ? printSize === "instax" ? 5 : 15
              : key === "shots"
                ? printSize === "instax" ? 0 : 12
                : key === "selectCount"
                  ? 4
                  : key === "prints"
                    ? printSize === "full" ? 2 : 1
              : 0
            : type === "color"
              ? key === "color"
                ? "#522e22"
                : "#ffffff"
              : type === "date"
                ? ""
                : type === "flip"
                  ? "device"
                  : type === "branches"
                    ? []
                    : type === "roomKind"
                      ? "photobooth"
                      : type === "checkbox"
                        ? false
                    : type === "permissions"
                      ? DEFAULT_STAFF_PERMISSIONS
                      : type === "role"
                  ? "staff"
                  : type === "printSize"
                    ? printSize
                    : "",
        ]),
        ["active", true],
      ]),
    );
  }
  async function save(e) {
    e.preventDefault();
    if (!canManage) return;
    setError("");
    if (!form.check(edit, RESOURCE_RULES[resource] || {})) return;
    setBusy(true);
    try {
      const body = { ...edit };
      if (!body.password) delete body.password;
      if (resource === "users" && body.role !== "staff") delete body.permissions;
      await api(`/admin/${resource}${edit._id ? `/${edit._id}` : ""}`, {
        method: edit._id ? "PUT" : "POST",
        body,
      });
      setEdit(null);
      await load();
      notify(
        edit._id
          ? `Đã cập nhật ${kind} “${edit.name}”.`
          : `Đã thêm ${kind} “${edit.name}”.`,
      );
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  // Tab Polaroid: tạo 6 layout mẫu (1, 2, 3, 4, 5, 6 ảnh) kèm khung trắng Instax Wide; layout / khung
  // đã có cùng số ảnh thì giữ nguyên.
  async function createSamples() {
    if (!canManage || busy) return;
    if (!confirm(`Tạo layout mẫu ${LAYOUT_COUNTS.join(", ")} ảnh (110.000 đ, 5 phút chụp, in 1 tấm) kèm khung trắng Instax Wide trong chủ đề “Layout trắng”?
Layout hoặc khung đã có cùng số ảnh được giữ nguyên. Sửa giá, thời gian chụp sau ở từng layout.`)) return;
    setBusy(true);
    try {
      const made = await createSampleLayouts(items);
      await load();
      reloadCatalog?.();
      notify(made.layouts.length || made.frames.length
        ? `Đã tạo ${made.layouts.length} layout và ${made.frames.length} khung trắng mẫu.`
        : "Đã có đủ layout và khung cho 1–6 ảnh — không tạo thêm.");
    } catch (e) {
      // Có thể đã tạo được một phần: tải lại để thấy đúng danh sách.
      await load();
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function deactivate(item) {
    if (!canManage) return;
    if (!confirm(`Ngừng sử dụng ${item.name || item.code}?`)) return;
    try {
      await api(`/admin/${resource}/${item._id}`, { method: "DELETE" });
      load();
      notify(`Đã ngừng sử dụng ${kind} “${item.name || item.code}”.`);
    } catch (e) {
      toast.error(e.message);
    }
  }
  // Phòng đã ngừng sử dụng: bật lại, hoặc xoá hẳn (đơn hàng cũ vẫn giữ tên phòng).
  async function restoreRoom(item) {
    if (!canManage) return;
    try {
      await api(`/admin/rooms/${item._id}`, {
        method: "PUT",
        body: {
          name: item.name, branch: item.branch, description: item.description || "",
          flip: item.flip || "device", kind: item.kind || "photobooth", active: true,
        },
      });
      load();
      notify(`Đã bật lại phòng “${item.name}”.`);
    } catch (e) {
      toast.error(e.message);
    }
  }
  async function removeRoom(item) {
    if (!canManage) return;
    if (!confirm(`Xoá hẳn phòng “${item.name}”?
Liên kết máy chụp của phòng này sẽ không mở được nữa. Đơn hàng cũ vẫn giữ tên phòng. Không thể khôi phục.`)) return;
    try {
      await api(`/admin/rooms/${item._id}/permanent`, { method: "DELETE" });
      load();
      notify(`Đã xoá phòng “${item.name}”.`);
    } catch (e) {
      toast.error(e.message);
    }
  }
  // Cài máy chụp (đầu ca, từng phòng): lấy liên kết + QR mở máy chụp. Loại phòng đã chọn lúc thêm
  // phòng; phòng Photobooth: quản trị viên bật / tắt chế độ thử tiền mặt ngay trong hộp này. Mở hộp
  // không gửi chế độ thử (danh sách phòng có thể đã cũ): máy chủ trả trạng thái đang lưu.
  const setup = (item) =>
    issueDevice({
      room: item,
      name: item.name,
      kind: item.kind || "photobooth",
      paymentTest: Boolean(item.paymentTest),
    });
  async function issueDevice(next, change = {}) {
    setDevice({ ...next, busy: true });
    try {
      const d = await api(`/admin/rooms/${next.room._id}/device`, {
        method: "POST",
        body: change,
      });
      setDevice((current) => current && {
        ...next,
        ...d,
        busy: false,
        url: `${window.location.origin}/kiosk?device=${encodeURIComponent(d.token)}`,
      });
      load().catch(() => {});
    } catch (e) {
      // Chưa có liên kết thì đóng hộp; đang đổi chế độ thử thì giữ liên kết cũ.
      setDevice((current) => current && (current.url ? { ...current, busy: false, paymentTest: !next.paymentTest } : null));
      toast.error(e.message);
    }
  }
  return (
    <>
      <ErrorBox error={error} />
      {resource === "rooms" && (
        <Guide
          id="rooms-kiosk"
          title="cài máy chụp cho phòng"
          steps={[
            "Bấm “Cài máy chụp” ở dòng phòng → mở liên kết (hoặc quét QR) trên máy tính trong phòng bằng Chrome / Edge. Loại phòng (Photobooth / Polaroid) chọn lúc thêm phòng.",
            "Trên máy chụp: mở “Cài đặt máy chụp (nhân viên)”, làm theo hướng dẫn kết nối máy ảnh.",
            "Muốn bật máy tính là tự mở máy chụp: trong hộp “Cài máy chụp” tải “File cài cho Windows / Mac”, chạy 1 lần trên máy trong phòng.",
          ]}
          note="Liên kết máy chụp có hạn 1 năm, chỉ gửi cho nhân viên."
        />
      )}
      {resource === "rooms" && printers.length > 0 && <PrinterStatus printers={printers} />}
      {isCatalog && <ServiceTabs value={service} onChange={setService} counts={loading ? {} : serviceCounts} />}
      {isCatalog ? (
        <CatalogToolbar
          service={service}
          items={serviceItems}
          visibleCount={visibleItems.length}
          query={query}
          onQueryChange={setQuery}
          status={status}
          onStatusChange={setStatus}
          onCreate={() => newItem(service === "polaroid" ? "instax" : "full")}
          actions={service === "polaroid" && canManage && (
            <Button className="outline" disabled={busy || loading} onClick={createSamples}>
              <Sparkles size={16} aria-hidden="true" />
              {busy ? "Đang tạo…" : "Tạo 6 layout mẫu"}
            </Button>
          )}
          loading={loading}
        />
      ) : (
        <div className="admin-toolbar">
          <p>
            {resource === "rooms"
              ? `${items.length} máy${canManage ? "" : " đang hoạt động"}`
              : `${items.length} mục trong danh sách`}
          </p>
          {canManage && (
            <Button onClick={() => newItem()}>
              <Plus size={16} /> Thêm mới
            </Button>
          )}
        </div>
      )}
      {isCatalog && loading ? (
        <div className="catalog-loading" role="status">
          <LoaderCircle size={24} aria-hidden="true" />
          <span>Đang tải danh mục…</span>
        </div>
      ) : resource === "packages" ? (
        <>
        {/* Khổ ảnh và giá gói ở trên; giá in thêm (ít khi đổi) ở dưới cùng. */}
        <PackageCatalog
          items={visibleItems}
          onEdit={(item) => openEditor({ ...item })}
          onDeactivate={deactivate}
          onCreate={newItem}
          filtered={filtered}
          sizes={service === "polaroid" ? ["instax"] : ["strip", "full"]}
        />
        {canManage && (
          <section className="panel extra-price-panel" aria-labelledby="extra-price-title">
            <div>
              <h3 id="extra-price-title">{service === "polaroid" ? "Giá in thêm Instax Wide" : "Giá in thêm tờ ảnh"}</h3>
              <p className="muted">
                Khi khách mua thêm bản in tại quầy (Đơn hàng → In ảnh → Thêm lượt in)
                {service === "polaroid"
                  ? ". Phim Instax Wide có giá riêng, không theo giá tờ 10 × 15."
                  : " hoặc chọn thêm ở máy chụp. Khổ nhỏ: mỗi tờ 10 × 15 cm = 2 tờ nhỏ."}
              </p>
            </div>
            <div className="extra-price-pair">
              {service === "polaroid" ? (
                <div className="extra-price-item">
                  <small>Phòng Polaroid · mỗi tấm Instax Wide</small>
                  <PriceEditor instax price={settings.extraInstaxPrice} startOpen={false} onSaved={() => reloadCatalog?.()} />
                </div>
              ) : (
                <div className="extra-price-item">
                  <small>Khổ to & khổ nhỏ · tờ 10 × 15 cm</small>
                  <PriceEditor price={settings.extraPrintPrice} startOpen={false} onSaved={() => reloadCatalog?.()} />
                </div>
              )}
            </div>
          </section>
        )}
        </>
      ) : (
        <div
          className={`table-wrap ${resource === "rooms" ? "room-table" : resource === "users" ? "staff-table" : ""}`}
        >
          <table>
            <thead>
              <tr>
                <TableHeading icon={RESOURCE_ICONS[resource] || Package}>
                  Tên / Mã
                </TableHeading>
                <TableHeading icon={Info}>Thông tin</TableHeading>
                <TableHeading icon={Activity}>Trạng thái</TableHeading>
                <TableHeading icon={SlidersHorizontal}>Thao tác</TableHeading>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id}>
                  <td
                    data-label={resource === "rooms" ? "Tên phòng" : "Họ tên"}
                  >
                    <strong>{item.name || item.code}</strong>
                  </td>
                  <td
                    data-label={
                      resource === "rooms" ? "Chi nhánh / địa chỉ" : "Tài khoản"
                    }
                  >
                    {resource === "packages" ? (
                      `${money(item.price)} · ${item.duration} phút · không giới hạn ảnh`
                    ) : resource === "users" ? (
                      <>
                        {item.email}
                        <small>
                          {item.role === "admin"
                            ? "Tài khoản chủ cửa hàng · toàn quyền"
                            : `Nhân viên${item.branch ? ` · ${item.branch}` : ""} · ${
                                (item.permissions ?? DEFAULT_STAFF_PERMISSIONS).length
                              } quyền`}
                        </small>
                        {item.role === "staff" && (
                          <small className="permission-summary">
                            {(item.permissions ?? DEFAULT_STAFF_PERMISSIONS)
                              .map((p) => PERMISSION_LABELS[p])
                              .filter(Boolean)
                              .join(" · ") || "Chỉ xem đơn và máy"}
                          </small>
                        )}
                      </>
                    ) : resource === "rooms" ? (
                      <>
                        {item.branch || "Chưa đặt chi nhánh"}
                        <small className="room-flip">
                          {ROOM_KIND_NAMES[item.kind || "photobooth"]}
                          {(item.kind || "photobooth") === "photobooth" && item.paymentTest ? " (đang bật chế độ thử đút tiền)" : ""} ·{" "}
                          Chế độ lật ảnh: {FLIP_LABELS[item.flip || "device"]}
                        </small>
                      </>
                    ) : (
                      item.caption || item.description
                    )}
                  </td>
                  <td data-label="Trạng thái">
                    <span
                      className={`badge ${item.active ? "confirmed" : "cancelled"}`}
                    >
                      {item.active ? "Đang hoạt động" : "Đã tắt"}
                    </span>
                    {resource === "rooms" && item.active && (
                      <small className={`machine-online ${isOnline(item) ? "is-online" : "is-offline"}`}>
                        <i aria-hidden="true" />
                        {isOnline(item)
                          ? "Online"
                          : item.lastSeenAt
                            ? `Offline · lần cuối ${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(item.lastSeenAt))}`
                            : "Offline · chưa kết nối"}
                      </small>
                    )}
                  </td>
                  <td data-label="Thao tác">
                    {resource === "users" &&
                    (item._id === me?._id ||
                      item.email?.toLowerCase() ===
                        me?.email?.toLowerCase()) ? (
                      // Không tự sửa / tự ngừng tài khoản đang đăng nhập (máy chủ cũng chặn).
                      <span
                        className="self-account"
                        title="Đổi mật khẩu ở mục “Đổi mật khẩu”. Đổi tên / email nhờ quản trị viên khác."
                      >
                        Tài khoản của bạn
                      </span>
                    ) : (
                      <div className="inline-actions">
                        {canManage && (
                          <button
                            title="Chỉnh sửa"
                            aria-label={`Chỉnh sửa ${item.name || item.code}`}
                            className="icon-button"
                            onClick={() => openEditor({ ...item })}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {canManage && item.active && (
                            <button
                              title="Ngừng sử dụng"
                              aria-label={`Ngừng sử dụng ${item.name || item.code}`}
                              className="icon-button"
                              onClick={() => deactivate(item)}
                            >
                              <X size={16} />
                            </button>
                          )}
                        {resource === "rooms" && canManage && !item.active && (
                          <>
                            <button
                              title="Bật lại"
                              aria-label={`Bật lại ${item.name}`}
                              className="icon-button"
                              onClick={() => restoreRoom(item)}
                            >
                              <RotateCcw size={16} />
                            </button>
                            <button
                              title="Xoá hẳn"
                              aria-label={`Xoá hẳn ${item.name}`}
                              className="icon-button danger"
                              onClick={() => removeRoom(item)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                        {resource === "rooms" && item.active && can(me, "rooms:setup") && (
                          <Button
                            className="outline small room-kiosk-button"
                            aria-label={`Cài máy chụp cho ${item.name}`}
                            onClick={() => setup(item)}
                          >
                            <Monitor size={16} aria-hidden="true" /> Cài máy chụp
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <div className="empty-state">
              {loading
                ? "Đang tải danh sách…"
                : !canManage && resource === "rooms"
                  ? "Chưa có phòng đang hoạt động. Liên hệ quản trị viên để thêm hoặc bật phòng."
                  : "Chưa có dữ liệu. Thêm mục đầu tiên của bạn."}
            </div>
          )}
        </div>
      )}
      {edit && canManage && (
        <ResourceEditor
          resource={resource}
          edit={edit}
          form={form}
          busy={busy}
          error={error}
          onChange={setEdit}
          onClose={() => setEdit(null)}
          onSubmit={save}
        />
      )}
      {device && (
        <div className="modal-backdrop">
          <section
            className="modal center"
            role="dialog"
            aria-modal="true"
            aria-label="Cài máy chụp"
          >
            <button
              aria-label="Đóng"
              className="modal-close icon-button"
              onClick={() => setDevice(null)}
            >
              <X />
            </button>
            <h2>Cài máy chụp: {device.name}</h2>
            <p className="setup-step">{ROOM_KIND_NAMES[device.kind]}</p>
            {device.kind === "photobooth" && (
              <label className="checkbox setup-test">
                <input
                  type="checkbox"
                  checked={device.paymentTest}
                  disabled={device.busy || !canManage}
                  onChange={(e) => issueDevice({ ...device, paymentTest: e.target.checked }, { paymentTest: e.target.checked })}
                />
                Chế độ thử tiền mặt: chưa lắp máy đọc tiền — máy chụp có nút giả lập đút tiền (không tính doanh thu)
                {!canManage && " · chỉ quản trị viên bật / tắt"}
              </label>
            )}
            {!device.url ? (
              <p role="status">Đang tạo liên kết máy chụp…</p>
            ) : (
            <>
            <p>
              Mở liên kết này một lần trên máy tính trong phòng (hoặc quét QR),
              máy chụp sẽ tự nhớ. Liên kết có hiệu lực 1 năm; chỉ gửi cho nhân
              viên.
            </p>
            <QRCodeSVG value={device.url} size={220} />
            <a
              className="button full"
              href={device.url}
              target="_blank"
              rel="noreferrer"
            >
              Mở máy chụp <ExternalLink size={16} />
            </a>
            <Button
              className="outline full"
              onClick={() =>
                navigator.clipboard
                  .writeText(device.url)
                  .then(() => notify("Đã sao chép liên kết."))
                  .catch(() =>
                    toast.error(
                      "Không sao chép được. Hãy mở máy chụp và sao chép đường dẫn.",
                    ),
                  )
              }
            >
              Sao chép liên kết
            </Button>
            <div className="kiosk-autostart">
              <h3>
                <Power size={16} aria-hidden="true" /> Bật máy tính là tự mở máy chụp
              </h3>
              <p>
                Tải file cài về <b>máy tính trong phòng</b> rồi chạy một lần: từ
                đó mỗi lần bật máy Windows sẽ mở Chrome toàn màn hình đúng phòng này.{" "}
                FUJIFILM X Acquire sẽ tự mở nếu đã cài; lần đầu nhớ cho phép camera và chọn thư mục ảnh trong “Cài đặt máy chụp”.
              </p>
              <div className="kiosk-autostart-actions">
                <Button
                  className="outline small"
                  onClick={() => {
                    download(
                      "cai-kiosk-NXC.bat",
                      windowsScript(device.url, device.name),
                    );
                    notify(
                      "Đã tải file cài cho Windows. Mở file trên máy trong phòng (nếu Windows hỏi: “Thêm thông tin” → “Vẫn chạy”).",
                    );
                  }}
                >
                  <Download size={15} /> File cài cho Windows
                </Button>
                <Button
                  className="outline small"
                  onClick={() => {
                    download(
                      "cai-kiosk-NXC.command",
                      macScript(device.url, device.name),
                    );
                    notify(
                      "Đã tải file cài cho Mac. Mở Terminal, gõ “bash ” rồi kéo file vào và bấm Enter.",
                    );
                  }}
                >
                  <Download size={15} /> File cài cho Mac
                </Button>
              </div>
              <small>
                Windows: bấm dấu tích ở góc trên bên phải để chọn Toàn màn hình
                (F11), Về cửa sổ hoặc Thu xuống taskbar. Khi đã thu nhỏ, bấm
                biểu tượng Chrome / Edge trên thanh tác vụ để mở lại. Đóng máy chụp:
                Alt+F4.
              </small>
              <p>
                <b>Mac:</b> mở Terminal, gõ <code>bash</code> rồi một dấu cách,
                kéo file cài vừa tải vào Terminal và bấm Enter. Để chuyển sang
                màn phụ, đưa chuột lên mép trên, bấm nút xanh để thoát toàn
                màn hình, kéo cửa sổ sang màn phụ rồi phóng to lại. Có thể
                dùng Fn+F hoặc Control+Command+F tùy phiên bản trình duyệt;
                xem phím tắt trong menu Xem. Đóng máy chụp: Cmd+Q.
              </p>
              <p>
                Máy đã cài bản cũ: đóng máy chụp bằng Alt+F4 (Windows) hoặc Cmd+Q
                (Mac), rồi tải và chạy lại file cài tương ứng một lần để cập
                nhật cách điều khiển cửa sổ.
              </p>
            </div>
            </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
