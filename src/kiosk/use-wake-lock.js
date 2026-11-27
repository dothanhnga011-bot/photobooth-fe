import { useEffect } from "react";

// Máy chụp mở cả ngày: giữ màn hình luôn sáng (trình duyệt hỗ trợ Wake Lock). Trình duyệt tự nhả khoá khi
// tab bị ẩn, nên xin lại mỗi khi tab hiện trở lại.
export function useWakeLock() {
  useEffect(() => {
    let lock = null;
    const keepAwake = () =>
      document.visibilityState === "visible" &&
      navigator.wakeLock?.request("screen").then(
        (l) => (lock = l),
        () => {},
      );
    keepAwake();
    document.addEventListener("visibilitychange", keepAwake);
    return () => {
      document.removeEventListener("visibilitychange", keepAwake);
      lock?.release().catch(() => {});
    };
  }, []);
}
