import { useEffect } from "react";
import { getApiUrl } from "./api";
import { onNetworkRecovery } from "./network.js";
import { useToast } from "./studio";

function beep() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + i * 0.18 + 0.16,
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* trình duyệt chặn âm thanh — bỏ qua */
  }
}

// Nhận lệnh in mới theo thời gian thực (Server-Sent Events): báo bằng thông báo, âm thanh và sự kiện
// `nxc:print` để các bảng đang mở (dung lượng) tải lại số liệu.
export function PrintAlerts() {
  const toast = useToast();
  useEffect(() => {
    // Trình duyệt tự nối lại luồng khi rớt mạng, nhưng bỏ hẳn nếu máy chủ trả lỗi (đang khởi
    // động lại, 502…): tự mở lại luồng với thời gian chờ tăng dần. Nối lại được thì báo `nxc:print`
    // vì lệnh in gửi trong lúc mất kết nối không có thông báo.
    let source, timer, failures = 0, lost = false, stopped = false;
    const unit = (job) => (job.printSize === "instax" ? "tấm Instax" : "tờ");
    const notify = (title, text) => {
      beep();
      if ("Notification" in window && Notification.permission === "granted")
        new Notification(title, { body: text });
      window.dispatchEvent(new Event("nxc:print"));
    };
    const onPrint = (e) => {
      const job = JSON.parse(e.data);
      // A locally acknowledged print is an archive update, not another job to print at the desk.
      if (job.spoolStatus === "sent") { window.dispatchEvent(new Event("nxc:print")); return; }
      const text = `Lệnh in mới · vé #${job.code} (${job.sheetCount || 1} ${unit(job)})`;
      toast.info(text, 8000);
      notify("NXC — Lệnh in mới", text);
    };
    // Print agent báo in lỗi (hết phim Instax, máy in mất kết nối…): lễ tân xử lý rồi bấm In lại.
    const onFailed = (e) => {
      const job = JSON.parse(e.data);
      const text = `Lệnh in vé #${job.code} chưa in được: ${job.spoolMessage || "máy in không nhận lệnh"}`;
      toast.error(text, 20000);
      notify("NXC — Lệnh in lỗi", text);
    };
    const connect = () => {
      clearTimeout(timer);
      source?.close();
      source = new EventSource(getApiUrl("/api/admin/print-jobs/stream"), {
        withCredentials: true,
      });
      source.addEventListener("print", onPrint);
      source.addEventListener("print-failed", onFailed);
      source.addEventListener("open", () => {
        failures = 0;
        if (lost) window.dispatchEvent(new Event("nxc:print"));
        lost = false;
      });
      source.addEventListener("error", () => {
        lost = true;
        // CLOSED (2): the browser gave up; CONNECTING: it is already retrying by itself.
        if (stopped || source.readyState !== 2) return;
        timer = setTimeout(connect, Math.min(60000, 2000 * 2 ** Math.min(failures++, 5)));
      });
    };
    connect();
    const unsubscribe = onNetworkRecovery(() => {
      if (source.readyState === 2) connect();
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
      source.close();
    };
  }, []);
  return null;
}
