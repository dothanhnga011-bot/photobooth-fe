# Kết nối Canon EOS R100 cho phòng Polaroid

Phòng Polaroid dùng **Canon EOS R100 + EOS Utility + dây bấm RS-60E3**. Hình trực tiếp đi qua thẻ ghi hình HDMI; JPEG chụp thật đi qua USB vào thư mục rồi được kiosk nhận. Máy in vẫn là Instax Link WIDE của phòng.

Phòng Polaroid hoạt động theo mô hình **Selfbooth**: nhân viên chọn gói ở quầy, xác nhận thanh toán và đưa mã 6 số → khách nhập mã trên kiosk → **bấm dây cho từng ảnh**, không hẹn giờ hay tự chụp. Layout và thời gian đã nằm trong mã, kiosk không còn màn chọn layout. Mã phải còn hạn 2 giờ, đã thanh toán, đúng chi nhánh và đúng loại phòng; nhập nhầm phòng không làm mất mã.

Màn nhập mã dùng nâu óc chó, be giấy và hoa văn lá cuộn vàng cổ kiểu Pháp. Khi chụp trên màn ngang, **live view chiếm 2/3, cột ảnh chiếm 1/3**. Cột bên phải có thời gian còn lại, ảnh mới nhất cỡ lớn, dải ảnh đã chụp và nút **Chụp xong**. Trên màn đứng, live view ở trên, ảnh ở dưới. Giao diện đã kiểm tra ở 1024 × 600, 1366 × 768 và 1920 × 1080.

Kiosk bỏ đếm ngược chuẩn bị và số 3–2–1 giữa màn hình cho phòng Polaroid, kể cả khi tải lại lượt cũ. Khi mở lượt, kiosk chỉ chờ máy chủ xác nhận phiên. Đồng hồ bên cạnh vẫn giới hạn thời gian của gói; hết giờ hiện QR để chọn ảnh trên điện thoại, không kích hoạt máy ảnh. Tải lại phiên đang chụp vẫn nhận diện Canon từ thông tin phiên khi yêu cầu kiểm tra phòng tạm mất mạng.

| Gói Polaroid | Thời gian chụp | Số ảnh chụp | Số ảnh chọn để in |
| --- | --- | --- | --- |
| Ảnh nhỏ | 3 phút | Không giới hạn | 1 ảnh |
| Ảnh to | 5 phút | Không giới hạn | 2 ảnh |

Thời gian trên là thời gian **chụp**, tính khi máy chủ mở phiên thành công. Khách quét QR rồi chọn ảnh, làm đẹp và chọn khung trên điện thoại, có đồng hồ riêng (mặc định 250 giây, quản trị thay đổi được). Giá do quản trị đặt; mỗi lượt vẫn in 1 tấm Instax Wide theo khung 1 hoặc 2 ô hiện có, QR nhận toàn bộ ảnh đã chụp. Bản in đợi ảnh gốc, kể cả khi ảnh gốc đến sau lúc hết giờ chọn.

Gói cũ có số lần bấm dây hoặc thời lượng khác được áp dụng quy tắc trên cho lượt mới, không cần tạo lại gói. Thời gian của lượt đã mở giữ theo snapshot của lượt đó. Cập nhật cả backend và frontend, rồi tải lại kiosk khi hết lượt khách; frontend cũ vẫn có thể hiển thị giới hạn cũ.

## Chuẩn bị và cắm dây

