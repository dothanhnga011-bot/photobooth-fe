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
import { canPickFolder } from "./folder.js";
import { cameraProfile } from "./camera-profile.js";
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
  lowPower = false,
  setLowPower = () => {},
}) {
  const usable = liveUsableFor({ webcam: webcamTest });
  const profile = cameraProfile(roomInfo?.kind);
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
          title={`kết nối ${profile.label}`}
          steps={profile.steps}
          note={profile.note}
        />
        <p className="kiosk-device-note">
          <a href={profile.downloadUrl} target="_blank" rel="noreferrer">Tải {profile.app}</a>
          {" · "}<a href={profile.manualUrl} target="_blank" rel="noreferrer">Hướng dẫn máy ảnh chính hãng</a>
        </p>
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
            <FolderCheck key={`${profile.id}:${folder.name}`} folder={folder} kind={roomInfo?.kind} />
          )}
          <details className="kiosk-camera-note">
            <summary>
              <span>Chi tiết kết nối & lưu ảnh</span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <small>
              Chọn đúng thư mục phần mềm máy ảnh lưu JPEG —
              nên là thư mục riêng, vd. {profile.folder}. {profile.note}
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
                  ? "Đã lưu: lật như gương — hình trên màn hình, ảnh chụp và video cùng lật."
                  : "Đã lưu: không lật — hình trên màn hình, ảnh chụp và video đúng chiều máy ảnh.",
              );
            }}
          />
          Lật như gương (hình trên màn hình, ảnh chụp và video cùng lật; tắt = đúng chiều máy ảnh)
          {mirrorLocked && " — quản trị đã đặt ở mục Quản lý máy"}
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={webcamTest} onChange={(e) => setWebcamTest(e.target.checked)} />
          Thử máy bằng webcam máy tính (khi không có máy ảnh): webcam làm hình trực tiếp, bấm phím Space
          trên bàn phím để chụp, không cần thư mục ảnh. Tắt trước khi đón khách.
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={lowPower} onChange={(e) => setLowPower(e.target.checked)} />
          Chế độ máy yếu (mini PC đời cũ, đồ họa Intel HD 5xx/6xx): hình trực tiếp vẽ bằng canvas — bật khi
          hình trực tiếp bị trắng hoặc giật sau khi chụp.
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
