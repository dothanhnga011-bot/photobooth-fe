import { useEffect, useRef } from "react";
import { useToast } from "./studio";
import { useConnectivity, useReconnectProbe } from "./use-connectivity";

// Mất mạng / máy chủ chưa phản hồi (miễn phí nên “ngủ” khi vắng khách, đang khởi động lại…):
// một thông báo duy nhất cho cả trang, tự dò lại máy chủ và báo khi đã kết nối lại.
// Album khách và máy chụp tự báo lỗi riêng nên không nhắc ở đó (quiet).
export function ServerStatus({ error, quiet }) {
  const toast = useToast();
  const shown = useRef(null);
  const { online } = useConnectivity();
  useReconnectProbe(!quiet);
  const problem = !online
    ? navigator.onLine === false
      ? "Thiết bị đang mất mạng — kiểm tra Wi-Fi hoặc dây mạng."
      : "Chưa kết nối được máy chủ (có thể đang khởi động lại)."
    : error;
  useEffect(() => {
    if (problem && !shown.current && !quiet)
      shown.current = toast.warning(
        `${problem} Hệ thống đang tự kết nối lại, dữ liệu sẽ tự cập nhật.`,
        0,
      );
    if (!problem && shown.current) {
      toast.dismiss(shown.current);
      shown.current = null;
      toast.success("Đã kết nối lại máy chủ.");
    }
  }, [problem, quiet, toast]);
  return null;
}
