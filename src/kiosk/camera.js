import { isMac } from "./folder.js";

// Tether software transfers JPEGs over USB; preview uses an HDMI capture device.
export const isCameraUsbVideo = (d) => /canon|eos|\br100\b|fujifilm|fuji|\bx-[st](?:3|10|20)\b/i.test(d?.label || "");
export const CAMERA_USB_MESSAGE =
  "Fujifilm X-T3/X-S10/X-S20 dùng USB tether và FUJIFILM X Acquire để lưu JPEG xuống máy tính. Hình trực tiếp dùng micro-HDMI qua thẻ ghi hình USB; chọn thẻ đó tại Hình trực tiếp từ máy ảnh.";
export const CAMERA_ERROR =
  "Không mở được hình trực tiếp. Kiểm tra cáp micro-HDMI, thẻ ghi hình USB và quyền camera của trình duyệt.";
const isVirtual = (d) => /obs|virtual/i.test(d.label);
// Webcam có sẵn của máy tính (MacBook "Camera FaceTime HD", laptop "USB2.0 FHD UVC WebCam"…):
// ở chế độ ảnh gốc không dùng làm hình trực tiếp — khách sẽ thấy sai góc máy.
// Windows: "Integrated Camera", "HD Webcam", "HP TrueVision", Surface "Camera Front/Rear";
// macOS: "FaceTime HD", iPhone làm webcam (Continuity Camera, Desk View).
export const isBuiltInCamera = (d) =>
  !isCameraUsbVideo(d) &&
  /webcam|integrated|built-?in|facetime|truevision|isight|camera (front|rear)|(front|rear) camera|iphone|ipad|continuity|desk view/i.test(
    d?.label || "",
  );
export const NO_HDMI_MESSAGE =
  "Chưa có hình trực tiếp từ máy ảnh: không thấy thẻ ghi hình HDMI (vd. “USB Video”). Ở chế độ ảnh gốc, máy chụp không dùng webcam của máy tính. Kiểm tra cáp micro HDMI từ máy ảnh và thẻ ghi hình cắm vào máy tính — cắm vào là hình tự hiện. Ảnh chụp vẫn nhận bình thường.";
export const hdmiFailed = (label, e) =>
  `Không mở được thẻ ghi hình “${label}” (${e?.name || "lỗi"}). Rút ra cắm lại thẻ ghi hình, tắt app khác đang dùng nó (Zoom, OBS, ${isMac ? "QuickTime, Photo Booth" : "app Camera, Teams"}, tab trình duyệt khác) rồi bấm “Mở lại camera”. Ảnh chụp vẫn nhận bình thường.`;
// Ưu tiên thẻ ghi hình HDMI, bỏ qua webcam USB chiếm đường điều khiển máy ảnh.
export const cameraRank = (d) =>
  isVirtual(d)
    ? 9
    : /capture|hdmi|cam ?link|elgato|avermedia|live gamer|ugreen|macrosilicon|usb video/i.test(
          d.label,
        )
      ? 0
      : isCameraUsbVideo(d)
        ? 1
        : isBuiltInCamera(d)
          ? 3
          : 2;
// Camera dùng được làm hình trực tiếp: chỉ thẻ ghi hình HDMI / camera ngoài của máy ảnh.
export const liveUsable = (d) => !isCameraUsbVideo(d) && !isBuiltInCamera(d);
// Chế độ thử máy bằng webcam: dùng được cả webcam máy tính (thẻ ghi hình HDMI vẫn được ưu tiên).
export const liveUsableFor = ({ webcam = false } = {}) =>
  webcam ? (d) => !isCameraUsbVideo(d) : liveUsable;
// light: thử máy bằng webcam máy tính — 1280 × 720 cho nhẹ (webcam laptop thường yếu ở 1080p).
export const videoConstraints = (deviceId, light = false) => ({
  video: {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: light ? 1280 : 1920 },
    height: { ideal: light ? 720 : 1080 },
    frameRate: { ideal: 30 },
  },
  audio: false,
});
