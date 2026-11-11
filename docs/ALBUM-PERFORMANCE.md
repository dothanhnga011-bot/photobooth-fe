# Tốc độ mở album và lưu ảnh

Không có thời gian cố định từ lúc chụp xong đến khi toàn bộ file gốc có thể tải về. Thời gian này phụ thuộc số ảnh, dung lượng JPEG, tốc độ upload còn lại của tiệm và các máy đang dùng chung mạng. Mở album xem ảnh và tải đủ file 20 MP là hai mốc riêng.

## Các thay đổi

- Màn chọn ảnh giải mã tối đa ba ảnh xem trước cùng lúc, gom cập nhật vào một lần vẽ màn hình. Danh sách phiên được cập nhật vẫn dùng lại bitmap đã đọc; chuyển khách/rời bước chọn ảnh sẽ hủy lượt tải cũ và đóng bitmap đến muộn. Không đổi kích thước hoặc màu của ảnh xem trước.
- Kéo/phóng ảnh, đổi màu hoặc đổi khung được ghép ở nhịp vẽ màn hình. Bản xem trước đã lỗi thời dừng trước bước cấp canvas/áp màu sau khi tài nguyên tải xong; khung/QR mới luôn kích hoạt ghép lại. Kiểm tra trình duyệt với tám lần đổi trong lúc khung đang tải chỉ cấp một canvas cho bản cuối, vẫn giữ kích thước xem trước cũ.
- URL Blob của ảnh/video gắn với đúng nguồn đang hiển thị, được thu hồi khi thay nguồn, đổi khách hoặc đóng trang. Video ghép xong sau khi chuyển sang khách mới vẫn được tải lên album cũ, nhưng không tạo thêm URL xem trước không còn ai sử dụng.
- Hàng gửi ảnh ghép và bản sao file in cập nhật trong một giao dịch IndexedDB: thêm việc và xác nhận việc đã xong không ghi đè nhau khi chạy đồng thời hoặc mở hai tab. Mã chống trùng in RX1 cũng được khởi tạo trong một giao dịch; lỗi lưu bản sao sau khi RX1 đã xác nhận không đổi trạng thái giấy thành thất bại.
- Các lượt đọc ảnh chờ cùng lúc dùng chung một truy vấn trong khi truy vấn đang chạy. Ghi/xoá ảnh vô hiệu hoá lượt đọc này; không giữ cache lâu hoặc đổi schema IndexedDB. Sau khi gửi ảnh xem trước, dùng ngay dòng đã xác nhận thay vì đọc lại toàn bộ ảnh của mọi khách. Kiểm tra điều kiện gửi bản sao in dừng ở ảnh chờ đầu tiên thuộc album, không lấy cả mảng Blob.
- Phản hồi chốt phiên đến muộn giữ các ảnh đã được xác nhận trong lúc chờ và giữ trạng thái ảnh gốc đã sẵn sàng. Hạn mức/trạng thái hoàn tất vẫn lấy từ máy chủ.
- Gói chỉ nhận ảnh QR không còn giải mã ảnh gốc/vẽ thêm một bản RX1 không dùng đến; tạo thẳng ảnh ghép khoảng 20 MP cho album. Gói có in vẫn tạo riêng tờ RX1 ở kích thước cũ.
- Backend gộp các yêu cầu cùng đọc một cấu hình/danh mục khi chưa có cache. Chỉnh cấu hình hoặc đổi quyền vẫn vô hiệu hoá cả cache lẫn lượt đang tải; kết quả cũ không được đưa trở lại cache. Kiểm tra sáu kiosk cùng mở danh mục mới chỉ phát sinh một bộ sáu truy vấn cơ sở dữ liệu.
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

## Video rõ hơn, giữ ngân sách tải lên

Kiosk ưu tiên định dạng HDMI gốc của thẻ ghi hình (tối đa mục tiêu 1920×1080/30 fps); webcam vẫn dùng chế độ nhẹ. Bản quay tạm HDMI trên PC tăng từ 16 lên 20 Mbps để giảm mất chi tiết trước lần ghép, còn webcam giữ 5 Mbps. Bản tạm này không tải lên; đổi lại nó tốn thêm RAM trong lúc chụp.

Khi ghép, cắt theo điểm ảnh nguyên và giữ tỉ lệ 1:1 nếu kích thước nguồn đã đủ. Ví dụ HDMI 1920×1080, cắt mép mặc định, vẫn xuất 1536×864 nhưng không còn lấy từ tọa độ y=86.4 và nội suy lại. Nguồn lớn cần thu nhỏ vẫn dùng nội suy chất lượng cao. Không phóng ảnh nhỏ lên Full HD để tạo nét giả.

