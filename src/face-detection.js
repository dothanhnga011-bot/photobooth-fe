const MAX_DETECTION_EDGE = 1024;

// Ma trận đưa pixel ảnh gốc vào canvas nhận diện. Các bước thử chỉ đổi ảnh
// đưa vào mô hình; mọi điểm mốc đều được quy về ảnh gốc trước khi chỉnh sửa.
function detectionView(sourceWidth, sourceHeight, padded, rotation = 0) {
  const longest = Math.max(sourceWidth, sourceHeight);
  const edge = Math.min(
    MAX_DETECTION_EDGE,
    Math.ceil(longest * (padded ? 1.5 : 1)),
  );
  const scale = Math.min(1, edge / (longest * (padded ? 1.5 : 1)));
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  const width = padded ? edge : drawWidth;
  const height = padded ? edge : drawHeight;
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const a = cos * (drawWidth / sourceWidth);
  const b = sin * (drawWidth / sourceWidth);
  const c = -sin * (drawHeight / sourceHeight);
  const d = cos * (drawHeight / sourceHeight);
  return {
    width,
    height,
    sourceWidth,
    sourceHeight,
    padded,
    rotation,
    transform: {
      a,
      b,
      c,
      d,
      e: width / 2 - (a * sourceWidth + c * sourceHeight) / 2,
      f: height / 2 - (b * sourceWidth + d * sourceHeight) / 2,
    },
  };
}

export function createDetectionViews(width, height) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0)) {
    throw new RangeError("Ảnh không có kích thước hợp lệ.");
  }
  return [
    detectionView(width, height, false),
    ...[0, 90, -90, 180].map((rotation) =>
      detectionView(width, height, true, rotation),
    ),
  ];
}

export function mapLandmarks(points, view) {
  const { a, b, c, d, e, f } = view.transform;
  const determinant = a * d - b * c;
  return points.map((point) => {
    const x = point.x * view.width - e;
    const y = point.y * view.height - f;
    return {
      x: (d * x - c * y) / determinant,
      y: (a * y - b * x) / determinant,
    };
  });
}

function usableFace(face, width, height) {
  if (
    face.length < 468 ||
    !face.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    return false;
  const distance = (left, right) =>
    Math.hypot(face[left].x - face[right].x, face[left].y - face[right].y);
  const fw = distance(234, 454);
  const nose = face[168];
  return (
    fw > 3 &&
    fw < Math.max(width, height) * 2 &&
    distance(33, 263) > 1 &&
    distance(168, 152) > 1 &&
    nose.x > -width * 0.3 &&
    nose.x < width * 1.3 &&
    nose.y > -height * 0.3 &&
    nose.y < height * 1.3
  );
}

const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function detectFaceLandmarks(source, model, options = {}) {
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const createCanvas =
    options.createCanvas || (() => document.createElement("canvas"));
  const pause = options.yieldFrame || yieldFrame;
  const views = createDetectionViews(width, height);
  for (const view of views) {
    // Cho trình duyệt vẽ trạng thái xử lý trước khi chạy suy luận đồng bộ.
    await pause();
    const canvas = createCanvas();
    canvas.width = view.width;
    canvas.height = view.height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#808080";
    context.fillRect(0, 0, view.width, view.height);
    const { a, b, c, d, e, f } = view.transform;
    context.setTransform(a, b, c, d, e, f);
    context.drawImage(source, 0, 0, width, height);
    const result = model.detect(canvas);
    const faces = (result.faceLandmarks || [])
      .map((points) => mapLandmarks(points, view))
      .filter((face) => usableFace(face, width, height));
    // Giải phóng canvas thử, không giữ nhiều bitmap lớn trên điện thoại.
    canvas.width = canvas.height = 1;
    if (faces.length) return faces;
  }
  return [];
}
