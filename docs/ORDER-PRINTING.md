# In ảnh từ đơn hàng

Mở **Đơn hàng → In ảnh** để đọc lại dữ liệu của đúng đơn, thay vì dùng bản chụp dữ liệu lúc tải danh sách. Hộp tự kiểm tra mỗi 10 giây khi đang mở; có thể bấm **Làm mới**. Lỗi tải được hiển thị riêng, không được coi là đơn chưa có file.

## Mã chụp trước khi in

Mã cấp ở quầy chỉ dùng một lần trong hai giờ từ lúc xác nhận đã thu tiền. **Tạo mã** không còn ô Chi nhánh: chọn gói thì hệ thống tự chọn máy/phòng phù hợp; nếu có nhiều máy phù hợp, chọn theo tên máy. Máy chủ lấy chi nhánh từ phòng đó, không nhận giá trị chi nhánh do form tạo mã gửi lên. Màn xác nhận hiển thị tên phòng.

Chỉ chọn được máy đang hoạt động, đúng loại gói, thuộc phạm vi tài khoản và áp dụng bảng giá của gói. Gói tờ 10 × 15 dùng ở Photobooth; gói tờ 20 × 30 dùng ở Selfbooth. Cả hai loại đều có thể thanh toán tại quầy, nhận mã rồi nhập trên kiosk; PTB còn có luồng tiền mặt tại máy. Máy chủ tiếp tục kiểm tra loại phòng và phạm vi sử dụng khi tạo, kích hoạt và nhập mã.

**Quản lý máy → Thêm mới / Chỉnh sửa** cũng không còn ô Chi nhánh / địa chỉ. Sửa máy giữ thông tin nội bộ đang có; thêm máy lấy chi nhánh của tài khoản nếu có, nếu không thì lấy từ máy hiện có (ưu tiên máy đang hoạt động). Tiệm chưa có máy nào dùng giá trị nội bộ “Mặc định”. Các bản in và mã cũ giữ thông tin đã lưu.

Nếu kiosk báo mã thuộc chi nhánh khác, kiểm tra chi nhánh của phiếu và phòng đang gán cho kiosk trong Quản lý máy. Giữ giới hạn chi nhánh khi sửa cấu hình. Mã đã thu tiền nhưng chưa chụp cần đối chiếu đơn cũ trước khi xử lý, tránh tạo thêm đơn đã thu lần hai.

Để áp dụng bản sửa cấp mã, cập nhật backend và frontend; tải lại trang quầy/kiosk sau khi phát hành. Việc sửa code không tự chuyển chi nhánh, sửa doanh thu hoặc gia hạn các mã cũ.

## File in đã lưu

- Chọn trong 20 lượt in gần nhất còn hạn, xem từng tờ hoặc mở file đầy đủ. Khổ giấy lấy từ file in thực tế, vì khung khách chọn có thể khác khổ gói.
- Số bộ nhân với số tờ trong bộ là số tờ 10 × 15 cm cần in. Khổ nhỏ cắt mỗi tờ thành hai dải. Mỗi thao tác RX1 giới hạn 20 tờ, tổng file gửi tối đa 64 MB.
- **In lại qua RX1** gửi bytes PNG/JPEG đầy đủ đến chương trình in trên chính PC đang dùng. Không gửi ảnh thumbnail, không nén lại và không tự chuyển sang hàng chờ trên máy chủ khi không thấy RX1.
- Bộ in áp dụng mức gamma trong `rx1-output.json` hoặc mặc định của script (hiện là 1.50), DPI cao nhất driver hỗ trợ và chế độ cắt của file. RX1 cần được cắm vào PC đang mở hộp này; thao tác không điều khiển máy in ở một PC khác.
- Quản trị chỉnh gamma/DPI/độ nét và **Dời đường cắt dải** tại **Thiết lập → Màu in RX1** rồi lưu để các bộ in đã cập nhật tự nhận.
  Mục này có trạng thái mức đã nhận của từng máy; không cần sửa file thủ công cho các lần đổi sau.
- “Đã gửi tới hàng in” chỉ xác nhận Windows đã nhận lệnh, không khẳng định giấy đã ra. Cần kiểm tra khay máy khi mất xác nhận.
- In lại là thao tác hỗ trợ, không trừ hạn mức và không cộng tiền. Khách mua thêm bản in vẫn dùng **Thêm lượt in** để ghi nhận thu tiền và cộng quyền in.

## In từ ảnh ghép

