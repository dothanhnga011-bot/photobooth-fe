import { isSelfboothSize, selfboothUnit } from "../print-sizes.js";

// Số bản in khách chọn ở máy chụp. Gói lưu số tờ 10 × 15 cm (như vé); khách đếm theo tờ cầm
// trên tay: khổ nhỏ một tờ cắt đôi thành 2 tờ nhỏ, khổ to mỗi tờ là một tờ; phòng Selfbooth
// mỗi tờ là một tờ 20 × 30 máy DNP DS820.
// Luật giống máy chủ (photobooth-be/src/routes/print-count.js): khách in tối thiểu 2 tờ; gói
// Selfbooth in ít nhất 1 tờ (khách chọn tờ muốn in trên điện thoại).
export const MIN_PIECES = 2;
// Số tờ tối thiểu của gói Selfbooth.
export const SELFBOOTH_MIN_SHEETS = 1;
export const printSizeOf = (pack) => pack?.printSize || "full";
export const isStrip = (pack) => printSizeOf(pack) === "strip";
// Gói / vé của phòng Selfbooth (tờ 20 × 30).
export const isSelfbooth = (pack) => isSelfboothSize(printSizeOf(pack));
export const piecesPerSheet = (pack) => (isStrip(pack) ? 2 : 1);
export const includedSheets = (pack) => Math.max(0, Number(pack?.prints) || 0);
// Gói kèm ít hơn 2 tờ (gói cũ) thì phần thiếu tính như tờ in thêm.
export const minSheets = (pack) =>
  Math.max(includedSheets(pack), isSelfbooth(pack) ? SELFBOOTH_MIN_SHEETS : Math.ceil(MIN_PIECES / piecesPerSheet(pack)));
export const extraSheets = (pack, sheets) => Math.max(0, sheets - includedSheets(pack));
export const saleTotal = (pack, sheets, extraPrice) =>
  (Number(pack?.price) || 0) + extraSheets(pack, sheets) * (Number(extraPrice) || 0);
// Giá một tờ in thêm theo khổ: phòng Selfbooth có giá riêng (Khổ ảnh & bảng giá).
export const extraPriceFor = (pack, settings = {}) => {
  const price = isSelfbooth(pack) ? settings.extraSelfboothPrice : settings.extraPrintPrice;
  return price === undefined || price === null ? undefined : Number(price);
};
// Đơn vị khách đếm: "tờ nhỏ" / "tờ 20 × 30" / "tờ".
export const pieceUnit = (pack) => (isStrip(pack) ? "tờ nhỏ" : isSelfbooth(pack) ? selfboothUnit(printSizeOf(pack)) : "tờ");
// "2 tờ nhỏ" / "2 tờ 20 × 30" / "2 tờ" — số tờ khách nhận được.
export const piecesLabel = (pack, sheets) => `${sheets * piecesPerSheet(pack)} ${pieceUnit(pack)}`;
