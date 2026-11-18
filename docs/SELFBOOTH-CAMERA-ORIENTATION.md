# Hình trực tiếp Selfbooth: máy ngang và máy dọc

## Cách dùng hiện tại của hai phòng

- **PTB:** hình trực tiếp trên web qua thẻ ghi hình HDMI. Màn ngang có hình trực tiếp và cột ảnh bên phải; màn dọc có hình trực tiếp phía trên, ảnh vừa chụp phía dưới. Web mở camera khi vào chụp mà không cần bật chế độ thử webcam.
- **Selfbooth:** máy ảnh nối thẳng màn HDMI riêng. Web hiện ảnh JPEG vừa chụp, đồng hồ và nút Chụp xong; không tự mở camera của trình duyệt. Ảnh vẫn nhận qua USB và thư mục X Acquire, chọn ảnh/in trên điện thoại như trước.
- Các lựa chọn xoay dưới đây chỉ tác động **hình xem thử trên web và chế độ thử webcam**. Chúng không điều khiển hay xoay màn HDMI riêng; cần chỉnh cách đặt/hiển thị của chính màn đó.

## Kiểm tra hình trên web khi cần

Sau khi triển khai frontend mới, tải lại kiosk. Khi chưa vào lượt chụp:

1. Mở **Cài đặt máy chụp (nhân viên)** ở màn chờ phòng Selfbooth.
2. Tại **Xoay hình trực tiếp**, chọn **Ngang · không xoay**, **Dọc · xoay trái 90°**, **Dọc · xoay phải 90°**, hoặc **Xoay ngược 180°**.
3. Bấm **Kiểm tra hình trực tiếp**. Khi thân máy ảnh đặt dọc, chọn trái/phải sao cho đầu người trên màn hình hướng lên trên. Có thể đổi lựa chọn ngay lúc xem thử, không cần mở lại camera.
4. Bấm **Tắt xem thử** rồi vào lượt chụp. Chụp thử một tấm để kiểm tra cả hình trực tiếp lẫn JPEG vừa nhận.

Lựa chọn tự lưu trong trình duyệt trên PC này, riêng cho phòng hiện tại. Tải lại trang vẫn giữ; PC hoặc trình duyệt khác cần đặt riêng. Nếu đổi lại cách đặt thân máy ảnh, đổi lựa chọn trước lượt chụp tiếp theo. Web không tự nhận biết thân máy vừa được xoay từ tín hiệu HDMI đang dùng. Chiều màn hình Windows không quyết định chiều đặt máy ảnh.

Xoay chỉ thay cách hiển thị hình xem thử trên web và màn chụp khi bật thử webcam, cả chế độ video thường và chế độ máy yếu vẽ canvas. Hình được giữ đúng tỉ lệ, vừa vùng xem sau khi xoay; lật như gương vẫn theo chiều ngang của hình đã đứng đúng hướng. Phần cắt viền tiếp tục dùng cài đặt hiện có.

JPEG từ thư mục máy ảnh không nhận thêm phép xoay HDMI: preview đọc EXIF `imageOrientation: from-image`, ảnh gốc vẫn giữ nguyên byte và chất lượng. Vì vậy ảnh ngang và dọc có EXIF hợp lệ có thể nằm chung trong album. Nếu hình trực tiếp đứng đúng nhưng JPEG vẫn nằm nghiêng, cần kiểm tra chiều của chính file JPEG/phần mềm nhận ảnh; tăng hoặc đổi xoay HDMI không sửa file đó. Chế độ thử webcam không có JPEG từ máy ảnh nên khung chụp thử được xoay theo lựa chọn hiện tại.

Không cần cài lại chương trình in hoặc giảm chất lượng ảnh/video để dùng cài đặt này. Mục xoay chỉ hiện ở phòng Selfbooth/Polaroid; phòng PTB giữ cách hiển thị hiện tại.

## Kiểm tra

- Hình vừa khung và đúng tâm ở 0/90/180/270°, có và không lật gương, trên màn ngang, màn dọc và ô xem thử.
- Trình duyệt thật: đổi bốn chiều không mở lại stream, lưu qua tải lại trang, áp dụng khi thử webcam. Phiên Selfbooth nhận JPEG không mở camera của trình duyệt; PTB mở live view mà không cần bật thử webcam.
- JPEG thử có EXIF chiều 6 được nhận thành ảnh dọc 800 × 1200, không xoay lần hai theo HDMI.
- Chế độ máy yếu vẫn xoay hình trực tiếp; ảnh chụp thử webcam đổi đúng chiều rộng/cao.

Các kiểm tra dùng Chromium, camera giả lập và JPEG có EXIF. Cần kiểm tra một lượt trên thẻ ghi hình và máy ảnh tại tiệm sau khi triển khai.
