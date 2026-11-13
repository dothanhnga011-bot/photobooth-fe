import { useState } from "react";
import { LogOut, KeyRound } from "lucide-react";
import { PrintAlerts } from "./print-alerts";
import { Brand, ErrorBox } from "./studio";
import { transition } from "./transitions";
import { NAV_TREE, nav, definitions, HIDDEN_PAGES, NAV_DESCRIPTIONS, STAFF_PAGES, can } from "./admin/config";
import { ResourceManager } from "./admin/resources";
import { BookingsManager } from "./admin/bookings";
import { Overview } from "./admin/overview";
import { Statistics } from "./admin/statistics";
import { ScreensManager } from "./admin/screens";
import { ThemesManager } from "./admin/themes";
import { FramesManager } from "./admin/frames";
import { StickersManager } from "./admin/stickers";
import { FiltersManager } from "./admin/filters";
import { KioskTextsManager } from "./admin/kiosk-texts";
import { Rx1OutputManager } from "./admin/rx1-output.jsx";
import { useAdminSession } from "./admin/use-admin-session";
import { LoginPage, PasswordDialog } from "./admin/auth";
import { StorageMonitorProvider } from "./admin/storage-monitor";
import { StorageWarning, useStorageUsage } from "./admin/storage-warning";
import { navNotes, useAwaitingPayment, usePrinterIssues } from "./admin/nav-badges";
import { StorageAssistant } from "./admin/storage-assistant";

// Trang album chỉ tải bản CSS không có phần quản trị (xem guestStylesheet trong vite.config.js); vào
// quản trị từ đó mà không tải lại trang thì nạp thêm bản đầy đủ.
const fullStylesheet = window.__fullStylesheet;
if (fullStylesheet && !document.querySelector(`link[href="${fullStylesheet}"]`)) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.crossOrigin = "";
  link.href = fullStylesheet;
  document.head.appendChild(link);
}

