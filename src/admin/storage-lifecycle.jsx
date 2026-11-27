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
  const hasExpiredFiles = knownSize(expired.files) && expired.files > 0;
  const canClean =
    measured &&
    !loadError &&
    knownSize(expired.bytes) &&
    hasExpiredFiles;
  const reason = loadError
    ? "Cần số liệu mới trước khi dọn. Bấm Làm mới để kiểm tra lại."
    : !measured
      ? "Chưa đo đủ kho ảnh. Chờ kết nối lại rồi mới dọn."
      : expired.files === 0
        ? "Chưa có file hết hạn cần dọn."
        : expired.orphans > 0 && !autoCleanOrphans
          ? "File R2 không còn dùng đang chờ quản trị viên dọn."
          : "";
  return (
    <section
      className="panel storage-lifecycle"
      aria-labelledby="storage-cleanup-title"
    >
      <header className="storage-store-heading">
        <h4 id="storage-cleanup-title">
          <ShieldCheck size={18} aria-hidden="true" /> Hạn lưu ảnh & dọn dẹp
        </h4>
        <span className="storage-state">Lưu {storageNumber.format(summary.ttlHours)} giờ</span>
      </header>
      <div className="storage-lifecycle-grid">
        <div className="storage-expiry" aria-label="Ảnh sắp xoá gần nhất">
          <span>
            <Clock size={16} aria-hidden="true" /> Ảnh sắp xoá gần nhất
          </span>
          <strong>{expiry.label}</strong>
          {(expiry.known || loadError) && <p className="storage-expiry-time">
            {expiry.known && `Hết hạn lúc ${formatDateTime(expiry.expiresAt)}`}
            {loadError && <span>{expiry.known && " · "}Số liệu cũ</span>}
          </p>}
        </div>
        <div className="storage-reclaim">
          <span>
            <Trash2 size={16} aria-hidden="true" /> Có thể dọn ngay
          </span>
          <strong>{measured ? storageMB(expired.bytes) : "Chưa đo đủ"}</strong>
          {measured && hasExpiredFiles && <>
            <p className="storage-expiry-time">
              {storageCount.format(expired.files)} file đủ điều kiện dọn
            </p>
            <div className="storage-expired-counts">
              {expired.photos > 0 && <span>
                <Image size={16} aria-hidden="true" /> {storageCount.format(expired.photos)} ảnh hết hạn
              </span>}
              {expired.printJobs > 0 && <span>
                <Printer size={16} aria-hidden="true" /> {storageCount.format(expired.printJobs)} lệnh in hết hạn
              </span>}
              {expired.orphans > 0 && <span>
                <FileX size={16} aria-hidden="true" /> {storageCount.format(expired.orphans)} file không còn dùng
              </span>}
            </div>
          </>}
        </div>
      </div>
      <div className="storage-cleanup-actions">
        <div className="storage-cleanup-status">
          <p className="storage-lifecycle-copy">
            Hệ thống dọn ảnh và file in hết hạn mỗi 15 phút.
            {autoCleanOrphans && " File R2 không còn dùng được dọn tự động mỗi giờ khi đủ hạn."}
          </p>
          {reason && <p className="storage-cleanup-reason" id="storage-cleanup-reason" role="status">{reason}</p>}
        </div>
        {canManageStorage && <Button
          className="outline small"
          onClick={onCleanup}
          disabled={!!busy || !canClean}
          aria-busy={busy === "cleanup"}
          aria-describedby={reason ? "storage-cleanup-reason" : undefined}
        >
          <Trash2 size={16} aria-hidden="true" />{" "}
          {busy === "cleanup" ? "Đang dọn…" : "Dọn ảnh đã hết hạn"}
        </Button>}
      </div>
    </section>
  );
}
