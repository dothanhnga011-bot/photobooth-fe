import { AlertTriangle, Cloud, Gauge, HardDrive, Image, Receipt } from "lucide-react";
import { AssistantAvatar } from "./assistant-avatar";
import { formatDateTime } from "../api";
import { Button, ErrorBox } from "../studio";
import { useStorageMonitor } from "./storage-monitor";
import {
  knownSize,
  storageMB,
  storageSize,
  StorageCapacity,
} from "./storage-ui";

const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const gb = (bytes) => number.format(bytes / 1_000_000_000);
const usd = (amount) => (amount > 0 && amount < 0.005
  ? "dưới 0,01 USD"
  : `${new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} USD`);
// "2026-11-15" → "15/11"
const dayMonth = (date) => date.slice(8, 10) + "/" + date.slice(5, 7);
const quotaKnown = (r2) =>
  r2?.available &&
  knownSize(r2.usedBytes) &&
  knownSize(r2.quota?.usagePercent) &&
  knownSize(r2.quota?.remainingBytes) &&
  Number.isFinite(r2.quota?.limitGB) &&
  r2.quota.limitGB > 0;
// Cloudflare R2 tính tiền theo GB-tháng = trung bình dung lượng ĐỈNH mỗi ngày trên 30 ngày (miễn phí 10 GB-tháng,
// sau đó 0,015 USD / GB-tháng), không theo dung lượng đang lưu lúc này (16/11 chủ tiệm: trang báo 61,9 / 10 GB =
// 618 % trong khi Cloudflare → Billing chỉ tính 9,96 GB-tháng, 0 USD). Máy chủ cũ chưa gửi `billing` thì giữ cách cũ.
const billingKnown = (r2) =>
  r2?.available &&
  knownSize(r2.usedBytes) &&
  Number.isFinite(r2.billing?.monthToDate) &&
  Number.isFinite(r2.billing?.limitGBMonths) &&
  ["normal", "warning", "critical"].includes(r2.billing?.level);
export const r2StorageLevel = (r2) =>
  billingKnown(r2)
    ? r2.billing.level
    : !quotaKnown(r2)
      ? "unknown"
      : r2.quota.usagePercent >= 90
        ? "critical"
        : r2.quota.usagePercent >= 80
          ? "warning"
          : "normal";

// Tiền R2 đã tính tới hôm nay, quy ra tiền đồng (16/11 chủ tiệm: "tính tiền hiện tại là bao nhiêu", bỏ phần dự kiến
// cuối tháng, "đổi luôn USD sang tiền Việt"). Cloudflare tính bằng USD; tỉ giá ước tính do máy chủ gửi (USD_VND_RATE),
// máy chủ cũ chưa gửi thì dùng 26.400 đ. USD chỉ còn ở dòng nhỏ để đối chiếu với hoá đơn Cloudflare.
const DEFAULT_VND_PER_USD = 26_400;
const rateOf = (b) => (Number(b?.vndPerUsd) > 0 ? Number(b.vndPerUsd) : DEFAULT_VND_PER_USD);
const dong = (value) => `${new Intl.NumberFormat("vi-VN").format(value)} đ`;
// Làm tròn 10 đ: số tiền R2 thường chỉ vài nghìn đồng.
const vnd = (amount, b) => {
  if (!(amount > 0)) return "0 đ";
  const value = Math.round((amount * rateOf(b)) / 10) * 10;
  return value < 10 ? "dưới 10 đ" : `≈ ${dong(value)}`;
};
// "≈ 1.050 đ" / "0 đ (còn trong mức miễn phí)"
const costText = (b) =>
  b.monthToDateCostUSD > 0 ? vnd(b.monthToDateCostUSD, b) : "0 đ (còn trong mức miễn phí)";

