// Album Selfbooth: hằng số và hàm nhỏ dùng chung giữa các bước (thư viện, chọn bộ khung, ghép ảnh, bản in).
import { photoLayout } from "../../frame-utils.js";

// Ảnh đầu tiên của thư viện tải ngay (không lười); xong cả hàng này mới bắt đầu gợi ý ảnh đẹp.
export const FIRST_GALLERY_PHOTOS = 4;
export const pad = (n) => String(n).padStart(2, "0");
export const slotsOf = (frame) => photoLayout(frame).slots;
export const capacityOf = (pack) => (pack?.frames || []).reduce((n, f) => n + slotsOf(f).length, 0);
export const isFilled = (frame, slots) => slots?.length === slotsOf(frame).length && slots.every((s) => s.photo);
