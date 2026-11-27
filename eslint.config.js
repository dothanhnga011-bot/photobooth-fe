// Kiểm tra code: `npm run lint`. Luật JS chuẩn (biến thừa, biến chưa khai báo…) và hai luật React hooks cốt lõi:
// rules-of-hooks (gọi hook sai chỗ: lỗi) và exhaustive-deps (useEffect / useMemo / useCallback thiếu giá trị nó
// dùng — kiểu lỗi "màn hình không cập nhật"). Bỏ qua có chủ ý thì ghi lí do ngay dòng đó.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  // .agents: công cụ thiết kế bên thứ ba, không phải mã của web.
  { ignores: ["dist/**", ".cache/**", "node_modules/**", "public/**", "hardware/**", "docs/**", ".agents/**"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Nhiều case rỗng liền nhau (có chú thích xen giữa) dùng chung một xử lý.
      "no-fallthrough": ["error", { allowEmptyCase: true }],
    },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Worker của Cloudflare, script build và test chạy bằng Node (test trình duyệt có cả mã chạy trong trang).
  {
    files: ["cloudflare/**/*.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["scripts/**", "test/**", "*.config.js", "*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
