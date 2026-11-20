// Gợi ý ảnh đẹp ở album phòng Selfbooth (20/11 chủ tiệm: khách chụp 100–300 tấm, chọn ảnh là bước lâu nhất).
// Mỗi ảnh được chấm theo khuôn mặt (MediaPipe Face Landmarker, điểm blendshape 0..1 của từng mặt) và đo trên
// ảnh (face-score.js): mắt mở (eyeBlink thấp), nụ cười (mouthSmile), độ nét vùng mặt, nhìn thẳng, mặt bị cắt ở
// mép, dấu vân ảnh (hai ảnh gần như giống hệt). Ảnh có người nhắm mắt, thiếu người (ít mặt hơn hầu hết các ảnh
// khác của buổi chụp) hoặc mờ hẳn bị loại; còn lại xếp theo điểm. Số ảnh gợi ý theo số ô của bộ khung (bộ 15 ô
// gợi ý 15 ảnh), ưu tiên các khoảnh khắc khác nhau.

// eyeBlink trên mức này là mắt nhắm (cười híp mắt thường chỉ tới khoảng 0,3–0,45).
export const CLOSED_EYE = 0.55;
// mouthSmile trung bình từ mức này là ảnh có cười.
export const SMILING = 0.3;
// Độ nét so với ảnh thường của buổi chụp (trung vị): dưới mức này là mờ hẳn (rung tay, lệch nét) — loại; dưới
// SHARP_ENOUGH chỉ dùng khi chưa đủ ảnh.
export const BLURRY = 0.35;
export const SHARP_ENOUGH = 0.6;
// Nhìn thẳng (1) … quay ngang (0): dưới mức này có người quay mặt đi — chỉ dùng khi chưa đủ ảnh.
export const FACING = 0.5;
// Dấu vân ảnh khác nhau tối đa chừng này bit (trên 64) là cùng một khoảnh khắc: rất giống ở bất cứ đâu trong
// buổi chụp, hoặc khá giống mà chụp liền nhau.
export const SAME_PICTURE = 6;
export const SIMILAR_PICTURE = 14;
// Album ít ảnh hơn chừng này: khách tự xem hết, không cần gợi ý.
export const MIN_PHOTOS = 6;
// Tiệm chưa có bộ khung nào: gợi ý khoảng một phần ba album, tối đa chừng này ảnh.
export const MAX_SUGGESTIONS = 10;

const round = (n) => Math.round(n * 1000) / 1000;
const finite = (values) => values.filter((v) => Number.isFinite(v));

// Kết quả chấm một ảnh ({ faces: [{ blink, smile, facing?, cut?, sharp? }], hash? }) → điểm lưu lại cho ảnh đó.
export function summarizePhoto({ faces = [], hash = "" } = {}) {
  if (!faces.length) return { faces: 0, ...(hash && { hash }) };
  const facing = finite(faces.map((face) => face.facing));
  const sharp = finite(faces.map((face) => face.sharp));
  return {
    faces: faces.length,
    smile: round(faces.reduce((sum, face) => sum + face.smile, 0) / faces.length),
    open: round(Math.min(...faces.map((face) => 1 - face.blink))),
    closed: faces.some((face) => face.blink > CLOSED_EYE),
    ...(facing.length && { facing: round(Math.min(...facing)) }),
    // Một người mờ là cả ảnh mờ: lấy mặt kém nét nhất.
    ...(sharp.length && { sharp: Math.min(...sharp) }),
    ...(faces.some((face) => face.cut) && { cut: true }),
    ...(hash && { hash }),
  };
}

// Số bit khác nhau của hai dấu vân ảnh (hex); thiếu dấu thì không so được (Infinity).
export function pictureDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let bits = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) { bits += x & 1; x >>= 1; }
  }
  return bits;
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
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// entries: [{ id, number, faces, smile, open, closed, facing?, sharp?, cut?, hash? }] của các ảnh đã chấm; total:
// số ảnh của album; limit: số ảnh muốn gợi ý (suggestionTarget). Trả về mã ảnh gợi ý, ảnh nên chọn trước đứng trước.
export function pickSuggestions(entries, total = entries.length, limit = suggestionTarget({ total })) {
  if (total < MIN_PHOTOS || !(limit > 0)) return [];
  const usual = usualFaces(entries);
  const people = entries.filter((entry) => entry.faces > 0 && !entry.closed && entry.faces >= usual);
  // Độ nét so với ảnh thường của chính buổi chụp này (cùng máy ảnh, cùng đèn).
  const typicalSharp = median(finite(people.map((entry) => entry.sharp)));
  const clarity = (entry) => (typicalSharp > 0 && Number.isFinite(entry.sharp) ? Math.min(1, entry.sharp / typicalSharp) : 1);
  const ranked = people
    .map((entry) => {
      const clear = clarity(entry), facing = entry.facing ?? 1;
      return { ...entry, clear, facing,
        score: 0.6 * entry.smile + 0.15 * entry.open + 0.15 * clear + 0.1 * facing - (entry.cut ? 0.1 : 0) };
    })
    .filter((entry) => entry.clear >= BLURRY)
    .sort((a, b) => b.score - a.score || a.number - b.number);
  // Cùng một khoảnh khắc: ảnh gần như giống hệt ở bất cứ đâu, hoặc chụp liền nhau mà khá giống (không có dấu vân
  // ảnh thì cứ chụp liền nhau là cùng khoảnh khắc).
  const gap = total >= 60 ? 3 : 2;
  const sameMoment = (a, b) => {
    const distance = pictureDistance(a.hash, b.hash);
    if (distance <= SAME_PICTURE) return true;
    return Math.abs(a.number - b.number) < gap && (distance === Infinity || distance <= SIMILAR_PICTURE);
  };
  // Thứ tự lấy, đến khi đủ số ô: ảnh đẹp (cười, nét, nhìn thẳng, không bị cắt) ở các khoảnh khắc khác nhau → ảnh
  // đẹp còn lại → các ảnh khác (mặt bình thường, kém nét hơn, quay đi, sát mép), cũng khoảnh khắc khác nhau trước.
  const picked = [];
  const take = (list, spread) => {
    for (const entry of list) {
      if (picked.length >= limit) return;
      if (picked.includes(entry)) continue;
      if (!spread || !picked.some((other) => sameMoment(other, entry))) picked.push(entry);
    }
  };
  const good = (entry) => entry.smile >= SMILING && entry.clear >= SHARP_ENOUGH && entry.facing >= FACING && !entry.cut;
  const best = ranked.filter(good);
  const rest = ranked.filter((entry) => !good(entry));
  take(best, true);
  take(best, false);
  take(rest, true);
  take(rest, false);
  return picked.map((entry) => entry.id);
}
