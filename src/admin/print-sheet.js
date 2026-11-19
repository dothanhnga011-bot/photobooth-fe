import { directMediaUrl, proxyMediaUrl } from "../media-delivery.js";

// Phòng Selfbooth in như web Selfbooth: nhân viên ở quầy bấm In, cửa sổ in của trình duyệt mở tờ 20 × 30 đúng
// khổ thật (8 × 12 inch) để in ra máy DNP DS820 cắm vào máy tính ở quầy. Không cần chương trình in riêng.
function openPrintWindow({ title, info }) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Trình duyệt đã chặn cửa sổ in. Hãy cho phép cửa sổ bật lên và thử lại.");

  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>NXC — In ảnh 20 × 30 cm</title>
<style>
  @page { size: 12in 8in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f8f2ec; color: #3f2c25; font: 14px Arial, sans-serif; }
  .toolbar { max-width: 600px; margin: 24px auto; padding: 0 20px; line-height: 1.7; }
  button { padding: 12px 20px; border: 0; border-radius: 4px; background: #522e22; color: white; cursor: pointer; }
  button:disabled { opacity: .5; cursor: wait; }
  .print-sheet { position: relative; width: 12in; height: 8in; margin: 24px auto; background: white; overflow: hidden; }
  /* Tờ ngang cùng tỉ lệ 3 : 2 với giấy: phủ kín, không viền trắng. */
  .print-sheet img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }
  /* Tờ dọc 20 × 30: xoay 90° cho kín khổ giấy ngang của máy in. */
  .print-sheet.portrait img { position: absolute; left: 2in; top: -2in; width: 8in; height: 12in; transform: rotate(-90deg); }
  @media print {
    html, body { width: 12in; height: 8in; margin: 0 !important; padding: 0 !important; background: white; }
    .toolbar { display: none !important; }
    .print-sheet { margin: 0; break-inside: avoid; break-after: page; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .print-sheet:last-child { break-after: auto; }
  }
</style></head><body>
<div class="toolbar"><h1></h1><p class="booking-info"></p>
<p>Chọn máy in <b>DNP DS820</b>, giấy <b>8 × 12 inch</b> (203 × 305 mm), hướng <b>ngang</b>, tỉ lệ <b>100%</b>, lề <b>Không có</b>; tắt đầu trang và chân trang.</p>
<p>Trong driver DNP chọn khổ <b>(8x12)</b>.</p>
<p>Tờ ngang 30 × 20 in thẳng kín khổ; tờ dọc được xoay cho vừa giấy.</p>
<p class="print-status" role="status">Đang tải ảnh…</p><button disabled>In 20 × 30 cm</button></div>
</body></html>`);
  popup.document.close();

  const doc = popup.document;
  doc.querySelector("h1").textContent = title;
  doc.querySelector(".booking-info").textContent = info;
  const button = doc.querySelector("button");
  const status = doc.querySelector(".print-status");
  button.onclick = () => { popup.focus(); popup.print(); };
  const addSheet = () => {
    const sheet = doc.createElement("div");
    sheet.className = "print-sheet";
    const img = doc.createElement("img");
    img.alt = "Ảnh in 20 × 30 cm";
    sheet.append(img);
    doc.body.append(sheet);
    return img;
  };
  // Ảnh đã tải xong: tờ dọc xoay cho vừa giấy, giải mã sẵn trước khi in.
  const shown = (img) => new Promise((resolve, reject) => {
    img.onload = () => {
      img.parentElement.classList.add(img.naturalHeight > img.naturalWidth ? "portrait" : "landscape");
      img.decode().then(resolve, reject);
    };
  });
  const ready = () => {
    if (popup.closed) return;
    button.disabled = false;
    status.textContent = "Ảnh đã sẵn sàng. Chỉ bấm “Đã in” ở Hàng chờ in sau khi nhận được bản in.";
    popup.requestAnimationFrame(() => popup.requestAnimationFrame(() => {
      if (!popup.closed) { popup.focus(); popup.print(); }
    }));
  };
  const fail = () => { status.textContent = "Không tải được ảnh. Hãy đóng cửa sổ và thử lại từ Hàng chờ in."; };
  return { addSheet, shown, ready, fail };
}

// Tờ in thẳng từ R2; lỗi thì tải qua máy chủ.
function loadSheet(img, src, shown) {
  const done = shown(img);
  const original = new URL(proxyMediaUrl(src), window.location.origin).href;
  const direct = directMediaUrl(original);
  return new Promise((resolve, reject) => {
    img.onerror = () => {
      if (img.src !== original && direct !== original) img.src = original;
      else reject(new Error("Không tải được ảnh in."));
    };
    img.src = direct;
    done.then(resolve, reject);
  });
}

// In các tờ 20 × 30 của một lệnh in (mỗi tờ `copies` bản) ra máy DNP DS820 ở quầy.
export function printLargeSheets({ imageUrls, code, copies = 1, branch = '' }) {
  const count = Math.max(1, Math.min(20, Number(copies) || 1));
  const view = openPrintWindow({
    title: "In ảnh · 20 × 30 cm",
    info: `${branch ? `${branch} · ` : ''}Vé #${code} · ${imageUrls.length} tờ 20 × 30 cm × ${count} bản.`,
  });
  const sheets = imageUrls.flatMap((src) => Array.from({ length: count }, () => ({ img: view.addSheet(), src })));
  Promise.all(sheets.map(({ img, src }) => loadSheet(img, src, view.shown))).then(() => view.ready(), view.fail);
}
