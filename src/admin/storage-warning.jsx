import { AlertTriangle } from "lucide-react";
import { AssistantAvatar } from "./assistant-avatar";
import { formatDateTime } from "../api";
import { Button } from "../studio";
import { useStorageMonitor } from "./storage-monitor";
import { R2StorageWarning } from "./r2-storage";

const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const mb = (bytes) => number.format(bytes / (1024 * 1024));

// Mức dùng kho ảnh từ số liệu máy chủ: normal < 80% ≤ warning < 90% ≤ critical; thiếu số liệu → unknown.
function storageUsage(summary) {
  const cluster = summary?.cluster;
  const quota = summary?.quota;
  const knownUsage =
    cluster?.available &&
    Number.isFinite(cluster.usedBytes) &&
    cluster.usedBytes >= 0 &&
    quota?.scope === "cluster" &&
    Number.isFinite(quota.limitMB) &&
    quota.limitMB > 0 &&
    Number.isFinite(quota.usagePercent) &&
    quota.usagePercent >= 0 &&
    Number.isFinite(quota.remainingBytes) &&
    quota.remainingBytes >= 0;
  const level = knownUsage
    ? quota.usagePercent >= 90
      ? "critical"
      : quota.usagePercent >= 80
        ? "warning"
        : "normal"
    : "unknown";
  return { cluster, quota, knownUsage, level };
}

// Số % đã dùng cho mục "Dung lượng ảnh" trên thanh bên: nhìn là biết kho còn chỗ hay sắp đầy.
// Chưa có số liệu đáng tin thì không hiện gì.
export function useStorageUsage() {
  const { summary } = useStorageMonitor();
  const { quota, knownUsage, level } = storageUsage(summary);
  return knownUsage ? { percent: Math.min(100, Math.round(quota.usagePercent)), level } : null;
}

export function StorageWarning({ onOpenStorage }) {
  const { summary, loadError } = useStorageMonitor();
  const { cluster, quota, knownUsage, level } = storageUsage(summary);
  const needsCleanup = level === "warning" || level === "critical";
  const unavailable =
    !!loadError || (summary && !knownUsage && Number.isFinite(quota?.limitMB));

  return (
    <>
      {(needsCleanup || unavailable) && (
        <div
          className={`storage-warning storage-warning-${needsCleanup ? level : "unknown"}`}
          role={needsCleanup ? "alert" : "status"}
          aria-atomic="true"
        >
          <AlertTriangle size={24} aria-hidden="true" />
          <div className="storage-warning-copy">
            <strong>
              {needsCleanup
                ? quota.usagePercent >= 100
                  ? "Dung lượng lưu trữ đã đầy"
                  : level === "critical"
                    ? "Dung lượng lưu trữ sắp đầy"
                    : "Dung lượng lưu trữ gần đầy"
                : "Chưa kiểm tra được dung lượng lưu trữ"}
            </strong>
            <p>
              {needsCleanup
                ? `Đã dùng ${mb(cluster.usedBytes)} / ${number.format(quota.limitMB)} MB (${number.format(quota.usagePercent)}%). Còn ${mb(quota.remainingBytes)} MB.`
                : "Chưa có số liệu mới từ MongoDB Atlas để xác định dung lượng còn lại."}
            </p>
            <small>
              {loadError
                ? `${needsCleanup ? `Số liệu cũ · ${formatDateTime(summary.checkedAt)}. ` : ""}Không cập nhật được dung lượng; hệ thống sẽ thử lại.`
                : needsCleanup
                  ? "Mở trợ lí để kiểm tra và dọn ảnh đã hết hạn."
                  : "Mở trợ lí để kiểm tra kết nối và giới hạn lưu trữ."}
            </small>
          </div>
          <Button className="outline small" onClick={onOpenStorage}>
            <AssistantAvatar size={24} /> Mở trợ lí để dọn ảnh
          </Button>
        </div>
      )}
      <R2StorageWarning onOpenStorage={onOpenStorage} />
    </>
  );
}
