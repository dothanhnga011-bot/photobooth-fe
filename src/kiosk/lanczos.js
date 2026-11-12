// Co / giãn ảnh bằng Lanczos3 cho tờ in DNP: ảnh gốc máy ảnh (26 MP) đi thẳng MỘT lần vào đúng ô trên tờ,
// đặt ở toạ độ nguyên. Đo trên sọc mảnh (chi tiết tóc, mi mắt): bộ thu nhỏ "high" của Chrome rồi vẽ ở toạ
// độ lẻ chỉ còn 64 % độ tương phản ở 0,4 chu kỳ / điểm máy in, Lanczos3 một lần giữ 83 % (mức lý tưởng).
// Cùng bộ lọc với bộ in trên máy tính phòng chụp (print-agent-dnp.ps1, NxcRx1Sharpen.Resample): tách hai
// chiều; khi thu nhỏ, bộ lọc nới theo tỉ lệ để không răng cưa; điểm ở mép lặp lại.

const sinc = (x) => (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos3 = (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0);

// Trọng số các điểm nguồn cho từng điểm đích: vùng nguồn [start, start + span) trải đều trên outSize điểm.
function plan(outSize, inSize, start, span) {
  const scale = span / outSize;
  const filter = Math.max(1, scale);
  const support = 3 * filter;
  const taps = Math.ceil(support * 2) + 2;
  const index = new Int32Array(outSize * taps);
  const weight = new Float32Array(outSize * taps);
  for (let i = 0; i < outSize; i++) {
    const center = start + (i + 0.5) * scale;
    const lo = Math.floor(center - support);
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const value = lanczos3((lo + k + 0.5 - center) / filter);
      weight[i * taps + k] = value;
      sum += value;
      index[i * taps + k] = Math.min(inSize - 1, Math.max(0, lo + k));
    }
    for (let k = 0; k < taps; k++) weight[i * taps + k] /= sum;
  }
  return { index, weight, taps };
}

// pixels: RGBA (width × height, đã đục — alpha bỏ qua). Vùng nguồn src (toạ độ có thể lẻ) trải lên đúng
// outWidth × outHeight điểm. Trả về RGBA đục (alpha 255).
export function lanczosResample(pixels, width, height, outWidth, outHeight, src = { x: 0, y: 0, w: width, h: height }) {
  const px = pixels, w = width, h = height, region = src;
  const X = plan(outWidth, w, region.x, region.w);
  const Y = plan(outHeight, h, region.y, region.h);
  let rowMin = h - 1, rowMax = 0;
  for (const r of Y.index) {
    if (r < rowMin) rowMin = r;
    if (r > rowMax) rowMax = r;
  }
  // Chiều ngang trước, chỉ các hàng nguồn cần cho chiều dọc.
  const across = new Float32Array((rowMax - rowMin + 1) * outWidth * 3);
  for (let r = rowMin; r <= rowMax; r++) {
    const row = r * w * 4, o = (r - rowMin) * outWidth * 3;
    for (let c = 0; c < outWidth; c++) {
      const base = c * X.taps;
      let red = 0, green = 0, blue = 0;
      for (let k = 0; k < X.taps; k++) {
        const p = row + X.index[base + k] * 4, wt = X.weight[base + k];
        red += wt * px[p]; green += wt * px[p + 1]; blue += wt * px[p + 2];
      }
      const q = o + c * 3;
      across[q] = red; across[q + 1] = green; across[q + 2] = blue;
    }
  }
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let r = 0; r < outHeight; r++) {
    const base = r * Y.taps;
    for (let c = 0; c < outWidth; c++) {
      let red = 0, green = 0, blue = 0;
      for (let k = 0; k < Y.taps; k++) {
        const q = ((Y.index[base + k] - rowMin) * outWidth + c) * 3, wt = Y.weight[base + k];
        red += wt * across[q]; green += wt * across[q + 1]; blue += wt * across[q + 2];
      }
      const p = (r * outWidth + c) * 4;
      out[p] = red; out[p + 1] = green; out[p + 2] = blue; out[p + 3] = 255;
    }
  }
  return out;
}

