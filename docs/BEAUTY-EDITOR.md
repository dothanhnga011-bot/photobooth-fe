# Làm đẹp ảnh Selfbooth — 17/11/2026

Mở album Selfbooth, chạm một ảnh trong thư viện để vào **Làm đẹp**. Màn rộng đặt ảnh bên trái, bảng chỉnh bên phải; điện thoại đặt bảng chỉnh dưới ảnh. Bảng cuộn riêng, nút **Xong** luôn ở dưới màn hình. Giữ màu sứ, be và nâu của album.

## Cách dùng

1. Đợi trạng thái **Đã nhận diện … khuôn mặt**. Chọn nhanh **Tự nhiên**, **Rạng rỡ** hoặc **Hồng nhẹ**, hoặc tự kéo các thanh 0–100. Mặc định vẫn là ảnh chưa chỉnh.
2. Mục **Tất cả** có 10 thanh; cuộn bảng để xem đủ, hoặc chọn nhóm **Da / Khuôn mặt / Mắt / Trang điểm**. Mục **Màu ảnh** giữ các bộ lọc đang có.
3. Bấm **So sánh ảnh gốc** để chuyển qua lại mà không xoá các mức đã chọn. Nút **1× / 2×** phóng vùng mặt để xem kỹ, chỉ ảnh hưởng màn xem trước.
4. **Đặt lại** đưa toàn bộ mức chỉnh và bộ lọc về ảnh gốc. **Xong** trở lại thư viện; ảnh nhỏ lúc này cũng hiện bản đã chỉnh.

| Thanh chỉnh | Tác dụng |
| --- | --- |
| Mịn da | Giảm nhiễu độ sáng và lệch màu nhẹ trong vùng da, bảo vệ mắt, mày và môi |
| Sáng da | Nâng sáng vùng da có mặt nạ, giữ sắc da và hạn chế cháy sáng |
| Thon mặt | Thu gọn vùng hàm dưới |
| Mắt to | Tăng nhẹ kích thước vùng mắt |
| Tròng mắt | Tăng kích thước mống mắt trong giới hạn mí; bỏ qua mống mắt không xác định rõ |
| Thu gọn mũi | Thu ngang vùng mũi, tác động dọc nhẹ |
| Thu gọn miệng | Thu vùng miệng |
| Giảm quầng thâm | Nâng nhẹ vùng tối dưới mắt theo màu vùng má của chính người đó |
| Son môi | Tô theo viền môi, chừa phần trong miệng và răng |
| Má hồng | Thêm màu nhẹ trên vùng gò má |

Các mức áp dụng cho những khuôn mặt nhận diện được trong ảnh đang mở. Ảnh quá nghiêng, bị che hoặc mắt nhắm có thể không nhận đủ vùng để chỉnh. Khi chưa nhận diện được, web báo rõ và khoá các thanh theo khuôn mặt; bộ lọc màu vẫn dùng được. Bấm **Nhận diện lại** khi cần, thay vì kéo thanh mà không biết có tác dụng hay không.

## Chất lượng và tốc độ

- Tách phần xử lý điểm ảnh sang image worker, có đường tương thích khi trình duyệt không hỗ trợ. Bản xem trước đã lỗi thời bị bỏ; không xếp mọi nhịp kéo thanh thành công việc xử lý ảnh đầy đủ.
- Những chỉnh hình dáng cùng một khuôn mặt được gộp vào một lần lấy mẫu, tránh co mắt, mũi, miệng và hàm qua nhiều bản ảnh nối tiếp.
- Tăng cạnh dài của ảnh xem nhỏ đã chỉnh từ 420 lên tối đa 720 px. Cache theo pixel, tối đa khoảng 8 triệu pixel / 24 mục; không giải phóng canvas còn đang được chỗ khác dùng. Rời album bỏ tham chiếu cache.
- Đang mở bảng làm đẹp thì thư viện phía sau tạm dừng tạo lại thumbnail. Bấm Xong mới tạo bản nhỏ mới nhất.
- Preview, ghép khung, tải từng ảnh đã chỉnh và bản in dùng cùng bộ công thức. Kích thước và codec của bản xuất hiện tại không giảm; không có bước nén JPEG trung gian mới.
- Ảnh gốc được giữ riêng. **Tải tất cả** ở thư viện tiếp tục tải các file gốc; nút tải của từng ảnh đã chỉnh và bản ghép/in áp dụng chỉnh sửa. Các chỉnh được giữ trong trình duyệt đang dùng, không tự đồng bộ sang điện thoại khác.
- Bộ nhận diện và WASM đóng gói cùng web; xử lý làm đẹp trên máy khách. Không thêm API gửi khuôn mặt tới dịch vụ làm đẹp bên ngoài. Bộ nhận diện tải khi mở phần làm đẹp lần đầu.
- Nếu nạp bộ nhận diện lỗi có thể thử lại. Nếu graph xử lý bị lỗi, lần nhận diện sau tạo graph mới và đóng graph cũ.

## Kiểm tra và áp dụng

Đã kiểm tra model thật với ảnh mẫu trong dự án, tác động điểm ảnh của cả 10 mức, vùng được bảo vệ, độ trong suốt, đặt lại, so sánh, model tải lỗi, lỗi suy luận và đường tương thích không có worker. Kết quả worker và đường tương thích được đối chiếu trên cùng nguồn đầy đủ. Kiểm tra bố cục ở 320×568, 390×844 và 1366×768 bằng Chromium.

Các bộ liên quan đều đạt: 252 kiểm tra đơn vị FE và 52 ca trình duyệt riêng biệt, gồm thư viện, ghép, in, upload, chụp và độ nét tờ in. Build production thành công. Chưa in giấy hay thử trên iPhone thật; chưa triển khai production.

Thay đổi này chỉ ở frontend. Phát hành frontend rồi tải lại album để dùng; không cần sửa `.env`, nâng cơ sở dữ liệu hay cài lại chương trình in. Dữ liệu chỉnh cũ vẫn đọc được, sáu mức mới khởi tạo bằng 0.

Tham chiếu kỹ thuật: [cấu trúc vùng mặt MediaPipe](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py), [Face Landmarker cho web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker?tab=Web).
