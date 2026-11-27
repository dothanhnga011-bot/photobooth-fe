// Chữ trên màn hình máy chụp. Quản trị sửa ở Thiết lập → Chữ trên máy chụp (settings.kioskTexts);
// để trống thì dùng chữ mặc định ở đây. {n}, {s}…: chỗ máy chụp điền số (số ảnh, số giây).
// [nhóm, [[khóa, tên ô trong trang quản trị, chữ mặc định], …]]
export const KIOSK_TEXT_GROUPS = [
  ["Chung", [
    ["start.tap", "Nút trên màn chờ", "Chạm để bắt đầu"],
    // Nhập mã / trả tiền xong: màn chụp chờ khách bấm (đồng hồ của lượt chỉ chạy từ lúc bấm).
    ["shoot.startTitle", "Tiêu đề trước khi chụp (chờ khách bấm)", "Sẵn sàng chụp chưa?"],
    ["shoot.startHint", "Hướng dẫn trước khi chụp", "Đứng vào vị trí rồi bấm Bắt đầu chụp. Đồng hồ chỉ chạy từ lúc bấm — bấm nút này trước rồi mới bấm dây chụp."],
    ["shoot.start", "Nút bắt đầu chụp", "Bắt đầu chụp"],
    ["select.title", "Tiêu đề màn chọn ảnh ({s} = số giây còn lại)", "Bạn có {s}s để chọn ảnh & trang trí"],
    ["select.frameTitle", "Tiêu đề màn chọn khung ({s} = số giây còn lại)", "Bạn có {s}s để chọn khung ảnh"],
    ["select.photoHint", "Hướng dẫn chọn ảnh sau khi chọn khung", "Chạm ảnh bạn thích để ghép vào khung. Chạm ảnh trên khung để bỏ chọn."],
    ["select.frameSubtitle", "Hướng dẫn màn chọn khung", "Chọn khung bạn thích rồi bấm Tiếp tục để chọn ảnh và trang trí."],
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
    // Nút này chỉ kiểm tra mã; vào chụp ở nút "Bắt đầu chụp" của màn chụp (shoot.start).
    ["code.submit", "Nút xác nhận mã", "Xác nhận mã"],
    ["package.title", "Tiêu đề chọn loại tờ", "Chọn loại tờ"],
    ["package.subtitle", "Dòng dưới tiêu đề chọn loại tờ", "Chạm vào loại tờ bạn muốn. Giá nằm ngay dưới mỗi lựa chọn."],
    ["print.title", "Tiêu đề chọn số lượng", "Chọn số lượng"],
    ["print.next", "Nút sang trả tiền", "Thanh toán tiền mặt"],
    ["pay.title", "Tiêu đề màn đút tiền", "Đút tiền để bắt đầu chụp"],
  ]],
  ["Phòng Selfbooth", [
    // Như Selfbooth: khách trả tiền ở quầy, nhân viên đưa mã (gói đã có trong mã), nhập mã là vào chụp.
    ["selfbooth.codeTitle", "Tiêu đề nhập mã", "Nhập mã chụp"],
    ["selfbooth.codeSubtitle", "Dòng dưới tiêu đề nhập mã", "Mã 6 số nhân viên đưa khi bạn thanh toán ở quầy. Gói và thời gian chụp đã có sẵn trong mã."],
    ["done.studioTitle", "Tiêu đề màn QR (chọn ảnh trên điện thoại)", "Quét mã QR để chọn ảnh, làm đẹp và in nhé!"],
  ]],
];
export const KIOSK_TEXT_DEFAULTS = Object.fromEntries(
  KIOSK_TEXT_GROUPS.flatMap(([, rows]) => rows.map(([key, , text]) => [key, text])),
);

// Chữ đã điền số: kioskText(texts, "select.title", { s: 90 }) → "Bạn có 90s để chọn ảnh & trang trí".
export const kioskText = (custom = {}, key, vars = {}) =>
  String(custom?.[key] || KIOSK_TEXT_DEFAULTS[key] || key).replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined ? match : String(vars[name]));
