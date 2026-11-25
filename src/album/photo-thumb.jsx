import { useState } from "react";
import { getApiUrl } from "../api";
import { directMediaUrl, storageLink } from "../media-delivery.js";

// size: false = ảnh gốc của máy ảnh; true / "thumbnail"; "preview" (ảnh xem 1600 px); "print" (nguồn in).
export const photoUrl = (token, id, size = false) =>
  getApiUrl(
    `/api/albums/${token}/photos/${id}${size ? `?size=${["preview", "print"].includes(size) ? size : "thumbnail"}` : ""}`,
  );

// Ảnh nhỏ của album: tải thẳng từ kho lưu trữ bằng link album trả kèm, rồi qua chuyển hướng của
// API, cuối cùng qua API. Giữ nguyên nguồn đã chọn: album làm mới link định kỳ, đổi src là tải lại.
export function thumbSources(photo, token) {
  const api = photoUrl(token, photo.id, true);
  const link = storageLink(photo, "thumbnail");
  return [...(link ? [{ src: link, cors: true }] : []),
    { src: directMediaUrl(api), cors: true }, { src: api, cors: false }];
}

export function PhotoThumb({ photo, token, onError, ...props }) {
  const [sources] = useState(() => thumbSources(photo, token));
  const [index, setIndex] = useState(0);
  const { src, cors } = sources[index];
  return (
    <img
      {...props}
      crossOrigin={cors ? "anonymous" : undefined}
      src={src}
      onError={(event) => {
        if (index < sources.length - 1) setIndex(index + 1);
        else onError?.(event);
      }}
    />
  );
}
