import { X, Ticket, Images, Printer, Eye, EyeOff } from "lucide-react";
import { Brand, Button, ErrorBox } from "../studio";
import { FieldError } from "../validate";

export function LoginPage({ session }) {
  const {
    error,
    busy,
    credentials,
    setCredentials,
    showLoginPassword,
    setShowLoginPassword,
    loginForm,
    login,
  } = session;
  return (
    <div className="admin-login">
      <div className="login-art">
        <Brand />
        <h1>
          Lưu những khoảnh khắc.
          <br />
          Chăm chút từng trải nghiệm.
        </h1>
        <p>Không gian quản lý dành cho studio của bạn.</p>
        <ul className="login-capabilities">
          <li>
            <Ticket size={18} /> Mã chụp & phòng studio
          </li>
          <li>
            <Images size={18} /> Ảnh & bộ khung thiết kế
          </li>
          <li>
            <Printer size={18} /> Hàng in & lưu trữ ảnh
          </li>
        </ul>
      </div>
      <div className="login-form">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <h2>Đăng nhập studio</h2>
        <p>Dành cho quản trị viên và lễ tân.</p>
        <form onSubmit={login} noValidate>
          <ErrorBox error={error} />
          <label>
            Email
            <input
              name="email"
              type="email"
              autoFocus
              autoComplete="username"
              aria-invalid={Boolean(loginForm.errors.email)}
              value={credentials.email}
              onChange={(e) => {
                setCredentials({ ...credentials, email: e.target.value });
                loginForm.clear("email");
              }}
            />
            <FieldError error={loginForm.errors.email} />
          </label>
          <label>
            Mật khẩu
            <div className="password-input-wrapper">
              <input
                name="password"
                type={showLoginPassword ? "text" : "password"}
                autoComplete="current-password"
                aria-invalid={Boolean(loginForm.errors.password)}
                value={credentials.password}
                onChange={(e) => {
                  setCredentials({
                    ...credentials,
                    password: e.target.value,
                  });
                  loginForm.clear("password");
                }}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowLoginPassword((prev) => !prev)}
                title={showLoginPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                aria-label={showLoginPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              >
                {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <FieldError error={loginForm.errors.password} />
          </label>
          <Button disabled={busy} className="full">
            {busy ? "Đang đăng nhập…" : "Đăng nhập"}
          </Button>
        </form>
        <small>Tài khoản được cấp bởi quản trị viên studio.</small>
        <small className="login-guest-note">
          Khách chụp ảnh không cần đăng nhập: quét mã QR trên màn hình máy chụp
          để nhận ảnh.
        </small>
      </div>
    </div>
  );
}

export function PasswordDialog({ session }) {
  const {
    password,
    setPassword,
    error,
    busy,
    passwordForm,
    changePassword,
    showCurrentPassword,
    setShowCurrentPassword,
    showNewPassword,
    setShowNewPassword,
  } = session;
  if (!password) return null;
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Đổi mật khẩu"
      >
        <div className="modal-header">
          <h2>Đổi mật khẩu</h2>
          <button
            aria-label="Đóng"
            className="icon-button"
            onClick={() => setPassword(null)}
          >
            <X />
          </button>
        </div>
        <ErrorBox error={error} />
        <form onSubmit={changePassword} noValidate>
          <label>
            Mật khẩu hiện tại
            <div className="password-input-wrapper">
              <input
                name="current"
                type={showCurrentPassword ? "text" : "password"}
                autoComplete="current-password"
                aria-invalid={Boolean(passwordForm.errors.current)}
                value={password.current}
                onChange={(e) => {
                  setPassword({ ...password, current: e.target.value });
                  passwordForm.clear("current");
                }}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowCurrentPassword((prev) => !prev)}
                title={showCurrentPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                aria-label={
                  showCurrentPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"
                }
              >
                {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <FieldError error={passwordForm.errors.current} />
          </label>
          <label>
            Mật khẩu mới (tối thiểu 10 ký tự)
            <div className="password-input-wrapper">
              <input
                name="password"
                type={showNewPassword ? "text" : "password"}
                autoComplete="new-password"
                aria-invalid={Boolean(passwordForm.errors.password)}
                value={password.password}
                onChange={(e) => {
                  setPassword({ ...password, password: e.target.value });
                  passwordForm.clear("password");
                }}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowNewPassword((prev) => !prev)}
                title={showNewPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                aria-label={showNewPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              >
                {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <FieldError error={passwordForm.errors.password} />
          </label>
          <label>
            Nhập lại mật khẩu mới
            <input
              name="confirm"
              type={showNewPassword ? "text" : "password"}
              autoComplete="new-password"
              aria-invalid={Boolean(passwordForm.errors.confirm)}
              value={password.confirm || ""}
              onChange={(e) => {
                setPassword({ ...password, confirm: e.target.value });
                passwordForm.clear("confirm");
              }}
            />
            <FieldError error={passwordForm.errors.confirm} />
          </label>
          <Button disabled={busy}>{busy ? "Đang lưu…" : "Đổi mật khẩu"}</Button>
        </form>
      </section>
    </div>
  );
}
