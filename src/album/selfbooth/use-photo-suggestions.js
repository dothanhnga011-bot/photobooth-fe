import { useEffect, useMemo, useState } from "react";
import { MIN_PHOTOS, pickSuggestions, summarizeFaces } from "./photo-suggestions.js";
import { scorePhoto } from "./face-score.js";

// Chấm lần lượt từng ảnh của album ở nền (không chặn khách xem / thả tim), lưu điểm trên máy để tải lại trang
// không phải chấm lại; ảnh thêm sau thì chấm thêm. Album ít hơn MIN_PHOTOS ảnh: không gợi ý. Bộ nhận diện
// không tải được (mạng yếu, máy cũ): thôi gợi ý, album vẫn dùng bình thường.
const key = (token) => `selfbooth-suggest-v1-${token}`;
function readCache(token) {
  try { return JSON.parse(localStorage.getItem(key(token))) || {}; } catch { return {}; }
}
// Ảnh chấm lỗi (mạng chập chờn) không lưu: lần mở sau chấm lại.
function writeCache(token, scores) {
  const kept = Object.fromEntries(Object.entries(scores).filter(([, score]) => !score.error));
  try { localStorage.setItem(key(token), JSON.stringify(kept)); } catch { /* đầy bộ nhớ: chỉ mất bản lưu */ }
}
const rest = () => new Promise((resolve) => setTimeout(resolve, 30));

// photos: ảnh gốc của album ({ id, number }); limit: số ảnh muốn gợi ý (suggestionTarget — theo số ô của bộ
// khung); paused: đang mở trình làm đẹp (nhường máy cho khách chỉnh ảnh).
export function usePhotoSuggestions(token, photos, { limit, paused = false } = {}) {
  const [scores, setScores] = useState(() => readCache(token));
  const [failed, setFailed] = useState(false);
  const ids = photos.map((p) => p.id).join();
  const enabled = photos.length >= MIN_PHOTOS && !failed;
  const missing = enabled ? photos.filter((p) => !scores[p.id]) : [];
  useEffect(() => {
    if (!enabled || paused || !missing.length) return;
    const controller = new AbortController();
    (async () => {
      let next = { ...readCache(token), ...scores };
      for (const photo of missing) {
        if (controller.signal.aborted) return;
        while (document.hidden && !controller.signal.aborted) await new Promise((r) => setTimeout(r, 1000));
        try {
          next = { ...next, [photo.id]: summarizeFaces(await scorePhoto(token, photo, controller.signal)) };
        } catch (error) {
          if (controller.signal.aborted) return;
          // Không tải được bộ nhận diện: dừng hẳn. Một ảnh lỗi (mạng): bỏ qua ảnh đó lần này.
          if (error?.code === "FACE_DETECTION_UNAVAILABLE") return setFailed(true);
          next = { ...next, [photo.id]: { faces: 0, error: true } };
        }
        writeCache(token, next);
        setScores(next);
        await rest();
      }
    })();
    return () => controller.abort();
    // Chạy lại khi danh sách ảnh đổi (thêm / xoá ảnh) hoặc hết tạm dừng.
  }, [token, ids, enabled, paused]);
  const suggested = useMemo(() => {
    if (!enabled || missing.length) return [];
    return pickSuggestions(photos.map((p) => ({ id: p.id, number: p.number, ...scores[p.id] })), photos.length, limit);
  }, [enabled, ids, scores, missing.length, limit]);
  return {
    // Đang chấm: { done, total } để hiện tiến độ; xong (hoặc không gợi ý) thì null.
    progress: enabled && missing.length ? { done: photos.length - missing.length, total: photos.length } : null,
    suggested,
  };
}
