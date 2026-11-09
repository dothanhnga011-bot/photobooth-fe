# Kết nối Canon EOS R100 cho phòng Polaroid

Phòng Polaroid dùng **Canon EOS R100 + EOS Utility + dây bấm RS-60E3**. Hình trực tiếp đi qua thẻ ghi hình HDMI; JPEG chụp thật đi qua USB vào thư mục rồi được kiosk nhận. Máy in vẫn là Instax Link WIDE của phòng.

## Chuẩn bị và cắm dây

- Cài [EOS Utility chính hãng, có hỗ trợ R100](https://app.ssw.imaging-saas.canon/app/app.html?app=eu).
- Tắt máy ảnh, cắm dây bấm RS-60E3 hoặc dây tương thích đúng chuẩn E3 vào cổng remote.
- Nối USB-C **truyền dữ liệu** từ R100 vào PC.
- Nối micro-HDMI từ R100 vào thẻ ghi hình, rồi cắm thẻ vào PC.
- Bật máy ảnh; chọn chế độ chụp ảnh, JPEG **L/Fine**, Single shooting, tắt self-timer và Auto power off. Chọn không gian màu sRGB. Chỉnh flash và nét bằng ảnh thử tại vị trí khách đứng.

R100 không cấp nguồn/sạc qua USB: kiểm tra pin hoặc dùng bộ nguồn tương thích theo tài liệu Canon. Phần mềm của dự án không điều khiển nút chụp; khách bấm dây.

## Cấu hình EOS Utility một lần

1. Mở EOS Utility, xác nhận đã nhận đúng R100. Đóng phần mềm khác đang giữ kết nối USB, gồm EOS Webcam Utility.
2. Trong Preferences, đặt thư mục đích thành `C:\PhotoBooth\Canon` trên Windows. Trên Mac có thể dùng `Pictures/PhotoBooth/Canon`. Tắt tạo thư mục con tự động để ảnh nằm ngay trong thư mục đã chọn.
3. Chọn khởi động vào màn **Remote shooting**; tại màn chụp, đặt đích lưu là máy tính hoặc cả máy tính và thẻ nhớ.
4. Tắt cửa sổ xem nhanh tự bật và ứng dụng mở ảnh sau khi chụp để chúng không che kiosk.
5. Bấm dây một lần. Phải thấy JPEG mới xuất hiện trong thư mục đích. Nếu chưa có JPEG, xử lý kết nối EOS Utility trước khi mở phiên cho khách.

## Chọn đúng phòng và thư mục trên web

1. Trong **Quản trị → Quản lý máy**, đặt loại phòng là **Polaroid** rồi mở liên kết kiosk của phòng.
2. Mở **Cài đặt máy chụp (nhân viên)**. Hướng dẫn phải ghi **Canon EOS R100**, không phải Fujifilm.
3. Bấm **Chọn thư mục ảnh**, chọn thư mục JPEG vừa cấu hình và cấp quyền đọc mỗi lần truy cập nếu trình duyệt hỏi.
4. Bấm **Thử nhận ảnh từ máy ảnh**, nhấn dây chụp; xác nhận ảnh thử hiện trong kiosk.
5. Chọn thiết bị HDMI, thường có tên USB Video/Cam Link. Nếu tín hiệu có chữ hoặc ô lấy nét, chỉnh hiển thị HDMI trên máy ảnh và thử lại trong chế độ chụp ảnh đang dùng.
6. Chụp một phiên thử đầy đủ: chọn layout → bấm dây → chọn ảnh → nhận bản in → quét QR và lưu ảnh.

Quyền thư mục Canon được lưu riêng với Fujifilm. Khi chuyển phòng từ cấu hình Fuji cũ sang Canon, cần chọn thư mục Canon một lần.

## Tự mở khi bật PC

Tải lại **File cài cho Windows/Mac** từ đúng phòng Polaroid và chạy một lần. File mới mở EOS Utility cùng kiosk; cấu hình thư mục và chế độ chụp trong EOS Utility vẫn cần làm ở bước trên. Trên Windows, lỗi khởi động được ghi tại `%LOCALAPPDATA%\NXC-Kiosk\eos-utility-start.log`.

## Khi không nhận được ảnh

- Có CR3 nhưng không có JPG: đổi chất lượng ảnh sang JPEG hoặc JPEG + RAW.
- Có JPG trong thư mục khác: sửa thư mục đích trong EOS Utility hoặc chọn lại đúng thư mục trên kiosk.
- Bấm dây không chụp: kiểm tra cổng remote, lấy nét và chế độ chụp bằng chính máy ảnh trước.
- Màn kiosk đen nhưng vẫn nhận JPG: kiểm tra đường HDMI/thẻ ghi hình riêng với đường USB chuyển ảnh.

Nguồn đối chiếu: [hướng dẫn R100](https://cam.start.canon/en/C015/manual/html/index.html), [dây bấm trong hướng dẫn R100, trang 166](https://cam.start.canon/vi/C015/manual/c015.pdf), [thiết lập EOS Utility](https://cam.start.canon/en/S003/manual/html/UG-05_Setting_0010.html), [thông số kết nối R100](https://www.usa.canon.com/support/p/Cameras/EOS-Digital-Cameras/6052C002).
