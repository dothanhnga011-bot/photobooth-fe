import { createCanvasCache } from '../canvas-cache.js';
import { DEFAULT_ADJUST, applyBeauty, detectFaces } from '../beauty.js';
import { fetchMediaBlob, storageLink } from '../media-delivery.js';
import { photoUrl } from './photo-thumb.jsx';

export const needsFaces = adjust => ['smooth', 'whiten', 'slim', 'blush'].some(key => Number(adjust?.[key]) > 0);

// Owned by one album. Keep at most ~24 MB of cached preview pixels; print
// bitmaps are decoded sequentially and closed immediately after retouching.
export function createStudioMedia(token) {
  const previews = createCanvasCache({ maxPixels: 6_000_000, maxEntries: 3 });
  const faces = new Map();
  const load = async (photo, size) => createImageBitmap(await fetchMediaBlob(photoUrl(token, photo.id, size), {
    link: storageLink(photo, size) || undefined,
  }));
  const preview = photo => previews.remember(String(photo.id), async () => {
    const bitmap = await load(photo, 'preview');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return canvas;
    } finally { bitmap.close(); }
  });
  const facesOf = photo => {
    const key = String(photo.id);
    if (!faces.has(key)) {
      const pending = preview(photo).then(detectFaces).catch(error => {
        if (faces.get(key) === pending) faces.delete(key);
        throw error;
      });
      faces.set(key, pending);
      if (faces.size > 12) faces.delete(faces.keys().next().value);
    }
    return faces.get(key);
  };
  return {
    facesOf,
    async edited(photo, adjust, size = 'preview', { isCurrent = () => true } = {}) {
      if (size === 'print' && photo.originalPending)
        throw new Error('Ảnh gốc đang tải lên. Vui lòng chờ ảnh gốc sẵn sàng để giữ chất lượng bản in.');
      const image = size === 'print' ? await load(photo, 'print') : await preview(photo);
      try {
        if (!isCurrent()) throw new DOMException('Preview replaced', 'AbortError');
        let landmarks = [];
        if (needsFaces(adjust)) {
          const reference = await preview(photo);
          const sx = image.width / reference.width, sy = image.height / reference.height;
          landmarks = (await facesOf(photo)).map(face => face.map(point => ({ ...point, x: point.x * sx, y: point.y * sy })));
        }
        if (!isCurrent()) throw new DOMException('Preview replaced', 'AbortError');
        return applyBeauty(image, landmarks, { ...DEFAULT_ADJUST, ...adjust });
      } finally { if (size === 'print') image.close(); }
    },
    clear() {
      for (const key of [...previews.keys()]) previews.delete(key);
      faces.clear();
    },
  };
}
