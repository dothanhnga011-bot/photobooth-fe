import { createSharedReads } from "./shared-reads.js";
import { GATEWAY_STATUSES, networkRequest, reportConnectivity, retryAfter } from "./network.js";

export const API_BASE = (import.meta.env?.VITE_API_URL || "").replace(
  /\/$/,
  "",
);
export const getApiUrl = (path = "") => `${API_BASE}${path}`;

// /catalog trả ảnh khung và mã QR dạng địa chỉ riêng (/api/...), cache lâu dài thay vì nhúng base64:
// ghép thêm địa chỉ máy chủ API (khi web và API khác tên miền) để dùng thẳng làm src.
export const assetUrl = (src) =>
  src?.startsWith("/api/") ? getApiUrl(src) : src;
export const withAssetUrls = (catalog) => ({
  ...catalog,
  ...(catalog.frames && {
    // thumb: ảnh xem nhanh (WebP nhẹ) cho bộ chọn; ghép ảnh / in dùng image (ảnh gốc).
    frames: catalog.frames.map((f) => ({ ...f, image: assetUrl(f.image), thumb: f.thumb ? assetUrl(f.thumb) : assetUrl(f.image) })),
  }),
  ...(catalog.stickers && {
    stickers: catalog.stickers.map((s) => ({ ...s, image: assetUrl(s.image), thumb: assetUrl(s.thumb || s.image) })),
  }),
  ...(catalog.screens && {
    screens: catalog.screens.map((s) => ({
      ...s,
      images: s.images.map((image) => ({ ...image, url: assetUrl(image.url) })),
    })),
  }),
  ...(catalog.settings && {
    settings: {
      ...catalog.settings,
      ...(catalog.settings.bankQrImage && {
        bankQrImage: assetUrl(catalog.settings.bankQrImage),
      }),
      ...(catalog.settings.kiosk?.idleImage && {
        kiosk: { ...catalog.settings.kiosk, idleImage: assetUrl(catalog.settings.kiosk.idleImage) },
      }),
    },
  }),
});

const STATUS_MESSAGES = {
  401: "Vui lòng đăng nhập lại.",
  403: "Bạn không có quyền thực hiện thao tác này.",
  404: "Không tìm thấy dữ liệu yêu cầu.",
  413: "Dữ liệu quá lớn. Vui lòng chọn ảnh nhỏ hơn.",
  429: "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.",
  500: "Máy chủ đang gặp sự cố. Vui lòng thử lại sau giây lát.",
};

const sharedReads = createSharedReads();

export function api(path, options = {}) {
  const { share = false, timeout = 20000, signal, allowNull = false, retry, ...request } = options;
  const method = (request.method || "GET").toUpperCase();
  const mutates = method !== "GET" && method !== "HEAD";
  const retries = retry ?? (mutates ? 0 : 1);
  // A read started before a write/login/logout must never be reused afterwards.
  if (mutates) sharedReads.invalidate();
  // Opt-in sharing is deliberately limited to ordinary credentialed GETs.
  // Custom headers, cache mode or other fetch options always get their own request.
  if (share && Object.keys(request).length === 0)
    return sharedReads.run(
      JSON.stringify([path, timeout, allowNull, retries]),
      signal,
      (sharedSignal) => performRequest(path, { timeout, signal: sharedSignal, allowNull, retry: retries }),
    );
  const result = performRequest(path, { timeout, signal, allowNull, retry: retries, ...request });
  // A read may also start while a write is still pending and see the old state.
  // Once the write settles, subsequent readers must start with the current cookie/data.
  return mutates ? result.finally(() => sharedReads.invalidate()) : result;
}

// Every API outcome also tells the page whether the server is reachable (network.js).
function performRequest(path, options) {
  return sendRequest(path, options).then(
    (data) => { reportConnectivity(null); return data; },
    (error) => { reportConnectivity(error); throw error; },
  );
}

async function sendRequest(path, options = {}) {
  const { timeout = 20000, signal, allowNull = false, retry = 0, ...request } = options;
  const binary = typeof Blob !== "undefined" && request.body instanceof Blob;
  return networkRequest(async (requestSignal) => {
    const res = await fetch(`${API_BASE}/api${path}`, {
      credentials: "include",
      ...request,
      signal: requestSignal,
      headers: {
        ...(request.body === undefined
          ? {}
          : { "Content-Type": binary ? request.body.type : "application/json" }),
        ...request.headers,
      },
      body:
        request.body === undefined || binary
          ? request.body
          : JSON.stringify(request.body),
    });
    let parsed = true;
    const data = await res.json().catch(() => {
      parsed = false;
      return null;
    });
    // A web page instead of JSON on a successful status is not this API: a Wi-Fi sign-in
    // portal or a proxy answered. Treat it as a network problem (and retry reads).
    if (res.ok && !parsed && /text\/html/.test(res.headers.get("Content-Type") || ""))
      throw Object.assign(new Error("Mạng Wi-Fi đang chặn kết nối tới máy chủ (có thể cần đăng nhập Wi-Fi). Vui lòng kiểm tra mạng."), { code: "NETWORK" });
    if (!res.ok || !parsed || (data === null && !allowNull)) {
      const error = new Error(
        data?.message ||
          STATUS_MESSAGES[res.status] ||
          (res.status >= 500
            ? STATUS_MESSAGES[500]
            : "Không thể kết nối máy chủ. Vui lòng thử lại."),
      );
      error.status = res.status;
      error.data = data;
      error.retryAfterMs = retryAfter(res.headers.get("Retry-After"));
      // A proxy page instead of this API's JSON: the server itself is not running yet.
      if (!parsed && GATEWAY_STATUSES.has(res.status)) error.code = "UNAVAILABLE";
      // Phiên quản trị hết hạn: báo cho màn hình quản trị để đăng nhập lại.
      if (res.status === 401 && path.startsWith("/admin"))
        window.dispatchEvent(
          new CustomEvent("nxc:unauthorized", { detail: error.message }),
        );
      throw error;
    }
    return data;
  }, { timeout, signal, retries: retry });
}
export const money = (value) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(
    value || 0,
  );
export const localDate = (at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
    at,
  );
export const labels = {
  pending: "Chờ thanh toán",
  confirmed: "Đã xác nhận",
  checked_in: "Đang chụp",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
};
// Hiển thị ngày theo kiểu Việt Nam: 26/09/2026 (và 14:30 26/09/2026 khi có giờ).
const VN_TIME = { timeZone: "Asia/Ho_Chi_Minh" };
export const formatDate = (value) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return value.split("-").reverse().join("/");
  return new Intl.DateTimeFormat("vi-VN", {
    ...VN_TIME,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
};
export const formatDateTime = (value) =>
  value
    ? `${new Intl.DateTimeFormat("vi-VN", { ...VN_TIME, hour: "2-digit", minute: "2-digit" }).format(new Date(value))} ${formatDate(value)}`
    : "";
