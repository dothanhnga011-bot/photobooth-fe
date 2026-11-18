# Đẩy ảnh lên album — kiểm tra ngày 18/11/2026

Đã giảm thời gian ảnh xem trước chờ sau công việc nặng, sửa một trường hợp ảnh gốc mất tín hiệu gửi tiếp và bỏ một lượt đọc cơ sở dữ liệu thừa. Không thay kích thước, mức nén, màu, cách lật ảnh hoặc nội dung video. Phép đo này so với phiên bản ngay trước lần sửa, không dùng lại mức 2,32 lần của phép đo ngày 10/11.

## So sánh thời gian

Hai cặp chạy đảo thứ tự cũ/mới, cùng 12 ảnh xem trước, ghi/đọc R2 thật; số trong bảng là trung vị. “Lưu” nghĩa là backend đã lưu và xác nhận ảnh xem trước, chưa phải điện thoại đã hiển thị hoặc tải đủ ảnh gốc.

| Tình huống | Cũ | Mới | Nhận xét |
| --- | ---: | ---: | --- |
| Máy chủ rảnh: ảnh xem trước đầu tiên | 0,38 giây | 0,56 giây | Dao động mạng; không kết luận cải thiện |
| Máy chủ rảnh: lưu đủ 12 ảnh xem trước | 6,04 giây | 5,90 giây | Gần tương đương, chênh 2,3% |
| Một tác vụ nặng giữ hàng chung 3 giây: ảnh xem trước đầu tiên | 3,35 giây | 0,41 giây | Bỏ phần chờ hàng chung khi còn RAM |
| Cùng tình huống trên: lưu đủ 12 ảnh xem trước | 8,96 giây | 5,54 giây | Giảm 38,2% thời gian, nhanh khoảng 1,62 lần trong ca đo |

Một phép thử riêng tái hiện ảnh gốc được ghi vào hàng chờ đúng lúc lượt đọc cuối đang kết thúc: bản cũ xác nhận sau **30,041 giây**, bản mới **0,032 giây**. Phép thử dùng đúng hàm xử lý hàng chờ, bộ hẹn giờ 30 giây thật và xác nhận giả lập 25 ms; đây là thời gian lập lịch, không phải tốc độ truyền JPEG lên R2. Bản mới tránh phải đợi lượt kiểm tra kế tiếp trong trường hợp này, không có nghĩa toàn bộ album nhanh hơn hàng trăm lần.

## Các thay đổi

- Backend có một lượt riêng cho ảnh xem trước từ kiosk, giới hạn cạnh 2048 px và đầu vào 6 MiB, kiểm tra JPEG trước khi giải mã thumbnail. Ảnh gốc vẫn dùng giới hạn xử lý cũ. Khi RAM dùng từ 70%, ảnh xem trước quay lại hàng chung. Việc tạo nguồn in/file tải về tiếp tục nhường các ảnh đang được lưu.
- Kiosk giữ quyền ưu tiên trong suốt đợt gửi ảnh xem trước, kể cả khoảng chờ đọc IndexedDB và xác nhận. Một ảnh xem trước bị từ chối vẫn được giữ để thử lại, nhưng không ngăn gửi ảnh gốc của các ảnh đã được xác nhận.
- Nếu ảnh gốc mới xuất hiện khi lượt gửi đang kết thúc, gom tín hiệu thành một lượt kiểm tra tiếp ngay. Không tạo thêm lượt gửi đồng thời. Giới hạn ảnh gốc/video thực sự truyền vẫn là hai file.
- Khi gắn ảnh gốc, dùng lại thông tin album và đúng ảnh đã đọc để xác thực: đường thành công thông thường giảm từ hai lần `find` xuống một. Kiểm tra tích hợp đếm truy vấn thật trên MongoDB tạm; chưa quy đổi thành thời gian trên Atlas của tiệm.
- Tìm ảnh theo `clientKey` cả khi backend vừa tự kết thúc một phiên quá giờ và trả về toàn bộ ảnh. Tránh lấy nhầm ảnh đầu tiên đã có bản gốc rồi trả `saved: true` cho ảnh phía sau vẫn chưa có file.

