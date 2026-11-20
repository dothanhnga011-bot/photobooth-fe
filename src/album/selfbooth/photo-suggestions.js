// Gợi ý ảnh đẹp ở album phòng Selfbooth (20/11 chủ tiệm: khách chụp 100–300 tấm, chọn ảnh là bước lâu nhất).
// Mỗi ảnh được chấm theo khuôn mặt (MediaPipe Face Landmarker, điểm blendshape 0..1 của từng mặt): mắt mở
// (eyeBlink thấp) và nụ cười (mouthSmile). Ảnh có người nhắm mắt hoặc thiếu người (ít mặt hơn hầu hết các ảnh
// khác của buổi chụp) bị loại; còn lại xếp theo điểm. Số ảnh gợi ý theo số ô của bộ khung (bộ 15 ô gợi ý 15
// ảnh), ưu tiên các khoảnh khắc khác nhau (bỏ ảnh chụp liền nhau gần như giống hệt). Cách chấm giống gợi ý ảnh
// của web Selfbooth.

// eyeBlink trên mức này là mắt nhắm (cười híp mắt thường chỉ tới khoảng 0,3–0,45).
export const CLOSED_EYE = 0.55;
// mouthSmile trung bình từ mức này là ảnh có cười; mặt bình thường (mắt mở) chỉ dùng khi chưa đủ ô.
export const SMILING = 0.3;
// Album ít ảnh hơn chừng này: khách tự xem hết, không cần gợi ý.
export const MIN_PHOTOS = 6;
// Tiệm chưa có bộ khung nào: gợi ý khoảng một phần ba album, tối đa chừng này ảnh.
export const MAX_SUGGESTIONS = 10;

const round = (n) => Math.round(n * 1000) / 1000;

// faces: [{ blink, smile }] của một ảnh → điểm lưu lại cho ảnh đó.
export function summarizeFaces(faces) {
  if (!faces?.length) return { faces: 0 };
  return {
    faces: faces.length,
    smile: round(faces.reduce((sum, face) => sum + face.smile, 0) / faces.length),
    open: round(Math.min(...faces.map((face) => 1 - face.blink))),
    closed: faces.some((face) => face.blink > CLOSED_EYE),
  };
}

// Số ảnh gợi ý: đúng số ô của bộ khung khách đã chọn; chưa chọn bộ thì theo bộ ít ô nhất của tiệm (đủ ghép ít
// nhất một bộ); tiệm chưa có bộ khung thì khoảng một phần ba album, tối đa 10. Album nhỏ: không gợi ý.
export function suggestionTarget({ total, packCapacity = 0, packCapacities = [] }) {
  if (total < MIN_PHOTOS) return 0;
  if (packCapacity > 0) return packCapacity;
  const sizes = packCapacities.filter((n) => n > 0);
  if (sizes.length) return Math.min(...sizes);
  return Math.min(MAX_SUGGESTIONS, Math.ceil(total / 3));
}

// Số mặt thường gặp nhất trong buổi chụp (bằng nhau thì lấy số lớn hơn): ảnh ít mặt hơn là có người quay
// đi, bị che hoặc ra khỏi khung.
function usualFaces(entries) {
  const counts = new Map();
  for (const { faces } of entries) if (faces > 0) counts.set(faces, (counts.get(faces) || 0) + 1);
  let best = 0, seen = 0;
  for (const [faces, count] of counts)
    if (count > seen || (count === seen && faces > best)) [best, seen] = [faces, count];
  return best;
}

// entries: [{ id, number, faces, smile, open, closed }] của các ảnh đã chấm; total: số ảnh của album; limit:
// số ảnh muốn gợi ý (suggestionTarget). Trả về mã ảnh gợi ý, ảnh đẹp nhất trước.
export function pickSuggestions(entries, total = entries.length, limit = suggestionTarget({ total })) {
  if (total < MIN_PHOTOS || !(limit > 0)) return [];
  const usual = usualFaces(entries);
  const ranked = entries
    .filter((entry) => entry.faces > 0 && !entry.closed && entry.faces >= usual)
    .map((entry) => ({ ...entry, score: 0.75 * entry.smile + 0.25 * entry.open }))
    .sort((a, b) => b.score - a.score || a.number - b.number);
  // Ảnh chụp liền nhau gần như giống hệt. Thứ tự lấy: ảnh cười ở các khoảnh khắc khác nhau → ảnh cười còn
  // lại (chụp liền nhau) → ảnh mặt bình thường, mắt mở (cũng khoảnh khắc khác nhau trước) — đến khi đủ số ô.
  const gap = total >= 60 ? 3 : 2;
  const picked = [];
  const take = (list, spread) => {
    for (const entry of list) {
      if (picked.length >= limit) return;
      if (picked.includes(entry)) continue;
      if (!spread || picked.every((other) => Math.abs(other.number - entry.number) >= gap)) picked.push(entry);
    }
  };
  const smiling = ranked.filter((entry) => entry.smile >= SMILING);
  const plain = ranked.filter((entry) => entry.smile < SMILING);
  take(smiling, true);
  take(smiling, false);
  take(plain, true);
  take(plain, false);
  // Thứ tự: các khoảnh khắc khác nhau từ đẹp nhất, rồi các ảnh lấy thêm (thả tim theo thứ tự này).
  return picked.map((entry) => entry.id);
}
