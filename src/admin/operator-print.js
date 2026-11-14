import { api } from "../api.js";
import { printPackUpload } from "../album/print-upload.js";
import { sendDirectPrint } from "../kiosk/direct-print.js";

const attempts = new Map();
const storageKey = (id) => `nxc-counter-print:${id}`;
function remember(id, attempt, storage) {
  if (attempt) attempts.set(id, attempt); else attempts.delete(id);
  try {
    if (attempt) storage?.setItem(storageKey(id), JSON.stringify(attempt));
    else storage?.removeItem(storageKey(id));
  } catch { /* The in-memory identity still protects retries in this page. */ }
}

// A lost reply reuses the local printer's durable request ID. After local success, retry only
// the archive write. No browser print dialog or cloud-queue fallback can issue a second copy.
export async function operatorPrint({ booking, images, frameName = "", printSize, copies = 1, sourceJob }, {
  send = sendDirectPrint, request = api, storage = globalThis.sessionStorage,
} = {}) {
  const size = printSize || booking.printSize || "full";
  if (size === "instax") throw new Error("Khổ Instax cần chương trình in Instax riêng.");
  if (size === "large") throw new Error("Tờ 20 × 30 in qua hàng chờ máy DNP DS820 của phòng Polaroid, không qua RX1.");
  if (!Number.isInteger(copies) || copies < 1 || copies > 20 || !images.length || images.length * copies > 20)
    throw new Error("Mỗi lượt in RX1 cần từ 1 đến 20 tờ.");
  const bytes = new Blob(images);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer()))]
    .map((n) => n.toString(16).padStart(2, "0")).join("");
  const identity = JSON.stringify([sourceJob?._id || "manual", size, copies, frameName, digest]);
  let attempt = attempts.get(booking._id);
  try { attempt = JSON.parse(storage?.getItem(storageKey(booking._id)) || "null") || attempt; } catch {}
  if (attempt?.identity !== identity) attempt = { identity, requestKey: crypto.randomUUID(), sent: false };
  remember(booking._id, attempt, storage);
  if (!attempt.sent) {
    await send({ token: booking.accessToken, printSize: size, frameName, requestKey: attempt.requestKey,
      images: Array.from({ length: copies }, () => images).flat() });
    attempt.sent = true;
    remember(booking._id, attempt, storage);
  }
  try {
    let result;
    if (sourceJob) {
      result = await request(`/admin/bookings/${booking._id}/reprint`, { method: "POST",
        body: { jobId: sourceJob._id, copies, requestKey: attempt.requestKey, delivery: "local" } });
    } else {
      const upload = printPackUpload({ images, frameName, printSize: size, requestKey: attempt.requestKey });
      result = await request(`/admin/bookings/${booking._id}/print-file`, {
        ...upload, headers: { ...upload.headers, "X-Print-Copies": String(copies) },
      });
    }
    remember(booking._id, null, storage);
    return result;
  } catch (cause) {
    throw Object.assign(new Error(`RX1 đã nhận file, nhưng chưa lưu được lịch sử. Bấm “Lưu kết quả in” để thử lưu lại; ảnh sẽ không được in thêm. ${cause.message}`), { printed: true, cause });
  }
}
