import {
  baseName,
  FOLDER_ACCESS_HINT,
  isJpeg,
  isRaw,
  listCameraFiles,
  RAW_ONLY_MESSAGE,
} from "./folder.js";

const CROWDED = 300;

// Scan only this session; stop before replacing the session or folder.
export function watchCameraFolder({
  folder,
  booking,
  onPhoto,
  notifyOnce,
  onScan,
  onScanSuccess,
  accessHint = FOLDER_ACCESS_HINT,
}) {
  let stopped = false,
    timer,
    first = true;
  // Chỉ lấy ảnh chụp trong phiên này (bỏ ảnh cũ trong thư mục, ảnh chụp sau khi hết giờ).
  const since =
    Math.min(Date.now(), new Date(booking.captureStartedAt).getTime()) -
    2000;
  const until = new Date(booking.captureEndsAt).getTime() + 5000;
  const known = new Map();
  // Tệp RAW mới chưa có JPEG cùng tên: máy ảnh có thể đang để chỉ chụp RAW.
  const raws = new Map();
  // Ảnh JPEG mới xuất hiện trong phiên, ảnh đã nhận, tệp mới nhất thấy được.
  const fresh = new Set();
  let imported = 0,
    scans = 0,
    newest = null;
  const queue = [];
  let processing = false;
  // Thư mục đông (trên CROWDED tệp): ảnh có sẵn từ trước phiên (của khách trước) chỉ kiểm tra lại
  // 10 giây/lần thay vì mỗi giây; ảnh của phiên này vẫn mỗi giây (máy ảnh có thể ghi đè cùng tên).
  let crowded = false;
  const notDue = (entry) => Date.now() < entry.checkAt + (entry.old && crowded ? 9000 : 0);
  // Continue observing newly written files while the previous JPEG is being
  // converted/saved. Process one file at a time to bound bitmap allocations.
  const processNext = () => {
    if (stopped || processing || !queue.length) return;
    processing = true;
    const { file, path, entry } = queue.shift();
    entry.queued = false;
    entry.processing = true;
    Promise.resolve().then(() => stopped ? false : onPhoto(file, path)).then(
      (saved) => {
        if (saved) {
          entry.done = true;
          entry.checkAt = Date.now() + 1000;
          imported++;
        } else entry.retryAt = Date.now() + 1000;
      },
      () => { entry.retryAt = Date.now() + 1000; },
    ).finally(() => {
      entry.processing = false;
      processing = false;
      processNext();
    });
  };
  const scan = async () => {
    const started = Date.now();
    const jpegs = new Set();
    let rawCount = 0,
      problem = "";
    try {
      for await (const [path, handle] of listCameraFiles(folder)) {
        if (stopped) return;
        const seen = known.get(path);
        if (isJpeg(path)) jpegs.add(baseName(path));
        else rawCount++;
        if (seen?.queued || seen?.processing) continue;
        if (seen?.done && (!isJpeg(path) || notDue(seen))) continue;
        if (isRaw(path)) {
          known.set(path, { done: true });
          if (!first) raws.set(baseName(path), Date.now());
          continue;
        }
        // Một tệp không đọc được (đang bị khóa, tệp hỏng…) không chặn các ảnh khác.
        let file;
        try {
          file = await handle.getFile();
        } catch (e) {
          problem = `${path}: ${e.message}`;
          continue;
        }
        if (!newest || file.lastModified >= newest.at)
          newest = { name: path, at: file.lastModified };
        // The camera agent can replace a JPEG at the same path. Cache the version,
        // not just the filename, including files ignored at session startup.
        if (seen?.done && seen.size === file.size && seen.time === file.lastModified) {
          seen.checkAt = Date.now() + 1000;
          continue;
        }
        if (seen?.done) fresh.add(path);
        if (!first && !seen) fresh.add(path);
        // Lần quét đầu: ảnh có sẵn là của khách trước — trừ ảnh chụp trong phiên này (trang
        // tải lại giữa phiên). Ảnh xuất hiện sau đó luôn thuộc phiên này, không dựa vào giờ
        // ghi trên tệp (có thể theo đồng hồ máy ảnh, lệch với máy tính).
        if (
          (!seen || seen.done) &&
          (first
            ? file.lastModified < since || file.lastModified > until
            : Date.now() > until)
        ) {
          known.set(path, {
            done: true, size: file.size, time: file.lastModified, old: true,
            checkAt: Date.now() + 1000,
          });
          continue;
        }
        // Đợi máy ảnh ghi xong tệp: kích thước không đổi giữa hai lần quét.
        if (
          !seen ||
          !file.size ||
          seen.size !== file.size ||
          seen.time !== file.lastModified
        ) {
          known.set(path, { size: file.size, time: file.lastModified });
          continue;
        }
        if (seen.retryAt && Date.now() < seen.retryAt) continue;
        seen.queued = true;
        queue.push({ file, path, entry: seen });
        processNext();
      }
      first = false;
      for (const [base, at] of raws)
        if (jpegs.has(base)) raws.delete(base);
        else if (Date.now() - at > 4000) {
          raws.delete(base);
          notifyOnce("raw", "warning", RAW_ONLY_MESSAGE, 12000);
        }
      onScanSuccess();
    } catch (e) {
      problem = e.message || String(e);
      notifyOnce(
        "folder",
        "error",
        `Không đọc được thư mục ảnh của máy ảnh: ${problem}. ${accessHint}`,
        15000,
      );
    } finally {
      // Tệp máy ảnh đang ghi dở (chưa đọc được) cũng tính là ảnh chưa lưu.
      let writing = 0;
      for (const entry of known.values())
        if (!entry.done && !entry.processing) writing++;
      if (!stopped) {
        scans++;
        const info = {
          folder: folder.name.slice(0, 200),
          jpegs: jpegs.size,
          raws: rawCount,
          fresh: fresh.size,
          imported,
          scans,
          newest: newest?.name.slice(-250),
          newestAt: newest?.at,
          error: problem.slice(0, 380),
        };
        onScan(info, writing);
        crowded = jpegs.size + rawCount > CROWDED;
        // Quét lâu (thư mục rất đông, máy yếu): nghỉ gấp đôi thời gian quét, tối đa 2 giây.
        timer = setTimeout(scan, Math.min(2000, Math.max(300, (Date.now() - started) * 2)));
      }
    }
  };
  scan();
  return () => {
    stopped = true;
    clearTimeout(timer);
    queue.length = 0;
  };
}
