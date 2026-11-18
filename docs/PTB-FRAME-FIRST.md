# PTB: chọn khung trước, chọn ảnh sau

Luồng sau khi chụp:

1. **Chọn khung:** hiển thị toàn bộ khung đang dùng, phù hợp khổ in của gói. Mặc định hiện mọi chủ đề, có nút lọc khi tiệm có nhiều chủ đề. Mỗi ô chỉ dùng ảnh danh mục của khung, không ghép ảnh khách. Bấm **Tiếp tục**.
2. **Chọn ảnh và trang trí:** bản ghép bên trái, toàn bộ ảnh đã chụp bên phải trên màn ngang. Chọn ảnh vào từng ô rồi bấm **In ảnh**. Màn dọc xếp bản ghép phía trên, ảnh và công cụ phía dưới.

Các mục **Chỉnh ảnh, Màu ảnh, Thêm chữ, Nhãn dán** tiếp tục dùng công cụ và công thức xuất ảnh hiện có. Nút **Đổi khung** quay lại bước đầu, giữ các ảnh đã chọn và trang trí; khung mới ít ô hơn thì giữ những ảnh đầu vừa số ô. Tải lại trang khôi phục bước đang làm và lựa chọn đã lưu.

Hai bước dùng chung thời gian chọn ảnh trong **Thiết lập → Chữ trên máy chụp**. Bấm Tiếp tục hoặc Đổi khung không đặt lại giờ. Hết giờ ở một trong hai bước sẽ tự chọn đủ ảnh rồi ghép/in theo cơ chế hiện có. Nếu đang ở màn khung, hệ thống nạp các ảnh cần dùng trước khi dựng bản xem QR, tránh bản ghép trống do chưa mở màn chọn ảnh.

Màn khung không tải hoặc giải mã ảnh khách, không dựng nhiều canvas ghép khung cùng lúc. Việc tải ảnh gốc tiếp tục ở nền. Nguồn ảnh in, kích thước tờ RX1, công thức màu in và bản ghép album khoảng 20 MP không bị thay đổi. Phòng Selfbooth/Polaroid vẫn chụp → QR → chọn ảnh trên điện thoại.

Đây là thay đổi frontend. Cần triển khai frontend mới rồi tải lại kiosk sau khi kết thúc lượt khách hiện tại; không cần cài lại chương trình in. Phiên chọn ảnh từ bản cũ tiếp tục mở màn ghép, không bị mất lựa chọn.

Kiểm tra bằng Chromium với API và máy in giả lập: khung không chứa ảnh khách hoặc yêu cầu ảnh khách; tiếp tục, quay lại, tải lại; giữ thời hạn và trang trí; chọn nhiều ô, màu ảnh, chữ, nhãn dán; xuất ảnh và gửi in; hết giờ tự in một lần. Kiểm tra 16 khung ở 1366 × 768, 1920 × 1080 và màn dọc 1080 × 1920. Đây không phải phép thử với máy in vật lý hoặc bản đã triển khai trên website.