export function R2StorageWarning({ onOpenStorage }) {
  const { summary, loadError } = useStorageMonitor();
  const r2 = summary?.r2;
  const level = r2StorageLevel(r2);
  const high = ["critical", "warning"].includes(level);
  const billing = billingKnown(r2);
  const unavailable =
    r2 &&
    (r2.active || r2.configured || r2.error) &&
    (!r2.available || !knownSize(r2.usedBytes));
  if (!high && !unavailable) return null;
  return (
    <div
      className={`storage-warning storage-warning-${high ? level : "unknown"}`}
      role={high ? "alert" : "status"}
      aria-atomic="true"
    >
      <AlertTriangle size={24} aria-hidden="true" />
      <div className="storage-warning-copy">
        <strong>
          {!high
            ? "Chưa kiểm tra được kho ảnh R2"
            : billing
              ? level === "critical"
                ? "Kho ảnh R2 đã vượt mức miễn phí tháng này"
                : "Kho ảnh R2 sắp hết mức miễn phí tháng này"
              : "Kho ảnh R2 gần mức cảnh báo"}
        </strong>
        <p>
          {!high
            ? r2.error || "Chưa có số liệu dung lượng từ kho ảnh."
            : billing
              ? `Đã tính ${number.format(r2.billing.monthToDate)} / ${number.format(r2.billing.limitGBMonths)} GB-tháng (${number.format(r2.billing.usagePercent)}%) · tiền R2 tháng này: ${costText(r2.billing)}.`
              : `R2 đang lưu ${gb(r2.usedBytes)} / ${number.format(r2.quota.limitGB)} GB (${number.format(r2.quota.usagePercent)}%).`}
        </p>
        <small>
          {loadError
            ? `Số liệu cũ · ${formatDateTime(summary.checkedAt)}. `
            : ""}
          {!high
            ? "Mở trợ lí để xem trạng thái kết nối."
            : billing
              ? "R2 tính tiền theo trung bình dung lượng đỉnh mỗi ngày trong tháng, không theo số đang lưu lúc này. Dọn ảnh hết hạn để giảm."
              : "Dọn ảnh hết hạn để giảm dung lượng. Đây là mức theo dõi; phí R2 còn phụ thuộc sử dụng trong tháng."}
        </small>
      </div>
      <Button className="outline small" onClick={onOpenStorage}>
        <AssistantAvatar size={24} /> Mở trợ lí để dọn ảnh
      </Button>
    </div>
  );
}

// Số GB-tháng R2 đã tính tháng này, tiền tương ứng tới hôm nay và dung lượng đang lưu.
function R2Billing({ r2, level }) {
  const b = r2.billing;
  const month = Number(b.period.start.slice(5, 7));
  const cloudflare = b.source === "cloudflare";
  const price = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(b.pricePerGBMonth);
  // Giá một GB-tháng quy ra đồng: 0,015 USD × 26.400 = 396 đ.
  const priceVnd = dong(Math.round(b.pricePerGBMonth * rateOf(b)));
  return (
    <>
      <div className="storage-r2-metrics">
        <article className="storage-r2-used">
          <span>
            <Gauge size={16} aria-hidden="true" /> Đã tính tháng {month} (đến hôm nay)
          </span>
          <strong>{number.format(b.monthToDate)} GB-tháng</strong>
          <small>Miễn phí {number.format(b.freeGBMonths)} GB-tháng mỗi tháng</small>
        </article>
        <article className="storage-r2-remaining">
          <span>
            <Receipt size={16} aria-hidden="true" /> Tiền R2 tháng {month} (đến hôm nay)
          </span>
          <strong>{vnd(b.monthToDateCostUSD, b)}</strong>
          <small>
            {b.monthToDateCostUSD > 0
              ? `Vượt ${number.format(b.monthToDate - b.freeGBMonths)} GB-tháng × ${priceVnd} · Cloudflare tính ${usd(b.monthToDateCostUSD)}`
              : "Còn trong mức miễn phí"}
          </small>
        </article>
      </div>
      <StorageCapacity
        level={level}
        label={`Mức theo dõi: ${number.format(b.limitGBMonths)} GB-tháng${b.limitGBMonths === b.freeGBMonths ? " (miễn phí của R2)" : ""}`}
        percent={b.usagePercent}
        ariaLabel="Phần trăm GB-tháng R2 đã tính tháng này"
      >
        R2 tính tiền theo GB-tháng: dung lượng đỉnh mỗi ngày cộng lại ÷ 30. Miễn phí {number.format(b.freeGBMonths)} GB-tháng,
        sau đó khoảng {priceVnd} / GB-tháng ({price} USD). Tiền đồng quy đổi theo tỉ giá ước tính {dong(rateOf(b))} / USD.
      </StorageCapacity>
      <p className="storage-r2-now">
        <Image size={16} aria-hidden="true" /> Đang lưu lúc này: <b>{storageSize(r2.usedBytes)}</b>
        {knownSize(r2.files) ? ` · ${number.format(r2.files)} file` : ""} — ảnh hết hạn được xoá dần nên số này lên xuống
        trong ngày.
      </p>
      <p className="storage-r2-source">
        {cloudflare
          ? "Số đo lấy từ Cloudflare, giống trang Billing."
          : b.missingDays > 0
            ? `Máy chủ tự đo mỗi giờ từ ${b.firstMeasured ? dayMonth(b.firstMeasured) : "hôm nay"}; ${b.missingDays} ngày đầu tháng chưa có số đo nên số trên thấp hơn hoá đơn. Số chính xác: Cloudflare → Billing (hoặc thêm CLOUDFLARE_API_TOKEN trên máy chủ để trang này đọc thẳng số của Cloudflare).`
            : "Máy chủ tự đo mỗi giờ (lấy đỉnh từng ngày)."}
      </p>
      {b.cloudflare?.error && <p className="storage-r2-source is-warn">{b.cloudflare.error}</p>}
    </>
  );
}

