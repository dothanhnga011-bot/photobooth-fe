// Tiêu đề màn chọn khung / chọn ảnh có số giây còn lại (chữ sửa ở quản trị, {s} = số giây, gạch chân).
// Còn ≤ 30 giây thì số giây chuyển đỏ như đồng hồ màn chụp: khách biết sắp hết giờ và máy sẽ tự in.
export const URGENT_SECONDS = 30;

export function TimedTitle({ text, seconds }) {
  const [before, after] = text.split("{s}");
  const urgent = seconds <= URGENT_SECONDS ? "is-urgent" : undefined;
  return after === undefined
    ? <>{before} · <u className={urgent}>{seconds}s</u></>
    : <>{before}<u className={urgent}>{seconds}</u>{after}</>;
}
