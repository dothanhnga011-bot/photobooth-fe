// Lưu ảnh / video của album vào thư viện ảnh của điện thoại.
// - iPhone / iPad: trang web không ghi thẳng vào app Ảnh được. Tải các tệp về trang rồi mở bảng chia sẻ
//   của iOS; khách bấm "Lưu N mục" (Save N Items) là tất cả vào app Ảnh. App Ảnh không nhận WebM nên
//   video WebM (máy chụp cũ) không đưa vào bảng chia sẻ.
// - Android / máy tính: tải từng tệp về. Android lưu vào thư mục Download, app Thư viện / Google Photos
//   hiện ngay (lần đầu Chrome hỏi "Cho phép tải nhiều tệp" thì bấm Cho phép).

import { directMediaUrl, fetchMediaBlob } from "../media-delivery.js";

export const isIOS = () =>
  /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function usesShareSheet() {
  if (!isIOS() || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File(["x"], "x.jpg", { type: "image/jpeg" })] });
  } catch {
    return false;
  }
}

// App Ảnh của iPhone nhận ảnh và video MP4 / MOV, không nhận WebM.
export const savableOnIOS = (entry) => entry.type !== "video/webm";

// Tải các tệp (3 tệp cùng lúc, giữ đúng thứ tự). Tệp đã tải giữ trong cache để bấm lại không tải lại.
export async function fetchFiles(entries, cache, onProgress = () => {}) {
  const files = new Array(entries.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const entry = entries[i];
      if (!cache.has(entry.url)) {
        // Fetch the prepared guest JPEG (or video) from storage. Expired links, missing
        // bucket CORS and older servers still use the authenticated API stream.
        const blob = await fetchMediaBlob(entry.url, { link: entry.link, timeout: 180000 });
        cache.set(entry.url, new File([blob], entry.name, { type: entry.type || blob.type }));
      }
      files[i] = cache.get(entry.url);
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, worker));
  return files;
}

// Tải từng tệp về máy (Android / máy tính), cách nhau một chút để trình duyệt không bỏ tệp nào.
export async function downloadEach(entries) {
  for (const [i, entry] of entries.entries()) {
    if (i) await new Promise((resolve) => setTimeout(resolve, 700));
    const link = document.createElement("a");
    link.href = directMediaUrl(entry.url);
    link.download = entry.name;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  }
}