// Phần ảnh nguồn cần đọc (toạ độ nguyên, đã gồm vùng ảnh hưởng của bộ lọc) để lọc vùng src về out điểm:
// ảnh gốc 26 MP chỉ đọc phần thấy trong ô, đỡ bộ nhớ. block: làm tròn ra bội số (để gộp 2 × 2 khớp lưới).
export function sourceWindow(src, out, width, height, block = 1) {
  const reach = 3 * Math.max(1, src.w / out.width, src.h / out.height) + 2 * block;
  const x0 = Math.max(0, Math.floor((src.x - reach) / block) * block);
  const y0 = Math.max(0, Math.floor((src.y - reach) / block) * block);
  const x1 = Math.min(width, Math.ceil(src.x + src.w + reach)), y1 = Math.min(height, Math.ceil(src.y + src.h + reach));
  // Cỡ là bội số của block (mép ảnh lẻ: bỏ tối đa block − 1 điểm, phần không thấy trên tờ in).
  const fit = (size) => Math.max(block, Math.floor(size / block) * block);
  return { x: x0, y: y0, w: fit(x1 - x0), h: fit(y1 - y0) };
}

// Số lần gộp 2 × 2 trước khi lọc: thu nhỏ hơn 3 lần thì gộp (nhanh hơn nhiều; ở tỉ lệ đó chi tiết nhỏ nhất
// máy in in được vẫn rộng hơn 6 điểm gốc, nên mỗi lần gộp chỉ bớt ~2,5 % ở chi tiết mảnh nhất).
export function halvingsFor(src, out) {
  let ratio = Math.min(src.w / out.width, src.h / out.height), halvings = 0;
  while (ratio > 3 && halvings < 3) { ratio /= 2; halvings++; }
  return halvings;
}

// Đọc phần cần thiết của ảnh (ImageBitmap / canvas / ảnh khung) lên nền trắng (khung PNG có chỗ trong suốt:
// như tờ in tô trắng trước khi vẽ khung) rồi lọc vùng src về out = { width, height } điểm.
// makeCanvas(w, h): OffscreenCanvas trong worker, canvas thường khi chạy dự phòng trên trang.
// Gộp 2 × 2 bằng chính trình duyệt: vẽ thu đúng 2 : 1 với làm mượt "low" (song tuyến, không mipmap) thì
// tâm mỗi điểm đích nằm giữa 4 điểm nguồn → đúng trung bình 2 × 2, mà nhanh hơn JS nhiều lần.
export function resampleImage(image, out, src, makeCanvas) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const halvings = halvingsFor(src, out), block = 2 ** halvings;
  const win = sourceWindow(src, out, width, height, block);
  const first = halvings ? 2 : 1;
  let canvas = makeCanvas(win.w / first, win.h / first);
  let ctx = canvas.getContext("2d", { willReadFrequently: !halvings });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "low";
  // Lần gộp đầu vẽ thẳng từ ảnh gốc; các lần sau từ canvas vừa gộp.
  ctx.drawImage(image, win.x, win.y, win.w, win.h, 0, 0, canvas.width, canvas.height);
  for (let i = 1; i < halvings; i++) {
    const next = makeCanvas(canvas.width / 2, canvas.height / 2);
    const nctx = next.getContext("2d", { willReadFrequently: i === halvings - 1 });
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = "low";
    nctx.drawImage(canvas, 0, 0, next.width, next.height);
    canvas.width = canvas.height = 0;
    canvas = next;
    ctx = nctx;
  }
  const w = canvas.width, h = canvas.height;
  const { data } = ctx.getImageData(0, 0, w, h);
  canvas.width = canvas.height = 0;
  const local = { x: (src.x - win.x) / block, y: (src.y - win.y) / block, w: src.w / block, h: src.h / block };
  return { width: out.width, height: out.height, data: lanczosResample(data, w, h, out.width, out.height, local) };
}

// Vùng điểm nguyên của ô (rect) mà ảnh (đã phóng `scale`, góc trái trên ở left, top) phủ kín, và vùng ảnh
// nguồn tương ứng. Ảnh nhỏ hơn ô (khách thu nhỏ < 100 %): điểm ở mép chỉ phủ một phần thì bỏ (nền khung).
export function slotMapping(image, rect, scale, left, top, canvas) {
  const x0 = Math.max(rect.x, 0, Math.ceil(left - 1e-6));
  const y0 = Math.max(rect.y, 0, Math.ceil(top - 1e-6));
  const x1 = Math.min(rect.x + rect.w, canvas.width, Math.floor(left + image.width * scale + 1e-6));
  const y1 = Math.min(rect.y + rect.h, canvas.height, Math.floor(top + image.height * scale + 1e-6));
  if (x1 <= x0 || y1 <= y0) return null;
  return {
    dest: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    src: { x: (x0 - left) / scale, y: (y0 - top) / scale, w: (x1 - x0) / scale, h: (y1 - y0) / scale },
  };
}
