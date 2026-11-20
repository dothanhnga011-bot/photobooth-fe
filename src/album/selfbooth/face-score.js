import { fetchMediaBlob, storageLink } from "../../media-delivery.js";
import { scoreFaces } from "../../beauty.js";
import { photoUrl } from "../photo-thumb.jsx";

// Chấm khuôn mặt một ảnh của album (gợi ý ảnh đẹp): dùng ảnh nhỏ 640 px của thư viện (trình duyệt thường đã
// tải sẵn khi hiện lưới ảnh), trả về [{ blink, smile, width }] từng mặt.
export async function scorePhoto(token, photo, signal) {
  const blob = await fetchMediaBlob(photoUrl(token, photo.id, "thumbnail"), {
    signal, link: storageLink(photo, "thumbnail"),
  });
  const bitmap = await createImageBitmap(blob);
  try {
    return await scoreFaces(bitmap);
  } finally {
    bitmap.close();
  }
}
