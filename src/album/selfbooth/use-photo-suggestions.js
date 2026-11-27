import { useEffect, useMemo, useRef, useState } from "react";
import { MIN_PHOTOS, pickSuggestions, summarizePhoto } from "./photo-suggestions.js";
import { loadPhoto, scoreLoaded, warmScorer } from "./face-score.js";

// Chấm lần lượt từng ảnh của album ở nền (không chặn khách xem / thả tim), lưu điểm trên máy để tải lại trang
// không phải chấm lại; ảnh thêm sau thì chấm thêm. Album ít hơn MIN_PHOTOS ảnh: không gợi ý. Bộ nhận diện
// không tải được (mạng yếu, máy cũ): thôi gợi ý, album vẫn dùng bình thường.
//
// Sau khi lưới ảnh đã mở, tải trước vài ảnh trong lúc chấm và nhường trình duyệt
// cập nhật giao diện giữa các ảnh. Công việc này nhường lượt cho các thao tác của khách.
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
// Chờ luồng vẽ rảnh sau khi lưới ảnh báo đã tải nhóm ảnh đầu.
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
  const latestScores = useRef(scores);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  const ids = photos.map((p) => p.id).join();
  const enabled = photos.length >= MIN_PHOTOS && !failed;
  const missing = enabled ? photos.filter((p) => !scores[p.id]) : [];
  useEffect(() => {
    if (!enabled || paused || !visible || !missing.length) return;
    const controller = new AbortController();
    const { signal } = controller;
    const queue = [];
    const next = { ...readCache(token), ...latestScores.current };
    const toScore = missing.filter((photo) => !next[photo.id]);
    let dirty = false;
    const publish = () => setScores({ ...next });
    const saveProgress = () => {
      if (!dirty) return;
      writeCache(token, next);
      dirty = false;
    };
    const run = async () => {
      if (!toScore.length) { publish(); return; }
      warmScorer();
      let shownAt = Date.now(), savedAt = Date.now();
      let index = 0;
      // Tải trước: mỗi ảnh là một lời hứa { photo, bitmap | error }; ảnh tải xong mà đã dừng thì giải phóng.
      const fill = () => {
        while (queue.length < PREFETCH && index < toScore.length) {
          const photo = toScore[index++];
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
        try {
          if (error) throw error;
          const result = await scoreLoaded(bitmap);
          if (signal.aborted) break;
          next[photo.id] = summarizePhoto(result);
        } catch (cause) {
          if (signal.aborted) break;
          // Không tải được bộ nhận diện: dừng hẳn. Một ảnh lỗi (mạng): bỏ qua ảnh đó lần này.
          if (cause?.code === "FACE_DETECTION_UNAVAILABLE") { controller.abort(); setFailed(true); break; }
          next[photo.id] = { faces: 0, error: true };
        } finally {
          bitmap?.close?.();
        }
        latestScores.current = next;
        dirty = true;
        const now = Date.now();
        if (now - shownAt >= UPDATE_MS) { shownAt = now; publish(); }
        if (now - savedAt >= SAVE_MS) { savedAt = now; saveProgress(); }
        await yieldToBrowser();
      }
      if (!signal.aborted) { publish(); saveProgress(); }
    };
    const cancelStart = whenIdle(() => { if (!signal.aborted) run(); });
    return () => {
      cancelStart();
      controller.abort();
      saveProgress();
      // Ảnh đang tải dở: giải phóng khi tải xong.
      for (const pending of queue) pending.then(({ bitmap }) => bitmap?.close?.());
    };
    // Chạy lại khi danh sách ảnh đổi (thêm / xoá ảnh) hoặc hết tạm dừng.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ids là danh sách mã ảnh (missing / photos tạo mới mỗi lần album hỏi lại)
  }, [token, ids, enabled, paused, visible]);
  const suggested = useMemo(() => {
    if (!enabled || missing.length) return [];
    return pickSuggestions(photos.map((p) => ({ id: p.id, number: p.number, ...scores[p.id] })), photos.length, limit);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- như trên: theo danh sách mã ảnh, không theo mảng photos mới mỗi lần hỏi lại
  }, [enabled, ids, scores, missing.length, limit]);
  return {
    // Đang chấm: { done, total } để hiện tiến độ; xong (hoặc không gợi ý) thì null.
    progress: enabled && missing.length ? { done: photos.length - missing.length, total: photos.length } : null,
    suggested,
  };
}