File album giữ codec ưu tiên MP4/H.264, độ phân giải theo vùng HDMI thực có, 30 fps, bitrate theo điểm ảnh (trần 16 Mbps, webcam 8 Mbps) và ngân sách 48 MB như trước. Giữ cách giải mã trước một clip và tải thẳng R2. Dung lượng thực tế vẫn phụ thuộc cảnh và bộ mã hóa, vì bitrate của MediaRecorder là [mục tiêu gợi ý](https://www.w3.org/TR/mediastream-recording/), không phải kích thước file cố định. Bản sửa không khôi phục chi tiết đã mất do nguồn HDMI mờ hoặc máy ảnh lấy nét sai.

Đo ngày 11/11/2026 trên Chromium 153 / Windows / Core Ultra 7 155H: dùng cùng bốn clip nguồn tổng hợp, mỗi clip khoảng hai giây, tua ×4, cắt mép mặc định; một lần làm nóng rồi hai cặp chạy đảo thứ tự. So với commit `4ec30fe`, trung vị riêng bước ghép:

| Nguồn | Thời gian cũ → mới | Dung lượng cũ → mới |
| --- | --- | --- |
| HDMI 1920×1080 | 2,071 → 2,020 giây | 715.763 → 726.368 byte (+1,5%) |
| Webcam 1280×720 | 1,975 → 1,985 giây | 467.079 → 488.443 byte (+4,6%) |

Đây là thử nghiệm bước ghép từ cùng file nguồn, chưa tính quay tạm 20 Mbps, mạng/R2 hoặc máy tại tiệm. Bộ ghi thời gian thực dao động cả thời lượng và số khung hình (Full HD khoảng 59–60 khung); không dùng chênh lệch thời gian nhỏ làm cam kết nhanh hơn. Kiểm tra Canvas bằng vạch sáng/tối một điểm ảnh xác nhận bản ghép 1:1 giữ nguyên pixel trước nén; đây không phải thang đo chất lượng video khách. Chạy bằng `node scripts/bench-timelapse.mjs --runs 2 --scenario all --output .cache/bench-timelapse-clarity.json` khi HEAD là bản gốc và working tree có bản sửa.

Thay đổi này nằm ở frontend. Sau khi phát hành, kết thúc lượt đang chụp rồi tải lại kiosk; video của lượt mới dùng bộ ghép mới. Video cũ trên album giữ nguyên.

## Giới hạn thực tế

Thời gian truyền tối thiểu xấp xỉ `dung lượng MB × 8 / tốc độ Mbps`. Ví dụ, còn 12 ảnh × 15 MB = 180 MB, upload thực tế 20 Mbps thì riêng truyền dữ liệu đã cần khoảng 72 giây, chưa tính tải khác và xác nhận lưu. Ảnh được gửi dần trong lúc chụp/chọn khung nên thời gian khách còn chờ sau khi quét QR có thể ngắn hơn.

Gửi song song giúp tận dụng khoảng chờ của từng yêu cầu; mức cải thiện thực tế còn phụ thuộc đường truyền có đang đầy tải hay không. Video vẫn giữ cùng codec, độ phân giải, bitrate và nội dung; bước ghép video còn cần thời gian xử lý trên PC, rồi mới tải tệp lên kho. Đã có [phép đo tải thật lên R2 trên máy thử nghiệm](./ALBUM-UPLOAD-BENCHMARK.md), với dữ liệu tổng hợp và API cục bộ; chưa đo tốc độ sau thay đổi này tại tiệm nên không cam kết nhanh gấp hai hay album đầy đủ sau một số giây cố định.

Đã thử bằng ảnh mẫu trong dự án, dựng đủ gần 20 MP chỉ để đo payload: file đầy đủ 1.777.233 byte, bản xem 1600 px 166.141 byte, giảm khoảng 91% dữ liệu cho bước hiển thị. Đây không phải phép đo Wi-Fi, camera hay điện thoại tại tiệm; không dùng làm cam kết thời gian mở album.

Album API trả `Server-Timing`: `album-read` cho đọc vé, `album-links` cho chuẩn bị link kho, `guest-file` cho lấy/tạo file tải về. Có thể đối chiếu với thời gian mạng trong DevTools để đo nút thắt trên máy thật.

## Áp dụng

Nếu album vẫn báo chờ ảnh gốc nhiều phút, đó chưa chắc là mạng chậm: kiểm tra hàng gửi trên đúng PC/trình duyệt đã chụp. Máy online chỉ xác nhận trang còn mở, không xác nhận ảnh gốc đã lên kho. Sau khi triển khai bản sửa, đợi lượt chụp hiện tại kết thúc rồi tải lại trang máy chụp trên đúng tên miền và hồ sơ trình duyệt để gửi tiếp hàng IndexedDB. Không xóa dữ liệu trang hay chuyển hồ sơ trình duyệt khi còn ảnh chưa gửi. Khi chờ hơn 5 phút sau giờ kết thúc, album hướng khách nhờ nhân viên kiểm tra thay vì chỉ báo tiếp tục đợi.

Cập nhật backend trước, sau đó frontend. Album mới có ảnh ghép xem nhanh; album cũ thiếu bản xem vẫn tải file cũ để tương thích. Chuẩn bị file tải về dùng cùng cache `downloadFile` được dọn theo hạn ảnh, không tạo thêm định dạng tải về. Kho GridFS nhỏ mặc định vẫn tạo file khi khách tải; có thể bật chuẩn bị sớm bằng `PHOTO_DOWNLOAD_PREWARM=1`, hoặc tắt trên R2 bằng `PHOTO_DOWNLOAD_PREWARM=0`.
