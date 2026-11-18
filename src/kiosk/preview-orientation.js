// HDMI carries pixels, not the JPEG's orientation metadata. Staff correct only
// the live view here; camera JPEGs keep their own EXIF and original bytes.
export const PREVIEW_ORIENTATIONS = [
  [0, 'Ngang · không xoay'],
  [270, 'Dọc · xoay trái 90°'],
  [90, 'Dọc · xoay phải 90°'],
  [180, 'Xoay ngược 180°'],
];
export const previewRotation = value => {
  const angle = Number(value);
  return [0, 90, 180, 270].includes(angle) ? angle : 0;
};
export const previewRotationKey = room => `kiosk-live-rotation:${room || 'default'}`;
export const readPreviewRotation = key => {
  try { return previewRotation(globalThis.localStorage?.getItem(key)); }
  catch { return 0; }
};

// Webcam test captures follow the displayed orientation. Wired camera JPEGs
// never pass through this canvas or inherit the HDMI correction.
export function drawLiveCapture(canvas, video, rotation) {
  const angle = previewRotation(rotation), swap = angle % 180 !== 0;
  canvas.width = swap ? video.videoHeight : video.videoWidth;
  canvas.height = swap ? video.videoWidth : video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(angle * Math.PI / 180);
  ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
}
