// Khổ in của gói / khung / vé (giống photobooth-be/src/print-sizes.js):
// - "full" / "strip": tờ 10 × 15 cm máy DNP DS-RX1 của phòng Photobooth (nguyên tờ / cắt đôi);
// - "large": tờ 20 × 30 cm máy DNP DS820 của phòng Selfbooth.
// Phòng Selfbooth chạy như web Selfbooth: khách chọn ảnh, bộ khung, ghép ảnh và gửi in trên điện thoại.
export const POLAROID_SIZE = "large";
export const isPolaroidSize = (printSize) => printSize === "large";
export const isLargeSize = (printSize) => printSize === "large";
// Tờ 20 × 30 cm (8 × 12 inch @ 300 pixels/inch) máy DS820 in nguyên tờ, dọc hoặc ngang.
export const LARGE_SHEET = { w: 2400, h: 3600 };
// Đơn vị khách đếm ở phòng Selfbooth.
export const polaroidUnit = () => "tờ 20 × 30";
// Máy in của phòng Selfbooth.
export const polaroidPrinter = () => "máy in DNP DS820";
