import { PiFolderOpenDuotone } from "react-icons/pi";
import { ChevronDown, Maximize2, Settings2 } from "lucide-react";
import { Button } from "../studio";
import { Guide } from "../guide";
import { CAMERA_KEY, MIRROR_KEY } from "./constants.js";
import {
  cameraRank,
  CAMERA_USB_MESSAGE,
  isBuiltInCamera,
  isCameraUsbVideo,
  liveUsable,
  liveUsableFor,
  NO_HDMI_MESSAGE,
} from "./camera.js";
import { canPickFolder, PHOTO_FOLDER_EXAMPLE } from "./folder.js";
import { FolderCheck } from "./FolderCheck.jsx";
import { KioskDevices } from "./KioskDevices.jsx";

export function KioskSettings({
  folder,
  folderAccess,
  pickFolder,
  grantFolder,
  cameras,
  cameraId,
  setCameraId,
  mirror,
  setMirror,
  mirrorLocked = false,
  zoom,
  setZoom,
  roomInfo,
  toast,
  webcamTest = false,
  setWebcamTest = () => {},
}) {
  const usable = liveUsableFor({ webcam: webcamTest });
  return (
    <details className="kiosk-settings">
      <summary>
        <span>
          <Settings2 size={18} aria-hidden="true" /> Cài đặt máy chụp (nhân
          viên)
        </span>
        {(!folder || folderAccess !== "granted") && (
          <em className="kiosk-settings-warn">Chưa chọn thư mục ảnh</em>
        )}
        <ChevronDown
          size={18}
          className="kiosk-settings-chevron"
          aria-hidden="true"
        />
      </summary>
      <div className="kiosk-settings-body">
        <Guide
          id="kiosk-camera"
          dark
          title="kết nối Fujifilm X-T3 / X-S10 / X-S20 (phòng Photobooth & Polaroid)"
          steps={[
            "Cắm USB dữ liệu từ Fujifilm vào máy tính và micro HDMI vào thẻ ghi hình; bật máy ảnh.",
            "Trên máy ảnh chọn USB TETHER SHOOTING AUTO, FINE hoặc FINE + RAW, định dạng JPEG, Single shooting và tắt self-timer.",
            `Mở FUJIFILM X Acquire, chọn tự tải JPEG vào ${PHOTO_FOLDER_EXAMPLE}; không mở gPhoto2 hoặc darktable cùng lúc.`,
            "Lần đầu bấm “Chọn thư mục ảnh”, chọn đúng thư mục đó. Nếu lần mở sau cần cấp quyền, bấm “Cho phép đọc thư mục” và chọn “Cho phép mỗi lần truy cập”.",
            "Bấm “Thử nhận ảnh từ máy ảnh”, rồi nhấn dây bấm tương thích Fujifilm; xác nhận JPEG gốc xuất hiện trong thư mục và kiosk.",
            "“Hình trực tiếp từ máy ảnh”: để Tự động hoặc chọn thẻ ghi hình (USB Video), không chọn webcam máy tính.",
          ]}
          note="Máy ảnh phải bật nguồn và FUJIFILM X Acquire phải kết nối. Khách bấm dây để chụp — phòng Polaroid cũng vậy, không còn tự chụp theo đếm ngược."
        />
        <div className="kiosk-folder">
          <p>
            Thư mục ảnh: <b>{folder ? folder.name : "chưa chọn"}</b>
            {folder &&
              (folderAccess === "granted"
                ? " · đã cho phép đọc"
                : " · cần cho phép đọc lại")}
          </p>
          <div className="kiosk-folder-actions">
            <Button
              type="button"
              className="outline small"
              onClick={pickFolder}
              disabled={!canPickFolder}
            >
              <PiFolderOpenDuotone />{" "}
              {folder ? "Đổi thư mục" : "Chọn thư mục ảnh"}
            </Button>
            {folder && folderAccess !== "granted" && (
              <Button type="button" className="small" onClick={grantFolder}>
                Cho phép đọc thư mục
              </Button>
            )}
          </div>
          {folder && folderAccess === "granted" && (
            <FolderCheck key={folder.name} folder={folder} />
          )}
          <details className="kiosk-camera-note">
            <summary>
              <span>Chi tiết kết nối & lưu ảnh</span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <small>
              Chọn đúng thư mục phần mềm máy ảnh lưu JPEG —
              nên là thư mục riêng, vd. {PHOTO_FOLDER_EXAMPLE}.
              X-T3/X-S10/X-S20 dùng USB dữ liệu và FUJIFILM X Acquire để lưu JPEG xuống máy tính.
              Hình trực tiếp dùng micro-HDMI + thẻ ghi hình; không dùng USB streaming đồng thời.
              Khách dùng dây bấm tương thích RR-100 để chụp; X-S10/X-S20 cần đầu chuyển 2,5 mm sang 3,5 mm đúng chân remote.
            </small>
          </details>
        </div>
        <label>
          Hình trực tiếp từ máy ảnh
          <select
            aria-label="Hình trực tiếp từ máy ảnh"
            value={
              cameras.some((c) => c.deviceId === cameraId && !usable(c))
                ? ""
                : cameraId
            }
            onChange={(e) => {
              setCameraId(e.target.value);
              localStorage.setItem(CAMERA_KEY, e.target.value);
              toast.success("Đã lưu camera cho phòng chụp này.");
            }}
          >
            <option value="">
              Tự động (ưu tiên thẻ ghi hình HDMI / máy ảnh)
            </option>
            {cameras.map((c, i) => (
              <option
                key={c.deviceId || i}
                value={c.deviceId}
                disabled={!usable(c)}
              >
                {c.label || `Camera ${i + 1}`}
                {usable(c)
                  ? ""
                  : isBuiltInCamera(c)
                    ? " — webcam máy tính, không dùng"
                    : " — không dùng (chiếm máy ảnh)"}
              </option>
            ))}
          </select>
        </label>
        {cameras.some(isCameraUsbVideo) && (
          <p className="kiosk-check-result is-warn kiosk-webcam-note">
            {CAMERA_USB_MESSAGE}
          </p>
        )}
        {!webcamTest && cameras.some((c) => c.label) &&
          !cameras.some((c) => liveUsable(c) && cameraRank(c) < 9) && (
            <p className="kiosk-check-result is-warn kiosk-hdmi-note">
              {NO_HDMI_MESSAGE}
            </p>
          )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={mirror}
            disabled={mirrorLocked}
            onChange={(e) => {
              setMirror(e.target.checked);
              localStorage.setItem(MIRROR_KEY, e.target.checked ? "1" : "0");
              toast.success(
                e.target.checked
                  ? "Đã lưu: ảnh chụp lật như gương (giống hình trên màn hình)."
                  : "Đã lưu: ảnh chụp giữ nguyên chiều như máy ảnh.",
              );
            }}
          />
          Lưu ảnh lật như gương (giống hình trên màn hình)
          {mirrorLocked && " — quản trị đã đặt ở mục Quản lý máy"}
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={webcamTest} onChange={(e) => setWebcamTest(e.target.checked)} />
          Thử máy bằng webcam máy tính (khi không có máy ảnh): webcam làm hình trực tiếp, chụp bằng nút
          “Chạm để chụp” trên màn hình, không cần thư mục ảnh. Tắt trước khi đón khách.
        </label>
        <KioskDevices zoom={zoom} setZoom={setZoom} roomInfo={roomInfo} toast={toast} />
        <Button
          type="button"
          className="outline small"
          onClick={() =>
            document.fullscreenElement
              ? document.exitFullscreen()
              : document.documentElement
                  .requestFullscreen()
                  .catch(() =>
                    toast.warning("Trình duyệt không cho bật toàn màn hình."),
                  )
          }
        >
          <Maximize2 size={17} aria-hidden="true" />
          Bật / tắt toàn màn hình
        </Button>
      </div>
    </details>
  );
}
