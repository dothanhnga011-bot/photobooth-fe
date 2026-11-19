// Dò ô ảnh trên ảnh khung — chép nguyên từ web Selfbooth (Photo_FE/src/frame-utils.js, 19/11): ô trong suốt và ô
// trắng dò riêng (gộp chung thì ô nhỏ có thể dính vào nền trắng và mất). Chỉ trình ghép khung kiểu Selfbooth
// (khung phòng Selfbooth) dùng; khung PTB vẫn dùng detectSlots trong frame-utils.js.
export function detectSlots({ data, width, height }) {
  const alpha = new Uint8Array(width * height), white = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) {
    const p = i * 4, a = data[p + 3];
    const lo = Math.min(data[p], data[p + 1], data[p + 2]);
    const hi = Math.max(data[p], data[p + 1], data[p + 2]);
    alpha[i] = a < 40 ? 1 : 0;
    white[i] = a >= 240 && lo >= 246 && hi - lo <= 6 ? 1 : 0;
  }
  const cutouts = detectMaskSlots(alpha, width, height).filter(s =>
    s.x > 0 && s.y > 0 && s.x + s.w < 1 && s.y + s.h < 1);
  const whites = detectMaskSlots(white, width, height).filter(s =>
    // The entire white page or white bands across its edges are not photo windows.
    !(s.x === 0 && s.x + s.w === 1) && !(s.y === 0 && s.y + s.h === 1));
  const overlaps = (a, b) => {
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return w * h > .05 * Math.min(a.w * a.h, b.w * b.h);
  };
  return [...cutouts, ...whites.filter(s => !cutouts.some(a => overlaps(a, s)))].sort((a, b) =>
    Math.abs(a.y - b.y) < 0.05 ? a.x - b.x : a.y - b.y);
}

function detectMaskSlots(raw, width, height) {
  // Co vùng trắng r px để cắt các sọc/viền trắng mảnh nối liền các ô,
  // sau đó nới khung chữ nhật tìm được ra lại r px.
  const r = Math.max(2, Math.round(Math.min(width, height) * 0.012));
  const erode = (src, horizontal) => {
    const out = new Uint8Array(src.length);
    const len = horizontal ? width : height,
      lines = horizontal ? height : width;
    for (let line = 0; line < lines; line++) {
      const at = (k) => (horizontal ? line * width + k : k * width + line);
      let run = 0;
      const runs = new Int32Array(len);
      for (let k = 0; k < len; k++) runs[k] = run = src[at(k)] ? run + 1 : 0;
      run = 0;
      for (let k = len - 1; k >= 0; k--) {
        run = src[at(k)] ? run + 1 : 0;
        out[at(k)] = runs[k] > r && run > r ? 1 : 0;
      }
    }
    return out;
  };
  const hole = erode(erode(raw, true), false);
  const seen = new Uint8Array(hole.length);
  const stack = new Int32Array(hole.length);
  const slots = [];
  const minArea = width * height * 0.03;
  for (let start = 0; start < hole.length; start++) {
    if (!hole[start] || seen[start]) continue;
    let top = 0,
      area = 0,
      x0 = width,
      y0 = height,
      x1 = 0,
      y1 = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % width,
        y = (i - x) / width;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const n of [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ])
        if (n >= 0 && hole[n] && !seen[n]) {
          seen[n] = 1;
          stack[top++] = n;
        }
    }
    const w = x1 - x0 + 1,
      h = y1 - y0 + 1;
    // Co vùng chỉ dùng để tách các ô và kiểm tra hình chữ nhật.
    if (area / (w * h) < 0.85) continue;
    const left = Math.max(0, x0 - r),
      topY = Math.max(0, y0 - r),
      right = Math.min(width, x1 + 1 + r),
      bottom = Math.min(height, y1 + 1 + r);
    // Đo diện tích ô sau khi nới lại: ô ảnh nhỏ trong khung 12–14 ảnh
    // có thể còn dưới 3% sau bước co nhưng vẫn đủ lớn ở thiết kế gốc.
    if ((right - left) * (bottom - topY) < minArea) continue;
    slots.push({
      x: left / width,
      y: topY / height,
      w: (right - left) / width,
      h: (bottom - topY) / height,
    });
  }
  return slots.sort((a, b) =>
    Math.abs(a.y - b.y) < 0.05 ? a.x - b.x : a.y - b.y,
  );
}