# Selfbooth: khách gửi lệnh lên web, quầy chọn cơ sở và in

Luồng Selfbooth dùng Fujifilm X-T3 / X-S10 / X-S20 vẫn nhận JPEG từ thư mục FUJIFILM X Acquire. Khách quét QR, chọn ảnh, làm đẹp, ghép khung và bấm **Gửi in** trên điện thoại. Web lưu tờ 20 × 30 và báo cho quầy; không tự gửi tờ này đến RX1 hay chương trình in nền.

## Tại quầy

1. Mở **Hàng chờ in**. Quản trị chọn **Bắc Ninh** hoặc **Bắc Giang**; trang nhớ cơ sở trên trình duyệt này. Tài khoản nhân viên tự theo cơ sở được phân công, không đổi sang cơ sở khác.
2. Tab **Chờ in** chỉ hiện lệnh Selfbooth của cơ sở đang chọn. Huy hiệu menu, thông báo và chuông lệnh mới cũng theo cơ sở đó. Hai cơ sở có số đang chờ và lịch sử đã in riêng.
3. Bấm **In 20×30** ở đúng vé. Cho phép cửa sổ bật lên, chọn **DNP DS820**, giấy **8 × 12 inch**, hướng ngang, tỉ lệ 100%, không lề, không đầu/chân trang. Tờ dọc tự xoay cho vừa giấy ngang.
4. Nhận được giấy in rồi bấm **Đã in**. Đóng/hủy hộp thoại in không tự đánh dấu đã in. Khi in hỏng, có thể mở bản in lại; tab **Đã in** có nút **In lại**.

Cơ sở lấy từ vé/lệnh in đã lưu. Các cơ sở cũ khác vẫn có mục riêng; lệnh không có cơ sở hiện **Chưa phân cơ sở**, không tự đoán là Bắc Ninh hay Bắc Giang. Phòng và tài khoản nhân viên cần mang đúng cơ sở trước khi cấp vé mới. Không chuyển cơ sở của các vé cũ trong lần sửa này.

Các tờ in đi qua API giữ nguyên byte PNG/JPEG 2400 × 3600 hoặc 3600 × 2400; không dùng thumbnail để in. Ảnh gốc và chất lượng album giữ nguyên. Lệnh và file in vẫn theo hạn lưu 3 ngày. Gửi lại cùng mã yêu cầu không tạo thêm lệnh hoặc trừ thêm tờ của vé.

Luồng PTB tiếp tục in RX1 như trước. Chương trình in tự động bỏ qua khổ `large`, kể cả lệnh cũ đang ở trạng thái `queued` hoặc chương trình cũ yêu cầu nhận tờ DS820.

## Triển khai và kiểm tra

Cập nhật backend trước, sau đó frontend, rồi tải lại trang quầy. Đây là luồng in qua trình duyệt trên PC cắm DS820, không cần chương trình in DS820 riêng. Không chạy lại bộ cài RX1 chỉ để dùng hàng chờ Selfbooth.

Đã kiểm tra bằng MongoDB tạm, API và Chromium: gửi lệnh đúng cơ sở, giữ nguyên byte tờ in, gửi lại không trùng, tách danh sách/số chờ/SSE, từ chối nhân viên truy cập cơ sở khác, chuyển cơ sở khi phản hồi chậm không hiện nhầm nút in, mở đủ tờ trong cửa sổ in và chuyển sang Đã in. Các kiểm tra không phát giấy trên máy in thật và không thay đổi dữ liệu tại tiệm.
