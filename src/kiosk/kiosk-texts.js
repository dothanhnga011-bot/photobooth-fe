// Chữ trên màn hình máy chụp. Quản trị sửa ở Thiết lập → Chữ trên máy chụp (settings.kioskTexts);
// để trống thì dùng chữ mặc định ở đây. {n}, {s}…: chỗ máy chụp điền số (số ảnh, số giây).
// [nhóm, [[khóa, tên ô trong trang quản trị, chữ mặc định], …]]
export const KIOSK_TEXT_GROUPS = [
  ["Chung", [
    ["start.tap", "Nút trên màn chờ", "Chạm để bắt đầu"],
    ["shoot.press", "Hướng dẫn trên màn chụp", "Nhấn nút trên dây bấm để chụp"],
    ["select.title", "Tiêu đề màn chọn ảnh ({s} = số giây còn lại)", "Bạn có {s}s để chọn ảnh & trang trí"],
    ["done.title", "Tiêu đề màn QR", "Quét QR để tải ảnh & video."],
  ]],
  ["Phòng photobooth", [
    ["method.title", "Tiêu đề chọn cách thanh toán", "Chọn cách thanh toán"],
    ["method.subtitle", "Dòng dưới tiêu đề", "Đã chuyển khoản tại quầy thì chọn Nhập mã, trả tiền mặt tại máy thì chọn Tiền mặt."],
    ["method.code", "Nút nhập mã", "Nhập mã"],
    ["method.codeHint", "Chú thích nút nhập mã", "Đã chuyển khoản tại quầy — nhập mã 6 số"],
    ["method.cash", "Nút tiền mặt", "Tiền mặt"],
    ["method.cashHint", "Chú thích nút tiền mặt", "Chọn loại tờ, số lượng rồi đút tiền vào máy"],
    ["code.title", "Tiêu đề nhập mã", "Nhập mã chụp"],
    ["code.subtitle", "Dòng dưới tiêu đề nhập mã", "Mã 6 số nhân viên đưa sau khi bạn chuyển khoản tại quầy. Gói chụp và số bản in đã có sẵn trong mã."],
    ["code.submit", "Nút vào chụp sau khi nhập mã", "Bắt đầu chụp"],
    ["package.title", "Tiêu đề chọn loại tờ", "Chọn loại tờ"],
    ["package.subtitle", "Dòng dưới tiêu đề chọn loại tờ", "Chạm vào loại tờ bạn muốn. Giá nằm ngay dưới mỗi lựa chọn."],
    ["print.title", "Tiêu đề chọn số lượng", "Chọn số lượng"],
    ["print.next", "Nút sang trả tiền", "Thanh toán tiền mặt"],
    ["pay.title", "Tiêu đề màn đút tiền", "Đút tiền để bắt đầu chụp"],
  ]],
  ["Phòng Polaroid", [
    ["layout.title", "Tiêu đề chọn layout", "Chọn layout"],
    ["layout.subtitle", "Dòng dưới tiêu đề chọn layout", "Chạm vào layout bạn thích. Thanh toán tại quầy."],
    ["layout.photos", "Số ảnh trên thẻ layout ({n} = số ảnh)", "{n} ảnh"],
    ["layout.confirm", "Thông báo khi chọn layout", "Chọn layout này, vào chụp nha!"],
    ["layout.go", "Nút vào chụp", "Vào chụp"],
    ["layout.back", "Nút chọn lại", "Chọn lại"],
  ]],
];
export const KIOSK_TEXT_DEFAULTS = Object.fromEntries(
  KIOSK_TEXT_GROUPS.flatMap(([, rows]) => rows.map(([key, , text]) => [key, text])),
);

// Chữ đã điền số: kioskText(texts, "layout.photos", { n: 4 }) → "4 ảnh".
export const kioskText = (custom = {}, key, vars = {}) =>
  String(custom?.[key] || KIOSK_TEXT_DEFAULTS[key] || key).replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined ? match : String(vars[name]));
