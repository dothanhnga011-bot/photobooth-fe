// Trang album chỉ tải bản CSS dành cho khách (xem guestStylesheet trong vite.config.js); khi chuyển sang
// trang quản trị hoặc máy chụp trong cùng phiên thì nạp thêm bản đầy đủ để không mất giao diện.
export function ensureFullStylesheet() {
  const fullStylesheet = typeof window !== "undefined" && window.__fullStylesheet;
  if (fullStylesheet && !document.querySelector(`link[href="${fullStylesheet}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.crossOrigin = "";
    link.href = fullStylesheet;
    document.head.appendChild(link);
  }
}
