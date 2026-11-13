# Rà soát luồng Photobooth và Polaroid — 13/11/2026

## Luồng đang dùng

| Phòng | Mở lượt | Chụp và chọn ảnh | In và album |
| --- | --- | --- | --- |
| PTB | Mã đã thanh toán ở quầy hoặc tiền mặt tại kiosk | JPEG từ Fujifilm/X Acquire, hình HDMI; chọn ảnh, khung và trang trí tại kiosk | DNP RX1; ảnh ghép và video gửi nền, khách quét QR tải ảnh |
| Polaroid / Selfbooth | Mã đã thanh toán ở quầy | Canon R100/EOS Utility, hình HDMI, bấm dây không đếm ngược; hết chụp hiện QR | Chọn ảnh, làm đẹp, khung và gửi in Instax Wide trên điện thoại |

Polaroid giữ chụp không giới hạn trong 3 phút/chọn 1 ảnh hoặc 5 phút/chọn 2 ảnh. Thời gian chọn trên điện thoại lấy từ máy chủ, theo cấu hình `selectSeconds` của tiệm (mặc định 250 giây). Hết giờ tự gửi ảnh đang chọn khi đủ nguồn in; không thay bằng ảnh xem nhanh.

## Các sửa đổi

- **Kiểm tra hình trước khi dùng mã:** Cài đặt máy chụp có nút “Kiểm tra hình trực tiếp”. Đổi nguồn hoặc rời cài đặt sẽ nhả camera. Thông báo phân biệt PC chưa nhận thiết bị, chặn quyền, thiết bị bận và nguồn bị ngắt. Khi đổi thiết bị, luồng cũ được đóng trước khi mở luồng mới; không thử EOS Webcam Utility thay cho một thẻ HDMI đang bận.
- **Giao diện điện thoại:** tiêu đề và đồng hồ không tranh cột với phần hướng dẫn. Lưới giữ hai cột trên màn nhỏ, ảnh dọc được thấy đầy đủ. Ảnh trong trình làm đẹp nằm riêng phía trên; tab, thanh chỉnh, bộ lọc và nút Xong không bị ảnh che. Có trạng thái nhận ảnh gốc, mất kết nối thời gian và thiếu khung. Kiểm tra thực tế bằng Chromium ở 320×568 và 390×844.
- **Bản in Polaroid:** chỉ dùng nguồn in sau khi ảnh gốc của các tấm được chọn đã sẵn sàng. Làm đẹp trực tiếp trên canvas rồi ghép khung, bỏ bước JPEG trung gian. Bản ghép tải xuống dùng JPEG 95 thay JPEG 90; tấm Instax vẫn 1260×840, JPEG 95. Dùng phép co ảnh Lanczos cho bản in.
- **Ảnh đến muộn và hết giờ:** bản in tự tiếp tục khi nguồn gốc đến sau lúc đồng hồ về 0. Nếu chỉ chụp được một ảnh với layout hai ô, ảnh đó được lặp; giao diện thông báo rõ.
- **Chống gửi in lại:** khoá thao tác đồng thời; tra lệnh theo UUID trước khi gửi. Mất phản hồi thì kiểm tra lệnh đã lưu, giữ cùng nội dung và UUID để thử lại. Lỗi 409 không bị suy diễn thành đã gửi in chỉ vì thông báo có chữ “in”. “Đã gửi in” là xác nhận lưu/gửi lệnh, không xác nhận giấy đã ra.
- **Bộ nhớ điện thoại:** cache ảnh xem trước theo từng album, tối đa khoảng 6 triệu pixel (~24 MB phần pixel cache), tối đa ba mục; ảnh nguồn in được giải mã lần lượt và đóng ngay sau khi xử lý. Tổng RAM còn gồm canvas đang hiển thị, model làm đẹp và các tài nguyên khác. Rời album giải phóng tham chiếu cache. Đổi thanh chỉnh liên tục bỏ công việc đã lỗi thời trước bước làm đẹp nặng.
- **Danh sách khung trên điện thoại:** dùng WebP xem nhanh của khung khi có, ghép lần lượt các ô nhỏ và huỷ việc cũ khi đổi ảnh/rời bước. Bản xem lớn và bản in vẫn lấy ảnh khung đầy đủ; không giải mã đồng thời mọi khung gốc để vẽ lưới.
- **Thống kê:** cập nhật cache ngay sau khi thay đổi tiền, trạng thái đơn, số tờ, hàng in hoặc phòng. Các lần cập nhật chỉ ảnh/kết nối không xoá cache thống kê. Báo cáo tiếp tục đọc cả đơn hiện tại và sổ tiền đã lưu sau khi dọn đơn hết hạn, khử trùng theo ID.