// children: phần thêm cuối thẻ (vd. danh sách ảnh của từng khách cho quản trị viên).
export function R2Storage({ children = null }) {
  const { summary } = useStorageMonitor();
  const r2 = summary?.r2;
  if (!r2) return null;
  const level = r2StorageLevel(r2);
  const measured = r2.available && knownSize(r2.usedBytes);
  const warning = ["critical", "warning"].includes(level);
  const billing = billingKnown(r2);
  return (
    <section className="panel storage-r2" aria-labelledby="r2-storage-title">
      <header className="storage-store-heading">
        <h4 id="r2-storage-title">
          <Cloud size={18} aria-hidden="true" /> Kho ảnh Cloudflare R2
        </h4>
        <span className={`storage-state is-${level}`}>
          {billing
            ? `${number.format(r2.billing.usagePercent)}% miễn phí tháng này`
            : quotaKnown(r2)
              ? `${number.format(r2.quota.usagePercent)}% đã dùng`
              : measured && r2.quota?.limitGB == null
                ? "Chưa đặt mức theo dõi"
                : "Chưa đủ số liệu"}
        </span>
      </header>
      <p className="storage-store-copy">
        {r2.active
          ? "Đang nhận ảnh mới tại đây. Ảnh cũ trong MongoDB vẫn xem và tải được."
          : "Ảnh mới đang lưu trong MongoDB. R2 chưa được bật để nhận ảnh mới."}
      </p>
      {r2.error && <ErrorBox error={r2.error} />}
      {!r2.configured && !r2.error ? (
        <p className="storage-r2-status">
          Chưa kết nối kho ảnh. Cần tạo bucket R2 và cấu hình kết nối trên máy
          chủ.
        </p>
      ) : billing ? (
        <R2Billing r2={r2} level={level} />
      ) : (
        <>
          <div className="storage-r2-metrics">
            <article className="storage-r2-used">
              <span>
                <Image size={16} aria-hidden="true" /> Ảnh và file đã dùng
              </span>
              <strong>
                {measured ? storageSize(r2.usedBytes) : "Chưa đo được"}
              </strong>
              <small>
                {measured
                  ? `${storageMB(r2.usedBytes)}${knownSize(r2.files) ? ` · ${number.format(r2.files)} file` : ""}`
                  : "Đang chờ số liệu từ kho ảnh"}
              </small>
            </article>
            <article className="storage-r2-remaining">
              <span>
                <HardDrive size={16} aria-hidden="true" /> Còn trong mức theo
                dõi
              </span>
              <strong>
                {quotaKnown(r2)
                  ? storageSize(r2.quota.remainingBytes)
                  : r2.quota?.limitGB == null
                    ? "Chưa đặt mức"
                    : "Chưa đo được"}
              </strong>
              <small>
                {r2.quota?.limitGB == null
                  ? "Chưa đặt mức theo dõi"
                  : `Mức theo dõi: ${number.format(r2.quota.limitGB)} GB`}
              </small>
            </article>
          </div>
          {quotaKnown(r2) && (
            <StorageCapacity
              level={level}
              label={`Mức theo dõi: ${number.format(r2.quota.limitGB)} GB`}
              percent={r2.quota.usagePercent}
              ariaLabel="Phần trăm dung lượng kho ảnh R2"
            >
              Cảnh báo từ 80%, cần chú ý từ 90%. Mức theo dõi không chặn lưu
              ảnh.
            </StorageCapacity>
          )}
        </>
      )}
      {warning && (
        <p className={`storage-r2-advice storage-level-${level}`} role="alert">
          {billing
            ? level === "critical"
              ? `Đã vượt ${number.format(r2.billing.limitGBMonths)} GB-tháng miễn phí: tiền R2 tháng này ${costText(r2.billing)}. Dọn file hết hạn bên dưới để giảm.`
              : `Đã dùng ${number.format(r2.billing.usagePercent)}% mức miễn phí tháng này. Dọn file hết hạn bên dưới để giảm.`
            : r2.quota.usagePercent >= 100
              ? "Đã chạm hoặc vượt mức theo dõi. Nên dọn file hết hạn bên dưới."
              : "Kho ảnh gần mức theo dõi. Bạn có thể dọn file hết hạn bên dưới."}
        </p>
      )}
      {children}
    </section>
  );
}
