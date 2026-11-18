// Persist the original keys so edits saved by older albums remain valid.
export const ADJUST_LABELS = {
  smooth: 'Mịn da', whiten: 'Sáng da', slim: 'Thon mặt',
  eyeSize: 'Mắt to', irisSize: 'Tròng mắt', nose: 'Thu gọn mũi',
  mouth: 'Thu gọn miệng', darkCircles: 'Giảm quầng thâm', lips: 'Son môi', blush: 'Má hồng',
};
export const DEFAULT_ADJUST = Object.freeze({
  ...Object.fromEntries(Object.keys(ADJUST_LABELS).map(key => [key, 0])), filter: 'original',
});
export const BEAUTY_PRESETS = [
  { id: 'natural', label: 'Tự nhiên', values: { smooth: 30, whiten: 10, darkCircles: 18, blush: 5 } },
  { id: 'clear', label: 'Trong trẻo', values: { smooth: 45, whiten: 18, slim: 6, eyeSize: 4, nose: 4, darkCircles: 28, lips: 7, blush: 10 } },
  { id: 'radiant', label: 'Rạng rỡ', values: { smooth: 55, whiten: 22, slim: 10, eyeSize: 8, irisSize: 5, nose: 6, darkCircles: 35, lips: 12, blush: 15 } },
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
