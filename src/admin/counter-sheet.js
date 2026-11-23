import { fetchMediaBlob } from "../media-delivery.js";
import { isSingleStrip } from "../frame-utils.js";
import { printSheets } from "../kiosk/compose.js";

// Tờ in RX1 làm từ ảnh ghép khung trong album (22/11): đơn chưa có file in đã lưu — vé chỉ nhận ảnh qua QR,
// hoặc máy chụp mất kết nối RX1 trước khi file in được lưu cả khi in lỗi — in lại / in thêm ngay mà không
// phải ghép lại bằng tay. Ảnh ghép là đúng khung, màu, chữ và nhãn dán khách đã chọn (20 MP), thu về tờ
// 2400 × 3600 như máy chụp in. printSize của vé: "strip" → máy cắt đôi (khung nhỏ có sẵn 2 dải trên tờ;
// ảnh ghép một dải cũ được xếp 2 dải / tờ như máy chụp).
export async function compositeSheet(url, printSize, { signal } = {}) {
  const blob = await fetchMediaBlob(url, { signal });
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const frame = { printSize: printSize === "strip" ? "strip" : "full" };
    const [image] = await printSheets(canvas, frame, 1, frame.printSize, 2);
    return { image, printSize: frame.printSize, strips: isSingleStrip(frame, canvas.width, canvas.height) ? 2 : 0 };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
