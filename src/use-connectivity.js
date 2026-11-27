import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import {
  getConnectivity, inOpenHours, KEEP_AWAKE_MS, OPEN_HOURS, subscribeConnectivity,
} from "./network.js";

// Whether the API answered the most recent request (shared by the whole page).
export function useConnectivity() {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);
}

// While the server is unreachable, ask a tiny health endpoint with growing pauses
// (3 s → 30 s) so the page notices recovery even when nothing else is polling.
// Hidden tabs wait; returning to the tab or a network change re-checks at once.
export function useReconnectProbe(enabled) {
  const { online } = useConnectivity();
  useEffect(() => {
    if (!enabled || online) return;
    let stopped = false, timer, attempt = 0;
    const probe = async () => {
      if (stopped) return;
      if (!document.hidden)
        await api("/health", { retry: 0, timeout: 8000 }).catch(() => {});
      if (!stopped)
        timer = setTimeout(probe, Math.min(30000, 3000 * 2 ** Math.min(attempt++, 4)));
    };
    timer = setTimeout(probe, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [enabled, online]);
}

// ── Giữ máy chủ miễn phí (Render) không "ngủ" trong giờ mở cửa ──────────────
// Render tắt máy chủ free sau 15 phút không có yêu cầu nào, lần mở sau phải chờ ~1 phút.
// Máy chụp và trang quản trị của tiệm mở suốt ngày nên tự gọi /api/health (rất nhẹ, không
// chạm database) mỗi 8 phút: khách quét QR hay vào kiosk không phải chờ máy chủ thức dậy.
// Chỉ trong khung giờ mở cửa (giờ Việt Nam) để một tab bị bỏ quên qua đêm không giữ máy chủ
// chạy 24/24 — hạn mức free là 750 giờ/tháng, 15 giờ × 31 ngày = 465 giờ.
export function useKeepServerAwake(enabled = true, interval = KEEP_AWAKE_MS, hours = OPEN_HOURS) {
  const { from, to } = hours;
  useEffect(() => {
    if (!enabled) return;
    // Hidden tabs are still pinged (a reception tab may sit in the background all day);
    // browsers slow their timers but never below once a minute.
    const ping = () => {
      if (inOpenHours(new Date(), { from, to }))
        api("/health", { retry: 0, timeout: 15000 }).catch(() => {});
    };
    const timer = setInterval(ping, interval);
    return () => clearInterval(timer);
  }, [enabled, interval, from, to]);
}
