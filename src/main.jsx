import React, { useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  useLocation,
} from "react-router-dom";
import { api, withAssetUrls } from "./api";
import { useLiveData } from "./use-live-data";
import { ServerStatus } from "./server-status";
import { useKeepServerAwake } from "./use-connectivity";
import { StudioContext, Brand, ToastProvider } from "./studio";
// Font tiêu đề (Playfair Display) và chữ viết tay (Patrick Hand) đóng gói kèm app, có bộ chữ tiếng Việt.
import "@fontsource/playfair-display/latin-700.css";
import "@fontsource/playfair-display/vietnamese-700.css";
import "@fontsource/playfair-display/latin-900.css";
import "@fontsource/playfair-display/vietnamese-900.css";
import "@fontsource/playfair-display/latin-500-italic.css";
import "@fontsource/playfair-display/vietnamese-500-italic.css";
import "@fontsource/patrick-hand/latin-400.css";
import "@fontsource/patrick-hand/vietnamese-400.css";
// Chữ khách gõ lên khung ở máy chụp: font viết tay đủ dấu tiếng Việt và font ký hiệu ♡ ☆ ✿ ✧.
import "./kiosk/decor-fonts.js";
import "./tailwind.css";

// An album opened from its QR code: ask for the album while the album screen's code is still
// downloading. The album screen's first read joins this request (shared while it is in flight),
// so the photos list arrives ~0.4 s sooner on 4G and is never fetched twice.
const albumAtStart = /^\/album\/([^/?#]+)/.exec(location.pathname);
if (albumAtStart) api(`/albums/${albumAtStart[1]}`, { share: true }).catch(() => {});

const AlbumPage = lazy(() =>
  import("./pages").then((m) => ({ default: m.AlbumPage })),
);
const Kiosk = lazy(() => import("./kiosk").then((m) => ({ default: m.Kiosk })));
const Admin = lazy(() => import("./admin").then((m) => ({ default: m.Admin })));

// Web chỉ dùng nội bộ tiệm: nhân viên dùng trang quản trị, máy chụp trong phòng dùng /kiosk,
// khách chỉ mở album bằng mã QR hiện trên máy chụp sau khi chụp xong.
const TITLES = [
  ["/album/", "Ảnh của bạn"],
  ["/kiosk", "Máy chụp"],
  ["/admin", "Quản lý tiệm"],
];

function App() {
  const [catalog, setCatalog] = useState({});
  const [error, setError] = useState("");
  const location = useLocation();
  // Chỉ xóa lỗi khi tải được thật: lỗi không chớp tắt giữa các lần thử lại.
  const reload = useLiveData(
    "/catalog",
    (data) => {
      setCatalog(withAssetUrls(data));
      setError("");
    },
    (e) => setError(e.message),
    5000,
    () => true,
  );
  const album = location.pathname.startsWith("/album/");
  const kiosk = location.pathname.startsWith("/kiosk");
  // Máy chụp / trang quản trị của tiệm giữ máy chủ miễn phí thức trong giờ mở cửa.
  useKeepServerAwake(kiosk || location.pathname.startsWith("/admin"));
  useEffect(() => {
    const page = TITLES.find(([path]) => location.pathname.startsWith(path));
    const name = catalog.settings?.name || "Photobooth";
    document.title = page ? `${page[1]} · ${name}` : name;
  }, [location.pathname, catalog.settings?.name]);
  return (
    <ToastProvider>
      <ServerStatus error={error} quiet={album || kiosk} />
      <StudioContext.Provider value={{ ...catalog, error, reload }}>
        {album && (
          <header className="site-header is-compact">
            <Brand />
          </header>
        )}
        <main id="main-content" tabIndex={-1}>
          <Suspense
            fallback={
              <div className="page center page-loading" role="status">
                <span className="spinner" aria-hidden="true" /> Đang tải…
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
        <ScrollRestoration />
      </StudioContext.Provider>
    </ToastProvider>
  );
}

function NotFound() {
  return (
    <section className="page narrow center internal-note">
      <h1>Không tìm thấy trang.</h1>
      <p>
        Đây là hệ thống nội bộ của tiệm. Nếu bạn vừa chụp ảnh, hãy quét mã QR
        trên màn hình máy chụp để nhận ảnh.
      </p>
    </section>
  );
}

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: "/", element: <Navigate to="/admin" replace /> },
      { path: "/album/:token", element: <AlbumPage /> },
      { path: "/kiosk", element: <Kiosk /> },
      { path: "/admin/*", element: <Admin /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
