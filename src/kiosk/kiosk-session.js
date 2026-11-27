// Máy chụp (Kiosk.jsx): hằng số và hàm nhỏ về lượt chụp / lượt mua, không phụ thuộc giao diện.

// Các chỗ báo lỗi mạng ở màn chụp: mỗi lần mất kết nối chỉ báo một lần, có mạng lại thì xoá.
export const NET_SLOTS = ["poll", "sync", "start", "finish"];
export const PING_MS = 60_000;
// Thời gian chuẩn bị trước khi khách bấm dây, chọn ảnh & khung.
export const READY_SECONDS = 3;
// Chọn khung trước, rồi chọn ảnh và trang trí: dùng chung thời gian quản trị đặt ở Thiết lập → Chữ trên máy
// chụp (settings.selectSeconds, 30–900 giây); chưa đặt thì 250 giây.
const SELECT_SECONDS = 250;
export const PICK_PHASES = ['frame-pick', 'select', 'frame'];
export const selectSecondsOf = (settings) => {
  const value = Number(settings?.selectSeconds);
  return Number.isInteger(value) && value >= 30 && value <= 900 ? value : SELECT_SECONDS;
};
export const SALE_KEY = "kiosk-sale";
// Phòng của máy chụp đọc ngay từ liên kết cài máy (phần giữa của mã), trước khi máy chủ trả lời.
export function deviceRoom(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part)).room || "";
  } catch {
    return "";
  }
}
// Bước của lượt chụp (lưu cùng phiên để tải lại trang vẫn tiếp tục đúng chỗ).
export const phaseOf = (s) =>
  !s ? null : s.phase || (s.booking.captureStartedAt ? "shoot" : "ready");
export const secondsUntil = (at) => Math.max(0, Math.ceil(((at || 0) - Date.now()) / 1000));
// Lượt mua tiền mặt dở dang (đã chọn gói / số tờ / tiền đã đút), lưu trên máy để tải lại trang vẫn còn.
export function readSale() {
  try {
    return JSON.parse(localStorage.getItem(SALE_KEY)) || null;
  } catch {
    return null;
  }
}