## Dữ liệu và giới hạn phép đo

- Backend cũ: `37da869dafa59dfe6318be0c20f0a514674d7996`; frontend cũ: `b6a62a1a00902c18bc59534e3047ff102a0690bc`.
- JPEG tổng hợp 6240 × 4160 (25,96 MP), 15.853.307 byte; tạo một ảnh xem trước 1600 px, 849.145 byte, gửi lại 12 lần với các khóa khác nhau. Không dùng ảnh khách. Không gửi toàn bộ JPEG camera trong phép đo preview.
- Hai HTTP client cục bộ; MongoMemoryServer riêng; lưu preview/thumbnail thật lên R2. Một lượt làm nóng cho mỗi bản; hai cặp cho mỗi tình huống, lần đầu cũ → mới, lần sau mới → cũ.
- Hàng xử lý ảnh lớn giới hạn một việc, giống cấu hình ít RAM. Ca bận chủ động giữ lượt này 3000 ms bằng một tác vụ chờ; ca mới có RAM dư được mô phỏng ở 40%. Không giả lập CPU Render hoặc chứng minh tất cả máy chủ thực tế đều đang gặp đúng độ chờ đó.
- Đọc lại preview/thumbnail mẫu ở mỗi lượt, đối chiếu SHA-256 cùng nguồn. Tất cả trùng byte. Kiểm tra upload riêng xác nhận file JPEG camera giữ nguyên byte, ICC, chiều xoay/lật và nguồn in vẫn lấy từ camera.
- Đã xóa 196 đối tượng thử trong namespace UUID riêng, kiểm tra namespace trống và xóa nhật ký dọn thử. Không kết nối MongoDB sản xuất hoặc sửa đơn/ảnh khách.
- Chưa đo PC/mạng tiệm, Render, Atlas và điện thoại. Chưa đo lại thời gian truyền đủ ảnh gốc/video. Hai cặp còn ít và R2 có dao động; không coi 1,62 lần là cam kết chung.

Số liệu gốc: [R2 preview](./benchmarks/album-latency-2026-11-18.json), [tái hiện tín hiệu gửi ảnh gốc](./benchmarks/original-wake-2026-11-18.json).

## Xác minh bản sửa

Lượt kiểm tra cuối đạt 254 unit test frontend, 265 test backend, 25 browser test (hàng IndexedDB, chụp PTB, chụp Selfbooth, album/chọn ảnh/in giả lập) và build frontend. Bộ backend chạy lần lượt bằng `node --import ./test/environment.js --test --test-concurrency=1 test/*.test.js` để tránh nhiều MongoDB tạm khởi động cùng lúc. Các phép thử chữ ký tải R2 đã được sửa để luôn thay sang một ký tự khác, tránh trường hợp chọn đúng ký tự cũ rồi báo sai là hệ thống chấp nhận chữ ký hỏng.

## Chạy lại và áp dụng

Từ `photobooth-be`, dùng cấu hình R2 hiện có, không cần sửa `.env`:

```powershell
node scripts/bench-album-latency.mjs --live-r2 --baseline=37da869 --photos=12 --rounds=2
```

Lệnh chỉ dùng cơ sở dữ liệu tạm và các file thử trong namespace riêng, rồi xóa chúng. Không có `--live-r2` thì không tải lên kho. Kết quả ở `.cache/bench-album-latency.json`; nhật ký file cần dọn được ghi trước khi tải để có thể phục hồi nếu tiến trình bị dừng.

Từ `photobooth-fe`, tái hiện lỗi lập lịch, không dùng mạng:

```powershell
node scripts/bench-original-wake.mjs --baseline=b6a62a1
```

Cập nhật backend và frontend, rồi kết thúc lượt chụp đang chạy và tải lại kiosk trên đúng hồ sơ trình duyệt. Không cần cài lại chương trình máy ảnh/máy in. Giữ dữ liệu trang để hàng IndexedDB tiếp tục gửi. Giới hạn băng thông vẫn giữ nguyên: muốn truyền cùng số byte nhanh hơn khi đường upload đã đầy cần tăng băng thông khả dụng; tăng số file gửi đồng thời không tự tạo thêm tốc độ đường truyền.
