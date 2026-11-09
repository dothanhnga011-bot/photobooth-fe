// Máy chụp chạy trên Windows hoặc macOS (Chrome / Edge): hướng dẫn theo đúng hệ điều hành.
export const isMac =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.userAgentData?.platform || navigator.platform || "");
export const PHOTO_FOLDER_EXAMPLE = isMac
  ? "Pictures/PhotoBooth"
  : "C:\\PhotoBooth\\Fujifilm";
// Thư mục ảnh không đọc được: lý do hay gặp khác nhau giữa macOS và Windows.
export const folderAccessHint = (folder = PHOTO_FOLDER_EXAMPLE) => isMac
  ? `Trên macOS: System Settings → Privacy & Security → Files and Folders → cho phép Chrome đọc thư mục ảnh riêng, vd. ${folder}.`
  : `Trên Windows: để phần mềm máy ảnh lưu JPEG vào thư mục riêng, vd. ${folder} (Chrome không cho đọc thẳng Desktop / Documents / Downloads; thư mục OneDrive “chỉ trên mạng” cũng không đọc được).`;
export const FOLDER_ACCESS_HINT = folderAccessHint();

export const canPickFolder =
  typeof window !== "undefined" && "showDirectoryPicker" in window;
export const isJpeg = (name) => /\.jpe?g$/i.test(name);
export const isRaw = (name) => /\.(raf|cr2|cr3)$/i.test(name);
export const baseName = (path) => path.replace(/\.[^./]+$/, "").toLowerCase();
// Ảnh trong thư mục máy ảnh (và thư mục con, vd. "Capture" của Capture One): JPEG để gửi
// lên; RAW Fujifilm/Canon chỉ để báo thiếu JPEG.
export async function* listCameraFiles(dir, depth = 2, prefix = "") {
  for await (const [name, handle] of dir.entries()) {
    // Bỏ tệp / thư mục ẩn (vd. "._DSCF0001.JPG" macOS tạo trên thẻ nhớ, ".Trashes").
    if (name.startsWith(".")) continue;
    if (handle.kind === "file" && (isJpeg(name) || isRaw(name)))
      yield [prefix + name, handle];
    else if (handle.kind === "directory" && depth > 1)
      yield* listCameraFiles(handle, depth - 1, `${prefix}${name}/`);
  }
}
export const RAW_ONLY_MESSAGE =
  "Máy ảnh đang chỉ gửi RAW (.RAF/.CR3/.CR2). Chọn JPEG chất lượng cao hoặc JPEG + RAW để kiosk nhận ảnh.";
export async function folderPermission(handle, ask) {
  const opts = { mode: "read" };
  try {
    if (!handle.queryPermission) return "granted";
    if ((await handle.queryPermission(opts)) === "granted") return "granted";
    return ask && (await handle.requestPermission(opts)) === "granted"
      ? "granted"
      : "prompt";
  } catch {
    return "prompt";
  }
}
