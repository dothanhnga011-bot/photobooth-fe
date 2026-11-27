import { useEffect, useState } from "react";
import { Clock, FileX, Image, Printer, ShieldCheck, Trash2 } from "lucide-react";
import { formatDateTime } from "../api";
import { Button } from "../studio";
import { imageRetention } from "./storage-retention";
import {
  completeMediaMeasurements,
  knownSize,
  storageCount,
  storageMB,
  storageNumber,
} from "./storage-ui";

export function StorageLifecycle({
  summary,
  loadError,
  busy,
  canManageStorage,
  onCleanup,
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const expiry = imageRetention(summary, now, loadError);
  const measured = completeMediaMeasurements(summary);
  const expired = summary.expired;
  const autoCleanOrphans = summary.r2?.autoCleanOrphans;
  const canClean =
    measured &&
    !loadError &&
    knownSize(expired.files) &&
    knownSize(expired.bytes) &&
    expired.files > 0;
  const reason = loadError
    ? "Cần số liệu mới trước khi dọn. Bấm Làm mới để kiểm tra lại."
    : !measured
      ? "Chưa đo đủ kho ảnh. Chờ kết nối lại rồi mới dọn."
      : expired.files === 0
        ? "Chưa có file hết hạn cần dọn."
        : expired.orphans > 0 && !autoCleanOrphans
          ? "File R2 không còn dùng đang chờ quản trị viên dọn."
          : "File đang chờ đợt dọn tự động. Bạn cũng có thể dọn ngay.";
  return (
    <section
      className="panel storage-lifecycle"
      aria-labelledby="storage-cleanup-title"
    >
      <h4 id="storage-cleanup-title">
        <ShieldCheck size={18} aria-hidden="true" /> Hạn lưu ảnh & dọn dẹp
      </h4>
      <div className="storage-lifecycle-grid">
        <div className="storage-expiry" aria-label="Ảnh sắp xoá gần nhất">
          <span>
            <Clock size={16} aria-hidden="true" /> Ảnh sắp xoá gần nhất
          </span>
          <strong>{expiry.label}</strong>
          <p className="storage-expiry-time">
            {expiry.known
              ? `Hết hạn lúc ${formatDateTime(expiry.expiresAt)}`
              : "Theo hạn của ảnh đang lưu trong kho."}
            {loadError && <span> · Số liệu cũ</span>}
          </p>
        </div>
        <div className="storage-reclaim">
          <span>
            <Trash2 size={16} aria-hidden="true" /> Có thể dọn ngay
          </span>
          <strong>{measured ? storageMB(expired.bytes) : "Chưa đo đủ"}</strong>
          <p className="storage-expiry-time">
            {measured && knownSize(expired.files)
              ? `${storageCount.format(expired.files)} file đủ điều kiện dọn`
              : "Chờ số liệu đầy đủ từ kho ảnh"}
          </p>
        </div>
      </div>
      <p className="storage-lifecycle-copy">
        Ảnh lưu {storageNumber.format(summary.ttlHours)} giờ. Hệ thống dọn ảnh và file in hết hạn mỗi 15 phút.
        {autoCleanOrphans && " File R2 không còn dùng được dọn tự động mỗi giờ khi đủ hạn."}
      </p>
      <div className="storage-expired-counts">
        <span>
          <Image size={16} aria-hidden="true" />{" "}
          {storageCount.format(expired.photos)} ảnh hết hạn
        </span>
        <span>
          <Printer size={16} aria-hidden="true" />{" "}
          {storageCount.format(expired.printJobs)} lệnh in hết hạn
        </span>
        {expired.orphans > 0 && (
          // Tệp trên kho không còn album / lệnh in nào dùng (đổi database, ảnh cũ đã xoá…).
          <span title="Không album hay lệnh in nào còn dùng, đã quá hạn lưu">
            <FileX size={16} aria-hidden="true" />{" "}
            {storageCount.format(expired.orphans)} file không còn dùng
          </span>
        )}
      </div>
      <div className="storage-cleanup-actions">
        {canManageStorage && (
          <Button
            className="small"
            onClick={onCleanup}
            disabled={!!busy || !canClean}
          >
            <Trash2 size={16} aria-hidden="true" />{" "}
            {busy === "cleanup" ? "Đang dọn…" : "Dọn ảnh đã hết hạn"}
          </Button>
        )}
      </div>
      <p className="storage-cleanup-reason" role="status">
        {canManageStorage
          ? reason
          : "Hệ thống tự dọn theo lịch. Quản trị viên có thể dọn ngay khi cần."}
      </p>
    </section>
  );
}