Đơn PTB chưa có file in đã lưu nhưng album có ảnh ghép khung (vé chỉ nhận ảnh qua QR, hoặc lượt chụp trước 22/11 mà RX1 lỗi) hiện ảnh ghép kèm **In từ ảnh ghép** và **Chỉ lưu file in**. Ảnh ghép là đúng khung, màu, chữ, nhãn dán khách đã chọn; trang làm thành tờ PNG 2400 × 3600 như máy chụp (vé dải nhỏ: máy cắt đôi), in qua RX1 trên PC đang mở rồi lưu vào đơn — lần sau chỉ cần **In lại qua RX1**.

## Ghép ảnh để in

**Ghép ảnh để in / Ghép ảnh thủ công** mở đúng hai màn của máy chụp trên toàn màn hình: chọn khung, rồi chạm ảnh để đặt vào khung (chạm lại ảnh hoặc ô trên khung để bỏ, các ô khác giữ nguyên), chỉnh / phóng ảnh, màu ảnh, thêm chữ, nhãn dán. Thanh trên cùng: thêm ảnh từ máy quầy, số bộ in, và **In qua RX1 & lưu file** hoặc **Chỉ lưu file in** (PC không cắm RX1: file lưu vào đơn với trạng thái chưa gửi máy in, in sau bằng In lại qua RX1). Ảnh gốc còn đang tải lên không dùng làm nguồn in. Tờ in là PNG 2400 × 3600 px từ ảnh gốc, cùng chương trình in và chế độ cắt như máy chụp. Vé Selfbooth (20 × 30) không ghép ở quầy: khách ghép và gửi in trên điện thoại, nhân viên in ở Hàng chờ in.

## Cắt dải 5 × 15

Tờ cắt đôi được in đúng 4 × 6 inch như thiết kế (tờ nguyên vẫn phóng nhẹ cho phủ kín phần tràn lề của giấy); phần tràn lề lấp bằng màu mép kéo dài, nên mép ngoài hai dải không mất nội dung. Dao cắt 2 inch của mỗi máy RX1 có thể lệch vài mm: bấm **In thử đường cắt** ở danh sách máy in (trang Màu in RX1). Tờ thử có thước vạch 0,5 mm quanh giữa tờ (vạch đỏ 0 = giữa thiết kế, nền xanh bên trái / hồng bên phải) và thước 0–5 mm ở mép ngoài. Số ở vạch sát mép cắt (hai dải cùng một số) là độ lệch: nhập đúng số đó vào **Dời đường cắt dải** (±5 mm, bước 0,1 mm, dương = dời nội dung sang dải phải) rồi Lưu. Chỉ tờ cắt đôi bị dời; bộ in cũ chưa cập nhật không nhận lệnh in thử đường cắt.

## Lưu file và chống trùng

Máy chụp in trực tiếp trước, rồi **luôn** lưu tờ in vào hàng tải lên IndexedDB — cả khi RX1 không nhận (khi đó `/albums/:token/print-archive?result=failed`: file lưu với trạng thái lỗi để nhân viên kiểm tra khay rồi In lại qua RX1). File in tải lên ngay sau ảnh xem trước và ảnh ghép của khách, trước ảnh gốc 15 MB, nên mở Đơn hàng vài phút sau buổi chụp đã có file. Endpoint chỉ lưu file và tính hạn mức một lần, **không phát lệnh in**. Mất mạng chỉ thử tải file lên lại trong tối đa 24 giờ, không gửi lại giấy và không đổi trạng thái in thành lỗi mạng.

In hỗ trợ dùng UUID được giữ trong phiên trình duyệt và nhật ký chống trùng của bộ in. Nếu RX1 đã nhận file mà bước lưu lịch sử lỗi, nút chuyển thành **Lưu kết quả in**: thử lại chỉ ghi lịch sử, không gửi giấy thêm. Nhân viên vẫn cần kiểm tra khay khi mất phản hồi từ bộ in.

Các lượt in lại chia sẻ bytes nguồn và giữ đúng hạn lưu của nguồn. Xóa một lượt không xóa file mà lượt khác còn dùng; xóa lượt hỗ trợ không hoàn lại hạn mức chưa từng bị trừ.

## Áp dụng bản cập nhật

Cập nhật backend trước để có các endpoint đọc/lưu mới, rồi triển khai frontend. Với file JPEG cũ 1181 × 1772 px, cập nhật chương trình in trên PC RX1 sau khi web đã phát hành và khi không còn lệnh đang xử lý. Các bản in DNP trước đây chỉ in cục bộ mà chưa lưu tờ in: dùng **In từ ảnh ghép** (album còn ảnh ghép) hoặc ghép thủ công từ ảnh gốc còn hạn. Dời đường cắt dải cần cả backend (lưu `stripShift`) và chương trình in mới (tự cập nhật từ `/downloads/print-agent-dnp.ps1`; mở lại chương trình in nếu trang Màu in RX1 báo chưa hỗ trợ).
