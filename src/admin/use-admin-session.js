import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { isTransient, onNetworkRecovery } from "../network.js";
import { useStudio, useToast } from "../studio";
import { transition } from "../transitions";
import {
  custom,
  email as isEmail,
  maxLength,
  minLength,
  required,
  useValidation,
} from "../validate";

export function useAdminSession(setTab) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const globalToast = useToast();
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [password, setPassword] = useState(null);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  // Kiểm tra phiên đăng nhập. Chưa đăng nhập (401) là bình thường; máy chủ chưa phản hồi (đang
  // khởi động, mất mạng) thì ghi lỗi ở màn đăng nhập (thông báo chung do ServerStatus hiện) và tự
  // kiểm tra lại khi kết nối được — không phải tải lại trang.
  const { error: serverError } = useStudio();
  const meFailed = useRef(false);
  const sessionVersion = useRef(0);
  const sessionRequest = useRef(null);
  const retryTimer = useRef(null);
  const sessionFailures = useRef(0);
  const cancelSessionCheck = useCallback(() => {
    clearTimeout(retryTimer.current);
    sessionFailures.current = 0;
    sessionVersion.current++;
    sessionRequest.current?.abort();
    sessionRequest.current = null;
    meFailed.current = false;
  }, []);
  const checkSession = useCallback(function checkSession() {
    clearTimeout(retryTimer.current);
    sessionRequest.current?.abort();
    const controller = new AbortController();
    const version = sessionVersion.current;
    sessionRequest.current = controller;
    const current = () => !controller.signal.aborted && version === sessionVersion.current;
    // /auth/session trả null khi chưa đăng nhập (không có lỗi 401 trong console trình duyệt); index.html đã hỏi
    // sẵn lúc trang vừa tới. Máy chủ cũ chưa có /auth/session (404): hỏi /auth/me như trước.
    return api("/auth/session", { signal: controller.signal, share: true, allowNull: true })
      .catch((e) => (e.status === 404 ? api("/auth/me", { signal: controller.signal, share: true }) : Promise.reject(e)))
      .then((me) => {
        if (!current()) return;
        meFailed.current = false;
        sessionFailures.current = 0;
        setError("");
        setUser(me);
      })
      .catch((e) => {
        if (!current()) return;
        meFailed.current = e.status !== 401;
        setError(meFailed.current ? e.message : "");
        if (meFailed.current && isTransient(e)) {
          const delay = Math.max(e.retryAfterMs || 0,
            Math.min(30000, 3000 * 2 ** Math.min(sessionFailures.current++, 4)));
          retryTimer.current = setTimeout(() => {
            if (current() && meFailed.current) checkSession();
          }, delay);
        }
      })
      .finally(() => {
        if (current()) setChecking(false);
        if (sessionRequest.current === controller) sessionRequest.current = null;
      });
  }, []);
  useEffect(() => {
    checkSession();
    return cancelSessionCheck;
  }, [checkSession, cancelSessionCheck]);
  useEffect(() => {
    if (!serverError && meFailed.current) checkSession();
  }, [serverError, checkSession]);
  useEffect(() => onNetworkRecovery(() => {
    if (meFailed.current && !sessionRequest.current) checkSession();
  }), [checkSession]);
  const loginForm = useValidation();
  const passwordForm = useValidation();
  const userRef = useRef(user);
  userRef.current = user;
  // Phiên hết hạn khi đang thao tác: quay về màn đăng nhập và báo cho người dùng.
  useEffect(() => {
    const expired = () => {
      if (!userRef.current) return;
      cancelSessionCheck();
      setUser(null);
      setPassword(null);
      globalToast.warning(
        "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
      );
    };
    window.addEventListener("nxc:unauthorized", expired);
    return () => window.removeEventListener("nxc:unauthorized", expired);
  }, [globalToast, cancelSessionCheck]);
  async function login(e) {
    e.preventDefault();
    setError("");
    if (
      !loginForm.check(credentials, {
        email: ["Email", required, isEmail],
        password: ["Mật khẩu", required],
      })
    )
      return;
    cancelSessionCheck();
    setBusy(true);
    try {
      const signedIn = await api("/auth/login", {
        method: "POST",
        body: { ...credentials, email: credentials.email.trim() },
      });
      transition(() => setUser(signedIn), "zoom");
      setCredentials({ email: "", password: "" });
      globalToast.success(`Xin chào ${signedIn.name}! Đăng nhập thành công.`);
    } catch (e) {
      setError(e.message);
      globalToast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    cancelSessionCheck();
    try {
      await api("/auth/logout", { method: "POST" });
      transition(() => {
        setUser(null);
        setTab("overview");
      }, "fade");
      globalToast.success("Đã đăng xuất. Hẹn gặp lại!");
    } catch (e) {
      globalToast.error(e.message);
    }
  }
  async function changePassword(e) {
    e.preventDefault();
    setError("");
    if (
      !passwordForm.check(password, {
        current: ["Mật khẩu hiện tại", required],
        password: [
          "Mật khẩu mới",
          required,
          minLength(10),
          maxLength(128),
          custom(
            (v, all) => v !== all.current,
            "Mật khẩu mới phải khác mật khẩu hiện tại.",
          ),
        ],
        confirm: [
          "Mật khẩu nhập lại",
          required,
          custom(
            (v, all) => v === all.password,
            "Mật khẩu nhập lại chưa khớp.",
          ),
        ],
      })
    )
      return;
    setBusy(true);
    try {
      await api("/auth/password", {
        method: "POST",
        body: { current: password.current, password: password.password },
      });
      setPassword(null);
      globalToast.success(
        "Đã đổi mật khẩu. Các thiết bị khác sẽ phải đăng nhập lại.",
      );
    } catch (e) {
      setError(e.message);
      globalToast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return {
    user,
    checking,
    error,
    setError,
    password,
    setPassword,
    busy,
    credentials,
    setCredentials,
    showLoginPassword,
    setShowLoginPassword,
    showCurrentPassword,
    setShowCurrentPassword,
    showNewPassword,
    setShowNewPassword,
    globalToast,
    loginForm,
    passwordForm,
    login,
    logout,
    changePassword,
  };
}
