// Transparent windows and opaque white placeholders are detected separately.
export function detectSlots({ data, width, height }, limit = 40) {
  const alpha = new Uint8Array(width * height), white = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) {
    const p = i * 4, a = data[p + 3];
    const lo = Math.min(data[p], data[p + 1], data[p + 2]);
    const hi = Math.max(data[p], data[p + 1], data[p + 2]);
    alpha[i] = a < 112 ? 1 : 0;
    white[i] = a >= 240 && lo >= 246 && hi - lo <= 6 ? 1 : 0;
  }
  // Alpha windows can be small or oval. Light erosion removes thin connections
  // between openings without shrinking the bounds used for photos.
  const cutouts = detectMaskSlots(alpha, width, height, {
    radius: Math.max(1, Math.round(Math.min(width, height) * .003)),
    minArea: .005, minFill: .55, enclosed: true,
  });
  const whites = detectMaskSlots(white, width, height).filter(s =>
    // The entire white page or white bands across its edges are not photo windows.
    !(s.x === 0 && s.x + s.w === 1) && !(s.y === 0 && s.y + s.h === 1));
  const overlaps = (a, b) => {
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return w * h > .05 * Math.min(a.w * a.h, b.w * b.h);
  };
  const detected = [...cutouts, ...whites.filter(s => !cutouts.some(a => overlaps(a, s)))].sort((a, b) => a.y - b.y);
  const rows = [];
  for (const slot of detected) {
    const row = rows.at(-1);
    if (row && slot.y - row[0].y < Math.min(.035, row[0].h / 3, slot.h / 3)) row.push(slot);
    else rows.push([slot]);
  }
  return rows.flatMap(row => row.sort((a, b) => a.x - b.x)).slice(0, limit);
}

function detectMaskSlots(raw, width, height, {
  radius: r = Math.max(2, Math.round(Math.min(width, height) * .012)),
  minArea = .03, minFill = .85, enclosed = false,
} = {}) {
  const erode = (src, horizontal) => {
    const out = new Uint8Array(src.length);
    const len = horizontal ? width : height,
      lines = horizontal ? height : width;
    const runs = new Int32Array(len);
    for (let line = 0; line < lines; line++) {
      const at = (k) => (horizontal ? line * width + k : k * width + line);
      let run = 0;
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
  const minSide = Math.min(width, height) * .035;
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
      for (let d = 0; d < 4; d++) {
        const n = d === 0 ? (x > 0 ? i - 1 : -1)
          : d === 1 ? (x < width - 1 ? i + 1 : -1)
            : d === 2 ? i - width : i + width;
        if (n >= 0 && hole[n] && !seen[n]) {
          seen[n] = 1;
          stack[top++] = n;
        }
      }
    }
    const w = x1 - x0 + 1,
      h = y1 - y0 + 1;
    if (area / (w * h) < minFill) continue;
    const left = Math.max(0, x0 - r),
      topY = Math.max(0, y0 - r),
      right = Math.min(width, x1 + 1 + r),
      bottom = Math.min(height, y1 + 1 + r);
    if (enclosed && (left === 0 || topY === 0 || right === width || bottom === height)) continue;
    const slotWidth = right - left, slotHeight = bottom - topY;
    const aspect = slotWidth / slotHeight;
    if (slotWidth * slotHeight < minArea * width * height ||
        Math.min(slotWidth, slotHeight) < minSide || aspect < .25 || aspect > 4) continue;
    slots.push({
      x: left / width,
      y: topY / height,
      w: slotWidth / width,
      h: slotHeight / height,
    });
  }
  return slots;
}
