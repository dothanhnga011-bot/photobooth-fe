import { useEffect, useRef, useState } from "react";
import { Bell, Check, Clock, Download, Printer, Trash2 } from "lucide-react";
import { api, assetUrl, formatDateTime } from "../api";
import { isConnectivityError } from "../network.js";
import { useLiveData } from "../use-live-data";
import { Guide } from "../guide";
import { Button, ErrorBox, useToast } from "../studio";
import { printLargeSheets } from "./print-sheet.js";
import { PRINT_BRANCHES, printBranchName, printQueuePath } from './print-branches.js';
import './print-queue.css';

// Hàng chờ in của phòng Selfbooth (như web Selfbooth): khách bấm "Gửi in" trên điện thoại → lệnh in hiện ở đây
// ngay (có chuông báo); nhân viên ở quầy bấm "In 20×30" → cửa sổ in của trình duyệt ra máy DNP DS820 ở quầy,
// nhận được ảnh rồi bấm "Đã in". Phòng Photobooth vẫn in tự động ở máy RX1 của phòng, không vào hàng này.
const time = formatDateTime;
const sheetUrl = (job, index, thumbnail = false) => assetUrl(`${job.image}?sheet=${index}${thumbnail ? "&size=thumbnail" : ""}`);
const minutesLeft = (job, now) => Math.max(0, Math.ceil((new Date(job.expiresAt).getTime() - now) / 60000));
const duration = (minutes) => {
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
  if (days) return `${days} ngày ${hours} giờ`;
  return hours ? `${hours} giờ ${String(rest).padStart(2, "0")} phút` : `${rest} phút`;
};
// Đồng hồ cập nhật nửa phút một lần cho các ô đếm ngược.
function useNow(every = 30000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

// Số lệnh in Selfbooth đang chờ (huy hiệu trên thanh bên).
export function usePendingPrints(branch) {
  const [rows, setRows] = useState([]);
  const load = useLiveData('/admin/print-jobs/branches?size=large', setRows, () => {}, 30000);
  useEffect(() => {
    const refresh = () => load({ share: true });
    window.addEventListener("nxc:print", refresh);
    return () => window.removeEventListener("nxc:print", refresh);
  }, [load]);
  return rows.filter(row=>branch===undefined||row.branch===branch).reduce((sum,row)=>sum+(Number(row.pending)||0),0);
}

export function PrintQueue({ canOperate = false, canDelete = false, branch = PRINT_BRANCHES[0], assignedBranch = '', onBranchChange = () => {} }) {
  const now = useNow();
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const path = printQueuePath(branch,status);
  const currentPath = useRef(path);
  currentPath.current = path;
  const [result, setResult] = useState(null);
  const loaded = result?.path === path;
  const jobs = loaded ? result.jobs : [];
  const [branches, setBranches] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const lastError = useRef("");
  useEffect(()=>{ setError(''); lastError.current=''; },[path]);
  const [permission, setPermission] = useState("Notification" in window ? Notification.permission : "unsupported");
  const load = useLiveData(
    path,
    (list) => {
      setResult(old => old?.path === path && JSON.stringify(old.jobs) === JSON.stringify(list) ? old : {path,jobs:list});
      setError("");
      lastError.current = "";
    },
    (e) => {
      setError(e.message);
      // Mất kết nối: thông báo chung của trang đã báo, không lặp ở từng bảng.
      if (lastError.current !== e.message && !isConnectivityError(e)) toast.error(e.message);
      lastError.current = e.message;
    },
    15000,
  );
  const loadBranches = useLiveData('/admin/print-jobs/branches?size=large', setBranches, () => {}, 15000);
  useEffect(() => {
    const refresh = () => { load({ share: true }); loadBranches({ share: true }); };
    window.addEventListener("nxc:print", refresh);
    return () => window.removeEventListener("nxc:print", refresh);
  }, [load,loadBranches]);
  const sites = assignedBranch ? [assignedBranch.trim()] : [...new Set([...PRINT_BRANCHES,branch,...branches.map(row=>row.branch)])];

  async function act(job, request, message) {
    setBusyId(job._id);
    try {
      await request();
      window.dispatchEvent(new Event("nxc:print"));
      if (currentPath.current === path) await load({ share: true });
      toast.success(message);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId("");
    }
  }
  function print(job) {
    try {
      printLargeSheets({
        imageUrls: Array.from({ length: job.sheetCount || 1 }, (_, i) => sheetUrl(job, i)),
        code: job.code,
        copies: job.copies,
        branch: job.branch,
      });
      toast.info(`Đang mở bản in vé #${job.code}. Chọn máy in DNP DS820, giấy 8 × 12 inch (20 × 30 cm).`);
    } catch (e) {
      toast.error(e.message);
    }
  }
  const pending = status === "pending";
  return (
    <>
      <ErrorBox error={error} />
      <section className="print-branch-panel" aria-label="Hàng chờ in theo cơ sở">
        <strong>Cơ sở nhận in</strong>
        <div className="print-branch-tabs" role="group" aria-label="Chọn cơ sở in">
          {sites.map(site => <button key={site} type="button" aria-pressed={branch === site}
            aria-label={printBranchName(site)} onClick={()=>onBranchChange(site)}>
            <span>{printBranchName(site)}</span>
            <small>{branches.find(row=>row.branch===site)?.pending ?? 0} chờ in</small>
          </button>)}
        </div>
        <p>Đang xem <b>{printBranchName(branch)}</b>. {assignedBranch ? 'Tài khoản chỉ nhận lệnh của cơ sở được phân công.' : 'Chọn cơ sở để xem và in riêng từng hàng chờ.'}</p>
      </section>
      <Guide
        id="print-ds820"
        title="in ảnh 20 × 30 bằng DNP DS820"
        steps={[
          "Khách bấm “Gửi in” trên điện thoại → lệnh in hiện ở đây (có chuông báo).",
          "Bấm “In 20×30” → cửa sổ in mở ra.",
          "Chọn máy in DNP DS820, giấy 8 × 12 inch (driver DNP: (8x12)), hướng Ngang, tỉ lệ 100%, lề Không có, tắt đầu trang / chân trang.",
          "Nhận được ảnh in rồi mới bấm “Đã in”. In hỏng thì bấm “In 20×30” lần nữa (hoặc “In lại” ở tab Đã in).",
        ]}
        note="Chỉ lệnh in của phòng Selfbooth vào đây. Phòng Photobooth vẫn tự in ở máy RX1 của phòng. Lệnh in tự xoá sau 3 ngày kể từ lúc khách gửi."
      />
      <div className="admin-toolbar">
        <div className="segmented print-view-tabs" aria-label="Hàng chờ in">
          {[["pending", "Chờ in"], ["printed", "Đã in"]].map(([key, label]) => (
            <button key={key} className={status === key ? "active" : ""} aria-pressed={status === key} onClick={() => setStatus(key)}>
              {label}
            </button>
          ))}
        </div>
        {permission === "default" && (
          <Button className="outline small" onClick={() => Notification.requestPermission().then((result) => {
            setPermission(result);
            if (result === "granted") toast.success("Đã bật thông báo lệnh in trên máy này.");
            else toast.warning("Trình duyệt đang chặn thông báo. Bạn vẫn nhận thông báo trong trang.");
          })}>
            <Bell size={15} /> Bật thông báo trên máy
          </Button>
        )}
      </div>
      <div className="print-grid">
        {jobs.map((job) => {
          const sheets = job.sheetCount || 1;
          const left = minutesLeft(job, now);
          return (
            <article key={job._id} className="panel print-card">
              <div className={`print-sheets${sheets > 1 ? " many" : ""}`}>
                {Array.from({ length: sheets }, (_, i) => (
                  <a key={i} href={sheetUrl(job, i)} target="_blank" rel="noreferrer" title={`Xem tờ ${i + 1} cỡ lớn`}>
                    <img
                      // Xem lướt dùng bản nhỏ; bấm vào mới mở tờ cỡ lớn.
                      src={sheetUrl(job, i, true)}
                      alt={`Tờ ${i + 1} · vé ${job.code}`}
                      loading="lazy"
                      onError={(e) => {
                        // Tờ in không còn trên máy chủ: hiện chữ thay cho ảnh hỏng.
                        e.currentTarget.parentElement.classList.add("is-missing");
                        e.currentTarget.parentElement.dataset.label = `Tờ ${i + 1}: ảnh không còn trên máy chủ`;
                      }}
                    />
                  </a>
                ))}
              </div>
              <div>
                <strong>#{job.code}{job.name ? ` · ${job.name}` : ""}</strong>
                <small><b>{printBranchName(job.branch)}</b> · {job.roomName || "Phòng Selfbooth"} · {job.frameName || "Khung ảnh"} · {sheets} tờ × {job.copies || 1} bản</small>
                <small>{pending ? `Gửi lúc ${time(job.createdAt)}` : `In lúc ${time(job.printedAt)}${job.printedBy ? ` · ${job.printedBy}` : ""}`}</small>
                <span className={`expiry-chip${left <= 60 ? (pending ? " is-urgent" : " is-soon") : ""}`}
                  title={`Tự xoá lúc ${time(job.expiresAt)}`}>
                  <Clock size={13} /> Tự xoá sau {duration(left)}
                </span>
              </div>
              <div className="print-actions">
                <Button className="small" disabled={!canOperate} onClick={() => print(job)}>
                  <Printer size={15} /> {pending ? "In 20×30" : "In lại"}
                </Button>
                {pending && canOperate && (
                  <Button className="outline small" disabled={busyId === job._id} onClick={() => act(job,
                    () => api(`/admin/print-jobs/${job._id}`, { method: "PATCH", body: { status: "printed" } }),
                    `Đã đánh dấu in xong vé #${job.code}.`)}>
                    <Check size={15} /> Đã in
                  </Button>
                )}
                <div className="print-icons">
                  <a className="icon-button" href={assetUrl(`${job.image}?download=1`)}
                    title={sheets > 1 ? `Tải cả ${sheets} tờ (ZIP)` : "Tải file in"}
                    aria-label={sheets > 1 ? `Tải cả ${sheets} tờ (ZIP)` : "Tải file in"}>
                    <Download size={16} />
                  </a>
                  {canDelete && (
                    <button className="icon-button" title="Hủy lệnh in" aria-label="Hủy lệnh in" disabled={busyId === job._id}
                      onClick={() => window.confirm(pending
                        ? `Hủy lệnh in của vé #${job.code}? Số tờ được trả lại để khách sửa và gửi in lại.`
                        : `Xoá lệnh in đã in của vé #${job.code} khỏi danh sách?`) &&
                        act(job, () => api(`/admin/print-jobs/${job._id}`, { method: "DELETE" }), "Đã hủy lệnh in.")}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {loaded && !jobs.length && (
        <div className="empty-state">
          <Printer />
          <h3>{pending ? `Không có lệnh đang chờ tại ${printBranchName(branch)}.` : `Chưa có lệnh đã in tại ${printBranchName(branch)} trong 3 ngày qua.`}</h3>
          <p>Khách bấm “Gửi in” trên điện thoại ở phòng Selfbooth, lệnh in sẽ hiện tại đây ngay.</p>
        </div>
      )}
    </>
  );
}
