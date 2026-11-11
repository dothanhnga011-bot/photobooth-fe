import { FOLDER_KEY } from "./constants.js";
import { isMac } from "./folder.js";

// One source for the room's camera, folder and staff instructions.
export function cameraProfile(kind) {
  const canon = kind === "polaroid";
  const folder = isMac ? `Pictures/PhotoBooth/${canon ? "Canon" : "Fujifilm"}`
    : `C:\\PhotoBooth\\${canon ? "Canon" : "Fujifilm"}`;
  const common = [
    "Lần đầu bấm “Chọn thư mục ảnh”, chọn đúng thư mục phần mềm máy ảnh đang lưu. Khi được hỏi quyền, chọn “Cho phép mỗi lần truy cập”.",
    "Bấm “Thử nhận ảnh từ máy ảnh”, rồi nhấn dây bấm. Xác nhận có JPEG mới trong thư mục và ảnh thử hiện trên kiosk trước khi đón khách.",
    "Hình trực tiếp: nối micro-HDMI của máy ảnh vào thẻ ghi hình USB và chọn thẻ đó (vd. USB Video).",
  ];
  return canon ? {
    id: "canon-r100", label: "Canon EOS R100", app: "Canon EOS Utility",
    folder, folderKey: "camera-folder-canon-r100",
    downloadUrl: "https://app.ssw.imaging-saas.canon/app/app.html?app=eu",
    manualUrl: "https://cam.start.canon/en/C015/manual/html/index.html",
    steps: [
      "Cài EOS Utility hỗ trợ EOS R100. Tắt máy ảnh, cắm dây bấm RS-60E3 vào cổng remote, cáp USB-C dữ liệu vào PC và micro-HDMI vào thẻ ghi hình; bật máy ảnh.",
      "Chọn chế độ chụp ảnh, JPEG Large/Fine (L), không chỉ RAW/CR3. Vào MENU → Drive mode → Single shooting (chụp từng ảnh), không chọn Self-timer 2s/10s; tắt Auto power off và đặt Color space = sRGB.",
      "Dây RS-60E3 điều khiển chụp trực tiếp trên R100: nhấn nửa nút để lấy nét, nhấn hết để chụp rồi thả nút. Không bật hẹn giờ/interval trên dây có bộ hẹn giờ. Web chờ JPEG từ EOS Utility, không tự bấm máy ảnh.",
      `Mở EOS Utility → Preferences → Destination Folder, chọn ${folder}. Tắt tạo thư mục con tự động để kiosk đọc ảnh ngay tại thư mục này.`,
      "EOS Utility → Preferences → Basic Settings → Startup Action: Show Remote shooting screen. Trong Remote shooting, đặt lưu ảnh trên Computer hoặc Computer and camera. Giữ cửa sổ này kết nối khi khách bấm dây.",
      "Trong Preferences, tắt Automatically display Quick Preview window và phần mềm mở ảnh sau khi chụp để cửa sổ khác không che kiosk. Đóng EOS Webcam Utility và chương trình khác đang giữ USB máy ảnh.",
      ...common,
    ],
    checks: [
      "Canon R100 đang bật, ở chế độ chụp ảnh, JPEG L/Fine; dây RS-60E3 cắm đúng cổng remote.",
      "EOS Utility đã kết nối và đang ở Remote shooting, lưu vào Computer hoặc Computer and camera.",
      `Destination Folder của EOS Utility trùng thư mục đã chọn ở kiosk (${folder}).`,
    ],
    note: "Phòng Polaroid dùng Canon R100 và dây bấm RS-60E3, không đếm ngược từng tấm. USB chuyển JPEG, thẻ ghi hình HDMI cung cấp hình trực tiếp. Đồng hồ trên kiosk chỉ giới hạn thời gian của lượt chụp; hết giờ không tự chụp. Thử cả dây bấm, flash và ảnh vào album trước khi đón khách.",
  } : {
    id: "fujifilm", label: "Fujifilm X-T3 / X-S10 / X-S20", app: "FUJIFILM X Acquire",
    folder, folderKey: FOLDER_KEY,
    downloadUrl: "https://www.fujifilm-x.com/global/support/download/software/x-acquire/",
    manualUrl: "https://fujifilm-dsc.com/en/manual/x-s10/connections/computer/index.html",
    steps: [
      "Cắm USB dữ liệu từ Fujifilm vào PC, micro-HDMI vào thẻ ghi hình và dây bấm tương thích RR-100; bật máy ảnh.",
      "Chọn USB TETHER SHOOTING AUTO, FINE hoặc FINE + RAW, định dạng JPEG và Color space = sRGB; chọn Single shooting, tắt self-timer/Auto power off. X-S10 cần firmware hỗ trợ tether; X-S20 chọn JPEG thay vì HEIF.",
      `Mở FUJIFILM X Acquire, chọn tự tải JPEG vào ${folder}; đóng gPhoto2, darktable và chương trình khác đang giữ USB máy ảnh.`,
      ...common,
    ],
    checks: [
      "Fujifilm đang bật, chọn USB TETHER SHOOTING AUTO, FINE JPEG và dây bấm tương thích RR-100.",
      "FUJIFILM X Acquire đang kết nối máy ảnh; không có chương trình khác đang giữ USB.",
      `Thư mục tải JPEG của X Acquire trùng thư mục đã chọn ở kiosk (${folder}).`,
    ],
    note: "Phòng Photobooth dùng Fujifilm và dây bấm RR-100 tương thích. X-S10/X-S20 cần đầu chuyển remote đúng chân. Thử cả dây bấm, flash và ảnh vào album trước khi đón khách.",
  };
}