// Mục lục bên trái. Cạnh mục có số / chấm báo việc cần làm: đơn chờ thu tiền (Đơn hàng), máy in cần xem
// (Quản lý máy), kho ảnh đã dùng bao nhiêu % (Dung lượng ảnh); rê chuột lên mục để đọc chi tiết.
function SidebarNav({ tree, currentTab, open }) {
  const notes = navNotes({ awaiting: useAwaitingPayment(), issues: usePrinterIssues(), storage: useStorageUsage() });
  const navButton = ([key, label, Icon], child = false) => (
    <button
      key={key}
      className={`${currentTab === key ? "active" : ""} ${child ? "admin-nav-child" : ""}`}
      aria-current={currentTab === key ? "page" : undefined}
      title={notes[key]?.title || undefined}
      onClick={() => open(key)}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="admin-nav-text">{label}</span>
      {notes[key]?.badge}
    </button>
  );
  return (
    <nav id="admin-navigation" aria-label="Quản lý studio">
      <div className="admin-nav-group admin-nav-tree">
        {tree.map(([key, label, Icon, children]) => {
          if (!children) return navButton([key, label, Icon]);
          // Nhóm luôn mở sẵn mọi trang con, không phải bấm mở / đóng. Tên nhóm là nhãn chữ nhỏ
          // (không icon) để không bị nhầm là một nút bấm.
          return (
            <div
              className={`admin-nav-branch ${children.some(([child]) => child === currentTab) ? "holds-current" : ""}`}
              key={key}
              role="group"
              aria-labelledby={`admin-nav-${key}`}
            >
              <div className="admin-nav-parent" id={`admin-nav-${key}`}>
                <span className="admin-nav-text">{label}</span>
              </div>
              <div className="admin-nav-children">
                {children.map((entry) => navButton(entry, true))}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export function Admin() {
  const [tab, setTab] = useState("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  // Chủ đề được chọn khi bấm từ trang Chủ đề sang Khung ảnh ("all" = xem tất cả khung).
  const [framesTheme, setFramesTheme] = useState("all");
  const session = useAdminSession(setTab);
  const { user, checking, error, setError, setPassword, globalToast, logout } =
    session;
  if (checking)
    return <div className="page center">Đang kiểm tra phiên đăng nhập…</div>;
  if (!user) return <LoginPage session={session} />;
  const isAdmin = user.role === "admin";
  const allowed = isAdmin ? [...nav, ...HIDDEN_PAGES].map(([key]) => key) : STAFF_PAGES(user);
  // Mục lục chỉ gồm trang tài khoản được mở; nhóm không còn trang con thì ẩn.
  const tree = NAV_TREE.map(([key, label, Icon, children]) =>
    children
      ? [key, label, Icon, children.filter(([child]) => allowed.includes(child))]
      : [key, label, Icon],
  ).filter(([key, , , children]) => (children ? children.length : allowed.includes(key)));
  const currentTab = allowed.includes(tab) ? tab : "overview";
  const notify = (msg) => globalToast.success(msg);
  // Tiền (doanh thu, tổng tiền từng vé) chỉ người có quyền xem doanh thu; máy chủ cũng kiểm tra.
  const canSeeMoney = can(user, "revenue:view");
  const activeNav = [...nav, ...HIDDEN_PAGES].find(([key]) => key === currentTab);
  const HeaderIcon = activeNav?.[2];
  // Nhóm chứa từng trang con (ghi trên đầu trang).
  const parents = {};
  tree.forEach(([key, label, , children]) =>
    children?.forEach(([child]) => (parents[child] = [key, label])),
  );
  const open = (key) =>
    transition(() => {
      setTab(key);
      setMobileMenu(false);
      setError("");
    });
  const parent = parents[currentTab];
  return (
    <StorageMonitorProvider key={user._id || user.email}>
      <div className="admin-shell">
        <aside className={`admin-sidebar ${mobileMenu ? "mobile-open" : ""}`}>
          <Brand />
          <button
            className="admin-menu-toggle"
            onClick={() => setMobileMenu(!mobileMenu)}
            aria-expanded={mobileMenu}
            aria-controls="admin-navigation"
          >
            {mobileMenu ? "Đóng menu" : "Menu quản lý"}
          </button>
          <SidebarNav tree={tree} currentTab={currentTab} open={open} />
          <div className="sidebar-bottom">
            <button
              onClick={() => {
                setMobileMenu(false);
                setPassword({ current: "", password: "", confirm: "" });
              }}
            >
              <KeyRound size={16} /> Đổi mật khẩu
            </button>
            <button onClick={logout}>
              <LogOut size={16} /> Đăng xuất
            </button>
          </div>
        </aside>
        <div className="admin-main">
          <header className="admin-header">
            <div>
              {parent && <span className="admin-eyebrow">{parent[1]}</span>}
              <h2>
                {HeaderIcon && <HeaderIcon size={26} aria-hidden="true" />}
                {activeNav?.[1]}
              </h2>
              <p className="admin-page-description">
                {NAV_DESCRIPTIONS[currentTab]}
              </p>
            </div>
            {/* Góc phải chỉ ghi vai trò (tên người dùng hiện khi rê chuột). */}
            <div className="admin-user" title={user.name}>
              <span className="admin-role">{isAdmin ? "Quản trị viên" : "Nhân viên"}</span>
            </div>
          </header>
          <div className="admin-content">
            <StorageWarning onOpenStorage={() => open("storage")} />
            <ErrorBox error={error} />
            <PrintAlerts />
            {currentTab === "overview" ? (
              <Overview
                notify={notify}
                canSeeMoney={canSeeMoney}
                assignedBranch={user.branch}
              />
            ) : currentTab === "statistics" ? (
              <Statistics assignedBranch={user.branch} />
            ) : currentTab === "storage" ? (
              <StorageAssistant canManageStorage={isAdmin} />
            ) : currentTab === "bookings" ? (
              <BookingsManager
                notify={notify}
                canSeeMoney={canSeeMoney}
                canExport={can(user, "orders:export")}
                canCancel={can(user, "orders:cancel")}
                canPrint={can(user, "print:operate")}
                canOpenKiosk={can(user, "rooms:setup")}
                assignedBranch={user.branch}
              />
            ) : currentTab === "screens" ? (
              <ScreensManager notify={notify} />
            ) : currentTab === "frames" ? (
              <FramesManager notify={notify} initialTheme={framesTheme} />
            ) : currentTab === "themes" ? (
              <ThemesManager
                notify={notify}
                onOpenFrames={(themeName) => {
                  setFramesTheme(themeName || "all");
                  open("frames");
                }}
              />
            ) : currentTab === "stickers" ? (
              <StickersManager notify={notify} />
            ) : currentTab === "filters" ? (
              <FiltersManager notify={notify} />
            ) : currentTab === "kiosk-texts" ? (
              <KioskTextsManager notify={notify} />
            ) : currentTab === "rx1-output" ? (
              <Rx1OutputManager notify={notify} />
            ) : definitions[currentTab] ? (
              <ResourceManager
                key={currentTab}
                resource={currentTab}
                notify={notify}
                me={user}
              />
            ) : null}
          </div>
        </div>

        <PasswordDialog session={session} />
      </div>
    </StorageMonitorProvider>
  );
}
