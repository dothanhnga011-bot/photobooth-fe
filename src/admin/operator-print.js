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
// photos: photo regions of the sheet (RX1 sharpens photos fully, text / frame half), as the kiosk sends.
// saveOnly: a new sheet saved to the order without printing (no RX1 on this computer) — printed later
// with "In lại qua RX1".
export async function operatorPrint({ booking, images, frameName = "", printSize, copies = 1, sourceJob, photos, saveOnly = false }, {
  send = sendDirectPrint, request = api, storage = globalThis.sessionStorage,
} = {}) {
  const size = printSize || booking.printSize || "full";
  if (size === "large") throw new Error("Tờ 20 × 30 in ở Hàng chờ in (máy DNP DS820 ở quầy), không qua RX1.");
  if (!Number.isInteger(copies) || copies < 1 || copies > 20 || !images.length || images.length * copies > 20)
    throw new Error("Mỗi lượt in RX1 cần từ 1 đến 20 tờ.");
  if (saveOnly && sourceJob) throw new Error("File này đã được lưu.");
  const bytes = new Blob(images);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer()))]
    .map((n) => n.toString(16).padStart(2, "0")).join("");
  const identity = JSON.stringify([sourceJob?._id || "manual", size, copies, frameName, digest, saveOnly ? "save" : "print"]);
  let attempt = attempts.get(booking._id);
  try { attempt = JSON.parse(storage?.getItem(storageKey(booking._id)) || "null") || attempt; } catch {}
  if (attempt?.identity !== identity) attempt = { identity, requestKey: crypto.randomUUID(), sent: false };
  remember(booking._id, attempt, storage);
  if (!attempt.sent && !saveOnly) {
    await send({ token: booking.accessToken, printSize: size, frameName, requestKey: attempt.requestKey,
      images: Array.from({ length: copies }, () => images).flat(), ...(photos?.length && { photos }) });
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
        ...upload, headers: { ...upload.headers, "X-Print-Copies": String(copies), ...(saveOnly && { "X-Print-Delivery": "none" }) },
      });
    }
    remember(booking._id, null, storage);
    return result;
  } catch (cause) {
    if (saveOnly) throw cause;
    throw Object.assign(new Error(`RX1 đã nhận file, nhưng chưa lưu được lịch sử. Bấm “Lưu kết quả in” để thử lưu lại; ảnh sẽ không được in thêm. ${cause.message}`), { printed: true, cause });
  }
}
