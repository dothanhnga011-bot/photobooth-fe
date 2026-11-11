# In ảnh từ đơn hàng

Mở **Đơn hàng → In ảnh** để đọc lại dữ liệu của đúng đơn, thay vì dùng bản chụp dữ liệu lúc tải danh sách. Hộp tự kiểm tra mỗi 10 giây khi đang mở; có thể bấm **Làm mới**. Lỗi tải được hiển thị riêng, không được coi là đơn chưa có file.

## Mã chụp trước khi in

Mã cấp ở quầy chỉ dùng một lần tại phòng photobooth **cùng chi nhánh**, trong hai giờ từ lúc xác nhận đã thu tiền. Chọn đúng chi nhánh trước khi tạo phiếu; màn xác nhận và mã đã cấp đều hiển thị chi nhánh dùng mã.

Danh sách cấp mã chỉ có chi nhánh còn phòng photobooth hoạt động. Chi nhánh chỉ có Polaroid không bán mã DNP; khách Polaroid chọn layout trên máy rồi trả tiền tại quầy. Máy chủ cũng kiểm tra điều này khi tạo phiếu, cấp mã trực tiếp và kích hoạt phiếu.

Nếu kiosk báo mã thuộc chi nhánh khác, kiểm tra chi nhánh của phiếu và phòng đang gán cho kiosk trong Quản lý máy. Giữ giới hạn chi nhánh khi sửa cấu hình. Mã đã thu tiền nhưng chưa chụp cần đối chiếu đơn cũ trước khi xử lý, tránh tạo thêm đơn đã thu lần hai.

Để áp dụng bản sửa cấp mã, cập nhật backend và frontend; tải lại trang quầy/kiosk sau khi phát hành. Việc sửa code không tự chuyển chi nhánh, sửa doanh thu hoặc gia hạn các mã cũ.

## File in đã lưu

- Chọn trong 20 lượt in gần nhất còn hạn, xem từng tờ hoặc mở file đầy đủ. Khổ giấy lấy từ file in thực tế, vì khung khách chọn có thể khác khổ gói.
- Số bộ nhân với số tờ trong bộ là số tờ 10 × 15 cm cần in. Khổ nhỏ cắt mỗi tờ thành hai dải. Mỗi thao tác RX1 giới hạn 20 tờ, tổng file gửi tối đa 64 MB.
- **In lại qua RX1** gửi bytes PNG/JPEG đầy đủ đến chương trình in trên chính PC đang dùng. Không gửi ảnh thumbnail, không nén lại và không tự chuyển sang hàng chờ trên máy chủ khi không thấy RX1.
- Bộ in áp dụng mức gamma trong `rx1-output.json` hoặc mặc định của script (hiện là 1.50), DPI cao nhất driver hỗ trợ và chế độ cắt của file. RX1 cần được cắm vào PC đang mở hộp này; thao tác không điều khiển máy in ở một PC khác.
- Quản trị chỉnh gamma/DPI tại **Thiết lập → Màu in RX1** rồi lưu để các bộ in đã cập nhật tự nhận.
  Mục này có trạng thái mức đã nhận của từng máy; không cần sửa file thủ công cho các lần đổi sau.
- “Đã gửi tới hàng in” chỉ xác nhận Windows đã nhận lệnh, không khẳng định giấy đã ra. Cần kiểm tra khay máy khi mất xác nhận.
- In lại là thao tác hỗ trợ, không trừ hạn mức và không cộng tiền. Khách mua thêm bản in vẫn dùng **Thêm lượt in** để ghi nhận thu tiền và cộng quyền in.

## Ghép ảnh để in

Khi chưa có file, có thể chọn ảnh gốc trong album hoặc thêm ảnh từ PC, chọn khung, chỉnh từng ô và xem trước. Ảnh gốc còn đang tải lên không được chọn làm nguồn in. File RX1 được ghép thành PNG 2400 × 3600 px hoặc ngang từ ảnh gốc, gửi cùng chương trình in như kiosk rồi lưu vào lịch sử đơn. Khổ Instax tải file để dùng chương trình Instax riêng.

## Lưu file và chống trùng

Kiosk DNP in trực tiếp trước, sau khi bộ in xác nhận thì lưu tờ in vào hàng tải lên IndexedDB. Lần tải nền gọi `/albums/:token/print-archive`, endpoint chỉ lưu file và tính hạn mức một lần, **không phát lệnh in**. Mất mạng chỉ thử tải file lên lại trong tối đa 24 giờ, không gửi lại giấy và không đổi trạng thái in thành lỗi mạng.

In hỗ trợ dùng UUID được giữ trong phiên trình duyệt và nhật ký chống trùng của bộ in. Nếu RX1 đã nhận file mà bước lưu lịch sử lỗi, nút chuyển thành **Lưu kết quả in**: thử lại chỉ ghi lịch sử, không gửi giấy thêm. Nhân viên vẫn cần kiểm tra khay khi mất phản hồi từ bộ in.

Các lượt in lại chia sẻ bytes nguồn và giữ đúng hạn lưu của nguồn. Xóa một lượt không xóa file mà lượt khác còn dùng; xóa lượt hỗ trợ không hoàn lại hạn mức chưa từng bị trừ.

## Áp dụng bản cập nhật

Cập nhật backend trước để có các endpoint đọc/lưu mới, rồi triển khai frontend. Với file JPEG cũ 1181 × 1772 px, cập nhật chương trình in trên PC RX1 sau khi web đã phát hành và khi không còn lệnh đang xử lý. Các bản in DNP trước đây chỉ in cục bộ mà chưa lưu tờ in không thể tự khôi phục file chất lượng in; dùng ghép thủ công từ ảnh gốc còn hạn.
