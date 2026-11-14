// Khổ in của gói / khung / vé (giống photobooth-be/src/print-sizes.js):
// - "full" / "strip": tờ 10 × 15 cm máy DNP DS-RX1 của phòng Photobooth (nguyên tờ / cắt đôi);
// - "large": tờ 20 × 30 cm máy DNP DS820 của phòng Polaroid / Selfbooth (từ 14/11);
// - "instax": thẻ Instax Wide (gói, khung cũ của phòng Polaroid trước 14/11, vẫn in được).
// Phòng Polaroid chạy như web Selfbooth với cả hai khổ của nó: khách chọn ảnh, bộ khung, ghép ảnh và gửi in trên điện thoại.
export const POLAROID_SIZE = "large";
export const isPolaroidSize = (printSize) => printSize === "instax" || printSize === "large";
export const isLargeSize = (printSize) => printSize === "large";
// Tờ 20 × 30 cm (8 × 12 inch @ 300 pixels/inch) máy DS820 in nguyên tờ, dọc hoặc ngang.
export const LARGE_SHEET = { w: 2400, h: 3600 };
// Đơn vị khách đếm ở phòng Polaroid: "tờ 20 × 30" / "tấm Instax".
export const polaroidUnit = (printSize) => (printSize === "instax" ? "tấm Instax" : "tờ 20 × 30");
// Máy in của khổ Polaroid: "máy in DNP DS820" / "máy Instax".
export const polaroidPrinter = (printSize) => (printSize === "instax" ? "máy Instax" : "máy in DNP DS820");
