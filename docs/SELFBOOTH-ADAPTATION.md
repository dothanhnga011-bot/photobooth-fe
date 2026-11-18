# Làm đẹp và gửi album theo Selfbooth — 18/11/2026

Đã đọc dự án của chủ tiệm tại `C:/Users/nguye/OneDrive/Desktop/Selfbooth`, chủ yếu `Photo_FE/src/album/PhotoEditor.jsx`, `beauty-render.js`, `face-geometry.js`, `kiosk/direct-upload.js` và các route ảnh trong `Photo_BE`. Dự án Selfbooth được dùng làm tham khảo, không sửa hoặc tạo phụ thuộc chạy sang thư mục đó.

## Phần đã lấy

| Từ Selfbooth | Cách áp dụng vào Photobooth |
| --- | --- |
| Ảnh lớn cạnh bảng công cụ có cuộn riêng | Modal nâu be trên desktop, toàn màn hình trên điện thoại. Ảnh và nút Xong luôn ở ngoài vùng cuộn. |
| Hiện đủ 10 mức chỉnh | Hai cột thanh 0–100, không còn phải chuyển các tab Da/Mắt/Trang điểm. Màu ảnh nằm cùng bảng. Bỏ cấu hình nhóm tab không còn dùng. |
| Ba gợi ý nhanh | Tự nhiên, Trong trẻo, Rạng rỡ, cùng mức tham khảo; ánh xạ `eyes/iris/lipstick` sang các khóa `eyeSize/irisSize/lips` của Photobooth, giữ chỉnh sửa đã lưu tương thích. |
| Giữ để so sánh, chuyển ảnh, áp dụng cả bộ | Giữ chuột/chạm hoặc Space/Enter để xem ảnh gốc; thả ra xem bản chỉnh. Chuyển ảnh trong modal, tải ảnh về, áp dụng công thức cho cả album. Phím mũi tên của thanh chỉnh không đổi ảnh. |
| Xem nhẹ khi kéo, dựng nét khi thả | Khi kéo dùng cạnh 640 px, thả tay về 1600 px; tọa độ khuôn mặt được đổi theo đúng kích thước. Công thức chỉ được lưu vào trạng thái dùng để in sau khi dựng thành công; kết quả cũ đến muộn bị bỏ. |
| Chỉ xử lý vùng quanh từng mặt | Mỗi mặt giữ tỉ lệ riêng, kể cả ảnh nhóm có người gần/xa. Không còn cấp mặt nạ Float32 cho cả ảnh 20 MP. Kích thước ảnh xuất giữ nguyên. |
| Xác nhận ảnh gọn | Client có `X-Photo-Reply: delta` nhận đúng ảnh vừa gửi, kể cả gửi lại khi mất phản hồi. Các ảnh khác vẫn nằm trong DB; frontend ghép xác nhận vào danh sách đang có. Client cũ và GET album vẫn nhận đầy đủ. |
| Phục hồi R2 sớm hơn | Thử lại đường tải thẳng sau 30 giây, lỗi liên tiếp tăng 60 rồi 120 giây. Ảnh và video có thời gian chờ độc lập; thành công đặt lại mức chờ. File đã lên kho vẫn chỉ gửi lại xác nhận, kể cả một file khác đang khiến đường tải mới tạm dùng máy chủ. |

Ảnh đã làm đẹp tải về trước đây dùng nguồn in cạnh 3000 px. Nay dựng từ JPEG camera, tối đa 20 triệu điểm ảnh, giữ tỉ lệ, không phóng ảnh nhỏ, theo chiều lật của bản xem và JPEG chất lượng 0,95. Nguồn in và bản xem tạm không bị dùng thay cho file tải về. Bản gốc chưa lên thì nút tải vẫn chờ, tránh lưu nhầm preview.

## Phần giữ của Photobooth

- Tiếp tục cho preview lên album trước, ảnh gốc tải sau. Selfbooth gửi original/preview/thumbnail lên kho rồi mới xác nhận chung; chép nguyên luồng đó sẽ buộc ảnh xem trong album chờ file camera lớn. Đây là đánh giá theo thứ tự xử lý trong code, chưa phải phép đo hai dự án trên mạng tiệm.
- Giữ hai lượt truyền lớn chung cho ảnh/video, IndexedDB và cơ chế chống trùng, thử lại từng file. Không tăng đồng thời tùy tiện trên mạng dùng chung.
- Giữ mịn da có giảm nhiễu màu, bảo vệ mắt/môi, và phép biến dạng gộp của Photobooth. Không thay toàn bộ thuật toán bằng bản làm mịn độ sáng của Selfbooth hoặc biến dạng nhiều lượt.
- Không đổi thời gian phiên, hạn lưu ảnh, màu in/driver hoặc các bước nhận mã, chụp và in.

## Kết quả kiểm tra

Ca thử API bằng MongoDB tạm với album 103 ảnh: phản hồi xác nhận đầy đủ **22.577 byte**, phản hồi cho một ảnh **659 byte**, giảm **97,08% phần phản hồi JSON**. Không giảm dung lượng JPEG/video và không có nghĩa tổng thời gian upload nhanh hơn 97%. [Số liệu](./benchmarks/selfbooth-delta-2026-11-18.json).

Kiểm tra trình duyệt dùng model nhận diện thật, worker và đường dự phòng; có ca kéo 640 → 1600 px, chuyển/áp dụng nhiều ảnh, công thức lỗi không được đưa vào in tự động, từng mức chỉnh tác động đúng vùng, và ảnh tải 4000 × 6000 được giới hạn còn 3651 × 5477 (không quá 20 MP). Nguồn in thử chỉ 800 × 1200 vẫn độc lập; ảnh nhỏ 320 × 480 không bị phóng lớn; ảnh gốc được lật đúng một lần.

Xác minh cuối: 257 unit test frontend, 266 test backend, 50 browser test và build đều đạt. Riêng editor đã kiểm tra thêm điện thoại 320 × 480, 320 × 568, 390 × 844, nằm ngang 667 × 375 và desktop 1366 × 768; ảnh không bị bảng công cụ che và nút Xong vẫn trong màn hình.

Các tối ưu [đã đo trước đó](./ALBUM-LATENCY-2026-11-18.md) tiếp tục giữ nguyên. Chưa đo lại thời gian truyền toàn bộ ảnh/video tại tiệm sau phần bổ sung này nên không gán thêm một mức nhanh gấp bao nhiêu lần.

## Áp dụng

Triển khai backend và frontend, sau đó hết lượt chụp đang chạy thì tải lại kiosk và album. Không cần cài lại chương trình máy ảnh/máy in. Không xóa dữ liệu trang khi còn ảnh chờ trong IndexedDB. Chỉnh sửa cũ đã lưu vẫn giữ các giá trị cũ; ba gợi ý mới chỉ có tác dụng khi khách chọn.
