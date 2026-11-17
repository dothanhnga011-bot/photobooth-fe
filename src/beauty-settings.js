// Persist the original keys so edits saved by older albums remain valid.
export const ADJUST_LABELS = {
  smooth: 'Mịn da', whiten: 'Sáng da', slim: 'Thon mặt',
  eyeSize: 'Mắt to', irisSize: 'Tròng mắt', nose: 'Thu gọn mũi',
  mouth: 'Thu gọn miệng', darkCircles: 'Giảm quầng thâm', lips: 'Son môi', blush: 'Má hồng',
};
export const DEFAULT_ADJUST = Object.freeze({
  ...Object.fromEntries(Object.keys(ADJUST_LABELS).map(key => [key, 0])), filter: 'original',
});
export const BEAUTY_GROUPS = [
  { id: 'all', label: 'Tất cả', keys: Object.keys(ADJUST_LABELS) },
  { id: 'skin', label: 'Da', keys: ['smooth', 'whiten', 'darkCircles'] },
  { id: 'shape', label: 'Khuôn mặt', keys: ['slim', 'nose', 'mouth'] },
  { id: 'eyes', label: 'Mắt', keys: ['eyeSize', 'irisSize'] },
  { id: 'makeup', label: 'Trang điểm', keys: ['lips', 'blush'] },
  { id: 'color', label: 'Màu ảnh', keys: [] },
];
export const BEAUTY_PRESETS = [
  { id: 'natural', label: 'Tự nhiên', values: { smooth: 30, whiten: 12, darkCircles: 20, lips: 8, blush: 8 } },
  { id: 'fresh', label: 'Rạng rỡ', values: { smooth: 45, whiten: 24, slim: 12, eyeSize: 10, darkCircles: 35, lips: 18, blush: 16 } },
  { id: 'rose', label: 'Hồng nhẹ', values: { smooth: 35, whiten: 14, darkCircles: 25, lips: 32, blush: 28 } },
];

export function normalizeAdjust(adjust) {
  const result = { ...DEFAULT_ADJUST };
  for (const key of Object.keys(ADJUST_LABELS))
    result[key] = Math.round(Math.max(0, Math.min(100, Number(adjust?.[key]) || 0)));
  if (['original', 'soft', 'warm', 'film', 'mono', 'vintage'].includes(adjust?.filter)) result.filter = adjust.filter;
  return result;
}
export const needsFaces = adjust => Object.keys(ADJUST_LABELS).some(key => Number(adjust?.[key]) > 0);
export const isNeutral = adjust => !needsFaces(adjust) && (!adjust?.filter || adjust.filter === 'original');
