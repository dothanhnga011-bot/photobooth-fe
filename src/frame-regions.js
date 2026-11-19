const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

export function regionFromPoints(start, end) {
  const x = Math.min(clamp(start.x), clamp(end.x)), y = Math.min(clamp(start.y), clamp(end.y));
  return { x, y, w: Math.abs(clamp(end.x) - clamp(start.x)), h: Math.abs(clamp(end.y) - clamp(start.y)) };
}

export function moveRegion(region, dx, dy, size) {
  if (region.angle) return fitRegion({ ...region, x: region.x + dx, y: region.y + dy }, size);
  return { ...region, x: clamp(region.x + dx, 0, 1 - region.w), y: clamp(region.y + dy, 0, 1 - region.h) };
}

export function resizeRegion(region, corner, dx, dy, minimum = .01, size) {
  if (region.angle) return resizeRotatedRegion(region, corner, dx, dy, minimum, size);
  let left = region.x, top = region.y, right = region.x + region.w, bottom = region.y + region.h;
  if (corner.includes("w")) left = clamp(left + dx, 0, right - minimum);
  if (corner.includes("e")) right = clamp(right + dx, left + minimum, 1);
  if (corner.includes("n")) top = clamp(top + dy, 0, bottom - minimum);
  if (corner.includes("s")) bottom = clamp(bottom + dy, top + minimum, 1);
  return { ...region, x: left, y: top, w: right - left, h: bottom - top };
}

const sizeOf = size => ({ width: size?.width || 1, height: size?.height || 1 });
export function regionLocalDelta(dx, dy, angle = 0, size) {
  const { width, height } = sizeOf(size), radians = angle * Math.PI / 180;
  return { x: (Math.cos(radians) * dx * width + Math.sin(radians) * dy * height) / width,
    y: (-Math.sin(radians) * dx * width + Math.cos(radians) * dy * height) / height };
}

export function regionContains(region, point, size) {
  const local = regionLocalDelta(point.x - region.x - region.w / 2,
    point.y - region.y - region.h / 2, region.angle, size);
  return Math.abs(local.x) <= region.w / 2 + 1e-10 && Math.abs(local.y) <= region.h / 2 + 1e-10;
}

export function regionExtents(region, size) {
  const { width, height } = sizeOf(size), angle = (region.angle || 0) * Math.PI / 180;
  return { x: (Math.abs(Math.cos(angle)) * region.w + Math.abs(Math.sin(angle)) * region.h * height / width) / 2,
    y: (Math.abs(Math.sin(angle)) * region.w * width / height + Math.abs(Math.cos(angle)) * region.h) / 2 };
}

// Keep the region as it appears (its rotated corners) on the image. The stored, unturned
// rectangle may extend past an edge: a slot turned 90° against the side of a portrait frame is
// longer in its own x than the room beside it. Dimensions must be physical pixels: normalized
// x/y have different scales on portrait art.
export function fitRegion(region, size) {
  let next = { ...region, w: clamp(region.w, .005, 4), h: clamp(region.h, .005, 4) };
  const extents = regionExtents(next, size);
  const scale = Math.min(1, 1 / (2 * extents.x), 1 / (2 * extents.y));
  const center = { x: region.x + region.w / 2, y: region.y + region.h / 2 };
  next.w *= scale; next.h *= scale;
  const halfX = extents.x * scale, halfY = extents.y * scale;
  return { ...next, x: clamp(center.x, halfX, 1 - halfX) - next.w / 2,
    y: clamp(center.y, halfY, 1 - halfY) - next.h / 2 };
}

export function rotateRegion(region, angle, size) {
  const normalized = ((angle + 180) % 360 + 360) % 360 - 180;
  return fitRegion({ ...region, angle: Math.round((normalized === -180 && angle > 0 ? 180 : normalized) * 10) / 10 }, size);
}

// Turn the photo a quarter without moving the slot: a rectangle turned 90° with its sides swapped
// covers exactly the same area, so a window in the frame stays filled while the photo faces
// another way. Turning the stored box alone would leave the window (portrait becomes landscape).
export function turnRegion(region, direction, size) {
  const { width, height } = sizeOf(size);
  const w = region.h * height / width, h = region.w * width / height;
  const cx = region.x + region.w / 2, cy = region.y + region.h / 2;
  return rotateRegion({ ...region, w, h, x: cx - w / 2, y: cy - h / 2 },
    (region.angle || 0) + (direction < 0 ? -90 : 90), size);
}

function resizeRotatedRegion(region, corner, dx, dy, minimum, size) {
  const { width, height } = sizeOf(size), radians = region.angle * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const sx = corner.includes("w") ? -1 : 1, sy = corner.includes("n") ? -1 : 1;
  // A side handle ("n", "e", "s", "w") moves only that side; a corner moves two.
  const sideways = /[ew]/.test(corner), upright = /[ns]/.test(corner);
  const delta = regionLocalDelta(dx, dy, region.angle, size);
  const candidate = fraction => {
    const w = sideways ? Math.max(minimum, region.w + sx * delta.x * fraction) : region.w;
    const h = upright ? Math.max(minimum, region.h + sy * delta.y * fraction) : region.h;
    const shiftX = sx * (w - region.w) * width / 2, shiftY = sy * (h - region.h) * height / 2;
    return { ...region, w, h, x: region.x + (region.w - w) / 2 + (cos * shiftX - sin * shiftY) / width,
      y: region.y + (region.h - h) / 2 + (sin * shiftX + cos * shiftY) / height };
  };
  const valid = value => {
    const extent = regionExtents(value, size), cx = value.x + value.w / 2, cy = value.y + value.h / 2;
    return cx >= extent.x - 1e-10 && cy >= extent.y - 1e-10 && cx + extent.x <= 1 + 1e-10 && cy + extent.y <= 1 + 1e-10;
  };
  const full = candidate(1);
  if (valid(full)) return full;
  if (!valid(region)) return fitRegion(full, size);
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (valid(candidate(mid))) low = mid; else high = mid;
  }
  return candidate(low);
}

export function quarterTurnRegions(regions, clockwise = true) {
  return regions.map(region => ({ ...region,
    x: clockwise ? Math.max(0, 1 - region.y - region.h) : region.y,
    y: clockwise ? region.x : Math.max(0, 1 - region.x - region.w),
    w: region.h, h: region.w,
  }));
}
