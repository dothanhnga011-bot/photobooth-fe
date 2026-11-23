// Slot indices are part of the composition. Empty slots must never compact it.
export const photoSlots = (selected, count) => Array.from({ length: count }, (_, i) => selected?.[i] || null);
export const selectedCount = (selected) => selected.filter(Boolean).length;
export function removePhotoSlot(selected, count, slot) {
  const next = photoSlots(selected, count);
  if (slot >= 0 && slot < count) next[slot] = null;
  return next;
}
export function togglePhotoSlot(selected, count, key) {
  const next = photoSlots(selected, count);
  const occupied = next.indexOf(key);
  const slot = occupied >= 0 ? occupied : next.indexOf(null);
  if (slot >= 0) next[slot] = occupied >= 0 ? null : key;
  return next;
}
// Timeout fills vacancies in place, preserving the customer's other choices.
export function fillPhotoSlots(selected, count, keys) {
  const next = photoSlots(selected, count).map(key => keys.includes(key) ? key : null);
  for (let i = 0; i < count; i++) if (!next[i]) next[i] = keys.find(key => !next.includes(key)) || keys[0] || null;
  return next;
}
