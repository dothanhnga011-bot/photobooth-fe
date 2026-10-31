// Số bản in khách chọn ở máy chụp. Gói lưu số tờ 10 × 15 cm (như vé); khách đếm theo tờ cầm
// trên tay: khổ nhỏ một tờ cắt đôi thành 2 tờ nhỏ, khổ to mỗi tờ là một tờ, Instax mỗi tấm là
// một thẻ Instax Wide (máy Instax Link WIDE cạnh máy chụp).
// Luật giống máy chủ (photobooth-be/src/routes/print-count.js): khách in tối thiểu 2 tờ; layout
// Polaroid (Instax) in đúng 1 tấm vì máy Instax Link WIDE in từng tấm một.
export const MIN_PIECES = 2;
export const INSTAX_SHEETS = 1;
export const printSizeOf = (pack) => pack?.printSize || "full";
export const isStrip = (pack) => printSizeOf(pack) === "strip";
export const isInstax = (pack) => printSizeOf(pack) === "instax";
export const piecesPerSheet = (pack) => (isStrip(pack) ? 2 : 1);
export const includedSheets = (pack) => Math.max(0, Number(pack?.prints) || 0);
// Gói kèm ít hơn 2 tờ (gói cũ) thì phần thiếu tính như tờ in thêm.
export const minSheets = (pack) =>
  Math.max(includedSheets(pack), isInstax(pack) ? INSTAX_SHEETS : Math.ceil(MIN_PIECES / piecesPerSheet(pack)));
export const extraSheets = (pack, sheets) => Math.max(0, sheets - includedSheets(pack));
export const saleTotal = (pack, sheets, extraPrice) =>
  (Number(pack?.price) || 0) + extraSheets(pack, sheets) * (Number(extraPrice) || 0);
// Giá một tờ in thêm theo khổ: phim Instax có giá riêng (Khổ ảnh & bảng giá).
export const extraPriceFor = (pack, settings = {}) => {
  const price = isInstax(pack) ? settings.extraInstaxPrice : settings.extraPrintPrice;
  return price === undefined || price === null ? undefined : Number(price);
};
// Đơn vị khách đếm: "tờ nhỏ" / "tấm Instax" / "tờ".
export const pieceUnit = (pack) => (isStrip(pack) ? "tờ nhỏ" : isInstax(pack) ? "tấm Instax" : "tờ");
// "2 tờ nhỏ" / "2 tấm Instax" / "2 tờ" — số tờ khách nhận được.
export const piecesLabel = (pack, sheets) => `${sheets * piecesPerSheet(pack)} ${pieceUnit(pack)}`;
