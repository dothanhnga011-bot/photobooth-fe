# Tốc độ mở album và lưu ảnh

Không có thời gian cố định từ lúc chụp xong đến khi toàn bộ file gốc có thể tải về. Thời gian này phụ thuộc số ảnh, dung lượng JPEG, tốc độ upload còn lại của tiệm và các máy đang dùng chung mạng. Mở album xem ảnh và tải đủ file 20 MP là hai mốc riêng.

## Các thay đổi

- Album xem ảnh ghép bằng JPEG 1600 px riêng; nút Lưu luôn lấy bản đầy đủ khoảng 20 MP. Bản 720 px dùng cho dải ảnh nhỏ. Các bản xem được tạo trước khi công bố ảnh ghép vào album. File đầy đủ giữ nguyên bytes nhận từ kiosk.
- Kiosk giải phóng canvas bản in trước khi tạo canvas ảnh ghép 20 MP; bước gửi RX1 tiếp tục ở nền. Không phải chờ Windows nhận xong lệnh in mới chuẩn bị album.
- Ảnh xem trước và ảnh ghép đi trước bản sao PNG lưu lịch sử in. Video lớn không khóa bước gửi ảnh gốc kế tiếp.
- Khi còn ảnh gốc đang tải, album cập nhật mỗi 2 giây. Dù một file mất hơn 3 phút, trang vẫn kiểm tra nhanh; khi album đầy đủ và đứng yên thì giảm xuống mỗi phút.
- Với kho R2, sau khi kết thúc chụp, backend chuẩn bị sẵn JPEG nhận qua QR khi có ảnh gốc. Dùng đúng bộ mã hóa hiện có: tối đa 20 MP, JPEG 95, 4:4:4, sRGB, xoay đúng chiều rồi lật gương một lần. Khi khách bấm Lưu, thường đã có file cache để tải thẳng từ kho.
- Việc chuẩn bị file tải về chỉ giữ tham chiếu file, chạy từng ảnh, chờ các lượt lưu ảnh đang được nhận và khi RAM gần ngưỡng. Đây là công việc phụ: lỗi chuẩn bị không làm mất ảnh, endpoint tải về vẫn tạo file theo yêu cầu như trước.
- Nếu file camera đã lên R2 nhưng mất phản hồi gắn file vào album, lần thử lại trong cùng trang chỉ xác nhận lại, không tải toàn bộ JPEG lên lần nữa.
- Một ảnh gốc gửi lỗi không chặn các ảnh còn lại hoặc album của khách khác. File lỗi vẫn nằm trong IndexedDB, có thời điểm thử lại riêng (tăng từ 20 giây đến 5 phút, tôn trọng Retry-After). Lỗi 404 không đặt lại tuổi file nên album đã mất không chiếm đầu hàng mãi.
- Ảnh gốc được gửi tối đa hai tấm song song thay vì chờ từng tấm xác nhận. Ảnh gốc và video dùng chung giới hạn hai tệp nền; video sẵn sàng nhận lượt theo thứ tự vào hàng, không phải chờ hết ảnh của album. Ảnh xem trước và ảnh ghép vẫn đi trước các tệp nền chưa bắt đầu. Cách này chồng thời gian chờ mạng/xác nhận, không thay bytes hay chất lượng file.
- Lượt truyền lớn được giải phóng ngay khi R2 nhận xong tệp, trước bước API xác nhận. Tối đa ba ảnh gốc có thể chuẩn bị/chờ xác nhận trong pipeline, còn số tệp lớn thực sự truyền (gồm cả video) vẫn tối đa hai. Nhờ vậy bước xác nhận chậm không giữ hết chỗ và chặn video.
- Kho R2 có thời gian thử lại riêng cho ảnh và video. Một lần tải ảnh lỗi không buộc video đi qua máy chủ trong 10 phút, và lỗi video cũng không tắt đường tải thẳng ảnh gốc.

Ảnh camera dùng để ghép và in giữ nguồn cũ. Các thay đổi tốc độ không giảm độ phân giải hoặc chất lượng của file khách lưu về máy. Ảnh nguồn nhỏ hơn 20 MP không bị phóng lên để tạo độ nét giả.

## Giới hạn thực tế

Thời gian truyền tối thiểu xấp xỉ `dung lượng MB × 8 / tốc độ Mbps`. Ví dụ, còn 12 ảnh × 15 MB = 180 MB, upload thực tế 20 Mbps thì riêng truyền dữ liệu đã cần khoảng 72 giây, chưa tính tải khác và xác nhận lưu. Ảnh được gửi dần trong lúc chụp/chọn khung nên thời gian khách còn chờ sau khi quét QR có thể ngắn hơn.

Gửi song song giúp tận dụng khoảng chờ của từng yêu cầu; mức cải thiện thực tế còn phụ thuộc đường truyền có đang đầy tải hay không. Video vẫn giữ cùng codec, độ phân giải, bitrate và nội dung; bước ghép video còn cần thời gian xử lý trên PC, rồi mới tải tệp lên kho. Đã có [phép đo tải thật lên R2 trên máy thử nghiệm](./ALBUM-UPLOAD-BENCHMARK.md), với dữ liệu tổng hợp và API cục bộ; chưa đo tốc độ sau thay đổi này tại tiệm nên không cam kết nhanh gấp hai hay album đầy đủ sau một số giây cố định.

Đã thử bằng ảnh mẫu trong dự án, dựng đủ gần 20 MP chỉ để đo payload: file đầy đủ 1.777.233 byte, bản xem 1600 px 166.141 byte, giảm khoảng 91% dữ liệu cho bước hiển thị. Đây không phải phép đo Wi-Fi, camera hay điện thoại tại tiệm; không dùng làm cam kết thời gian mở album.

Album API trả `Server-Timing`: `album-read` cho đọc vé, `album-links` cho chuẩn bị link kho, `guest-file` cho lấy/tạo file tải về. Có thể đối chiếu với thời gian mạng trong DevTools để đo nút thắt trên máy thật.

## Áp dụng

Nếu album vẫn báo chờ ảnh gốc nhiều phút, đó chưa chắc là mạng chậm: kiểm tra hàng gửi trên đúng PC/trình duyệt đã chụp. Máy online chỉ xác nhận trang còn mở, không xác nhận ảnh gốc đã lên kho. Sau khi triển khai bản sửa, đợi lượt chụp hiện tại kết thúc rồi tải lại trang máy chụp trên đúng tên miền và hồ sơ trình duyệt để gửi tiếp hàng IndexedDB. Không xóa dữ liệu trang hay chuyển hồ sơ trình duyệt khi còn ảnh chưa gửi. Khi chờ hơn 5 phút sau giờ kết thúc, album hướng khách nhờ nhân viên kiểm tra thay vì chỉ báo tiếp tục đợi.

Cập nhật backend trước, sau đó frontend. Album mới có ảnh ghép xem nhanh; album cũ thiếu bản xem vẫn tải file cũ để tương thích. Chuẩn bị file tải về dùng cùng cache `downloadFile` được dọn theo hạn ảnh, không tạo thêm định dạng tải về. Kho GridFS nhỏ mặc định vẫn tạo file khi khách tải; có thể bật chuẩn bị sớm bằng `PHOTO_DOWNLOAD_PREWARM=1`, hoặc tắt trên R2 bằng `PHOTO_DOWNLOAD_PREWARM=0`.
