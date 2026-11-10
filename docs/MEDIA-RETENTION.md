# Lưu ảnh 3 ngày, giữ sổ doanh thu

- Backend: `MEDIA_TTL_HOURS=72` trong môi trường chạy thực tế. `.env` ở PC và `render.yaml` đã đặt 72;
  nếu dịch vụ Render đang có biến riêng bằng 24, cần đổi thành 72 và triển khai lại backend.
- Mỗi ảnh và mọi bản sao của ảnh (gốc, preview, thumbnail, nguồn in, bản tải về) hết hạn sau 72 giờ
  kể từ lúc chụp. Video/ảnh ghép xoá theo ảnh cuối của album; file in hết hạn 72 giờ sau khi gửi.
- Backend chạy dọn lúc khởi động và mỗi 15 phút. File hết hạn bị chặn truy cập ngay; thời điểm xoá vật lý
  có thể trễ đến lượt dọn kế tiếp khi máy chủ đang chạy. Nếu kho ảnh lỗi, giữ tham chiếu để thử xoá lại.
- Khi vé hoàn tất hoặc đã huỷ quá hạn, hết ảnh/video/ảnh ghép/lệnh in: dọn tên, số điện thoại,
  link album và dữ liệu phiên chụp. Không xoá vé đang chụp hoặc vé hẹn tương lai.
- Giữ số tiền, ngày thu, phương thức thanh toán, chi nhánh, gói, số tờ, tiền bán thêm và mã đối soát
  để xem lại doanh thu và thu tiền theo ca. Các khoá chống ghi nhận tiền hai lần vẫn được giữ.
- Không thay đổi chất lượng ảnh trong 3 ngày được lưu. Thay đổi áp dụng cho cả ảnh cũ còn tồn tại;
  ảnh đã bị xoá theo chính sách 24 giờ trước đây không được khôi phục.

Triển khai backend trước rồi frontend. Tải lại trang không cập nhật được cấu hình backend.
Trong R2, nếu có rule xoá `media/` sau 2 ngày của cấu hình cũ, đổi thành 4 ngày (dự phòng cho backend);
rule 2 ngày sẽ xoá ảnh trước hạn 72 giờ. Khoá R2 hiện có không cho đọc cấu hình lifecycle (HTTP 403),
nên cần kiểm tra rule này trong Cloudflare Dashboard.
