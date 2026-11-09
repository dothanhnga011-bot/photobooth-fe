import { useEffect, useRef, useState } from "react";
import { PiCameraDuotone as Camera } from "react-icons/pi";
import { Button } from "../studio";
import {
  baseName,
  folderAccessHint,
  isJpeg,
  isRaw,
  listCameraFiles,
  RAW_ONLY_MESSAGE,
} from "./folder.js";
import { cameraProfile } from "./camera-profile.js";

const CHECK_SECONDS = 60;
const skewText = (minutes) => {
  const m = Math.abs(minutes);
  if (m >= 2 * 1440) return `${Math.round(m / 1440)} ngày`;
  if (m >= 90) return `${Math.round(m / 60)} giờ`;
  return `${m} phút`;
};
// Nhân viên thử cả chuỗi dây bấm → phần mềm nhận ảnh → thư mục → máy chụp, không cần mã vé.
export function FolderCheck({ folder, kind }) {
  const profile = cameraProfile(kind);
  const [check, setCheck] = useState(null);
  const run = useRef(0);
  useEffect(() => () => void run.current++, []);
  useEffect(() => {
    const url = check?.preview;
    return () => url && URL.revokeObjectURL(url);
  }, [check?.preview]);
  async function start() {
    const turn = ++run.current;
    const live = () => turn === run.current;
    const before = new Set();
    try {
      for await (const [path] of listCameraFiles(folder)) before.add(path);
      const end = Date.now() + CHECK_SECONDS * 1000;
      const raws = new Map();
      let last = null;
      setCheck({ status: "waiting", left: CHECK_SECONDS });
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        if (!live()) return;
        const jpegs = new Set();
        let fresh = null;
        for await (const [path, handle] of listCameraFiles(folder)) {
          if (isJpeg(path)) jpegs.add(baseName(path));
          if (before.has(path)) continue;
          if (isRaw(path)) {
            if (!raws.has(baseName(path))) raws.set(baseName(path), Date.now());
          } else fresh ??= [path, handle];
        }
        if (!live()) return;
        if (fresh) {
          const file = await fresh[1].getFile();
          // Đợi máy ảnh ghi xong tệp: kích thước không đổi giữa hai lần quét.
          if (file.size && last?.path === fresh[0] && last.size === file.size) {
            const bitmap = await createImageBitmap(file, {
              imageOrientation: "from-image",
            });
            const { width, height } = bitmap;
            bitmap.close();
            if (!live()) return;
            setCheck({
              status: "ok",
              name: fresh[0],
              width,
              height,
              preview: URL.createObjectURL(file),
              skew: Math.round((Date.now() - file.lastModified) / 60000),
            });
            return;
          }
          last = { path: fresh[0], size: file.size };
        }
        for (const [base, at] of raws)
          if (!jpegs.has(base) && Date.now() - at > 4000)
            return setCheck({ status: "raw" });
        const left = Math.ceil((end - Date.now()) / 1000);
        if (left <= 0) return setCheck({ status: "timeout" });
        setCheck((c) => ({ ...c, left }));
      }
    } catch (e) {
      if (live()) setCheck({ status: "error", message: e.message });
    }
  }
  const stopCheck = () => {
    run.current++;
    setCheck(null);
  };
  return (
    <div className="kiosk-folder-check" aria-live="polite">
      {check?.status === "waiting" ? (
        <div className="kiosk-check-waiting">
          <p>
            <span className="spinner" aria-hidden="true" /> Bấm dây chụp trên {profile.label}… còn {check.left}s
          </p>
          <Button type="button" className="outline small" onClick={stopCheck}>
            Dừng thử
          </Button>
        </div>
      ) : (
        <Button type="button" className="small" onClick={start}>
          <Camera /> Thử nhận ảnh từ máy ảnh
        </Button>
      )}
      {check?.status === "ok" && (
        <div className="kiosk-check-result is-ok">
          <img src={check.preview} alt="Ảnh thử vừa nhận từ máy ảnh" />
          <div>
            <p>
              <b>Đã nhận {check.name}</b> ({check.width} × {check.height}). Máy
              chụp sẵn sàng — khách bấm chụp là ảnh vào album.
            </p>
            {Math.abs(check.skew) >= 2 && (
              <small>
                Giờ ghi trên tệp ảnh lệch khoảng {skewText(check.skew)} so với
                máy tính. Máy chụp vẫn nhận ảnh bình thường, nhưng nên chỉnh lại
                ngày giờ trên máy ảnh.
              </small>
            )}
          </div>
        </div>
      )}
      {check?.status === "raw" && (
        <p className="kiosk-check-result is-warn">{RAW_ONLY_MESSAGE}</p>
      )}
      {check?.status === "timeout" && (
        <div className="kiosk-check-result is-warn">
          <p>
            Sau {CHECK_SECONDS} giây chưa có ảnh mới trong thư mục “
            {folder.name}”. Kiểm tra lần lượt:
          </p>
          <ol>
            {profile.checks.map((text) => <li key={text}>{text}</li>)}
            <li>
              Cáp USB-C cắm thẳng vào máy tính và là cáp truyền dữ liệu (cáp chỉ
              sạc không dùng được).
            </li>
            <li>{folderAccessHint(profile.folder)}</li>
            <li>Chọn JPEG chất lượng cao hoặc JPEG + RAW; kiosk không nhận ảnh chỉ có RAW hay HEIF.</li>
          </ol>
        </div>
      )}
      {check?.status === "error" && (
        <p className="kiosk-check-result is-warn">
          Không đọc được thư mục ảnh: {check.message}
        </p>
      )}
    </div>
  );
}