- Cài [EOS Utility chính hãng, có hỗ trợ R100](https://app.ssw.imaging-saas.canon/app/app.html?app=eu).
- Tắt máy ảnh, cắm dây bấm RS-60E3 hoặc dây tương thích đúng chuẩn E3 vào cổng remote.
- Nối USB-C **truyền dữ liệu** từ R100 vào PC.
- Nối micro-HDMI từ R100 vào thẻ ghi hình, rồi cắm thẻ vào PC.

| Đường kết nối | Cắm từ đâu đến đâu | Công dụng |
| --- | --- | --- |
| Dây RS-60E3 hoặc dây đúng chuẩn E3 | Nút bấm của khách → cổng remote trên R100 | Lấy nét và bấm chụp |
| USB-C dữ liệu | R100 → cổng USB của PC | EOS Utility chuyển JPEG chụp thật |
| Micro-HDMI Type D | R100 → HDMI IN của thẻ ghi hình → USB của PC | Hình trực tiếp trên kiosk |

Cổng HDMI trên phần lớn laptop là đầu ra: cần thẻ ghi hình để nhận hình từ máy ảnh. Dây bấm không cắm vào PC.

## Tắt hẹn giờ trên R100 và dây bấm

1. Bật R100 ở chế độ **chụp ảnh** (P/Av/Tv/M theo thiết lập ánh sáng của tiệm).
2. Vào **MENU → Drive mode → Single shooting** (biểu tượng một khung hình). Không chọn **Self-timer 2 sec/10 sec/Remote control** hay chụp liên tiếp. Dây RS-60E3 không cần chế độ hẹn giờ của remote Bluetooth BR-E1.
3. Chọn chất lượng **JPEG L/Fine**, Color space **sRGB**, tắt Auto power off. Chỉnh flash và nét bằng ảnh thử tại vị trí khách đứng.
4. Nếu dây có màn hình/bộ hẹn giờ, tắt timer/interval; dùng nút chụp tay. Nhấn nửa nút để lấy nét, nhấn hết để chụp rồi thả nút. Không gạt khóa giữ nút.
5. Thử một lần: máy phải chụp khi nhấn hết nút (sau khi lấy nét/flash sẵn sàng), không chờ 2 hoặc 10 giây. Nếu còn đếm ngược, kiểm tra lại Drive mode và bộ hẹn giờ trên dây; tải lại web không đổi được hai thiết lập này.

R100 không cấp nguồn/sạc qua USB: kiểm tra pin hoặc dùng bộ nguồn tương thích theo tài liệu Canon. Phần mềm của dự án không điều khiển nút chụp; khách bấm dây.

## Cấu hình EOS Utility một lần

1. Mở EOS Utility, xác nhận đã nhận đúng R100. Đóng phần mềm khác đang giữ kết nối USB, gồm EOS Webcam Utility.
2. Trong Preferences, đặt thư mục đích thành `C:\PhotoBooth\Canon` trên Windows. Trên Mac có thể dùng `Pictures/PhotoBooth/Canon`. Tắt tạo thư mục con tự động để ảnh nằm ngay trong thư mục đã chọn.
3. Chọn khởi động vào màn **Remote shooting**; tại màn chụp, đặt đích lưu là máy tính hoặc cả máy tính và thẻ nhớ.
   Giữ cửa sổ Remote shooting kết nối ở nền. Khách bấm dây; không bật Timer-controlled shooting/Interval timer trong EOS Utility.
4. Tắt cửa sổ xem nhanh tự bật và ứng dụng mở ảnh sau khi chụp để chúng không che kiosk.
5. Bấm dây một lần. Phải thấy JPEG mới xuất hiện trong thư mục đích. Nếu chưa có JPEG, xử lý kết nối EOS Utility trước khi mở phiên cho khách.

## Chọn đúng phòng và thư mục trên web

1. Trong **Quản trị → Quản lý máy**, đặt loại phòng là **Polaroid** rồi mở liên kết kiosk của phòng.
2. Mở **Cài đặt máy chụp (nhân viên)**. Hướng dẫn phải ghi **Canon EOS R100**, không phải Fujifilm.
3. Bấm **Chọn thư mục ảnh**, chọn thư mục JPEG vừa cấu hình và cấp quyền đọc mỗi lần truy cập nếu trình duyệt hỏi.
   Tắt **Thử máy bằng webcam máy tính** trước khi dùng R100; chế độ thử bằng phím Space lấy ảnh webcam và có đếm ngược riêng.
4. Bấm **Thử nhận ảnh từ máy ảnh**, nhấn dây chụp; xác nhận ảnh thử hiện trong kiosk.
5. Chọn thiết bị HDMI, thường có tên USB Video/Cam Link, bấm **Kiểm tra hình trực tiếp**. Tắt xem thử trước khi bắt đầu. Nếu tín hiệu có chữ hoặc ô lấy nét, chỉnh hiển thị HDMI trên máy ảnh và thử lại trong chế độ chụp ảnh đang dùng.
6. Trong quầy **Tạo mã chụp**, chọn gói Polaroid và phòng, xác nhận đã thu tiền rồi lấy mã 6 số. Thử đầy đủ: nhập mã → bấm dây → quét QR → chọn ảnh/làm đẹp/chọn khung trên điện thoại → gửi in → nhận bản in và lưu ảnh.

Quyền thư mục Canon được lưu riêng với Fujifilm. Khi chuyển phòng từ cấu hình Fuji cũ sang Canon, cần chọn thư mục Canon một lần.

## Tự mở khi bật PC

Tải lại **File cài cho Windows/Mac** từ đúng phòng Polaroid và chạy một lần. File mới mở EOS Utility cùng kiosk; cấu hình thư mục và chế độ chụp trong EOS Utility vẫn cần làm ở bước trên. Trên Windows, lỗi khởi động được ghi tại `%LOCALAPPDATA%\NXC-Kiosk\eos-utility-start.log`.

## Khi không nhận được ảnh

- Có CR3 nhưng không có JPG: đổi chất lượng ảnh sang JPEG hoặc JPEG + RAW.
- Có JPG trong thư mục khác: sửa thư mục đích trong EOS Utility hoặc chọn lại đúng thư mục trên kiosk.
- Bấm dây không chụp: kiểm tra cổng remote, lấy nét và chế độ chụp bằng chính máy ảnh trước.
- Bấm dây mà máy đếm 2/10 giây: đổi Drive mode về Single shooting và tắt timer trên dây. Web không thể tự đổi chế độ này của R100.
- Màn kiosk đen nhưng vẫn nhận JPG: kiểm tra đường HDMI/thẻ ghi hình riêng với đường USB chuyển ảnh.

Nguồn đối chiếu: [Drive mode trên R100](https://cam.start.canon/en/C015/manual/html/UG-04_AF-Drive_0050.html), [dây RS-60E3 trên R100](https://cam.start.canon/en/C015/manual/html/UG-04_AF-Drive_0070.html), [chụp trên máy ảnh khi kết nối EOS Utility](https://cam.start.canon/en/S003/manual/html/UG-03_RemoteCamera_0080.html), [thiết lập EOS Utility](https://cam.start.canon/en/S003/manual/html/UG-05_Setting_0010.html), [thông số kết nối R100](https://cam.start.canon/en/C015/manual/html/UG-11_Reference_0080.html).
