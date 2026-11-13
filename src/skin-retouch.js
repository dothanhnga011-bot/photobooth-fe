// Chỉnh da bằng độ sáng: giữ màu da gốc, chi tiết nhỏ và vùng sáng đã đủ sáng.
// Chỉ xử lý vùng mặt nạ được truyền vào; không đoán vùng da trên cả nền ảnh.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const amount = (value) => clamp(Number(value) || 0, 0, 100) / 100;
const ramp = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

export function skinColorWeight(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  // Dải màu rộng với biên mềm để không tạo mảng loang trên da sáng / da ngăm.
  // Mặt nạ hình học vẫn quyết định vùng được chỉnh; màu chỉ giảm ảnh hưởng lên tóc.
  return (
    ramp(60, 78, cb) *
    (1 - ramp(135, 153, cb)) *
    ramp(116, 134, cr) *
    (1 - ramp(185, 203, cr)) *
    ramp(20, 55, y)
  );
}

// Feather vào trong bằng khoảng cách tới biên, thay vì làm mờ alpha ra ngoài.
// Vùng sát tóc / mắt / môi giảm dần về 0, tránh vệt trắng theo đa giác nhận diện.
export function featherSkinRegion(region, width, height, radius) {
  const distance = Float32Array.from(region, (value) =>
    value > 0.5 ? width + height : 0,
  );
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!distance[i]) continue;
      let value = distance[i];
      if (x) value = Math.min(value, distance[i - 1] + 1);
      if (y) {
        value = Math.min(value, distance[i - width] + 1);
        if (x) value = Math.min(value, distance[i - width - 1] + diagonal);
        if (x + 1 < width)
          value = Math.min(value, distance[i - width + 1] + diagonal);
      }
      distance[i] = value;
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!distance[i]) continue;
      let value = distance[i];
      if (x + 1 < width) value = Math.min(value, distance[i + 1] + 1);
      if (y + 1 < height) {
        value = Math.min(value, distance[i + width] + 1);
        if (x) value = Math.min(value, distance[i + width - 1] + diagonal);
        if (x + 1 < width)
          value = Math.min(value, distance[i + width + 1] + diagonal);
      }
      distance[i] = value;
    }
  for (let i = 0; i < region.length; i++)
    region[i] *= ramp(0, Math.max(1, radius), distance[i]);
  return region;
}

const toLinear = Float32Array.from({ length: 256 }, (_, i) => {
  const value = i / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});
const toSrgb = Float32Array.from({ length: 4096 }, (_, i) => {
  const value = i / 4095;
  return (
    255 *
    (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055)
  );
});
function encode(value) {
  const position = clamp(value, 0, 1) * 4095;
  const index = Math.floor(position);
  return (
    toSrgb[index] +
    (toSrgb[Math.min(4095, index + 1)] - toSrgb[index]) * (position - index)
  );
}

// Trung bình độ sáng và bình phương độ sáng trong cùng cửa sổ, tách hai chiều.
// Số phép tính không tăng theo diện tích cửa sổ; chỉ cấp phát trong vùng da.
function localMoments(input, width, height, radius) {
  const horizontal = new Float32Array(input.length);
  const output = new Float32Array(input.length);
  const diameter = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    const base = y * width * 2;
    for (let channel = 0; channel < 2; channel++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++)
        sum += input[base + clamp(x, 0, width - 1) * 2 + channel];
      for (let x = 0; x < width; x++) {
        horizontal[base + x * 2 + channel] = sum / diameter;
        sum +=
          input[base + clamp(x + radius + 1, 0, width - 1) * 2 + channel] -
          input[base + clamp(x - radius, 0, width - 1) * 2 + channel];
      }
    }
  }
  for (let x = 0; x < width; x++) {
    for (let channel = 0; channel < 2; channel++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++)
        sum += horizontal[(clamp(y, 0, height - 1) * width + x) * 2 + channel];
      for (let y = 0; y < height; y++) {
        output[(y * width + x) * 2 + channel] = sum / diameter;
        sum +=
          horizontal[
            (clamp(y + radius + 1, 0, height - 1) * width + x) * 2 + channel
          ] -
          horizontal[
            (clamp(y - radius, 0, height - 1) * width + x) * 2 + channel
          ];
      }
    }
  }
  return output;
}

export function retouchSkin(data, width, height, mask, adjust, faceSize) {
  const smooth = amount(adjust.smooth);
  const whiten = amount(adjust.whiten);
  if ((!smooth && !whiten) || !width || !height) return;
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (mask[y * width + x] >= 0.01) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < left) return;
  const radius = clamp(Math.round((faceSize || 100) * 0.012), 1, 18);
  left = Math.max(0, left - radius);
  right = Math.min(width - 1, right + radius);
  top = Math.max(0, top - radius);
  bottom = Math.min(height - 1, bottom + radius);
  const regionWidth = right - left + 1;
  const regionHeight = bottom - top + 1;
  let moments;
  if (smooth) {
    const input = new Float32Array(regionWidth * regionHeight * 2);
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const offset = (y * width + x) * 4;
        const luma =
          0.299 * data[offset] +
          0.587 * data[offset + 1] +
          0.114 * data[offset + 2];
        const index = ((y - top) * regionWidth + x - left) * 2;
        input[index] = luma;
        input[index + 1] = luma * luma;
      }
    moments = localMoments(input, regionWidth, regionHeight, radius);
  }
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const maskIndex = y * width + x;
      const weight =
        clamp(mask[maskIndex], 0, 1) * (data[maskIndex * 4 + 3] / 255);
      if (weight < 0.01) continue;
      const offset = maskIndex * 4;
      if (moments) {
        const luma =
          0.299 * data[offset] +
          0.587 * data[offset + 1] +
          0.114 * data[offset + 2];
        const index = ((y - top) * regionWidth + x - left) * 2;
        const mean = moments[index];
        const variance = Math.max(0, moments[index + 1] - mean * mean);
        // Vùng có đường nét / râu / nếp da rõ được giữ lại. Ngay ở 100%,
        // vẫn giữ ít nhất một nửa chi tiết nhỏ; không trộn màu da với ảnh mờ.
        const blend = weight * smooth * 0.5 * (81 / (81 + variance));
        const delta = clamp((mean - luma) * blend, -7, 7);
        const bounded = clamp(
          delta,
          -Math.min(data[offset], data[offset + 1], data[offset + 2]),
          255 - Math.max(data[offset], data[offset + 1], data[offset + 2]),
        );
        for (let channel = 0; channel < 3; channel++)
          data[offset + channel] += bounded;
      }
      if (whiten) {
        const r = toLinear[data[offset]],
          g = toLinear[data[offset + 1]],
          b = toLinear[data[offset + 2]];
        const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        // Nâng phơi sáng nhẹ trong ánh sáng tuyến tính để giữ sắc da, tránh
        // pha trắng/xanh. Không nâng tóc/râu tối và không làm cháy vùng da bóng.
        const lift = ramp(0.012, 0.08, light) * (1 - ramp(0.4, 0.85, light));
        const gain = Math.min(
          1 + whiten * weight * lift * 0.32,
          1 / Math.max(r, g, b, 1 / 4095),
        );
        if (gain <= 1.00001) continue;
        data[offset] = encode(r * gain);
        data[offset + 1] = encode(g * gain);
        data[offset + 2] = encode(b * gain);
      }
    }
}
