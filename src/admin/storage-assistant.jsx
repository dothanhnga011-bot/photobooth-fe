import { useState } from "react";
import {
  ChevronDown,
  Clock,
  Database,
  FileImage,
  Image,
  Layers,
  Printer,
  RefreshCw,
  Video,
} from "lucide-react";
import { api, formatDateTime } from "../api";
import { Button, ErrorBox, useToast } from "../studio";
import { useStorageMonitor } from "./storage-monitor";
import { AssistantAvatar } from "./assistant-avatar";
import { CustomerStorage } from "./customer-storage";
import { R2Storage, r2StorageLevel } from "./r2-storage";
import { MongoStorage, mongoStorageState } from "./mongo-storage";
import { StorageLifecycle } from "./storage-lifecycle";
import {
  completeMediaMeasurements,
  knownSize,
  storageCount,
  storageMB,
  StorageMetric,
} from "./storage-ui";

const groups = [
  ["photos", "Ảnh chụp / ảnh JPEG", Image],
  ["originals", "Ảnh gốc tải lên", FileImage],
  ["thumbnails", "Ảnh nhỏ thư viện", Image],
  ["printSheets", "Tờ in", Printer],
  ["videos", "Video", Video],
  ["other", "File khác", Layers],
];

export function StorageAssistant({ canManageStorage = false }) {
  const toast = useToast();
  const { summary, loadError, load, publishSummary } = useStorageMonitor();
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }
  async function cleanup() {
    // Guard against stale clicks as well as disabling the visible control.
    if (
      busy ||
      loadError ||
      !completeMediaMeasurements(summary) ||
      !knownSize(summary.expired.files) ||
      !knownSize(summary.expired.bytes) ||
      summary.expired.files <= 0
    )
      return;
    const expired = summary.expired;
    if (
      !window.confirm(
        `Dọn ${storageCount.format(expired.files)} file đã hết hạn (${storageMB(expired.bytes)})?\n` +
          `Dữ liệu gồm ${storageCount.format(expired.photos)} ảnh và ${storageCount.format(expired.printJobs)} lệnh in đã hết hạn` +
            (expired.orphans > 0
              ? `, cùng ${storageCount.format(expired.orphans)} file không còn album hay lệnh in nào dùng`
              : "") +
            ". File còn hạn được giữ lại.",
      )
    )
      return;
    setBusy("cleanup");
    setActionError("");
    try {
      const data = await api("/admin/storage/cleanup-expired", {
        method: "POST",
      });
      publishSummary(data.summary);
      window.dispatchEvent(new Event("nxc:print"));
      toast.success(
        Number.isFinite(data.freedBytes)
          ? `Đã dọn file hết hạn, giải phóng ${storageMB(data.freedBytes)}.`
          : "Đã dọn file hết hạn. Chưa đo đủ dung lượng giải phóng.",
      );
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy("");
    }
  }
  const hasR2 = !!(
    summary?.r2?.configured ||
    summary?.r2?.active ||
    summary?.r2?.error
  );
  const measured = completeMediaMeasurements(summary);
  const healthy =
    summary &&
    !loadError &&
    measured &&
    mongoStorageState(summary).level === "normal" &&
    (!hasR2 || r2StorageLevel(summary.r2) === "normal");
  const database = summary?.database;
  return (
    <section
      className="storage-assistant"
      aria-labelledby="storage-assistant-title"
    >
      <header className="storage-heading">
        <div className="storage-heading-copy">
          <span className="storage-avatar">
            <AssistantAvatar size={46} />
          </span>
          <h3 id="storage-assistant-title">Trợ lí Minh</h3>
        </div>
        <Button
          className="outline small"
          onClick={refresh}
          disabled={refreshing || !!busy}
          aria-busy={refreshing}
        >
          <RefreshCw
            size={15}
            className={refreshing ? "storage-spinning" : ""}
            aria-hidden="true"
          />{" "}
          Làm mới
        </Button>
        {summary && (
          <p
            className={`storage-updated${loadError ? " is-stale" : ""}`}
            role="status"
          >
            <Clock size={13} aria-hidden="true" />
            <span>
              {loadError ? "Số liệu cũ · cập nhật lần cuối " : "Cập nhật "}
              {formatDateTime(summary.checkedAt)} · Tự làm mới mỗi 30 giây.
            </span>
          </p>
        )}
      </header>
      <ErrorBox error={loadError} />
      <ErrorBox error={actionError} />
      {!summary ? (
        <div className="panel storage-loading" role="status">
          <Database size={25} aria-hidden="true" />
          {loadError
            ? "Chưa lấy được dung lượng. Bấm Làm mới để thử lại."
            : "Đang kiểm tra dung lượng lưu trữ…"}
        </div>
      ) : (
        <>
          <StorageLifecycle
            summary={summary}
            loadError={loadError}
            busy={busy}
            canManageStorage={canManageStorage}
            onCleanup={cleanup}
          />
          <div className="storage-overview">
            {hasR2 ? (
              <R2Storage />
            ) : (
              <section
                className="panel storage-photo-store"
                aria-labelledby="storage-photo-title"
              >
                <h4 id="storage-photo-title">
                  <Image size={18} aria-hidden="true" /> Kho ảnh trong MongoDB
                </h4>
                <p className="storage-store-copy">
                  Ảnh và file in dùng chung dung lượng MongoDB Atlas với dữ liệu vé và cài đặt.
                </p>
                <StorageMetric
                  icon={Image}
                  title="Ảnh và file trong MongoDB"
                  value={measured ? storageMB(summary.media.bytes) : "Chưa đo đủ"}
                >
                  {measured && knownSize(summary.media.files)
                    ? `${storageCount.format(summary.media.files)} file đang lưu`
                    : "Chờ số liệu đầy đủ"}
                </StorageMetric>
              </section>
            )}
            <MongoStorage />
          </div>
          {canManageStorage && <CustomerStorage canManageStorage />}
          <details className="panel storage-breakdown">
            <summary>
              <Layers size={18} aria-hidden="true" />
              <span>Chi tiết ảnh đang lưu</span>
              <span className="storage-detail-total">
                {measured
                  ? `${storageMB(summary.media.bytes)} · ${storageCount.format(summary.media.files)} file`
                  : "Số liệu chưa đầy đủ"}
              </span>
              <ChevronDown
                size={18}
                className="storage-disclosure-icon"
                aria-hidden="true"
              />
            </summary>
            <div className="storage-breakdown-content">
              <p className="storage-store-copy">
                {hasR2
                  ? "Tổng ảnh và file trên R2 + MongoDB. Một ảnh có thể có bản gốc, JPEG và ảnh nhỏ thư viện."
                  : "Dung lượng từng loại file trong kho ảnh MongoDB."}
              </p>
              <dl>
                {groups
                  .filter(
                    ([key]) =>
                      key !== "thumbnails" || summary.media.groups.thumbnails,
                  )
                  .map(([key, label, Icon]) => (
                    <div key={key}>
                      <dt>
                        <Icon size={16} aria-hidden="true" /> {label}
                      </dt>
                      <dd>
                        <strong>
                          {storageMB(summary.media.groups[key]?.bytes ?? 0)}
                        </strong>
                        <small>
                          {storageCount.format(
                            summary.media.groups[key]?.files ?? 0,
                          )}{" "}
                          file{!measured ? " · đã đo" : ""}
                        </small>
                      </dd>
                    </div>
                  ))}
              </dl>
              {!measured && (
                <p className="storage-database-detail">
                  Chưa đo được kho R2. Số liệu từng loại file bên trên mới gồm
                  phần trong MongoDB.
                </p>
              )}
              {database.available ? (
                <p className="storage-database-detail">
                  Database ứng dụng: {storageMB(database.usedBytes)} (dữ liệu:{" "}
                  {storageMB(database.dataBytes)} · chỉ mục:{" "}
                  {storageMB(database.indexBytes)}). Phần này chỉ thống kê
                  database của ứng dụng.
                </p>
              ) : (
                <p className="storage-database-detail">
                  {database.error ||
                    "Máy chủ chưa cung cấp số liệu dung lượng database ứng dụng."}
                </p>
              )}
              <p className="storage-database-detail">
                1 MB = 1.048.576 byte. 1 GB trên R2 = 1.000.000.000 byte. Số
                liệu trong trang là dung lượng hiện tại, không phải hoá đơn
                tháng.
              </p>
            </div>
          </details>
          {healthy && (
            <p className="storage-signature">
              Gì cũng đến tay tôi bạn chả được cái nước gì đâu
            </p>
          )}
        </>
      )}
    </section>
  );
}
