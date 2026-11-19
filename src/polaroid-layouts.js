import { isPolaroidSize } from "./print-sizes.js";
// Gói phòng Selfbooth (tờ 20 × 30 máy DS820) tính theo thời gian như web Selfbooth: giá, số phút chụp, số tờ in; bấm dây
// không giới hạn (không có số lần chụp). Máy chủ kiểm tra lại (ít nhất 1 tờ). Layout thẻ Instax và khung thử Mellow
// đã bỏ 19/11 ("không làm Polaroid nữa").
export function polaroidPackage(pack) {
  return isPolaroidSize(pack?.printSize) ? { ...pack, shots: 0 } : pack;
}