## Giữ chất lượng

Không giảm độ phân giải JPEG nguồn, kích thước tờ RX1, chất lượng file QR hay thông số video để đổi lấy tốc độ. PTB giữ PNG tờ in, ảnh ghép QR mục tiêu khoảng 20 MP và video theo cấu hình hiện có. Cách xoay/lật và giới hạn ảnh tải về không đổi. Mức gamma, ICC/ICM và DPI đã lưu không bị chỉnh tự động.

Tối ưu lần này chủ yếu bỏ nén trung gian, giới hạn tài nguyên và tránh công việc/lệnh trùng. Chưa đo thời gian trên mạng và phần cứng tại tiệm, nên không quy đổi thành “nhanh gấp N lần”.

## Cấu hình và áp dụng

1. Cập nhật backend rồi frontend. Các sửa này không đổi chương trình in/driver; không cần cài lại bộ in vì riêng bản sửa này.
2. Khi hết lượt khách, tải lại trang quầy và kiosk trên đúng hồ sơ trình duyệt. Giữ dữ liệu trang nếu còn ảnh chờ tải trong IndexedDB.
3. Trong Cài đặt máy chụp, kiểm tra đúng thư mục JPEG của từng máy, bấm **Thử nhận ảnh từ máy ảnh** và **Kiểm tra hình trực tiếp** trước khi mở lượt thật. Tắt webcam thử khi đón khách.
4. Kiểm tra đủ một lượt ở mỗi phòng: PTB chọn/in/QR; Polaroid chụp/QR/chọn và làm đẹp trên điện thoại/in Instax. Đối chiếu tấm in thật dưới ánh sáng cố định khi chỉnh gamma.

Nếu Windows Camera vẫn báo `NoCamerasAreAttached`, cần xử lý việc PC nhận thẻ ghi hình. Bản web chỉ chẩn đoán rõ hơn, không cài được phần cứng chưa được hệ điều hành nhận.

## Kiểm chứng

- FE: 245 kiểm tra đơn vị đạt.
- BE: 250 kiểm tra đạt trên MongoDB thử nghiệm; gồm cập nhật tổng tiền/hàng in ngay sau ghi và lưu doanh thu khi đơn hết hạn bị xoá.
- Trình duyệt: 203 kiểm tra đạt, gồm nhập mã, đồng hồ lệch, camera, chụp Canon không giới hạn, nối lại phiên khi mạng lỗi, chỉnh/in trên điện thoại, ảnh gốc đến muộn, mất phản hồi in và bố cục màn nhỏ. Kiểm tra canvas giữ chi tiết tờ in và pixel video gốc cũng đạt. Tổng ba bộ: 698 kiểm tra.
- Bản dựng production thành công. Không in giấy, thay dữ liệu thật hoặc triển khai production trong lần kiểm tra này.

Xem thêm: [Canon R100](./CANON-R100-POLAROID.md), [tốc độ album](./ALBUM-PERFORMANCE.md), [in từ đơn hàng](./ORDER-PRINTING.md), [màu RX1](./PRINT-COLOR-RX1.md).
