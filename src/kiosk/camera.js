import { isMac } from "./folder.js";

// Tether software transfers JPEGs over USB; preview uses an HDMI capture device.
export const isCameraUsbVideo = (d) => /canon|eos|\br100\b|fujifilm|fuji|\bx-[st](?:3|10|20)\b/i.test(d?.label || "");
export const CAMERA_USB_MESSAGE =
  "USB chuyển JPEG bằng FUJIFILM X Acquire (Photobooth) hoặc Canon EOS Utility (Polaroid/R100). Hình trực tiếp dùng micro-HDMI qua thẻ ghi hình USB; chọn thẻ đó tại Hình trực tiếp từ máy ảnh.";
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
    // Prefer a native capture-card format over an extra browser crop/resize.
    // This is a preference, so older cards can still negotiate a working mode.
    ...(!light && { resizeMode: { ideal: "none" } }),
  },
  audio: false,
});

export function cameraProblem(error) {
  if (error?.cameraProblem) return error.cameraProblem;
  switch (error?.name) {
    case 'NotFoundError': case 'DevicesNotFoundError':
      return { message: 'Máy tính chưa nhận thiết bị video. Nhờ nhân viên kiểm tra thẻ ghi hình trong ứng dụng Camera và Device Manager, rồi cắm lại USB của thẻ ghi hình.' };
    case 'NotAllowedError': case 'PermissionDeniedError': case 'SecurityError':
      return { message: `Quyền camera đang bị chặn. Cho phép camera cho trang web và ${isMac ? 'trong cài đặt quyền riêng tư của macOS' : 'bật quyền camera cho ứng dụng desktop trong Windows'}, sau đó tải lại trang.` };
    case 'NotReadableError': case 'TrackStartError':
      return { message: 'Chưa đọc được thẻ ghi hình. Đóng ứng dụng Camera, OBS, Zoom và tab kiosk khác đang dùng thẻ; kiểm tra cổng USB rồi mở lại camera.' };
    case 'OverconstrainedError': case 'ConstraintNotSatisfiedError':
      return { message: 'Thiết bị video đã thay đổi hoặc chế độ hình chưa phù hợp. Chọn lại thẻ ghi hình trong Cài đặt máy chụp rồi thử lại.' };
    case 'NotSupportedError':
      return { message: 'Trình duyệt chưa cung cấp quyền truy cập camera. Mở kiosk bằng Chrome hoặc Edge qua HTTPS.' };
    default: return { message: CAMERA_ERROR };
  }
}

// Each attempt owns one stream. Release it before switching UVC sources: on
// Windows an old stream can otherwise keep the same capture device busy.
// Never probe EOS Webcam Utility as a fallback when named HDMI devices exist.
export async function openLiveVideo({ devices = globalThis.navigator?.mediaDevices, id = '', webcam = false } = {}) {
  if (!devices?.getUserMedia || !devices?.enumerateDevices)
    throw Object.assign(new Error('Camera API unavailable'), { name: 'NotSupportedError' });
  const usable = liveUsableFor({ webcam }), failed = new Set();
  const inputs = async () => (await devices.enumerateDevices()).filter(device => device.kind === 'videoinput');
  const choose = list => list.find(device => device.deviceId === id && usable(device) && !failed.has(device.deviceId)) ||
    list.filter(device => usable(device) && cameraRank(device) < 9 && !failed.has(device.deviceId))
      .sort((a, b) => cameraRank(a) - cameraRank(b))[0];
  const stop = stream => stream?.getTracks().forEach(track => track.stop());
  const blocked = list => Object.assign(new Error('No usable capture device'), { cameraProblem: {
    message: list.some(isCameraUsbVideo) ? CAMERA_USB_MESSAGE : NO_HDMI_MESSAGE,
  } });
  let media;
  try {
    let list = await inputs();
    const named = list.some(device => device.label);
    const first = named ? choose(list)?.deviceId : id;
    if (named && !first) throw blocked(list);
    try { media = await devices.getUserMedia(videoConstraints(first, webcam)); }
    catch (error) {
      if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(error.name)) throw error;
      if (first) failed.add(first);
      list = await inputs();
      const alternative = choose(list);
      if (alternative) media = await devices.getUserMedia(videoConstraints(alternative.deviceId, webcam));
      else if (first && !named) media = await devices.getUserMedia(videoConstraints('', webcam));
      else throw error;
    }
    list = await inputs();
    const wanted = choose(list)?.deviceId;
    if (wanted && media.getVideoTracks()[0]?.getSettings().deviceId !== wanted) {
      stop(media);
      media = null;
      media = await devices.getUserMedia(videoConstraints(wanted, webcam));
    }
    if (!media.getVideoTracks()[0] || !usable(media.getVideoTracks()[0])) throw blocked(list);
    return { stream: media, cameras: list };
  } catch (error) { stop(media); throw error; }
}
