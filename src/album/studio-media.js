import { createCanvasCache } from '../canvas-cache.js';
import { detectFaces, normalizeAdjust } from '../beauty.js';
import { needsFaces } from '../beauty-settings.js';
import { applyBeautyAsync } from '../image-processing.js';
import { fetchMediaBlob, storageLink } from '../media-delivery.js';
import { photoUrl } from './photo-thumb.jsx';

export { needsFaces } from '../beauty-settings.js';

// Owned by one album. Keep at most ~24 MB of cached preview pixels; print
// bitmaps are decoded sequentially and closed immediately after retouching.
export function createStudioMedia(token) {
  const previews = createCanvasCache({ maxPixels: 6_000_000, maxEntries: 3 });
  const faces = new Map();
  const load = async (photo, size) => createImageBitmap(await fetchMediaBlob(photoUrl(token, photo.id, size), {
    link: storageLink(photo, size || 'original') || undefined,
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
  const facesOf = (photo, { retry = false } = {}) => {
    const key = String(photo.id);
    if (retry) faces.delete(key);
    if (!faces.has(key)) {
      const pending = preview(photo).then(detectFaces).then(list => list.sort((a,b) => a[168].x-b[168].x)).catch(error => {
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
    preview,
    async edited(photo, adjust, size = 'preview', { edge = 1600, isCurrent = () => true } = {}) {
      if (['print', 'download'].includes(size) && photo.originalPending)
        throw new Error('Ảnh gốc đang tải lên. Vui lòng chờ ảnh gốc sẵn sàng để giữ chất lượng bản in.');
      let image = ['print', 'download'].includes(size) ? await load(photo, size === 'download' ? false : 'print') : await preview(photo);
      let small, full;
      try {
        if (!isCurrent()) throw new DOMException('Preview replaced', 'AbortError');
        if (size === 'download') {
          // Edited phone downloads use camera pixels, not the 3000px print
          // source. Follow the preview's mirror choice and cap at 20MP.
          const bitmap = image, scale = Math.min(1, Math.sqrt(20_000_000 / (bitmap.width * bitmap.height)));
          full = document.createElement('canvas');
          full.width = Math.max(1, Math.floor(bitmap.width * scale));
          full.height = Math.max(1, Math.floor(bitmap.height * scale));
          const ctx = full.getContext('2d'); ctx.imageSmoothingQuality = 'high';
          if (photo.mirrored) { ctx.translate(full.width, 0); ctx.scale(-1, 1); }
          ctx.drawImage(bitmap, 0, 0, full.width, full.height);
          bitmap.close(); image = full;
        }
        // Like Selfbooth: lighter interactive pixels while dragging, then the
        // original 1600px preview on release. Print pixels never use this path.
        if (size === 'preview' && edge < Math.max(image.width, image.height)) {
          const scale = Math.min(1, Math.max(320, edge) / Math.max(image.width, image.height));
          small = document.createElement('canvas');
          small.width = Math.max(1, Math.round(image.width * scale));
          small.height = Math.max(1, Math.round(image.height * scale));
          const ctx = small.getContext('2d'); ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(image, 0, 0, small.width, small.height); image = small;
        }
        let landmarks = [];
        if (needsFaces(adjust)) {
          const reference = await preview(photo);
          const sx = image.width / reference.width, sy = image.height / reference.height;
          landmarks = (await facesOf(photo)).map(face => face.map(point => ({ ...point, x: point.x * sx, y: point.y * sy })));
        }
        if (!isCurrent()) throw new DOMException('Preview replaced', 'AbortError');
        return await applyBeautyAsync(image, landmarks, normalizeAdjust(adjust), { isCurrent });
      } finally {
        if (size === 'print') image.close();
        if (size === 'download') { image.close?.(); if (full) full.width = full.height = 0; }
        if (small) small.width = small.height = 0;
      }
    },
    clear() {
      for (const key of [...previews.keys()]) previews.delete(key);
      faces.clear();
    },
  };
}
