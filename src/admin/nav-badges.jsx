import { useEffect, useState } from "react";
import { useLiveData } from "../use-live-data";
import { printerIssues } from "./printer-issues";

// Số / chấm cạnh mục trên thanh bên quản trị: nhân viên quầy thấy ngay việc cần làm. Huy hiệu chỉ là
// hình (aria-hidden); lời giải thích nằm ở title của nút — hiện khi rê chuột, và là mô tả cho trình đọc
// màn hình — nên tên nút vẫn đúng "Đơn hàng", "Quản lý máy".

// Gọi sau khi tạo phiếu, xác nhận đã thu, hủy đơn…: số "chờ thu tiền" cập nhật ngay, không đợi 30 giây.
export const ordersChanged = () => window.dispatchEvent(new Event("nxc:orders"));

// Số đơn chờ thu tiền: phiếu quầy hôm nay chưa xác nhận đã thu, lượt Polaroid chưa thu.
export function useAwaitingPayment() {
  const [count, setCount] = useState(0);
  const load = useLiveData("/admin/bookings/awaiting-payment", (data) => setCount(Number(data?.count) || 0),
    () => {}, 30000);
  useEffect(() => {
    window.addEventListener("nxc:orders", load);
    return () => window.removeEventListener("nxc:orders", load);
  }, [load]);
  return count;
}

// Máy in cần xem: lỗi, mất kết nối, chương trình in không chạy hoặc Instax sắp hết phim.
export function usePrinterIssues() {
  const [issues, setIssues] = useState([]);
  useLiveData("/admin/print-jobs/printers", (rows) => setIssues(printerIssues(Array.isArray(rows) ? rows : [])),
    () => {}, 30000);
  return issues;
}

// Huy hiệu và lời giải thích cho từng mục; mục không có gì cần báo thì không có.
export function navNotes({ awaiting, issues, storage }) {
  return {
    bookings: awaiting > 0 && {
      title: `${awaiting} đơn chờ thu tiền`,
      badge: <span className="nav-count nav-alert" aria-hidden="true">{awaiting > 99 ? "99+" : awaiting}</span>,
    },
    rooms: issues.length > 0 && {
      title: `${issues.length} máy in cần xem:\n${issues.join("\n")}`,
      badge: <span className="nav-dot" aria-hidden="true" />,
    },
    storage: storage && {
      title: `Kho ảnh đã dùng ${storage.percent}%`,
      badge: <span className={`nav-count nav-storage is-${storage.level}`} aria-hidden="true">{storage.percent}%</span>,
    },
  };
}
