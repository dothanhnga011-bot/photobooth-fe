import { useEffect, useMemo, useState } from "react";
import { MIN_PHOTOS, pickSuggestions, summarizePhoto } from "./photo-suggestions.js";
import { loadPhoto, scoreLoaded, warmScorer } from "./face-score.js";

// Chấm lần lượt từng ảnh của album ở nền (không chặn khách xem / thả tim), lưu điểm trên máy để tải lại trang
// không phải chấm lại; ảnh thêm sau thì chấm thêm. Album ít hơn MIN_PHOTOS ảnh: không gợi ý. Bộ nhận diện
// không tải được (mạng yếu, máy cũ): thôi gợi ý, album vẫn dùng bình thường.
//
// Nhanh hết mức mà không làm giật trang: tải trước PREFETCH ảnh trong lúc chấm ảnh đang có (mạng chạy song song
// với nhận diện), tải bộ nhận diện cùng lúc với các ảnh đầu, nhường trình duyệt vẽ sau mỗi ảnh (không chờ cố định),
// và chỉ cập nhật giao diện / bộ nhớ máy vài lần mỗi giây (lưới 300 ảnh không vẽ lại sau từng ảnh).
const PREFETCH = 4;
const UPDATE_MS = 400;
const SAVE_MS = 2000;
const key = (token) => `selfbooth-suggest-v2-${token}`;
function readCache(token) {
  try { return JSON.parse(localStorage.getItem(key(token))) || {}; } catch { return {}; }
}
// Ảnh chấm lỗi (mạng chập chờn) không lưu: lần mở sau chấm lại.
function writeCache(token, scores) {
  const kept = Object.fromEntries(Object.entries(scores).filter(([, score]) => !score.error));
  try { localStorage.setItem(key(token), JSON.stringify(kept)); } catch { /* đầy bộ nhớ: chỉ mất bản lưu */ }
}
// Nhường trình duyệt vẽ và nhận thao tác của khách giữa hai ảnh.
const yieldToBrowser = () => (globalThis.scheduler?.yield
  ? globalThis.scheduler.yield()
  : new Promise((resolve) => setTimeout(resolve, 0)));
// Bắt đầu khi trang vừa hiện xong (ảnh nhỏ đầu tiên của lưới tải trước).
const whenIdle = (run) => {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: 1200 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 300);
  return () => clearTimeout(id);
};

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
    const { signal } = controller;
    const queue = [];
    const run = async () => {
      warmScorer();
      let next = { ...readCache(token), ...scores };
      let shownAt = Date.now(), savedAt = Date.now();
      let index = 0;
      // Tải trước: mỗi ảnh là một lời hứa { photo, bitmap | error }; ảnh tải xong mà đã dừng thì giải phóng.
      const fill = () => {
        while (queue.length < PREFETCH && index < missing.length) {
          const photo = missing[index++];
          queue.push(loadPhoto(token, photo, signal).then(
            (bitmap) => (signal.aborted ? (bitmap.close?.(), { photo }) : { photo, bitmap }),
            (error) => ({ photo, error })));
        }
      };
      fill();
      while (queue.length && !signal.aborted) {
        const { photo, bitmap, error } = await queue.shift();
        fill();
        if (signal.aborted) { bitmap?.close?.(); break; }
        while (document.hidden && !signal.aborted) await new Promise((r) => setTimeout(r, 1000));
        try {
          if (error) throw error;
          next = { ...next, [photo.id]: summarizePhoto(await scoreLoaded(bitmap)) };
        } catch (cause) {
          if (signal.aborted) break;
          // Không tải được bộ nhận diện: dừng hẳn. Một ảnh lỗi (mạng): bỏ qua ảnh đó lần này.
          if (cause?.code === "FACE_DETECTION_UNAVAILABLE") { controller.abort(); setFailed(true); break; }
          next = { ...next, [photo.id]: { faces: 0, error: true } };
        } finally {
          bitmap?.close?.();
        }
        const now = Date.now(), last = !queue.length;
        if (last || now - shownAt >= UPDATE_MS) { shownAt = now; setScores(next); }
        if (last || now - savedAt >= SAVE_MS) { savedAt = now; writeCache(token, next); }
        await yieldToBrowser();
      }
      if (!signal.aborted) { setScores(next); writeCache(token, next); }
    };
    const cancelStart = whenIdle(() => { if (!signal.aborted) run(); });
    return () => {
      cancelStart();
      controller.abort();
      // Ảnh đang tải dở: giải phóng khi tải xong.
      for (const pending of queue) pending.then(({ bitmap }) => bitmap?.close?.());
    };
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
