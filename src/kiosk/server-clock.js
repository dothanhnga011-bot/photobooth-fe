// Đồng hồ máy chủ trên máy chụp. Giờ bắt đầu / kết thúc phiên chụp do máy chủ đặt; mini PC trong phòng có
// thể chạy nhanh / chậm vài phút (không đồng bộ giờ), khi đó đồng hồ đếm ngược hiện sai thời gian của gói
// (gói 10 phút hiện 13:00) và ảnh chụp những phút cuối bị coi là chụp sau khi hết giờ. Mỗi lần máy chủ trả lời
// /kiosk/start, /kiosk/state (kèm serverTime) máy chụp đo lại độ lệch; giờ máy chủ ≈ Date.now() + offset.
const KEY = "kiosk-server-clock-offset";
// Trả lời chậm hơn mức này thì sai số đo lớn: bỏ mẫu.
const MAX_ROUND_TRIP_MS = 4000;

const read = () => {
  try {
    return Number(globalThis.localStorage?.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
};
let offset = read();

export const serverNow = () => Date.now() + offset;
// Một thời điểm theo giờ máy chủ (ISO / ms) đổi sang giờ của máy này (so với thời gian sửa tệp ảnh, Date.now()).
export const toLocalTime = (serverTime) => new Date(serverTime).getTime() - offset;

// sentAt / receivedAt: Date.now() lúc gửi / nhận yêu cầu có serverTime trong câu trả lời.
export function noteServerTime(serverTime, sentAt, receivedAt) {
  if (!Number.isFinite(serverTime) || !(receivedAt >= sentAt) || receivedAt - sentAt > MAX_ROUND_TRIP_MS) return;
  offset = Math.round(serverTime - (sentAt + receivedAt) / 2);
  try {
    globalThis.localStorage?.setItem(KEY, String(offset));
  } catch { /* không lưu được: vẫn dùng trong phiên này */ }
}

export const clockOffset = () => offset;
