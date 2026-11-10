# Đo gửi ảnh/video lên R2 — 10/11/2026

Đo trên máy và mạng hiện tại bằng Chromium 153.0.8010.12, tải tệp thật lên R2. Đây là phép đo đường gửi tệp, không phải thời gian khách quét QR đến khi lưu xong trên điện thoại tại tiệm.

## Kết quả bản mới nhất

Một cặp chạy đầy đủ, thứ tự mới → cũ sau khi làm nóng kết nối. Bản cũ lấy từ commit `df7946e`: gửi lần lượt ảnh gốc, video chạy độc lập. Bản mới có tối đa hai lượt truyền tệp lớn, tối đa ba ảnh trong các bước chuẩn bị/gửi/chờ xác nhận; trả lượt truyền ngay khi PUT hoàn tất, trước khi chờ API xác nhận. Không thay bộ mã hóa ảnh/video.

| Mốc hoàn tất | Cũ | Mới nhất | Cũ / mới |
| --- | ---: | ---: | ---: |
| Đủ 12 ảnh và tệp video thử | 111,075 giây | 47,840 giây | 2,32 lần |
| Riêng tệp video thử | 17,514 giây | 11,724 giây | 1,49 lần |

Thời gian gửi đủ bộ giảm 56,9% trong lượt này. **Lượt cũ có khoảng chờ 49,735 giây giữa ảnh thứ 6 và thứ 7**, vì vậy không coi 2,32 lần là mức cải thiện cố định. Băng thông và độ trễ R2 thay đổi theo thời điểm.

## Dữ liệu và cách đo

- Cùng dữ liệu trong mỗi cặp so sánh: 12 lượt gửi JPEG 6240 × 4160 px (25,96 MP), mỗi lượt 15.856.567 byte; một tệp dữ liệu ngẫu nhiên 31.457.280 byte (30 MiB) mang MIME `video/mp4`. Tổng 221.736.084 byte, khoảng 211,46 MiB. JPEG được tạo bằng dữ liệu tổng hợp, không dùng ảnh khách.
- Tệp video là payload thử truyền dữ liệu, không phải video được ghép/phát để đo. Phép đo không tính quay, ghép hoặc mã hóa video.
- Trình duyệt dùng origin `https://mellowptb.com` trong trang thử bị chặn bởi Playwright; các PUT đi thẳng lên R2, có kiểm tra CORS thật. Các đường API xin URL/xác nhận được xử lý bởi fixture cục bộ: ký URL thật, kiểm tra header JPEG từ R2 hoặc HEAD video, rồi trả xác nhận. Không gọi API sản xuất hoặc MongoDB; thời gian Render/MongoDB không nằm trong kết quả.
- Mọi tệp đã có sẵn lúc bắt đầu mỗi lượt. Thực tế ảnh được gửi dần trong lúc chụp nên thời gian còn chờ sau QR sẽ khác. Phép đo chỉ có một máy, một album, không mô phỏng nhiều phòng cùng dùng mạng tiệm.
- Mỗi lượt xác nhận đủ 13 tệp tải trực tiếp, không dùng đường gửi qua máy chủ. Đọc lại một JPEG và một payload video mỗi lượt, đối chiếu SHA-256 với dữ liệu nguồn. Mẫu kiểm tra khớp nguyên byte.
- Các tệp dùng namespace UUID riêng. Đã xóa tệp của từng lượt, xóa kiểm tra lần cuối và xác nhận namespace trống. Đã kiểm tra không còn tệp có prefix `bench-album-upload-` sau phép đo. Không sửa đơn hàng hoặc file ảnh khách.

## Các lượt trước và giới hạn kết luận

Bản thử trước khi tách bước truyền/xác nhận đã có một cặp đo: 59,162 → 32,129 giây cho đủ bộ (1,84 lần), video 10,580 → 9,900 giây. Một lượt lặp tiếp theo đã gửi xong bản mới trong 84,862 giây nhưng bị ngắt khi bản cũ mới xong 4 ảnh; lượt không hoàn tất này bị loại khỏi phép tính tỷ lệ. Năm tệp còn lại của lượt bị ngắt đã được dọn riêng và kiểm tra trống.

Các số trên cho thấy dao động mạng đáng kể. Không gộp các phiên bản triển khai khác nhau thành một mức trung bình, và không so trực tiếp 32,129 với 47,840 giây để kết luận bước tối ưu sau nhanh/chậm hơn. Bản cuối chỉ có **một cặp so sánh đầy đủ**; cần đo nhiều cặp trên PC tại tiệm trước khi đưa ra thời gian cam kết.

Số liệu gốc, checksum nguồn code đã chạy và các mốc nhận ảnh được lưu tại [benchmarks/album-upload-2026-11-10.json](./benchmarks/album-upload-2026-11-10.json). Checksum code đang mở đã được đối chiếu với bản được đo. Kiểm tra chức năng: 191 unit test, 20 browser test và build đều đạt.

## Đo lại

Từ thư mục `photobooth-fe`, dùng cấu hình R2 trong backend và Playwright đã cài:

```powershell
node scripts/bench-album-upload.mjs --live-r2 --baseline=df7946e --rounds=2
```

Hai vòng đổi thứ tự cũ/mới để giảm ảnh hưởng thời điểm chạy. Lệnh tạo dữ liệu giả, tải lên R2 rồi xóa các tệp riêng của nó; không kết nối MongoDB. Kết quả JSON mặc định ở `.cache/bench-album-upload.json`. Chạy không có `--live-r2` chỉ hiện hướng dẫn, không tải dữ liệu lên kho. Nhật ký tệp cần dọn được ghi vào `.cache/bench-album-upload-*-cleanup.json` trước khi cấp URL, để còn tham chiếu nếu tiến trình bị dừng đột ngột.
