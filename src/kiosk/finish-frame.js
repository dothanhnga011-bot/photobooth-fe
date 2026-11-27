// Máy chụp, khách bấm "In ảnh" (Kiosk.jsx → confirmFrame): ghép tờ in, ảnh QR và ảnh ghép trong album từ đúng
// những ảnh, màu ảnh, nhãn dán và phóng / dời / xoay khách đã chọn. Kiosk.jsx lo phần trạng thái màn hình.
import { fillPhotoSlots } from "./photo-selection.js";
import { filterStepsFor, photoFilterId } from "./decor.js";
import { compositeJpeg, printPhotoRegions, printSheets, queueKioskComposite, renderPrintFrame } from "./compose.js";

// Tờ in DNP vẽ gấp đôi khổ khung (2400 × 3600 cho khung 1200 × 1800).
const PRINT_SCALE = 2;

export const frameNameOf = (frame) => frame?.themeName?.trim() || frame?.name || "Khung ảnh";

// Ảnh đặt vào từng ô theo đúng thứ tự (hết giờ mà chưa chọn đủ: lấp ô trống bằng ảnh ít dùng nhất), cùng màu
// từng ảnh (màu riêng của tấm đó, không có thì màu chung), nhãn dán và phóng / dời / xoay theo mã tấm ảnh.
export function chosenLook(session, shots, frameNeeds, settings) {
  const keys = fillPhotoSlots(session.selected, frameNeeds, shots.map((shot) => shot.key));
  const chosenShots = keys.map((key) => shots.find((shot) => shot.key === key)).filter(Boolean);
  const stepsOf = (shot) => filterStepsFor(photoFilterId(session.decor, shot.key), settings);
  const transformOf = (shot) => session.decor?.transforms?.[shot.key];
  return {
    chosenShots,
    look: {
      filters: chosenShots.map(stepsOf),
      stickers: session.decor?.stickers || [],
      transforms: chosenShots.map(transformOf),
    },
  };
}

// Ảnh nhỏ (cạnh dài ≤ 1000 px) hiện ở màn QR.
export function qrPreview(image) {
  const preview = document.createElement("canvas");
  const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
  preview.width = Math.max(1, Math.round(image.width * scale));
  preview.height = Math.max(1, Math.round(image.height * scale));
  const ctx = preview.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, preview.width, preview.height);
  try { return preview.toDataURL("image/jpeg", 0.92); }
  finally { preview.width = preview.height = 0; }
}

// Tờ in của khung (nét Lanczos, từ ảnh gốc máy ảnh): ảnh nhỏ cho màn QR và lệnh in để lưu / gửi máy in.
export async function renderPrintJob(frame, chosenShots, session, look, albumLink) {
  const prints = Number(session.booking.prints) || 0;
  const canvas = await renderPrintFrame(frame, chosenShots, session.accessToken, albumLink, {
    ...look, scale: PRINT_SCALE, strict: true, sharp: true,
  });
  try {
    const composite = qrPreview(canvas);
    return {
      composite,
      printJob: {
        token: session.accessToken,
        frameName: frameNameOf(frame),
        images: await printSheets(canvas, frame, Math.max(1, prints), session.booking.printSize, PRINT_SCALE),
        printSize: frame.printSize === "strip" ? "strip" : "full",
        photos: printPhotoRegions(frame, canvas),
      },
    };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

// Ảnh ghép cho album (~20 MP, vẽ thẳng từ ảnh gốc máy ảnh; tờ in giữ kích thước của nó): khách xem / tải.
export async function saveAlbumComposite(frame, chosenShots, session, look, albumLink) {
  let albumFrame = null;
  try {
    albumFrame = await renderPrintFrame(frame, chosenShots, session.accessToken, albumLink, {
      ...look, pixels: 20_000_000, strict: true,
    });
    await queueKioskComposite({
      token: session.accessToken,
      captureToken: session.captureToken,
      image: await compositeJpeg(albumFrame),
      frameName: frameNameOf(frame),
    });
  } finally {
    if (albumFrame) albumFrame.width = albumFrame.height = 0;
  }
}
